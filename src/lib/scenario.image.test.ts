/**
 * src/lib/scenario.image.test.ts
 *
 * 팀리드 실행 검증: 사용자가 제시한 "이미지" 그대로의 실데이터를 재현하여
 * 부모 솔루션(assets) 묶음이 종단(end-to-end)으로 동작하는지 증명한다.
 *
 * 시나리오 (이미지):
 *   group_company='공용', hostname='PJ-FI-IDS', owner='네트웍보안기술팀' 를 공유하는
 *   5개 구성요소가 "따로따로" 등록되어 있다.
 *     - 기타     OpenSSH 10.2p
 *     - Crypto   OpenSSL 3.3.5          (취약 — matched CVE 1건)
 *     - DB       SQLite 3.7.17
 *     - HW       Wins SNIPER ONE-i 5300 v3.3.1.15
 *     - OS       Wins SNIPER ONE-i 5300 v4.0.8_k5.4.0
 *   + 다른 자산(별도 hostname)과 hostname 없는 레거시 단독 행도 함께 둔다.
 *
 * 기대: backfill 후 5개가 "SNIPER ONE-i 5300" 1개 부모로 묶이고,
 *       취약 컴포넌트(OpenSSL) 때문에 부모가 취약으로 롤업되며, 미연결 0건.
 */

import { describe, it, expect } from 'vitest'
import { createD1ShimWithRaw, applyMigrations } from '../../test/d1-shim'
import type { D1DatabaseShim } from '../../test/d1-shim'
import {
  backfillAssets,
  getAssetsWithComponents,
  countUnlinkedComponents,
  listAssetOptions,
} from './assets'

function asDb(shim: D1DatabaseShim): D1Database {
  return shim as unknown as D1Database
}

async function seed(
  db: D1DatabaseShim,
  v: {
    vendor: string
    product: string
    category: string
    current_version: string
    hostname: string | null
    group_company: string | null
    owner: string | null
    is_vulnerable?: number
  },
): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO solutions
         (vendor, product, category, current_version, hostname, group_company, owner, is_vulnerable, asset_id,
          cpe_part, cpe_version_range, aliases, vendor_normalized, product_normalized,
          cpe_uri, category_attributes, source, embedding_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, '[]', NULL, NULL, NULL, NULL, 'legacy', 'pending')`,
    )
    .bind(
      v.vendor,
      v.product,
      v.category,
      v.current_version,
      v.hostname,
      v.group_company,
      v.owner,
      v.is_vulnerable ?? 0,
    )
    .run()
  return res.meta.last_row_id
}

describe('이미지 시나리오 — 따로 등록된 구성요소가 하나의 솔루션으로 묶임', () => {
  it('backfill 후 PJ-FI-IDS 5개 구성요소가 단일 부모로 그룹핑되고 취약 롤업/미연결 0건', async () => {
    const db = createD1ShimWithRaw()
    applyMigrations(db)

    const GC = '공용'
    const HOST = 'PJ-FI-IDS'
    const OWNER = '네트웍보안기술팀'

    // 이미지의 5개 구성요소 (따로 등록된 상태 — asset_id NULL)
    await seed(db, { vendor: 'OpenSSH', product: 'OpenSSH', category: 'Other', current_version: '10.2p', hostname: HOST, group_company: GC, owner: OWNER })
    const opensslId = await seed(db, { vendor: 'OpenSSL', product: 'OpenSSL', category: 'Crypto', current_version: '3.3.5', hostname: HOST, group_company: GC, owner: OWNER, is_vulnerable: 1 })
    await seed(db, { vendor: 'SQLite', product: 'SQLite', category: 'DB', current_version: '3.7.17', hostname: HOST, group_company: GC, owner: OWNER })
    await seed(db, { vendor: 'Wins', product: 'SNIPER ONE-i 5300', category: 'HW', current_version: 'v3.3.1.15', hostname: HOST, group_company: GC, owner: OWNER })
    await seed(db, { vendor: 'Wins', product: 'SNIPER ONE-i 5300', category: 'OS', current_version: 'v4.0.8_k5.4.0', hostname: HOST, group_company: GC, owner: OWNER })

    // 취약 컴포넌트(OpenSSL)에 매칭 CVE 1건
    await db
      .prepare(
        `INSERT INTO matched_vulns (solution_id, cve_id, source, severity, title, detected_at)
         VALUES (?, 'CVE-2024-0001', 'NVD', 'high', 'OpenSSL test vuln', CURRENT_TIMESTAMP)`,
      )
      .bind(opensslId)
      .run()

    // 다른 자산(별도 hostname) + hostname 없는 레거시 단독 행
    await seed(db, { vendor: 'Fortinet', product: 'FortiOS', category: 'OS', current_version: '7.4.1', hostname: 'fw-hq-01', group_company: GC, owner: '보안팀' })
    await seed(db, { vendor: 'Apache', product: 'httpd', category: 'WEB', current_version: '2.4.58', hostname: null, group_company: GC, owner: '웹팀' })

    // 등록 전 — 전부 미연결
    const before = await countUnlinkedComponents(asDb(db), {})
    expect(before).toBe(7)

    // 백필 실행
    const result = await backfillAssets(asDb(db), {})
    // 자산: PJ-FI-IDS(1) + fw-hq-01(1) + 레거시 단독(1) = 3
    expect(result.assetsCreated).toBe(3)
    expect(result.componentsLinked).toBe(7)

    // 미연결 0건
    const after = await countUnlinkedComponents(asDb(db), {})
    expect(after).toBe(0)

    // 그룹 뷰 로드
    const groups = await getAssetsWithComponents(asDb(db), {})

    // 트리 출력 (실행 검증 증거)
    // eslint-disable-next-line no-console
    console.log('\n===== 실행 검증: 솔루션(부모) 그룹 트리 =====')
    for (const g of groups) {
      const status = g.hasVulnerable ? `취약 ${g.vulnerableCount}` : '정상'
      // eslint-disable-next-line no-console
      console.log(`▼ [${status}] ${g.asset.name}  (${g.asset.group_company} · ${g.asset.hostname ?? '호스트없음'} · ${g.asset.owner ?? '-'})  구성요소 ${g.componentCount}`)
      for (const c of g.components) {
        // eslint-disable-next-line no-console
        console.log(`     ├ ${c.category.padEnd(7)} ${c.vendor} ${c.product}  @ ${c.current_version}${c.is_vulnerable === 1 ? '   ⚠ 취약' : ''}`)
      }
    }
    // eslint-disable-next-line no-console
    console.log('==========================================\n')

    // 핵심 단언: PJ-FI-IDS 부모 = 5개 구성요소, 이름은 HW 제품으로 파생
    const sniper = groups.find((g) => g.asset.hostname === HOST)
    expect(sniper).toBeDefined()
    expect(sniper!.componentCount).toBe(5)
    expect(sniper!.asset.name).toBe('SNIPER ONE-i 5300') // deriveAssetName: HW 우선
    expect(sniper!.asset.group_company).toBe(GC)
    expect(sniper!.asset.owner).toBe(OWNER)
    expect(sniper!.hasVulnerable).toBe(true)
    expect(sniper!.vulnerableCount).toBe(1)

    // 부모 3개, 단독 레거시(Apache)도 자기 부모를 가짐
    expect(groups.length).toBe(3)
    const legacy = groups.find((g) => g.asset.hostname === null)
    expect(legacy).toBeDefined()
    expect(legacy!.componentCount).toBe(1)
    expect(legacy!.asset.name).toBe('Apache httpd')

    // 단건 등록 부모 드롭다운 옵션 3개
    const options = await listAssetOptions(asDb(db), {})
    expect(options.length).toBe(3)
  })

  it('재실행(idempotent) — 두 번째 backfill 은 0개 생성', async () => {
    const db = createD1ShimWithRaw()
    applyMigrations(db)
    await seed(db, { vendor: 'Wins', product: 'SNIPER ONE-i 5300', category: 'HW', current_version: 'v3.3.1.15', hostname: 'PJ-FI-IDS', group_company: '공용', owner: '네트웍보안기술팀' })
    const first = await backfillAssets(asDb(db), {})
    expect(first.assetsCreated).toBe(1)
    const second = await backfillAssets(asDb(db), {})
    expect(second.assetsCreated).toBe(0)
    expect(second.componentsLinked).toBe(0)
  })
})
