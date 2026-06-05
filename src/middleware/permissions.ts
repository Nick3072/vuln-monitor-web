// v3.0 그룹사 WRITE 권한 검증 헬퍼.
// admin / system 은 모든 그룹사 허용. operator 는 자신이 매핑된 그룹사만 허용.

import type { Context } from 'hono'
import type { Bindings } from '../types'
import { getAuthContext } from './auth'

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

/**
 * operator 가 group_company 미지정 시 자동으로 첫 그룹사 채워주기 헬퍼.
 * admin/system 은 null 그대로 반환 (선택 권한 위임).
 */
export function defaultGroupForUser(c: Context<{ Bindings: Bindings }>): string | null {
  const auth = getAuthContext(c)
  if (!auth) return null
  if (auth.user.role === 'admin' || auth.user.role === 'system') return null
  return auth.user.groups[0] ?? null
}
