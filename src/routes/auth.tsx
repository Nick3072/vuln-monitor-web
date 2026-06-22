import { Hono } from 'hono'
import { setSignedCookie, deleteCookie } from 'hono/cookie'
import type { Bindings } from '../types'
import { LoginPage } from '../views/login'
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  type SessionPayload,
} from '../middleware/auth'
import { verifyPassword } from '../lib/password'
import {
  getUserCredentials,
  getUserGroups,
  isSystemUsername,
  touchLastLogin,
} from '../lib/users'
import { recordAttempt, isLockedOut, cleanupOldAttempts } from '../lib/login-attempts'
import { safeNext } from '../lib/http'
import { clearActiveGroup } from '../lib/active-group'

// v3.0 다중 사용자 로그인/로그아웃. 공개 라우트.

const app = new Hono<{ Bindings: Bindings }>()

// v3.6 사용자 열거(timing) 방어용 디코이 해시 — 형식만 유효(salt$hash), PBKDF2 1회 수행 후 항상 false.
//   미존재/비활성 계정에서도 동일한 PBKDF2 연산 시간을 들여 응답시간 차이를 없앤다. (비밀 아님)
const DECOY_PASSWORD_HASH =
  '00112233445566778899aabbccddeeff$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

// v3.5 로그인 안내 정보(관리자 연락처·도움말 URL)는 모든 LoginPage 렌더에 동일하게 주입.
function loginInfo(env: Bindings): { adminContact: string | null; helpUrl: string | null } {
  return {
    adminContact: env.ADMIN_CONTACT ?? null,
    helpUrl: env.HELP_URL ?? null,
  }
}

app.get('/login', (c) => {
  const next = safeNext(c.req.query('next'))
  const flash = c.req.query('flash') ?? null
  return c.html(<LoginPage next={next} flash={flash} {...loginInfo(c.env)} />)
})

app.post('/login', async (c) => {
  const sessionSecret = c.env.SESSION_SECRET
  if (!sessionSecret) {
    return c.html(
      <LoginPage
        error="서버에 SESSION_SECRET 시크릿이 설정되지 않았습니다. 관리자에게 문의하세요."
        {...loginInfo(c.env)}
      />,
      500,
    )
  }

  // v3.5 로그인 보안 감사 — 시도 출처(IP·UA) 캡처.
  const ip = c.req.header('CF-Connecting-IP') ?? null
  const ua = c.req.header('User-Agent') ?? null

  const form = await c.req.formData().catch(() => null)
  if (!form) {
    return c.html(<LoginPage error="요청 본문을 읽을 수 없습니다." {...loginInfo(c.env)} />, 400)
  }
  const usernameRaw = form.get('username')
  const passwordRaw = form.get('password')
  const nextRaw = form.get('next')
  const username = (typeof usernameRaw === 'string' ? usernameRaw : '').trim()
  const password = typeof passwordRaw === 'string' ? passwordRaw : ''
  const next = safeNext(typeof nextRaw === 'string' ? nextRaw : '/')

  if (!username || !password) {
    return c.html(
      <LoginPage error="아이디와 비밀번호를 모두 입력해주세요." next={next} {...loginInfo(c.env)} />,
      400,
    )
  }

  // v3.5 IP·계정 단위 잠금 — 최근 실패 누적 임계 초과 시 인증 시도 자체를 차단.
  if (await isLockedOut(c.env.DB, { ip, username })) {
    await recordAttempt(c.env.DB, { username, ip, userAgent: ua, success: false, reason: 'locked' })
    return c.html(
      <LoginPage
        error="로그인 시도가 많아 약 15분간 제한되었습니다. 잠시 후 다시 시도해주세요."
        next={next}
        {...loginInfo(c.env)}
      />,
      429,
    )
  }

  // 시스템 사용자명으로 로그인 시도 차단
  if (isSystemUsername(username)) {
    await recordAttempt(c.env.DB, {
      username,
      ip,
      userAgent: ua,
      success: false,
      reason: 'system_blocked',
    })
    return c.html(
      <LoginPage error="시스템 계정은 로그인할 수 없습니다." next={next} {...loginInfo(c.env)} />,
      403,
    )
  }

  const user = await getUserCredentials(c.env.DB, username)
  if (!user || user.is_active !== 1) {
    // v3.6 사용자 열거(timing) 방어 — 존재 계정과 동일하게 PBKDF2 1회 수행 후 거부.
    await verifyPassword(password, DECOY_PASSWORD_HASH).catch(() => undefined)
    // 계정 열거 방지 — 화면 메시지는 동일, 감사 사유만 미존재/비활성 구분.
    await recordAttempt(c.env.DB, {
      username,
      ip,
      userAgent: ua,
      success: false,
      reason: user ? 'inactive' : 'bad_credentials',
    })
    return c.html(
      <LoginPage error="아이디 또는 비밀번호가 일치하지 않습니다." next={next} {...loginInfo(c.env)} />,
      401,
    )
  }

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) {
    await recordAttempt(c.env.DB, {
      username,
      ip,
      userAgent: ua,
      success: false,
      reason: 'bad_credentials',
    })
    return c.html(
      <LoginPage error="아이디 또는 비밀번호가 일치하지 않습니다." next={next} {...loginInfo(c.env)} />,
      401,
    )
  }

  const groups = await getUserGroups(c.env.DB, user.id)
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = {
    sub: user.id,
    username: user.username,
    groups,
    role: user.role,
    sver: user.session_version,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  }

  await setSignedCookie(c, SESSION_COOKIE_NAME, JSON.stringify(payload), sessionSecret, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })

  // v3.5 성공 감사 기록 + 보존기간 초과분 정리(둘 다 흐름을 깨지 않음).
  await recordAttempt(c.env.DB, { username, ip, userAgent: ua, success: true, reason: 'ok' })
  await cleanupOldAttempts(c.env.DB).catch(() => undefined)

  await touchLastLogin(c.env.DB, user.id).catch(() => undefined)

  // v3.6 결정 #4: 로그인 후에는 그룹사가 1개여도 항상 선택 화면을 거친다.
  //   원래 가려던 경로(next)는 선택 완료 후 이동을 위해 쿼리로 보존한다.
  const dest =
    next && next !== '/' ? `/select-group?next=${encodeURIComponent(next)}` : '/select-group'
  return c.redirect(dest, 303)
})

// v3.6 로그아웃은 POST 전용 — GET /logout 은 상태변경 GET(CSRF 강제 로그아웃) 벡터라 제거.
//   모든 로그아웃 UI 는 <form method="post" action="/logout"> 를 사용한다.
app.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' })
  clearActiveGroup(c) // v3.6 활성 그룹 쿠키도 함께 정리
  return c.redirect('/login?flash=logged-out', 303)
})

export default app
