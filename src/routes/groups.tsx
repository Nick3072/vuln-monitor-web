import { Hono } from 'hono'
import type { Bindings } from '../types'
import { getAuthContext } from '../middleware/auth'
import { requireAdmin } from '../middleware/permissions'
import { writeAudit } from '../lib/audit'
import { safeNext, safeNextAfterSelection } from '../lib/http'
import { setActiveGroup, ALL_GROUPS_SENTINEL } from '../lib/active-group'
import {
  listGroupCompaniesForUser,
  createGroupCompany,
  deleteGroupCompany,
  groupExists,
  countEquipmentInGroup,
  validateGroupName,
  normalizeGroupName,
  SYSTEM_GROUP,
} from '../lib/group-companies'
import { SelectGroupPage, type GroupCardData } from '../views/select-group'

// v3.6 그룹사 선택/생성/삭제 라우트. 보호 라우트(sessionOrBearerAuth 통과 후).
// 세션 전용 — Bearer/n8n 은 도달하지 않는다(게이트가 bearer 를 통과시키고 web/api 로 보냄).

const app = new Hono<{ Bindings: Bindings }>()

function readField(form: FormData, key: string): string {
  const v = form.get(key)
  return typeof v === 'string' ? v.trim() : ''
}

// ── GET /select-group — 선택 화면 ───────────────────────────────
app.get('/select-group', async (c) => {
  const auth = getAuthContext(c)
  if (!auth) return c.redirect('/login', 302)

  const db = c.env.DB
  const isAdmin = auth.user.role === 'admin'

  const groups = await listGroupCompaniesForUser(db, {
    role: auth.user.role,
    groups: auth.user.groups,
  })
  const cards: GroupCardData[] = groups.map((g) => ({
    name: g.name,
    assetCount: g.assetCount,
    solutionCount: g.solutionCount,
    vulnerableCount: g.vulnerableCount,
  }))

  // admin 전용: 'system'(미분류) 버킷 컴포넌트 수 — 0 이면 카드 미표시.
  let systemBucketCount = 0
  if (isAdmin) {
    const row = await db
      .prepare(`SELECT COUNT(*) AS cnt FROM solutions WHERE group_company = ?`)
      .bind(SYSTEM_GROUP)
      .first<{ cnt: number }>()
    systemBucketCount = row?.cnt ?? 0
  }

  return c.html(
    <SelectGroupPage
      groups={cards}
      currentUser={{ username: auth.user.username, role: auth.user.role, id: auth.user.id }}
      isAdmin={isAdmin}
      next={safeNext(c.req.query('next'))}
      flash={c.req.query('flash') ?? null}
      error={c.req.query('error') ?? null}
      systemBucketCount={systemBucketCount}
    />,
  )
})

// ── POST /select-group/activate — 활성 그룹 설정 후 진입 ──────────
app.post('/select-group/activate', async (c) => {
  const auth = getAuthContext(c)
  if (!auth) return c.redirect('/login', 302)

  const form = await c.req.formData().catch(() => null)
  if (!form) return c.redirect('/select-group?error=' + encodeURIComponent('폼 파싱 실패'), 303)

  const group = readField(form, 'group')
  const next = safeNextAfterSelection(readField(form, 'next'))
  const isAdmin = auth.user.role === 'admin'

  // 전체(__ALL__) / 미분류(system) 는 admin 전용.
  if (group === ALL_GROUPS_SENTINEL || group === SYSTEM_GROUP) {
    if (!isAdmin) {
      return c.redirect('/select-group?error=forbidden_group', 303)
    }
    await setActiveGroup(c, auth.user.id, group)
    return c.redirect(next, 303)
  }

  const name = normalizeGroupName(group)
  if (!name) {
    return c.redirect('/select-group?error=' + encodeURIComponent('그룹사를 선택하세요.'), 303)
  }

  // 권한 검증: operator 는 본인 담당 그룹만, admin 은 존재하는 그룹만.
  if (isAdmin) {
    if (!(await groupExists(c.env.DB, name))) {
      return c.redirect('/select-group?error=' + encodeURIComponent('존재하지 않는 그룹사입니다.'), 303)
    }
  } else if (!auth.user.groups.includes(name)) {
    return c.redirect('/select-group?error=forbidden_group', 303)
  }

  await setActiveGroup(c, auth.user.id, name)
  return c.redirect(next, 303)
})

// ── POST /groups — 그룹사 생성 (operator + admin) ────────────────
app.post('/groups', async (c) => {
  const auth = getAuthContext(c)
  if (!auth) return c.redirect('/login', 302)

  const form = await c.req.formData().catch(() => null)
  if (!form) return c.redirect('/select-group?error=' + encodeURIComponent('폼 파싱 실패'), 303)

  const rawName = readField(form, 'name')
  const next = safeNextAfterSelection(readField(form, 'next'))
  const db = c.env.DB
  const isAdmin = auth.user.role === 'admin'

  const v = validateGroupName(rawName)
  if (!v.ok) {
    return c.redirect('/select-group?error=' + encodeURIComponent(v.error), 303)
  }
  const name = v.name

  // operator 는 '신규 이름'만 생성 가능 — 기존(레지스트리/solutions/assets) 이름은 거부.
  //   타테넌트의 기존 그룹명을 입력해 자동배정으로 데이터를 탈취하는 것을 차단.
  if (!isAdmin) {
    const inRegistry = await groupExists(db, name)
    const counts = await countEquipmentInGroup(db, name)
    if (inRegistry || counts.assetCount > 0 || counts.solutionCount > 0) {
      return c.redirect(
        '/select-group?error=' +
          encodeURIComponent('이미 존재하는 그룹사 이름입니다. 관리자에게 배정을 요청하세요.'),
        303,
      )
    }
  }

  let result
  try {
    result = await createGroupCompany(db, name, auth.user.id, {
      autoAssignOperator: !isAdmin,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '그룹사 생성에 실패했습니다.'
    return c.redirect('/select-group?error=' + encodeURIComponent(msg), 303)
  }

  await writeAudit(db, 'group_create', 'group_companies', result.id, auth.user.username, {
    name: result.name,
    autoAssigned: !isAdmin,
  })

  // operator: 자동배정됐으므로 바로 활성화 + 진입. admin: 선택 화면에 남아 관리.
  if (!isAdmin) {
    await setActiveGroup(c, auth.user.id, result.name)
    return c.redirect(next, 303)
  }
  return c.redirect('/select-group?flash=created', 303)
})

// ── POST /groups/delete — 그룹사 삭제 (admin only) ───────────────
app.post('/groups/delete', async (c) => {
  const perm = requireAdmin(c)
  if (!perm.ok) return c.text(perm.error, perm.status)
  const auth = getAuthContext(c)!

  const form = await c.req.formData().catch(() => null)
  if (!form) return c.redirect('/select-group?error=' + encodeURIComponent('폼 파싱 실패'), 303)

  const name = normalizeGroupName(readField(form, 'name'))
  if (!name) return c.redirect('/select-group?error=' + encodeURIComponent('그룹사를 선택하세요.'), 303)

  try {
    const res = await deleteGroupCompany(c.env.DB, name)
    if (!res.deleted) {
      return c.redirect('/select-group?error=' + encodeURIComponent('존재하지 않는 그룹사입니다.'), 303)
    }
    await writeAudit(c.env.DB, 'group_delete', 'group_companies', 0, auth.user.username, {
      name,
      removedUserMappings: res.removedUserMappings,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '삭제에 실패했습니다.'
    return c.redirect('/select-group?error=' + encodeURIComponent(msg), 303)
  }

  return c.redirect('/select-group?flash=deleted', 303)
})

export default app
