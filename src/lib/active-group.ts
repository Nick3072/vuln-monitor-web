// v3.6 활성 그룹 서명 쿠키 — 선택한 그룹사를 세션 동안 기억.
// 기존 vuln_session 패턴(SESSION_SECRET HMAC 서명) 재사용.
// 보안 핵심:
//   - 페이로드에 uid 를 포함해 다른 사용자/세션의 쿠키 재사용을 차단(공유 PC 안전).
//   - 값 자체는 신뢰하지 않는다. 권한(소유/존재) 검증은 항상 resolveEffectiveGroup 가 매 요청 재수행.

import type { Context } from 'hono'
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie'
import type { Bindings } from '../types'

export const ACTIVE_GROUP_COOKIE_NAME = 'vuln_active_group'
export const ALL_GROUPS_SENTINEL = '__ALL__' // admin "전체" 뷰 (실제 그룹명과 충돌 불가)
export const ACTIVE_GROUP_TTL_SECONDS = 60 * 60 * 8 // 세션과 동일 8시간

interface ActiveGroupPayload {
  uid: number // 발급 대상 user.id — 조회 시 현재 사용자와 일치해야 유효
  v: string // 그룹명 또는 ALL_GROUPS_SENTINEL
}

/**
 * 활성 그룹 쿠키 저장(서명). value 는 그룹명 또는 ALL_GROUPS_SENTINEL.
 * SESSION_SECRET 미설정 시 no-op(설정 전엔 활성 그룹도 발급 불가 — readSession 과 동일 폴백).
 */
export async function setActiveGroup(
  c: Context<{ Bindings: Bindings }>,
  uid: number,
  value: string,
): Promise<void> {
  const secret = c.env.SESSION_SECRET
  if (!secret) return
  const payload: ActiveGroupPayload = { uid, v: value }
  await setSignedCookie(c, ACTIVE_GROUP_COOKIE_NAME, JSON.stringify(payload), secret, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: ACTIVE_GROUP_TTL_SECONDS,
  })
}

/** 활성 그룹 쿠키 삭제(로그아웃/그룹 재선택 강제 시). */
export function clearActiveGroup(c: Context<{ Bindings: Bindings }>): void {
  deleteCookie(c, ACTIVE_GROUP_COOKIE_NAME, { path: '/' })
}

/**
 * 저장된 활성 그룹 값을 읽어 반환(서명 + uid 일치 검증만 수행).
 * 반환: 그룹명 | ALL_GROUPS_SENTINEL | null(쿠키 없음/서명 실패/uid 불일치).
 * ※ 권한(소유/존재) 검증은 호출자(resolveEffectiveGroup)가 담당 — 여기서는 출처 신뢰만 판단.
 */
export async function readActiveGroupValue(
  c: Context<{ Bindings: Bindings }>,
  uid: number,
): Promise<string | null> {
  const secret = c.env.SESSION_SECRET
  if (!secret) return null

  let raw: string | false | undefined
  try {
    raw = await getSignedCookie(c, secret, ACTIVE_GROUP_COOKIE_NAME)
  } catch {
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const p = parsed as Record<string, unknown>
  if (typeof p.uid !== 'number' || typeof p.v !== 'string') return null
  if (p.uid !== uid) return null // 다른 사용자/세션 쿠키 → 무효

  return p.v
}

/**
 * 네비 칩 표시용 라벨 — 그룹명 반환, 전체(__ALL__)/미설정은 null(Layout 이 역할별 기본값 표시).
 * 비스코프 페이지(관리/계정)에서 활성 그룹 칩을 일관되게 보이기 위해 사용.
 */
export async function getActiveGroupLabel(
  c: Context<{ Bindings: Bindings }>,
  uid: number,
): Promise<string | null> {
  const v = await readActiveGroupValue(c, uid)
  if (!v || v === ALL_GROUPS_SENTINEL) return null
  return v
}
