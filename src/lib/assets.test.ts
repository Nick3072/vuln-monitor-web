/**
 * src/lib/assets.test.ts
 *
 * lib/assets.ts 의 순수 헬퍼 + D1 데이터 함수 단위 테스트.
 * node:sqlite D1 shim + 실제 마이그레이션(0001~0006) 적용.
 *
 * 주의: ExperimentalWarning (node:sqlite) 은 정상 — 무시.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createD1ShimWithRaw, applyMigrations } from '../../test/d1-shim'
import type { D1DatabaseShim } from '../../test/d1-shim'
import {
  deriveAssetName,
  resolveOrCreateAsset,
  getAssetById,
  updateAsset,
  deleteAssetCascade,
  getAssetsWithComponents,
  countUnlinkedComponents,
  backfillAssets,
} from './assets'

// D1Database 타입을 shim 으로 캐스팅하는 헬퍼
function asDb(shim: D1DatabaseShim): D1Database {
  return shim as unknown as D1Database
}

// 공통 픽스처 — 각 테스트 전 새로운 인메모리 DB 생성
function makeDb() {
  const shim = createD1ShimWithRaw()
  applyMigrations(shim)
  return shim
}

// ─ 시드 헬퍼 ─────────────────────────────────────────────────

async function seedSolution(
  db: D1DatabaseShim,
  overrides: Partial<{
    vendor: string
    product: string
    category: string
    current_version: string
    hostname: string | null
    group_company: string | null
    owner: string | null
    is_vulnerable: number
    asset_id: number | null
  }> = {},
): Promise<number> {
  const values = {
    vendor: 'TestVendor',
    product: 'TestProduct',
    category: 'OS',
    current_version: '1.0',
    hostname: null,
    group_company: null,
    owner: null,
    is_vulnerable: 0,
    asset_id: null,
    ...overrides,
  }
  const result = await db
    .prepare(
      `INSERT INTO solutions
         (vendor, product, category, current_version, hostname, group_company, owner, is_vulnerable, asset_id,
          cpe_part, cpe_version_range, aliases, vendor_normalized, product_normalized,
          cpe_uri, category_attributes, source, embedding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '[]', ?, ?, NULL, NULL, 'test', 'pending')`,
    )
    .bind(
      values.vendor,
      values.product,
      values.category,
      values.current_version,
      values.hostname,
      values.group_company,
      values.owner,
      values.is_vulnerable,
      values.asset_id,
      values.vendor.toLowerCase(),
      values.product.toLowerCase(),
    )
    .run()
  return result.meta.last_row_id
}

async function seedMatchedVuln(db: D1DatabaseShim, solutionId: number): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO matched_vulns (solution_id, cve_id, source, severity, detected_at)
       VALUES (?, 'CVE-2024-0001', 'test', 'high', CURRENT_TIMESTAMP)`,
    )
    .bind(solutionId)
    .run()
  return result.meta.last_row_id
}

// ─────────────────────────────────────────────────────────────
// 1. deriveAssetName 우선순위 테스트
// ─────────────────────────────────────────────────────────────
describe('deriveAssetName', () => {
  it('HW 카테고리가 있으면 HW product 를 반환한다', () => {
    const comps = [
      { category: 'OS', product: 'Ubuntu', vendor: 'Canonical' },
      { category: 'HW', product: 'FortiGate-100F', vendor: 'Fortinet' },
      { category: 'DB', product: 'MySQL', vendor: 'Oracle' },
    ]
    expect(deriveAssetName(comps, 'fw-01')).toBe('FortiGate-100F')
  })

  it('HW 없으면 OS product 를 반환한다', () => {
    const comps = [
      { category: 'DB', product: 'PostgreSQL', vendor: 'PostgreSQL' },
      { category: 'OS', product: 'CentOS', vendor: 'CentOS' },
    ]
    expect(deriveAssetName(comps, null)).toBe('CentOS')
  })

  it('HW/OS/FW 없으면 첫 컴포넌트의 "vendor product" 반환', () => {
    const comps = [{ category: 'DB', product: 'MySQL', vendor: 'Oracle' }]
    expect(deriveAssetName(comps, null)).toBe('Oracle MySQL')
  })

  it('컴포넌트 없고 hostname 있으면 hostname 반환', () => {
    expect(deriveAssetName([], 'my-host')).toBe('my-host')
  })

  it('컴포넌트도 hostname 도 없으면 "unnamed" 반환', () => {
    expect(deriveAssetName([], null)).toBe('unnamed')
  })

  it('hostname 비어있으면 "unnamed" 반환', () => {
    expect(deriveAssetName([], '')).toBe('unnamed')
  })
})

// ─────────────────────────────────────────────────────────────
// 2. resolveOrCreateAsset — 동일 (group, hostname) 은 같은 id
// ─────────────────────────────────────────────────────────────
describe('resolveOrCreateAsset', () => {
  it('같은 (group_company, hostname) 이면 동일 id 반환', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const key = { name: '테스트장비', vendor: 'V', hostname: 'host-01', group_company: '공용', owner: null }
    const id1 = await resolveOrCreateAsset(db, key)
    const id2 = await resolveOrCreateAsset(db, key)
    expect(id1).toBe(id2)
    expect(typeof id1).toBe('number')
  })

  it('hostname 이 null 이면 호출마다 새로운 id 반환', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const key = { name: 'Standalone', vendor: 'V', hostname: null, group_company: '공용', owner: null }
    const id1 = await resolveOrCreateAsset(db, key)
    const id2 = await resolveOrCreateAsset(db, key)
    expect(id1).not.toBe(id2)
  })

  it('빈 문자열 hostname 도 null 처럼 처리되어 매번 신규 id 반환', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const key = { name: 'Standalone', vendor: 'V', hostname: '', group_company: null, owner: null }
    const id1 = await resolveOrCreateAsset(db, key)
    const id2 = await resolveOrCreateAsset(db, key)
    expect(id1).not.toBe(id2)
  })
})

// ─────────────────────────────────────────────────────────────
// 3. backfillAssets — 메인 시나리오
// ─────────────────────────────────────────────────────────────
describe('backfillAssets', () => {
  it('같은 (group, hostname) 5개 컴포넌트 → 부모 1개로 묶음', async () => {
    const shim = makeDb()
    const db = asDb(shim)

    // 공용/PJ-FI-IDS — 5개 컴포넌트 (HW, OS, DB, Crypto, WEB)
    const categories = ['HW', 'OS', 'DB', 'Crypto', 'WEB']
    for (const cat of categories) {
      await seedSolution(shim, {
        category: cat,
        vendor: 'Fortinet',
        product: cat === 'HW' ? 'FortiGate-100F' : cat,
        hostname: 'PJ-FI-IDS',
        group_company: '공용',
      })
    }

    const result = await backfillAssets(db)
    expect(result.componentsLinked).toBe(5)
    expect(result.assetsCreated).toBe(1)

    // 생성된 asset 이름은 HW product 여야 함
    const asset = await shim
      .prepare('SELECT * FROM assets WHERE group_company = ? AND hostname = ?')
      .bind('공용', 'PJ-FI-IDS')
      .first<{ id: number; name: string }>()
    expect(asset).not.toBeNull()
    expect(asset!.name).toBe('FortiGate-100F')

    // 모든 컴포넌트가 같은 asset_id 로 연결
    const { results: linked } = await shim
      .prepare('SELECT DISTINCT asset_id FROM solutions WHERE hostname = ? AND group_company = ?')
      .bind('PJ-FI-IDS', '공용')
      .all<{ asset_id: number | null }>()
    expect(linked.length).toBe(1)
    expect(linked[0].asset_id).toBe(asset!.id)
  })

  it('hostname null 레거시 행 → 행마다 단독 자산', async () => {
    const shim = makeDb()
    const db = asDb(shim)

    await seedSolution(shim, { vendor: 'Oracle', product: 'MySQL', hostname: null, group_company: '공용' })
    await seedSolution(shim, { vendor: 'Apache', product: 'Tomcat', hostname: null, group_company: '공용' })

    const result = await backfillAssets(db)
    expect(result.assetsCreated).toBe(2)
    expect(result.componentsLinked).toBe(2)

    // asset 이름 확인
    const { results: assets } = await shim
      .prepare("SELECT name FROM assets ORDER BY name ASC")
      .all<{ name: string }>()
    expect(assets.map((a) => a.name).sort()).toEqual(['Apache Tomcat', 'Oracle MySQL'])
  })

  it('멱등 — 두 번째 호출은 0 을 반환', async () => {
    const shim = makeDb()
    const db = asDb(shim)

    await seedSolution(shim, { hostname: 'host-a', group_company: '공용' })
    await backfillAssets(db)
    const second = await backfillAssets(db)
    expect(second.assetsCreated).toBe(0)
    expect(second.componentsLinked).toBe(0)
  })

  it('이미 asset_id 있는 행은 skip', async () => {
    const shim = makeDb()
    const db = asDb(shim)

    // 미리 asset 생성 후 컴포넌트에 연결
    const existingAssetId = await resolveOrCreateAsset(db, {
      name: 'Existing',
      vendor: 'V',
      hostname: 'host-b',
      group_company: '공용',
      owner: null,
    })
    await seedSolution(shim, { hostname: 'host-b', group_company: '공용', asset_id: existingAssetId })

    const result = await backfillAssets(db)
    expect(result.componentsLinked).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────
// 4. getAssetsWithComponents — 취약 롤업 + 카테고리 필터
// ─────────────────────────────────────────────────────────────
describe('getAssetsWithComponents', () => {
  async function setupTwoAssets(shim: D1DatabaseShim) {
    const db = asDb(shim)
    // 자산 A: 컴포넌트 2개 (하나 취약)
    const assetAId = await resolveOrCreateAsset(db, {
      name: 'Asset-A',
      vendor: 'VA',
      hostname: 'host-a',
      group_company: '공용',
      owner: null,
    })
    const sol1 = await seedSolution(shim, { vendor: 'VA', product: 'OS-A', category: 'OS', hostname: 'host-a', group_company: '공용', asset_id: assetAId, is_vulnerable: 1 })
    await seedSolution(shim, { vendor: 'VA', product: 'DB-A', category: 'DB', hostname: 'host-a', group_company: '공용', asset_id: assetAId, is_vulnerable: 0 })
    // matched_vuln 추가 (취약 롤업 확인용)
    await seedMatchedVuln(shim, sol1)

    // 자산 B: 컴포넌트 1개 (취약 아님)
    const assetBId = await resolveOrCreateAsset(db, {
      name: 'Asset-B',
      vendor: 'VB',
      hostname: 'host-b',
      group_company: '공용',
      owner: null,
    })
    await seedSolution(shim, { vendor: 'VB', product: 'OS-B', category: 'OS', hostname: 'host-b', group_company: '공용', asset_id: assetBId, is_vulnerable: 0 })

    return { assetAId, assetBId }
  }

  it('취약 롤업: 한 컴포넌트 is_vulnerable=1 → asset.hasVulnerable=true, vulnerableCount=1', async () => {
    const shim = makeDb()
    await setupTwoAssets(shim)

    const db = asDb(shim)
    const result = await getAssetsWithComponents(db, {})
    expect(result.length).toBe(2)

    // 취약 자산이 먼저 정렬
    const first = result[0]
    expect(first.hasVulnerable).toBe(true)
    expect(first.vulnerableCount).toBe(1)
    expect(first.componentCount).toBe(2)
    expect(first.asset.name).toBe('Asset-A')
  })

  it('category 필터: OS 만 필터링하면 OS 컴포넌트가 있는 자산만 포함, DB 컴포넌트는 제외', async () => {
    const shim = makeDb()
    await setupTwoAssets(shim)

    const db = asDb(shim)
    const result = await getAssetsWithComponents(db, { category: 'OS' })
    // 두 자산 모두 OS 컴포넌트 있음
    expect(result.length).toBe(2)

    // Asset-A 의 컴포넌트는 OS 만 (DB 제외)
    const assetA = result.find((r) => r.asset.name === 'Asset-A')
    expect(assetA).toBeDefined()
    expect(assetA!.components.every((c) => c.category === 'OS')).toBe(true)
    expect(assetA!.componentCount).toBe(1)
  })

  it('category 필터: HW 로 필터링하면 HW 컴포넌트 없는 자산 제외', async () => {
    const shim = makeDb()
    await setupTwoAssets(shim)

    const db = asDb(shim)
    const result = await getAssetsWithComponents(db, { category: 'HW' })
    expect(result.length).toBe(0)
  })

  it('정렬: hasVulnerable 우선 → asset.name 오름차순', async () => {
    const shim = makeDb()
    const db = asDb(shim)

    // 비취약 자산 Z 먼저 등록
    const assetZId = await resolveOrCreateAsset(db, { name: 'Z-Asset', vendor: 'VZ', hostname: 'hz', group_company: null, owner: null })
    await seedSolution(shim, { vendor: 'VZ', product: 'p', category: 'OS', hostname: 'hz', asset_id: assetZId, is_vulnerable: 0 })

    // 취약 자산 A 나중에 등록
    const assetAId = await resolveOrCreateAsset(db, { name: 'A-Asset', vendor: 'VA', hostname: 'ha', group_company: null, owner: null })
    await seedSolution(shim, { vendor: 'VA', product: 'p', category: 'OS', hostname: 'ha', asset_id: assetAId, is_vulnerable: 1 })

    const result = await getAssetsWithComponents(db, {})
    expect(result[0].asset.name).toBe('A-Asset') // 취약이 먼저
    expect(result[1].asset.name).toBe('Z-Asset')
  })
})

// ─────────────────────────────────────────────────────────────
// 5. deleteAssetCascade — 컴포넌트 + matched_vulns 삭제
// ─────────────────────────────────────────────────────────────
describe('deleteAssetCascade', () => {
  it('자산 삭제 시 소속 컴포넌트 + matched_vulns 도 삭제', async () => {
    const shim = makeDb()
    const db = asDb(shim)

    const assetId = await resolveOrCreateAsset(db, { name: 'ToDelete', vendor: 'V', hostname: 'hd', group_company: null, owner: null })
    const solId1 = await seedSolution(shim, { hostname: 'hd', asset_id: assetId, is_vulnerable: 1 })
    const solId2 = await seedSolution(shim, { hostname: 'hd', asset_id: assetId, is_vulnerable: 0 })
    await seedMatchedVuln(shim, solId1)

    const result = await deleteAssetCascade(db, assetId)
    expect(result.deletedComponents).toBe(2)

    // asset 삭제 확인
    const asset = await shim.prepare('SELECT id FROM assets WHERE id = ?').bind(assetId).first<{ id: number }>()
    expect(asset).toBeNull()

    // solutions 삭제 확인
    const { results: sols } = await shim.prepare('SELECT id FROM solutions WHERE id IN (?, ?)').bind(solId1, solId2).all<{ id: number }>()
    expect(sols.length).toBe(0)

    // matched_vulns 삭제 확인
    const mv = await shim.prepare('SELECT id FROM matched_vulns WHERE solution_id = ?').bind(solId1).first<{ id: number }>()
    expect(mv).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────
// 6. updateAsset
// ─────────────────────────────────────────────────────────────
describe('updateAsset', () => {
  it('이름/노트 수정이 반영된다', async () => {
    const shim = makeDb()
    const db = asDb(shim)

    const assetId = await resolveOrCreateAsset(db, { name: 'OldName', vendor: 'V', hostname: null, group_company: null, owner: null })
    const updated = await updateAsset(db, assetId, {
      name: 'NewName',
      vendor: 'V2',
      hostname: null,
      group_company: null,
      owner: 'admin',
      notes: '메모',
    })
    expect(updated).toBe(true)

    const asset = await getAssetById(db, assetId)
    expect(asset?.name).toBe('NewName')
    expect(asset?.owner).toBe('admin')
    expect(asset?.notes).toBe('메모')
  })

  it('존재하지 않는 id 면 false 반환', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const updated = await updateAsset(db, 99999, { name: 'X', vendor: null, hostname: null, group_company: null, owner: null, notes: null })
    expect(updated).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// 7. countUnlinkedComponents
// ─────────────────────────────────────────────────────────────
describe('countUnlinkedComponents', () => {
  it('asset_id=null 인 행 수 반환', async () => {
    const shim = makeDb()
    const db = asDb(shim)

    await seedSolution(shim, { asset_id: null, group_company: '공용' })
    await seedSolution(shim, { asset_id: null, group_company: '공용' })

    // asset_id 있는 행
    const assetId = await resolveOrCreateAsset(db, { name: 'A', vendor: 'V', hostname: 'h', group_company: '공용', owner: null })
    await seedSolution(shim, { asset_id: assetId, group_company: '공용' })

    const count = await countUnlinkedComponents(db, {})
    expect(count).toBe(2)
  })

  it('group 필터 적용', async () => {
    const shim = makeDb()
    const db = asDb(shim)

    await seedSolution(shim, { asset_id: null, group_company: '공용' })
    await seedSolution(shim, { asset_id: null, group_company: '자회사A' })

    const countPublic = await countUnlinkedComponents(db, { group: '공용' })
    expect(countPublic).toBe(1)
  })
})
