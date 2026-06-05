/**
 * src/lib/vuln-status.test.ts
 *
 * v3.2 수동 취약점 상태 오버라이드 함수 단위 테스트.
 * node:sqlite D1 shim + 실제 마이그레이션(0001~0007) 적용.
 *
 * 주의: ExperimentalWarning (node:sqlite) 은 정상 — 무시.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createD1ShimWithRaw, applyMigrations } from '../../test/d1-shim'
import type { D1DatabaseShim } from '../../test/d1-shim'
import {
  markVulnerable,
  markResolved,
  clearManualStatus,
} from './vuln-status'

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

/** solutions 행 삽입 → last_row_id(=id) 반환 */
async function seedSolution(
  db: D1DatabaseShim,
  overrides: Partial<{
    vendor: string
    product: string
    category: string
    current_version: string
    group_company: string | null
    is_vulnerable: number
  }> = {},
): Promise<number> {
  const v = {
    vendor: 'TestVendor',
    product: 'TestProduct',
    category: 'OS',
    current_version: '1.0',
    group_company: null,
    is_vulnerable: 0,
    ...overrides,
  }
  const res = await db
    .prepare(
      `INSERT INTO solutions
         (vendor, product, category, current_version, group_company, is_vulnerable,
          cpe_part, cpe_version_range, aliases, vendor_normalized, product_normalized,
          cpe_uri, category_attributes, source, embedding_status)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, '[]', ?, ?, NULL, NULL, 'test', 'pending')`,
    )
    .bind(
      v.vendor, v.product, v.category, v.current_version, v.group_company,
      v.is_vulnerable,
      v.vendor.toLowerCase(), v.product.toLowerCase(),
    )
    .run()
  return res.meta.last_row_id
}

/** matched_vulns 행 삽입 — source 지정 가능 */
async function seedMatchedVuln(
  db: D1DatabaseShim,
  solutionId: number,
  opts: { cveId?: string; source?: string; severity?: string } = {},
): Promise<number> {
  const cveId = opts.cveId ?? 'CVE-2024-0001'
  const source = opts.source ?? 'nvd'
  const severity = opts.severity ?? 'high'
  const res = await db
    .prepare(
      `INSERT INTO matched_vulns
         (solution_id, cve_id, source, severity, detected_at, first_seen_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(solutionId, cveId, source, severity)
    .run()
  return res.meta.last_row_id
}

// ─────────────────────────────────────────────────────────────
// 1. markVulnerable
// ─────────────────────────────────────────────────────────────
describe('markVulnerable', () => {
  it('is_vulnerable → 1, manual_status = "vulnerable"', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const id = await seedSolution(shim)

    await markVulnerable(db, id, 'operator1', {
      cve_id: 'CVE-2025-9999',
      severity: 'critical',
      title: '테스트 취약점',
      note: '수동 등록 테스트',
    })

    const row = await shim
      .prepare('SELECT is_vulnerable, manual_status, status_note, status_updated_by, last_matched_cve FROM solutions WHERE id = ?')
      .bind(id)
      .first<{
        is_vulnerable: number
        manual_status: string | null
        status_note: string | null
        status_updated_by: string | null
        last_matched_cve: string | null
      }>()

    expect(row).not.toBeNull()
    expect(row!.is_vulnerable).toBe(1)
    expect(row!.manual_status).toBe('vulnerable')
    expect(row!.status_note).toBe('수동 등록 테스트')
    expect(row!.status_updated_by).toBe('operator1')
    expect(row!.last_matched_cve).toBe('CVE-2025-9999')
  })

  it('source="manual" matched_vulns 행이 생성된다', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const id = await seedSolution(shim)

    await markVulnerable(db, id, 'op', {
      cve_id: 'CVE-2025-0001',
      severity: 'high',
      note: '노트',
    })

    const mv = await shim
      .prepare('SELECT * FROM matched_vulns WHERE solution_id = ? AND source = ?')
      .bind(id, 'manual')
      .first<{ cve_id: string; severity: string; source: string }>()

    expect(mv).not.toBeNull()
    expect(mv!.cve_id).toBe('CVE-2025-0001')
    expect(mv!.severity).toBe('high')
    expect(mv!.source).toBe('manual')
  })

  it('cve_id 미입력 시 MANUAL-<id>-<n> 형식으로 자동 생성', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const id = await seedSolution(shim)

    await markVulnerable(db, id, 'op', { note: '자동 생성 테스트' })

    const row = await shim
      .prepare('SELECT last_matched_cve FROM solutions WHERE id = ?')
      .bind(id)
      .first<{ last_matched_cve: string | null }>()

    expect(row!.last_matched_cve).toMatch(/^MANUAL-\d+-\d+$/)

    const mv = await shim
      .prepare("SELECT cve_id FROM matched_vulns WHERE solution_id = ? AND source = 'manual'")
      .bind(id)
      .first<{ cve_id: string }>()
    expect(mv).not.toBeNull()
    expect(mv!.cve_id).toMatch(/^MANUAL-\d+-\d+$/)
  })

  it('사용자 지정 cve_id 를 그대로 사용한다', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const id = await seedSolution(shim)

    await markVulnerable(db, id, 'op', { cve_id: 'CVE-2099-12345', severity: 'low' })

    const row = await shim
      .prepare('SELECT last_matched_cve FROM solutions WHERE id = ?')
      .bind(id)
      .first<{ last_matched_cve: string }>()
    expect(row!.last_matched_cve).toBe('CVE-2099-12345')
  })
})

// ─────────────────────────────────────────────────────────────
// 2. markResolved
// ─────────────────────────────────────────────────────────────
describe('markResolved', () => {
  it('is_vulnerable → 0, manual_status = "resolved"', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const id = await seedSolution(shim, { is_vulnerable: 1 })

    await markResolved(db, id, 'operator2', '패치 적용 완료')

    const row = await shim
      .prepare('SELECT is_vulnerable, manual_status, status_note, status_updated_by FROM solutions WHERE id = ?')
      .bind(id)
      .first<{
        is_vulnerable: number
        manual_status: string | null
        status_note: string | null
        status_updated_by: string | null
      }>()

    expect(row!.is_vulnerable).toBe(0)
    expect(row!.manual_status).toBe('resolved')
    expect(row!.status_note).toBe('패치 적용 완료')
    expect(row!.status_updated_by).toBe('operator2')
  })

  it('기존 matched_vulns 이력이 보존된다', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const id = await seedSolution(shim, { is_vulnerable: 1 })
    await seedMatchedVuln(shim, id, { cveId: 'CVE-2024-5555' })

    await markResolved(db, id, 'op', null)

    const { results } = await shim
      .prepare('SELECT id FROM matched_vulns WHERE solution_id = ?')
      .bind(id)
      .all<{ id: number }>()
    // 기존 매칭 행이 삭제되지 않아야 함
    expect(results.length).toBe(1)
  })

  it('status_note null 도 허용된다', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const id = await seedSolution(shim)

    await markResolved(db, id, 'op', null)

    const row = await shim
      .prepare('SELECT status_note FROM solutions WHERE id = ?')
      .bind(id)
      .first<{ status_note: string | null }>()
    expect(row!.status_note).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────
// 3. clearManualStatus
// ─────────────────────────────────────────────────────────────
describe('clearManualStatus', () => {
  it('source="manual" 행을 삭제하고 manual_status → NULL', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const id = await seedSolution(shim)

    // 수동 취약 표시
    await markVulnerable(db, id, 'op', { cve_id: 'MANUAL-test', note: 'test' })

    // 자동 복귀
    await clearManualStatus(db, id, 'admin')

    const row = await shim
      .prepare('SELECT manual_status, status_note FROM solutions WHERE id = ?')
      .bind(id)
      .first<{ manual_status: string | null; status_note: string | null }>()
    expect(row!.manual_status).toBeNull()
    expect(row!.status_note).toBeNull()

    // manual 행 삭제 확인
    const mv = await shim
      .prepare("SELECT id FROM matched_vulns WHERE solution_id = ? AND source = 'manual'")
      .bind(id)
      .first<{ id: number }>()
    expect(mv).toBeNull()
  })

  it('비수동 matched_vuln 이 남아있으면 is_vulnerable=1 유지', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const id = await seedSolution(shim)

    // 비수동 CVE 시드
    await seedMatchedVuln(shim, id, { cveId: 'CVE-2024-9001', source: 'nvd' })
    // 수동 취약 표시 추가
    await markVulnerable(db, id, 'op', { cve_id: 'MANUAL-extra', note: 'extra' })

    // 자동 복귀
    await clearManualStatus(db, id, 'admin')

    const row = await shim
      .prepare('SELECT is_vulnerable, last_matched_cve FROM solutions WHERE id = ?')
      .bind(id)
      .first<{ is_vulnerable: number; last_matched_cve: string | null }>()
    // 비수동 CVE 가 남아있으므로 취약 상태 유지
    expect(row!.is_vulnerable).toBe(1)
    expect(row!.last_matched_cve).toBe('CVE-2024-9001')
  })

  it('남은 matched_vuln 없으면 is_vulnerable=0', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const id = await seedSolution(shim)

    // 수동 취약 표시만 있음
    await markVulnerable(db, id, 'op', { cve_id: 'MANUAL-only', note: 'only' })

    // 자동 복귀
    await clearManualStatus(db, id, 'admin')

    const row = await shim
      .prepare('SELECT is_vulnerable, last_matched_cve, manual_status FROM solutions WHERE id = ?')
      .bind(id)
      .first<{ is_vulnerable: number; last_matched_cve: string | null; manual_status: string | null }>()
    expect(row!.is_vulnerable).toBe(0)
    expect(row!.last_matched_cve).toBeNull()
    expect(row!.manual_status).toBeNull()
  })

  it('status_updated_by 가 갱신된다', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const id = await seedSolution(shim)

    await markVulnerable(db, id, 'op', {})
    await clearManualStatus(db, id, 'super-admin')

    const row = await shim
      .prepare('SELECT status_updated_by FROM solutions WHERE id = ?')
      .bind(id)
      .first<{ status_updated_by: string | null }>()
    expect(row!.status_updated_by).toBe('super-admin')
  })
})

// ─────────────────────────────────────────────────────────────
// 4. "resolved 는 같은 CVE INSERT OR IGNORE 에 의해 뒤집히지 않는다"
//    n8n 이 이미 존재하는 CVE 를 재전송해도 UNIQUE 제약으로 무시됨 →
//    is_vulnerable 재갱신이 발생하지 않는다 (changes=0).
// ─────────────────────────────────────────────────────────────
describe('resolved 스티키 vs 동일 CVE n8n 재전송', () => {
  it('기존 CVE 와 동일한 cve_id 는 INSERT OR IGNORE 로 무시된다', async () => {
    const shim = makeDb()
    const db = asDb(shim)
    const id = await seedSolution(shim)

    // 1. n8n 이 먼저 CVE 를 삽입
    await seedMatchedVuln(shim, id, { cveId: 'CVE-2024-7777', source: 'nvd' })

    // 2. 운영자가 해결 표시
    await markResolved(db, id, 'op', '임시 대응')

    // 3. n8n 이 같은 CVE 를 재전송 (INSERT OR IGNORE → changes=0)
    const insRes = await db
      .prepare(
        `INSERT OR IGNORE INTO matched_vulns
           (solution_id, cve_id, source, severity, detected_at, first_seen_at)
         VALUES (?, 'CVE-2024-7777', 'nvd', 'high', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(id)
      .run()

    // changes=0 이면 UPDATE solutions 로 진입하지 않음 → resolved 유지
    expect(insRes.meta.changes).toBe(0)

    const row = await shim
      .prepare('SELECT is_vulnerable, manual_status FROM solutions WHERE id = ?')
      .bind(id)
      .first<{ is_vulnerable: number; manual_status: string | null }>()

    // 재삽입이 무시되었으므로 resolved 상태 유지
    expect(row!.is_vulnerable).toBe(0)
    expect(row!.manual_status).toBe('resolved')
  })
})
