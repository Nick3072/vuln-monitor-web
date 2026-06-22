// v3.0 그룹사 WRITE 권한 검증 헬퍼.
// admin / system 은 모든 그룹사 허용. operator 는 자신이 매핑된 그룹사만 허용.
// v3.6 그룹사 READ 스코핑(resolveEffectiveGroup) + IDOR/파괴 라우트 가드 추가.

import type { Context } from 'hono'
import type { Bindings } from '../types'
import { getAuthContext } from './auth'
import { readActiveGroupValue, ALL_GROUPS_SENTINEL } from '../lib/active-group'
import { groupExists, normalizeGroupName, SYSTEM_GROUP } from '../lib/group-companies'

export interface PermissionDeny {
  ok: false
  status: 403
  error: string
}
export interface PermissionAllow {
  ok: true
}
export type PermissionResult = PermissionAllow | PermissionDeny

/**
 * 신규/수정 시 입력된 group_company 가 현재 세션 사용자에 의해 변경 가능한지 검증.
 * - admin/system → 항상 통과
 * - operator → groups 배열에 포함되어야 통과
 * - NULL/빈값 → operator 의 경우 첫 그룹사로 자동 보정 권장 (호출자가 처리)
 */
export function canWriteGroup(
  c: Context<{ Bindings: Bindings }>,
  targetGroup: string | null,
): PermissionResult {
  const auth = getAuthContext(c)
  if (!auth) {
    return { ok: false, status: 403, error: '인증 컨텍스트 없음' }
  }
  if (auth.user.role === 'admin' || auth.user.role === 'system') {
    return { ok: true }
  }
  if (!targetGroup || targetGroup.trim().length === 0) {
    return {
      ok: false,
      status: 403,
      error: '그룹사가 지정되지 않았습니다. 본인이 담당하는 그룹사를 선택해주세요.',
    }
  }
  if (!auth.user.groups.includes(targetGroup)) {
    return {
      ok: false,
      status: 403,
      error: `본인이 담당하는 그룹사 솔루션만 수정/등록할 수 있습니다. (요청: ${targetGroup}, 담당: ${auth.user.groups.join(', ') || '없음'})`,
    }
  }
  return { ok: true }
}

/**
 * admin 전용 라우트 (/admin/*) 보호.
 */
export function requireAdmin(c: Context<{ Bindings: Bindings }>): PermissionResult {
  const auth = getAuthContext(c)
  if (!auth) return { ok: false, status: 403, error: '인증 컨텍스트 없음' }
  if (auth.user.role !== 'admin') {
    return { ok: false, status: 403, error: '관리자(admin) 권한이 필요합니다.' }
  }
  return { ok: true }
}

// ============================================================
// v3.6 READ 스코핑
// ============================================================

/**
 * 유효 그룹(읽기 필터) 결정 결과.
 * - ok: group=null 이면 "전체(필터 없음)". isAggregate 는 admin 전체 뷰 표시 분기에 사용.
 * - !ok: HTML 호출자는 redirectTo 로 이동, JSON 호출자는 status 로 응답.
 */
export type EffectiveScope =
  | { ok: true; group: string | null; isAggregate: boolean }
  | { ok: false; status: 403; redirectTo: string; error: string }

/**
 * (역할 + 활성 그룹 쿠키 + ?group= 요청 + auth.user.groups)로 읽기 유효 그룹을 결정.
 *   - system(Bearer/n8n) → 요청값 그대로(없으면 전체). 절대 강제 스코프 안 함.
 *   - admin → 요청/쿠키 선택. 없거나 __ALL__ → 전체(aggregate). 존재하지 않는 이름 → 전체 폴백.
 *   - operator → 요청 ?? 쿠키 ?? groups[0]. groups 비었으면 거부.
 *       __ALL__/미소유 그룹 → 거부(=?group= 변조 차단). operator 는 절대 aggregate 아님.
 */
export async function resolveEffectiveGroup(
  c: Context<{ Bindings: Bindings }>,
  requested: string | null,
): Promise<EffectiveScope> {
  const auth = getAuthContext(c)
  if (!auth) {
    return { ok: false, status: 403, redirectTo: '/login', error: '인증 컨텍스트 없음' }
  }
  const role = auth.user.role
  const req = requested && requested.trim().length > 0 ? normalizeGroupName(requested) : null

  if (role === 'system') {
    return { ok: true, group: req, isAggregate: req === null }
  }

  const cookieVal = await readActiveGroupValue(c, auth.user.id)

  if (role === 'admin') {
    const candidate = req ?? (cookieVal && cookieVal !== ALL_GROUPS_SENTINEL ? cookieVal : null)
    if (!candidate) {
      return { ok: true, group: null, isAggregate: true } // 전체
    }
    // admin 전용 '미분류(system)' 드릴인 — 레지스트리에는 없지만 실제 group_company 값.
    if (candidate === SYSTEM_GROUP) {
      return { ok: true, group: SYSTEM_GROUP, isAggregate: false }
    }
    // 존재하지 않는(삭제된) 그룹 → 전체로 무해 폴백.
    const exists = await groupExists(c.env.DB, candidate)
    return exists
      ? { ok: true, group: candidate, isAggregate: false }
      : { ok: true, group: null, isAggregate: true }
  }

  // operator
  if (auth.user.groups.length === 0) {
    return {
      ok: false,
      status: 403,
      redirectTo: '/select-group?error=no_group',
      error: '담당 그룹사가 없습니다. 관리자에게 배정을 요청하세요.',
    }
  }
  const candidate = req ?? (cookieVal && cookieVal !== ALL_GROUPS_SENTINEL ? cookieVal : null)
  if (!candidate) {
    return {
      ok: false,
      status: 403,
      redirectTo: '/select-group',
      error: '그룹사를 먼저 선택하세요.',
    }
  }
  if (!auth.user.groups.includes(candidate)) {
    return {
      ok: false,
      status: 403,
      redirectTo: '/select-group?error=forbidden_group',
      error: '담당하지 않는 그룹사입니다.',
    }
  }
  return { ok: true, group: candidate, isAggregate: false }
}

/**
 * v3.6 신규 등록 시 저장할 group_company 결정 — 쓰기 단일 진실 공급원(SSOT).
 *   - operator: 폼이 보낸 requested 를 **완전히 무시**하고 활성 그룹 쿠키로 강제
 *               (다중 그룹 operator 의 groups[0] 오배정 + hidden 값 위조 동시 차단).
 *               미선택/미소유/0그룹 → 거부.
 *   - admin   : 진입한 특정 그룹 사용. 전체(__ALL__)/미선택이면 requested 사용, 그것도 없으면 거부
 *               (NULL/미분류 누수 차단).
 *   - system  : n8n 자동화 — requested 신뢰(없으면 null, 기존 동작 보존).
 * 호출자는 결과 group 을 다시 canWriteGroup 으로 재검증한다(이중 방어).
 */
export async function resolveWriteGroup(
  c: Context<{ Bindings: Bindings }>,
  requested: string | null,
): Promise<{ ok: true; group: string | null } | { ok: false; status: 403; error: string }> {
  const auth = getAuthContext(c)
  if (!auth) return { ok: false, status: 403, error: '인증 컨텍스트 없음' }
  const req = requested && requested.trim().length > 0 ? normalizeGroupName(requested) : null

  if (auth.user.role === 'system') {
    return { ok: true, group: req }
  }

  const cookieVal = await readActiveGroupValue(c, auth.user.id)

  if (auth.user.role === 'admin') {
    // 진입한 특정 그룹(미분류 system 포함) 우선
    if (cookieVal && cookieVal !== ALL_GROUPS_SENTINEL) {
      return { ok: true, group: cookieVal }
    }
    if (req) return { ok: true, group: req }
    return {
      ok: false,
      status: 403,
      error: '전체 보기 상태에서는 등록할 그룹사를 지정해야 합니다. 특정 그룹사로 진입 후 등록하세요.',
    }
  }

  // operator — requested 무시, 활성 그룹만 사용
  if (auth.user.groups.length === 0) {
    return { ok: false, status: 403, error: '담당 그룹사가 없습니다. 관리자에게 배정을 요청하세요.' }
  }
  if (!cookieVal || cookieVal === ALL_GROUPS_SENTINEL) {
    return { ok: false, status: 403, error: '그룹사를 먼저 선택하세요.' }
  }
  if (!auth.user.groups.includes(cookieVal)) {
    return { ok: false, status: 403, error: '담당하지 않는 그룹사입니다. 그룹사를 다시 선택하세요.' }
  }
  return { ok: true, group: cookieVal }
}

/**
 * 다중 그룹 lib 호출용(목록 제한): operator → 본인 groups, admin/system → null(전체).
 */
export function allowedGroupsForUser(c: Context<{ Bindings: Bindings }>): string[] | null {
  const auth = getAuthContext(c)
  if (!auth) return []
  if (auth.user.role === 'admin' || auth.user.role === 'system') return null
  return auth.user.groups
}

/**
 * 단건(:id) 읽기 IDOR 가드: 행의 group_company 를 현재 사용자가 읽을 수 있는가.
 *   admin/system → 항상 true. operator → rowGroup 이 본인 groups 에 있어야 true.
 * 호출자는 false 일 때 404(존재 노출 회피) 반환 권장.
 */
export function canReadRowGroup(
  c: Context<{ Bindings: Bindings }>,
  rowGroup: string | null,
): boolean {
  const auth = getAuthContext(c)
  if (!auth) return false
  if (auth.user.role === 'admin' || auth.user.role === 'system') return true
  return rowGroup != null && auth.user.groups.includes(rowGroup)
}

/**
 * 파괴적/전역 변경 라우트(예: 전체 취약플래그 초기화, 대량 매칭 업로드) 가드.
 *   system(n8n) 또는 admin 만 허용. operator 차단.
 */
export function requireSystemOrAdmin(c: Context<{ Bindings: Bindings }>): PermissionResult {
  const auth = getAuthContext(c)
  if (!auth) return { ok: false, status: 403, error: '인증 컨텍스트 없음' }
  if (auth.user.role === 'system' || auth.user.role === 'admin') return { ok: true }
  return { ok: false, status: 403, error: '관리자 또는 시스템 권한이 필요합니다.' }
}
