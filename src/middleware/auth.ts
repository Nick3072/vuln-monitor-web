import type { Context, Next } from 'hono'
import { getSignedCookie } from 'hono/cookie'
import type { Bindings, UserRole } from '../types'
import { getUserById, getUserGroups, isSystemUsername } from '../lib/users'
import { timingSafeEqual } from '../lib/password'

// v3.0 다중 사용자 세션 + 외부 자동화 Bearer 토큰 동시 지원.
//
// 인증 우선순위:
//   1) HMAC 서명된 세션 쿠키 (운영자 로그인) — payload 의 session_version 이 DB 값과 일치해야 함
//   2) Authorization: Bearer <API_KEY> 헤더 (n8n / 외부 호출) — `_system_automation` 사용자로 매핑
//
// 둘 다 실패 시:
//   - HTML 요청 → /login?next=<원경로> 로 302 리다이렉트
//   - API 요청 → 401 JSON

export const SESSION_COOKIE_NAME = 'vuln_session'
export const SESSION_TTL_SECONDS = 60 * 60 * 8 // 8 시간

// v3.0 확장된 세션 페이로드 — 쿠키에 직렬화되는 값.
export interface SessionPayload {
  sub: number // user.id
  username: string // 화면 표시용
  groups: string[] // 사용자가 담당하는 group_company 배열 (다대다)
  role: UserRole
  sver: number // session_version — DB 값과 비교
  iat: number // 발급 시각 (Unix seconds)
  exp: number // 만료 시각 (Unix seconds)
}

// 요청 처리 동안 한 번 검증된 세션 컨텍스트.
export interface AuthContext {
  user: {
    id: number
    username: string
    groups: string[]
    role: UserRole
  }
  via: 'session' | 'bearer'
}

// HTML 요청 vs API 요청 판별.
function isHtmlRequest(c: Context<{ Bindings: Bindings }>): boolean {
  if (c.req.path.startsWith('/api/')) return false
  const accept = c.req.header('Accept') ?? ''
  if (accept.includes('application/json') && !accept.includes('text/html')) return false
  return true
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * 쿠키에서 세션 페이로드 추출 (서명+만료+session_version 검증).
 * 모두 통과하면 AuthContext, 아니면 null.
 */
export async function readSession(c: Context<{ Bindings: Bindings }>): Promise<AuthContext | null> {
  const secret = c.env.SESSION_SECRET
  if (!secret) return null

  let raw: string | false | undefined
  try {
    raw = await getSignedCookie(c, secret, SESSION_COOKIE_NAME)
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

  if (
    typeof p.sub !== 'number' ||
    typeof p.username !== 'string' ||
    typeof p.role !== 'string' ||
    typeof p.sver !== 'number' ||
    typeof p.exp !== 'number' ||
    !Array.isArray(p.groups)
  ) {
    return null
  }
  if (p.exp <= nowSeconds()) return null

  // session_version DB 검증 — 비번 변경/비활성화 시 자동 무효화
  const user = await getUserById(c.env.DB, p.sub)
  if (!user || user.is_active !== 1) return null
  if (user.session_version !== p.sver) return null

  // 그룹사 매핑은 DB 변경이 즉시 반영되도록 매 요청에서 재조회
  // (캐싱 가능하지만 정확성 우선)
  const groups = await getUserGroups(c.env.DB, user.id)

  return {
    user: {
      id: user.id,
      username: user.username,
      groups,
      role: user.role,
    },
    via: 'session',
  }
}

/**
 * Bearer 토큰 검증 — 일치 시 `_system_automation` 사용자로 매핑.
 * 양쪽 모두 trim 하여 wrangler secret put 의 trailing newline 같은 미세 차이를 흡수.
 */
async function readBearer(c: Context<{ Bindings: Bindings }>): Promise<AuthContext | null> {
  const expected = (c.env.API_KEY ?? '').trim()
  if (!expected) return null
  const header = c.req.header('Authorization')
  if (!header || !header.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  // 상수시간 비교 — 장기 시스템 자격증명(API_KEY)의 타이밍 사이드채널 차단.
  if (token.length === 0 || !timingSafeEqual(token, expected)) return null

  // 시스템 사용자는 모든 그룹사 허용 (role='system' 으로 권한 헬퍼가 통과)
  // 실제 사용자가 미존재할 가능성 대비해 fallback 처리
  return {
    user: {
      id: 0,
      username: '_system_automation',
      groups: [],
      role: 'system',
    },
    via: 'bearer',
  }
}

/**
 * Hono Variables 슬롯에 AuthContext 저장 + 조회용 헬퍼.
 * (Hono Context Variables 타입을 좁히지 않고 unknown 으로 통과 — 호출자에서 cast 필요)
 */
const AUTH_VAR_KEY = '__auth__'

export function setAuthContext(c: Context<{ Bindings: Bindings }>, auth: AuthContext): void {
  ;(c as unknown as { set: (k: string, v: unknown) => void }).set(AUTH_VAR_KEY, auth)
}

export function getAuthContext(c: Context<{ Bindings: Bindings }>): AuthContext | null {
  const v = (c as unknown as { get: (k: string) => unknown }).get(AUTH_VAR_KEY)
  return (v as AuthContext | undefined) ?? null
}

/**
 * 세션 쿠키 OR Bearer 토큰 둘 중 하나라도 통과하면 다음 핸들러로 진행.
 * AuthContext 를 c.var 에 저장하여 후속 핸들러에서 사용 가능.
 */
export async function sessionOrBearerAuth(
  c: Context<{ Bindings: Bindings }>,
  next: Next,
): Promise<Response | void> {
  // 1) 세션 쿠키 우선
  const session = await readSession(c)
  if (session) {
    if (isSystemUsername(session.user.username)) {
      // 시스템 계정은 비번 로그인 불가 — 만약 세션이 발급됐다면 거부
      return c.json({ success: false, error: 'System account cannot login' }, 403)
    }
    setAuthContext(c, session)
    await next()
    return
  }

  // 2) Bearer 토큰 폴백
  const bearer = await readBearer(c)
  if (bearer) {
    setAuthContext(c, bearer)
    await next()
    return
  }

  // 3) 둘 다 실패
  if (isHtmlRequest(c)) {
    const urlObj = new URL(c.req.url)
    const next_ = c.req.path + (urlObj.search ? urlObj.search : '')
    return c.redirect(`/login?next=${encodeURIComponent(next_)}`, 302)
  }
  return c.json({ success: false, error: 'Authentication required' }, 401)
}
