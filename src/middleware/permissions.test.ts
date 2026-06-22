// v3.6 멀티테넌시 SSOT 단위테스트 — resolveWriteGroup / resolveEffectiveGroup + 가드 헬퍼.
// 쿠키(readActiveGroupValue)와 DB(groupExists)는 모킹, getAuthContext 는 가짜 컨텍스트로 주입.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../lib/active-group', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/active-group')>()
  return { ...actual, readActiveGroupValue: vi.fn() }
})
vi.mock('../lib/group-companies', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/group-companies')>()
  return { ...actual, groupExists: vi.fn() }
})

import {
  resolveWriteGroup,
  resolveEffectiveGroup,
  canWriteGroup,
  canReadRowGroup,
  requireSystemOrAdmin,
  allowedGroupsForUser,
} from './permissions'
import { readActiveGroupValue, ALL_GROUPS_SENTINEL } from '../lib/active-group'
import { groupExists } from '../lib/group-companies'
import type { UserRole } from '../types'

const mockedActive = vi.mocked(readActiveGroupValue)
const mockedExists = vi.mocked(groupExists)

// AuthContext 를 담은 가짜 Hono Context (getAuthContext 는 c.get('__auth__') 사용)
function ctx(role: UserRole | null, groups: string[] = [], id = 1) {
  const auth =
    role === null ? null : { user: { id, username: 'u', groups, role }, via: 'session' as const }
  return { get: (k: string) => (k === '__auth__' ? auth : undefined), env: { DB: {} } } as never
}

beforeEach(() => {
  mockedActive.mockReset()
  mockedExists.mockReset()
})

describe('resolveWriteGroup', () => {
  it('operator: 폼값(requested)을 무시하고 활성 그룹 쿠키로 강제', async () => {
    mockedActive.mockResolvedValue('B') // 활성 그룹 = B
    const r = await resolveWriteGroup(ctx('operator', ['A', 'B']), 'A') // requested=A(위조)
    expect(r).toEqual({ ok: true, group: 'B' })
  })
  it('operator: 활성 그룹 미선택이면 거부', async () => {
    mockedActive.mockResolvedValue(null)
    const r = await resolveWriteGroup(ctx('operator', ['A']), 'A')
    expect(r.ok).toBe(false)
  })
  it('operator: 활성 그룹이 __ALL__ 이면 거부', async () => {
    mockedActive.mockResolvedValue(ALL_GROUPS_SENTINEL)
    const r = await resolveWriteGroup(ctx('operator', ['A']), null)
    expect(r.ok).toBe(false)
  })
  it('operator: 활성 그룹이 본인 소유가 아니면 거부(권한회수/탈퇴)', async () => {
    mockedActive.mockResolvedValue('C')
    const r = await resolveWriteGroup(ctx('operator', ['A', 'B']), null)
    expect(r.ok).toBe(false)
  })
  it('operator: 담당 그룹사가 없으면 거부', async () => {
    mockedActive.mockResolvedValue(null)
    const r = await resolveWriteGroup(ctx('operator', []), null)
    expect(r.ok).toBe(false)
  })
  it('admin: 진입한 특정 그룹 사용', async () => {
    mockedActive.mockResolvedValue('본사')
    const r = await resolveWriteGroup(ctx('admin'), null)
    expect(r).toEqual({ ok: true, group: '본사' })
  })
  it('admin: 전체(__ALL__) + requested 있으면 requested 사용', async () => {
    mockedActive.mockResolvedValue(ALL_GROUPS_SENTINEL)
    const r = await resolveWriteGroup(ctx('admin'), '자회사A')
    expect(r).toEqual({ ok: true, group: '자회사A' })
  })
  it('admin: 전체 + requested 없으면 거부(NULL 누수 차단)', async () => {
    mockedActive.mockResolvedValue(ALL_GROUPS_SENTINEL)
    const r = await resolveWriteGroup(ctx('admin'), null)
    expect(r.ok).toBe(false)
  })
  it('system(n8n): requested 신뢰', async () => {
    const r = await resolveWriteGroup(ctx('system'), '본사')
    expect(r).toEqual({ ok: true, group: '본사' })
    expect(mockedActive).not.toHaveBeenCalled()
  })
})

describe('resolveEffectiveGroup', () => {
  it('operator: 미소유 그룹 요청(?group= 변조)은 거부', async () => {
    mockedActive.mockResolvedValue('A')
    const r = await resolveEffectiveGroup(ctx('operator', ['A', 'B']), 'C')
    expect(r.ok).toBe(false)
  })
  it('operator: 요청 없으면 활성 그룹으로 스코프', async () => {
    mockedActive.mockResolvedValue('B')
    const r = await resolveEffectiveGroup(ctx('operator', ['A', 'B']), null)
    expect(r).toMatchObject({ ok: true, group: 'B', isAggregate: false })
  })
  it('admin: 미선택이면 전체(aggregate)', async () => {
    mockedActive.mockResolvedValue(null)
    const r = await resolveEffectiveGroup(ctx('admin'), null)
    expect(r).toMatchObject({ ok: true, group: null, isAggregate: true })
  })
  it('admin: 존재하는 그룹 요청이면 해당 그룹 스코프', async () => {
    mockedActive.mockResolvedValue(null)
    mockedExists.mockResolvedValue(true)
    const r = await resolveEffectiveGroup(ctx('admin'), '본사')
    expect(r).toMatchObject({ ok: true, group: '본사', isAggregate: false })
  })
  it('system: requested 그대로(강제 스코프 없음)', async () => {
    const r = await resolveEffectiveGroup(ctx('system'), '본사')
    expect(r).toMatchObject({ ok: true, group: '본사' })
  })
})

describe('가드 헬퍼', () => {
  it('canReadRowGroup: operator 는 본인 그룹만 true', () => {
    expect(canReadRowGroup(ctx('operator', ['A']), 'A')).toBe(true)
    expect(canReadRowGroup(ctx('operator', ['A']), 'B')).toBe(false)
    expect(canReadRowGroup(ctx('admin'), 'B')).toBe(true)
    expect(canReadRowGroup(ctx('system'), 'B')).toBe(true)
  })
  it('canWriteGroup: operator 미소유 그룹 거부', () => {
    expect(canWriteGroup(ctx('operator', ['A']), 'A').ok).toBe(true)
    expect(canWriteGroup(ctx('operator', ['A']), 'B').ok).toBe(false)
    expect(canWriteGroup(ctx('admin'), 'any').ok).toBe(true)
  })
  it('requireSystemOrAdmin: operator 거부', () => {
    expect(requireSystemOrAdmin(ctx('operator', ['A'])).ok).toBe(false)
    expect(requireSystemOrAdmin(ctx('admin')).ok).toBe(true)
    expect(requireSystemOrAdmin(ctx('system')).ok).toBe(true)
  })
  it('allowedGroupsForUser: operator=본인 groups, admin/system=null', () => {
    expect(allowedGroupsForUser(ctx('operator', ['A', 'B']))).toEqual(['A', 'B'])
    expect(allowedGroupsForUser(ctx('admin'))).toBeNull()
    expect(allowedGroupsForUser(ctx('system'))).toBeNull()
  })
})
