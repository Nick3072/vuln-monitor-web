/**
 * src/lib/group-companies.test.ts
 *
 * lib/group-companies.ts — 레지스트리 CRUD + 가드 단위 테스트.
 * node:sqlite D1 shim + 실제 마이그레이션(0001~0011) 적용.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createD1ShimWithRaw, applyMigrations } from '../../test/d1-shim'
import type { D1DatabaseShim } from '../../test/d1-shim'
import {
  normalizeGroupName,
  validateGroupName,
  listAllGroupCompanies,
  listGroupCompaniesForUser,
  createGroupCompany,
  countEquipmentInGroup,
  deleteGroupCompany,
  groupExists,
} from './group-companies'

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
  group: string | null,
  isVulnerable = 0,
): Promise<number> {
  const r = await db
    .prepare(
      `INSERT INTO solutions
         (vendor, product, category, current_version, hostname, group_company, owner, is_vulnerable,
          cpe_part, cpe_version_range, aliases, vendor_normalized, product_normalized,
          cpe_uri, category_attributes, source, embedding_status)
       VALUES ('V','P','OS','1.0', NULL, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'web', 'pending')`,
    )
    .bind(group, isVulnerable)
    .run()
  return Number(r.meta.last_row_id)
}

async function seedAsset(db: D1DatabaseShim, group: string | null): Promise<number> {
  const r = await db
    .prepare(`INSERT INTO assets (name, group_company) VALUES ('asset', ?)`)
    .bind(group)
    .run()
  return Number(r.meta.last_row_id)
}

async function seedUser(db: D1DatabaseShim, username: string, role = 'operator'): Promise<number> {
  const r = await db
    .prepare(
      `INSERT INTO users (username, password_hash, role, is_active, session_version) VALUES (?, 'x$x', ?, 1, 1)`,
    )
    .bind(username, role)
    .run()
  return Number(r.meta.last_row_id)
}

describe('normalizeGroupName', () => {
  it('trim + 내부 연속 공백 1칸 축소, 대소문자 보존', () => {
    expect(normalizeGroupName('  본사  ')).toBe('본사')
    expect(normalizeGroupName('본  사')).toBe('본 사')
    expect(normalizeGroupName('ABC')).toBe('ABC')
  })
})

describe('validateGroupName', () => {
  it('빈값/공백 거부', () => {
    expect(validateGroupName('   ').ok).toBe(false)
  })
  it("예약어 'system' 거부(대소문자 무관)", () => {
    expect(validateGroupName('system').ok).toBe(false)
    expect(validateGroupName('SYSTEM').ok).toBe(false)
  })
  it('100자 초과 거부', () => {
    expect(validateGroupName('a'.repeat(101)).ok).toBe(false)
  })
  it('정상 이름은 정규화되어 통과', () => {
    const r = validateGroupName('  자회사 A ')
    expect(r).toEqual({ ok: true, name: '자회사 A' })
  })
})

describe('listAllGroupCompanies', () => {
  let db: D1DatabaseShim
  beforeEach(() => {
    db = makeDb()
  })

  it('장비 0개 그룹도 포함하고 카운트를 집계한다', async () => {
    await createGroupCompany(asDb(db), '빈그룹', null, { autoAssignOperator: false })
    await createGroupCompany(asDb(db), '본사', null, { autoAssignOperator: false })
    await seedSolution(db, '본사', 1)
    await seedSolution(db, '본사', 0)
    await seedAsset(db, '본사')

    const all = await listAllGroupCompanies(asDb(db))
    const empty = all.find((g) => g.name === '빈그룹')!
    const hq = all.find((g) => g.name === '본사')!

    expect(empty.assetCount).toBe(0)
    expect(empty.solutionCount).toBe(0)
    expect(hq.solutionCount).toBe(2)
    expect(hq.vulnerableCount).toBe(1)
    expect(hq.assetCount).toBe(1)
  })
})

describe('listGroupCompaniesForUser', () => {
  let db: D1DatabaseShim
  beforeEach(() => {
    db = makeDb()
  })

  it('admin 은 전체 그룹사를 본다', async () => {
    await createGroupCompany(asDb(db), '본사', null, { autoAssignOperator: false })
    await createGroupCompany(asDb(db), '자회사A', null, { autoAssignOperator: false })
    const list = await listGroupCompaniesForUser(asDb(db), { role: 'admin', groups: [] })
    expect(list.map((g) => g.name).sort()).toEqual(['본사', '자회사A'])
  })

  it('operator 는 본인 담당 그룹사만 본다', async () => {
    await createGroupCompany(asDb(db), '본사', null, { autoAssignOperator: false })
    await createGroupCompany(asDb(db), '자회사A', null, { autoAssignOperator: false })
    const list = await listGroupCompaniesForUser(asDb(db), { role: 'operator', groups: ['자회사A'] })
    expect(list.map((g) => g.name)).toEqual(['자회사A'])
  })

  it('매핑에만 있고 레지스트리에 없는 이름은 즉석 시드되어 노출된다', async () => {
    const list = await listGroupCompaniesForUser(asDb(db), { role: 'operator', groups: ['레거시그룹'] })
    expect(list.map((g) => g.name)).toEqual(['레거시그룹'])
    expect(await groupExists(asDb(db), '레거시그룹')).toBe(true)
  })

  it('담당 그룹사가 없으면 빈 배열', async () => {
    const list = await listGroupCompaniesForUser(asDb(db), { role: 'operator', groups: [] })
    expect(list).toEqual([])
  })
})

describe('createGroupCompany', () => {
  let db: D1DatabaseShim
  beforeEach(() => {
    db = makeDb()
  })

  it('신규 생성 + id 반환', async () => {
    const r = await createGroupCompany(asDb(db), '  새그룹 ', null, { autoAssignOperator: false })
    expect(r.name).toBe('새그룹')
    expect(r.id).toBeGreaterThan(0)
    expect(await groupExists(asDb(db), '새그룹')).toBe(true)
  })

  it('operator 자동 배정 시 user_group_companies 매핑 생성', async () => {
    const uid = await seedUser(db, 'op1')
    await createGroupCompany(asDb(db), '내그룹', uid, { autoAssignOperator: true })
    const row = await db
      .prepare('SELECT 1 AS hit FROM user_group_companies WHERE user_id = ? AND group_company = ?')
      .bind(uid, '내그룹')
      .first<{ hit: number }>()
    expect(row).not.toBeNull()
  })

  it("예약어 'system' 생성은 throw", async () => {
    await expect(createGroupCompany(asDb(db), 'system', null, { autoAssignOperator: false })).rejects.toThrow()
  })

  it('중복 이름 생성은 기존 id 를 반환(멱등)', async () => {
    const a = await createGroupCompany(asDb(db), '중복', null, { autoAssignOperator: false })
    const b = await createGroupCompany(asDb(db), '중복', null, { autoAssignOperator: false })
    expect(b.id).toBe(a.id)
  })
})

describe('countEquipmentInGroup + deleteGroupCompany', () => {
  let db: D1DatabaseShim
  beforeEach(() => {
    db = makeDb()
  })

  it('장비 0개면 삭제 성공 + 매핑 정리', async () => {
    const uid = await seedUser(db, 'op2')
    await createGroupCompany(asDb(db), '삭제대상', uid, { autoAssignOperator: true })
    const res = await deleteGroupCompany(asDb(db), '삭제대상')
    expect(res.deleted).toBe(true)
    expect(res.removedUserMappings).toBe(1)
    expect(await groupExists(asDb(db), '삭제대상')).toBe(false)
  })

  it('자산이 있으면 삭제 차단(throw)', async () => {
    await createGroupCompany(asDb(db), '장비있음', null, { autoAssignOperator: false })
    await seedAsset(db, '장비있음')
    await expect(deleteGroupCompany(asDb(db), '장비있음')).rejects.toThrow()
    expect(await groupExists(asDb(db), '장비있음')).toBe(true)
  })

  it('컴포넌트(solution)만 있어도 삭제 차단', async () => {
    await createGroupCompany(asDb(db), '컴포넌트있음', null, { autoAssignOperator: false })
    await seedSolution(db, '컴포넌트있음')
    const counts = await countEquipmentInGroup(asDb(db), '컴포넌트있음')
    expect(counts.solutionCount).toBe(1)
    await expect(deleteGroupCompany(asDb(db), '컴포넌트있음')).rejects.toThrow()
  })
})
