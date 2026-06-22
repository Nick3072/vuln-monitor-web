import { Hono } from 'hono'
import type { Bindings, UserRole } from '../types'
import {
  countAdmins,
  createUser,
  deleteUser,
  getUserById,
  listUsers,
  updateUser,
  isSystemUsername,
} from '../lib/users'
import { getAuthContext } from '../middleware/auth'
import { requireAdmin } from '../middleware/permissions'
import { getActiveGroupLabel } from '../lib/active-group'
import { writeAudit } from '../lib/audit'
import { validatePasswordPolicy } from '../lib/password-policy'
import { AdminUsersPage } from '../views/admin-users'

// v3.0 관리자 라우트:
//   - POST /admin/bootstrap : 최초 admin 1명 생성 (Bearer 토큰 필수, admin 0명일 때만 가능)
//   - GET  /admin/users     : 사용자 목록 페이지
//   - POST /admin/users     : 신규 생성
//   - POST /admin/users/:id : 수정
//   - POST /admin/users/:id/delete : 삭제

const app = new Hono<{ Bindings: Bindings }>()

// === 부트스트랩 (sessionOrBearerAuth 통과 후 호출됨) ===
// admin 사용자가 0명일 때만 동작. Bearer 토큰(시스템)이 호출하는 게 일반적.
app.post('/bootstrap', async (c) => {
  const auth = getAuthContext(c)
  if (!auth) return c.json({ success: false, error: 'auth required' }, 401)

  // 보안 가드: admin 이 이미 있으면 거부 (멱등)
  const existingAdmins = await countAdmins(c.env.DB)
  if (existingAdmins > 0) {
    return c.json({ success: false, error: 'admin user already exists' }, 409)
  }

  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return c.json({ success: false, error: 'JSON body required' }, 400)
  }
  const b = body as Record<string, unknown>
  const username = typeof b.username === 'string' ? b.username.trim() : ''
  const password = typeof b.password === 'string' ? b.password : ''
  const display_name = typeof b.display_name === 'string' ? b.display_name.trim() : null
  const groups = Array.isArray(b.groups)
    ? (b.groups as unknown[]).filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
    : []

  if (!username || !password) {
    return c.json({ success: false, error: 'username/password required' }, 400)
  }
  const pwCheck = validatePasswordPolicy(password)
  if (!pwCheck.ok) {
    return c.json({ success: false, error: pwCheck.error }, 400)
  }
  if (isSystemUsername(username)) {
    return c.json({ success: false, error: 'reserved username' }, 400)
  }

  const userId = await createUser(c.env.DB, {
    username,
    password,
    display_name,
    role: 'admin',
    groups,
  })

  await writeAudit(c.env.DB, 'admin_bootstrap', 'users', userId, auth.user.username, {
    username,
    groups,
  })

  return c.json({ success: true, data: { id: userId, username, role: 'admin', groups } }, 201)
})

// === 이하 라우트는 admin 권한 필수 ===

// 관리자 페이지 (HTML)
app.get('/users', async (c) => {
  const perm = requireAdmin(c)
  if (!perm.ok) return c.text(perm.error, perm.status)

  const users = await listUsers(c.env.DB)
  const flash = c.req.query('flash') ?? null
  const error = c.req.query('error') ?? null
  const auth = getAuthContext(c)!
  const activeGroup = await getActiveGroupLabel(c, auth.user.id)
  return c.html(
    <AdminUsersPage
      users={users}
      flash={flash}
      error={error}
      currentUser={{
        username: auth.user.username,
        role: auth.user.role,
        groups: auth.user.groups,
      }}
      activeGroup={activeGroup}
    />,
  )
})

// 신규 생성 (HTML form)
app.post('/users', async (c) => {
  const perm = requireAdmin(c)
  if (!perm.ok) return c.text(perm.error, perm.status)
  const auth = getAuthContext(c)!

  const form = await c.req.formData().catch(() => null)
  if (!form) return c.redirect('/admin/users?error=' + encodeURIComponent('폼 파싱 실패'), 303)

  const username = String(form.get('username') ?? '').trim()
  const password = String(form.get('password') ?? '')
  const display_name = String(form.get('display_name') ?? '').trim() || null
  const role = (String(form.get('role') ?? 'operator') as UserRole) || 'operator'
  const groupsRaw = String(form.get('groups') ?? '')
  const groups = groupsRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (!username || !password) {
    return c.redirect('/admin/users?error=' + encodeURIComponent('아이디와 비밀번호는 필수입니다.'), 303)
  }
  const pwCheck = validatePasswordPolicy(password)
  if (!pwCheck.ok) {
    return c.redirect('/admin/users?error=' + encodeURIComponent(pwCheck.error), 303)
  }
  if (isSystemUsername(username)) {
    return c.redirect('/admin/users?error=' + encodeURIComponent('예약된 사용자명입니다.'), 303)
  }
  if (role !== 'admin' && role !== 'operator') {
    return c.redirect('/admin/users?error=' + encodeURIComponent('role 은 admin/operator 만 가능합니다.'), 303)
  }

  try {
    const newId = await createUser(c.env.DB, { username, password, display_name, role, groups })
    await writeAudit(c.env.DB, 'user_create', 'users', newId, auth.user.username, {
      username,
      role,
      groups,
    })
  } catch (err) {
    const msg = err instanceof Error && err.message.includes('UNIQUE') ? '이미 존재하는 아이디입니다.' : '생성 실패'
    return c.redirect('/admin/users?error=' + encodeURIComponent(msg), 303)
  }

  return c.redirect('/admin/users?flash=' + encodeURIComponent(`${username} 생성 완료`), 303)
})

// 수정 (HTML form)
app.post('/users/:id', async (c) => {
  const perm = requireAdmin(c)
  if (!perm.ok) return c.text(perm.error, perm.status)
  const auth = getAuthContext(c)!

  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id < 1) return c.text('invalid id', 400)
  const existing = await getUserById(c.env.DB, id)
  if (!existing) return c.text('not found', 404)
  if (isSystemUsername(existing.username)) {
    return c.redirect('/admin/users?error=' + encodeURIComponent('시스템 계정은 수정할 수 없습니다.'), 303)
  }

  const form = await c.req.formData().catch(() => null)
  if (!form) return c.redirect('/admin/users?error=' + encodeURIComponent('폼 파싱 실패'), 303)

  const display_name = String(form.get('display_name') ?? '').trim() || null
  const role = String(form.get('role') ?? existing.role) as UserRole
  const is_active = String(form.get('is_active') ?? '1') === '1' ? 1 : 0
  const new_password = String(form.get('new_password') ?? '').trim()
  const groupsRaw = String(form.get('groups') ?? '')
  const groups = groupsRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (new_password) {
    const pwCheck = validatePasswordPolicy(new_password)
    if (!pwCheck.ok) {
      return c.redirect('/admin/users?error=' + encodeURIComponent(pwCheck.error), 303)
    }
  }

  // 마지막 admin 비활성화/role 변경 차단
  if (existing.role === 'admin' && (is_active === 0 || role !== 'admin')) {
    const admins = await countAdmins(c.env.DB)
    if (admins <= 1) {
      return c.redirect(
        '/admin/users?error=' + encodeURIComponent('마지막 관리자는 비활성화/역할변경 할 수 없습니다.'),
        303,
      )
    }
  }

  await updateUser(c.env.DB, id, {
    display_name,
    role: role === 'admin' || role === 'operator' ? role : existing.role,
    is_active: is_active as 0 | 1,
    new_password: new_password.length > 0 ? new_password : undefined,
    groups,
  })

  await writeAudit(c.env.DB, 'user_update', 'users', id, auth.user.username, {
    display_name,
    role,
    is_active,
    groups,
    password_changed: new_password.length > 0,
  })

  return c.redirect('/admin/users?flash=' + encodeURIComponent(`${existing.username} 수정 완료`), 303)
})

// 삭제 (HTML form)
app.post('/users/:id/delete', async (c) => {
  const perm = requireAdmin(c)
  if (!perm.ok) return c.text(perm.error, perm.status)
  const auth = getAuthContext(c)!

  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id < 1) return c.text('invalid id', 400)
  const existing = await getUserById(c.env.DB, id)
  if (!existing) return c.text('not found', 404)
  if (isSystemUsername(existing.username)) {
    return c.redirect('/admin/users?error=' + encodeURIComponent('시스템 계정은 삭제할 수 없습니다.'), 303)
  }
  if (existing.role === 'admin') {
    const admins = await countAdmins(c.env.DB)
    if (admins <= 1) {
      return c.redirect('/admin/users?error=' + encodeURIComponent('마지막 관리자는 삭제할 수 없습니다.'), 303)
    }
  }
  if (auth.user.id === id) {
    return c.redirect('/admin/users?error=' + encodeURIComponent('본인 계정은 삭제할 수 없습니다.'), 303)
  }

  await deleteUser(c.env.DB, id)
  await writeAudit(c.env.DB, 'user_delete', 'users', id, auth.user.username, { username: existing.username })

  return c.redirect('/admin/users?flash=' + encodeURIComponent(`${existing.username} 삭제 완료`), 303)
})

export default app
