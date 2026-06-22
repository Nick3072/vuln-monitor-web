// v3.7 조치 이력 쿼리 — 그룹 스코핑/방식 파싱/필터 단위테스트.
import { describe, it, expect, beforeEach } from 'vitest'
import { createD1ShimWithRaw, applyMigrations } from '../../test/d1-shim'
import type { D1DatabaseShim } from '../../test/d1-shim'
import { getRemediationHistory, normalizeResolveMethod } from './history'

function asDb(shim: D1DatabaseShim): D1Database {
  return shim as unknown as D1Database
}
function makeDb() {
  const shim = createD1ShimWithRaw()
  applyMigrations(shim)
  return shim
}

async function seedSolution(
  db: D1DatabaseShim,
  opts: { group: string | null; vendor?: string; product?: string; isVulnerable?: number; hostname?: string | null },
): Promise<number> {
  const r = await db
    .prepare(
      `INSERT INTO solutions
         (vendor, product, category, current_version, hostname, group_company, is_vulnerable,
          cpe_part, cpe_version_range, aliases, vendor_normalized, product_normalized,
          cpe_uri, category_attributes, source, embedding_status)
       VALUES (?, ?, 'FW', '1.0', ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'web', 'pending')`,
    )
    .bind(opts.vendor ?? 'Fortinet', opts.product ?? 'FortiOS', opts.hostname ?? 'h1', opts.group, opts.isVulnerable ?? 0)
    .run()
  return Number(r.meta.last_row_id)
}

async function seedAudit(
  db: D1DatabaseShim,
  action: string,
  targetId: number,
  payload: unknown,
  createdAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_log (action, target_table, target_id, actor, payload_json, created_at)
       VALUES (?, 'solutions', ?, 'op', ?, ?)`,
    )
    .bind(action, targetId, payload === null ? null : JSON.stringify(payload), createdAt)
    .run()
}

describe('normalizeResolveMethod', () => {
  it("'update' 만 업데이트, 나머지는 manual", () => {
    expect(normalizeResolveMethod('update')).toBe('update')
    expect(normalizeResolveMethod('manual')).toBe('manual')
    expect(normalizeResolveMethod(null)).toBe('manual')
    expect(normalizeResolveMethod('xxx')).toBe('manual')
  })
})

describe('getRemediationHistory', () => {
  let db: D1DatabaseShim
  beforeEach(() => {
    db = makeDb()
  })

  it('manual_vuln_resolved 이벤트만, 방식/메모 파싱', async () => {
    const id = await seedSolution(db, { group: '본사', isVulnerable: 0 })
    await seedAudit(db, 'manual_vuln_resolved', id, { action: 'resolved', method: 'update', note: '패치 적용' }, '2026-06-06 10:00:00')
    await seedAudit(db, 'manual_vuln_vulnerable', id, { action: 'vulnerable' }, '2026-06-05 10:00:00') // 제외돼야 함

    const { entries, total } = await getRemediationHistory(asDb(db), {
      group: '본사', from: null, to: null, q: null, page: 1, pageSize: 50,
    })
    expect(total).toBe(1)
    expect(entries[0].method).toBe('update')
    expect(entries[0].note).toBe('패치 적용')
    expect(entries[0].vendor).toBe('Fortinet')
  })

  it('그룹 스코핑 — 타 그룹 이력은 제외(테넌트 격리)', async () => {
    const a = await seedSolution(db, { group: '본사' })
    const b = await seedSolution(db, { group: '자회사A' })
    await seedAudit(db, 'manual_vuln_resolved', a, { action: 'resolved', method: 'manual' }, '2026-06-06 10:00:00')
    await seedAudit(db, 'manual_vuln_resolved', b, { action: 'resolved', method: 'manual' }, '2026-06-06 11:00:00')

    const scoped = await getRemediationHistory(asDb(db), { group: '본사', from: null, to: null, q: null, page: 1, pageSize: 50 })
    expect(scoped.total).toBe(1)
    expect(scoped.entries[0].groupCompany).toBe('본사')

    const all = await getRemediationHistory(asDb(db), { group: null, from: null, to: null, q: null, page: 1, pageSize: 50 })
    expect(all.total).toBe(2) // admin 전체
  })

  it('삭제된 솔루션 이력은 INNER JOIN 으로 제외', async () => {
    const id = await seedSolution(db, { group: '본사' })
    await seedAudit(db, 'manual_vuln_resolved', id, { action: 'resolved', method: 'manual' }, '2026-06-06 10:00:00')
    await db.prepare('DELETE FROM solutions WHERE id = ?').bind(id).run()
    const { total } = await getRemediationHistory(asDb(db), { group: null, from: null, to: null, q: null, page: 1, pageSize: 50 })
    expect(total).toBe(0)
  })

  it('재취약 플래그(currentlyVulnerable) 반영', async () => {
    const id = await seedSolution(db, { group: '본사', isVulnerable: 1 }) // 조치 후 다시 취약
    await seedAudit(db, 'manual_vuln_resolved', id, { action: 'resolved', method: 'manual' }, '2026-06-06 10:00:00')
    const { entries } = await getRemediationHistory(asDb(db), { group: '본사', from: null, to: null, q: null, page: 1, pageSize: 50 })
    expect(entries[0].currentlyVulnerable).toBe(true)
  })

  it('검색(q) + 페이지네이션', async () => {
    const a = await seedSolution(db, { group: '본사', vendor: 'Fortinet', product: 'FortiOS' })
    const b = await seedSolution(db, { group: '본사', vendor: 'Cisco', product: 'IOS' })
    await seedAudit(db, 'manual_vuln_resolved', a, { action: 'resolved', method: 'manual' }, '2026-06-06 10:00:00')
    await seedAudit(db, 'manual_vuln_resolved', b, { action: 'resolved', method: 'manual' }, '2026-06-06 11:00:00')
    const res = await getRemediationHistory(asDb(db), { group: '본사', from: null, to: null, q: 'Cisco', page: 1, pageSize: 50 })
    expect(res.total).toBe(1)
    expect(res.entries[0].vendor).toBe('Cisco')

    const pageRes = await getRemediationHistory(asDb(db), { group: '본사', from: null, to: null, q: null, page: 1, pageSize: 1 })
    expect(pageRes.total).toBe(2)
    expect(pageRes.entries.length).toBe(1)
  })
})
