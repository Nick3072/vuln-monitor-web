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

// v3.0 다중 사용자 로그인/로그아웃. 공개 라우트.

const app = new Hono<{ Bindings: Bindings }>()

const SAFE_NEXT_RE = /^\/[^/]/ // 같은 출처 내부 경로만 허용

function safeNext(raw: string | undefined | null): string {
  if (!raw) return '/'
  if (!SAFE_NEXT_RE.test(raw)) return '/'
  if (raw.length > 512) return '/'
  return raw
}

app.get('/login', (c) => {
  const next = safeNext(c.req.query('next'))
  const flash = c.req.query('flash') ?? null
  return c.html(<LoginPage next={next} flash={flash} />)
})

app.post('/login', async (c) => {
  const sessionSecret = c.env.SESSION_SECRET
  if (!sessionSecret) {
    return c.html(
      <LoginPage error="서버에 SESSION_SECRET 시크릿이 설정되지 않았습니다. 관리자에게 문의하세요." />,
      500,
    )
  }

  const form = await c.req.formData().catch(() => null)
  if (!form) {
    return c.html(<LoginPage error="요청 본문을 읽을 수 없습니다." />, 400)
  }
  const usernameRaw = form.get('username')
  const passwordRaw = form.get('password')
  const nextRaw = form.get('next')
  const username = (typeof usernameRaw === 'string' ? usernameRaw : '').trim()
  const password = typeof passwordRaw === 'string' ? passwordRaw : ''
  const next = safeNext(typeof nextRaw === 'string' ? nextRaw : '/')

  if (!username || !password) {
    return c.html(<LoginPage error="아이디와 비밀번호를 모두 입력해주세요." next={next} />, 400)
  }

  // 시스템 사용자명으로 로그인 시도 차단
  if (isSystemUsername(username)) {
    return c.html(<LoginPage error="시스템 계정은 로그인할 수 없습니다." next={next} />, 403)
  }

  const user = await getUserCredentials(c.env.DB, username)
  if (!user || user.is_active !== 1) {
    return c.html(
      <LoginPage error="아이디 또는 비밀번호가 일치하지 않습니다." next={next} />,
      401,
    )
  }

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) {
    return c.html(
      <LoginPage error="아이디 또는 비밀번호가 일치하지 않습니다." next={next} />,
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

  await touchLastLogin(c.env.DB, user.id).catch(() => undefined)

  return c.redirect(next, 303)
})

app.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' })
  return c.redirect('/login?flash=logged-out', 303)
})
app.get('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' })
  return c.redirect('/login?flash=logged-out', 303)
})

export default app
