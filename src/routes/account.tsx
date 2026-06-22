import { Hono } from 'hono'
import { setSignedCookie } from 'hono/cookie'
import type { Bindings } from '../types'
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  getAuthContext,
  type SessionPayload,
} from '../middleware/auth'
import {
  getUserById,
  getUserCredentials,
  getUserGroups,
  isSystemUsername,
  updateUser,
} from '../lib/users'
import { verifyPassword } from '../lib/password'
import { validatePasswordPolicy } from '../lib/password-policy'
import { writeAudit } from '../lib/audit'
import { getActiveGroupLabel } from '../lib/active-group'
import { AccountPage } from '../views/account'

// v3.7 내 계정 라우트 (/account 하위):
//   - GET  /         : 프로필 확인 + 비밀번호 변경 폼
//   - POST /password : 본인 비밀번호 변경 (현재 비번 검증 → 정책 검증 → 갱신 → 세션 재발급)
// sessionOrBearerAuth 통과 후 마운트되므로 getAuthContext 는 채워져 있다.

const app = new Hono<{ Bindings: Bindings }>()

// 내 계정 페이지 (HTML)
app.get('/', async (c) => {
  const auth = getAuthContext(c)
  if (!auth) return c.redirect('/login', 302)

  const user = await getUserById(c.env.DB, auth.user.id)
  const activeGroup = await getActiveGroupLabel(c, auth.user.id)
  return c.html(
    <AccountPage
      currentUser={{
        username: auth.user.username,
        role: auth.user.role,
        groups: auth.user.groups,
      }}
      lastLogin={user?.last_login_at ?? null}
      flash={c.req.query('flash') ?? null}
      error={c.req.query('error') ?? null}
      activeGroup={activeGroup}
    />,
  )
})

// 본인 비밀번호 변경 (HTML form)
app.post('/password', async (c) => {
  const auth = getAuthContext(c)
  if (!auth) return c.redirect('/login', 302)

  // 시스템 계정은 비번 로그인/변경 불가
  if (isSystemUsername(auth.user.username)) {
    return c.redirect(
      '/account?error=' + encodeURIComponent('시스템 계정은 비밀번호를 변경할 수 없습니다.'),
      303,
    )
  }

  const form = await c.req.formData().catch(() => null)
  if (!form) {
    return c.redirect('/account?error=' + encodeURIComponent('폼 파싱 실패'), 303)
  }
  const currentRaw = form.get('current_password')
  const newRaw = form.get('new_password')
  const confirmRaw = form.get('confirm_password')
  const currentPassword = typeof currentRaw === 'string' ? currentRaw : ''
  const newPassword = typeof newRaw === 'string' ? newRaw : ''
  const confirmPassword = typeof confirmRaw === 'string' ? confirmRaw : ''

  if (!currentPassword || !newPassword || !confirmPassword) {
    return c.redirect('/account?error=' + encodeURIComponent('모든 비밀번호 항목을 입력해주세요.'), 303)
  }
  if (newPassword !== confirmPassword) {
    return c.redirect('/account?error=' + encodeURIComponent('새 비밀번호와 확인이 일치하지 않습니다.'), 303)
  }

  // 현재 비밀번호 검증 — password_hash 까지 조회
  const cred = await getUserCredentials(c.env.DB, auth.user.username)
  if (!cred || cred.is_active !== 1) {
    return c.redirect('/account?error=' + encodeURIComponent('현재 비밀번호가 일치하지 않습니다.'), 303)
  }
  const currentValid = await verifyPassword(currentPassword, cred.password_hash)
  if (!currentValid) {
    return c.redirect('/account?error=' + encodeURIComponent('현재 비밀번호가 일치하지 않습니다.'), 303)
  }

  // 새 비밀번호 정책 검증
  const policy = validatePasswordPolicy(newPassword)
  if (!policy.ok) {
    return c.redirect('/account?error=' + encodeURIComponent(policy.error), 303)
  }

  // SESSION_SECRET 없으면 세션 재발급 불가 — 비번 변경 자체를 막아 잠금 상태 방지
  const sessionSecret = c.env.SESSION_SECRET
  if (!sessionSecret) {
    return c.redirect(
      '/account?error=' +
        encodeURIComponent('서버에 SESSION_SECRET 시크릿이 설정되지 않았습니다. 관리자에게 문의하세요.'),
      303,
    )
  }

  // 비밀번호 갱신 — updateUser 가 password_hash 교체 + session_version++ 처리
  await updateUser(c.env.DB, auth.user.id, { new_password: newPassword })

  // 세션 재발급 — 갱신된 session_version 으로 본인 세션은 유지(타 세션은 무효화)
  const fresh = await getUserById(c.env.DB, auth.user.id)
  if (!fresh) {
    return c.redirect('/account?error=' + encodeURIComponent('사용자 정보를 다시 불러올 수 없습니다.'), 303)
  }
  const groups = await getUserGroups(c.env.DB, auth.user.id)
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = {
    sub: fresh.id,
    username: fresh.username,
    groups,
    role: fresh.role,
    sver: fresh.session_version,
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

  await writeAudit(c.env.DB, 'password_self_change', 'users', auth.user.id, auth.user.username, {})

  return c.redirect('/account?flash=' + encodeURIComponent('비밀번호가 변경되었습니다.'), 303)
})

export default app
