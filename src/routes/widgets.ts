import { Hono } from 'hono'
import type { Bindings, WidgetType } from '../types'
import {
  createWidget,
  deleteWidget,
  getWidget,
  moveWidget,
  updateWidget,
} from '../lib/widgets'
import { getAuthContext } from '../middleware/auth'
import { writeAudit } from '../lib/audit'

// v3.0 공유 대시보드 위젯 CRUD. sessionOrBearerAuth 통과 후 호출.
// 생성자(또는 admin) 만 수정/삭제. 모든 로그인 사용자는 추가 가능.

const app = new Hono<{ Bindings: Bindings }>()

const WIDGET_TYPES: WidgetType[] = ['filter_preset', 'note']

function isValidWidgetType(v: unknown): v is WidgetType {
  return typeof v === 'string' && (WIDGET_TYPES as string[]).includes(v)
}

function parseConfigJson(widgetType: WidgetType, configRaw: string | null): string | null {
  if (!configRaw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(configRaw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  // 위젯 종류별 최소 스키마 검증
  if (widgetType === 'note') {
    const p = parsed as Record<string, unknown>
    if (typeof p.content !== 'string' || p.content.length === 0) return null
    if (p.content.length > 2000) return null
  } else if (widgetType === 'filter_preset') {
    // 최소 1개 필드 채워야 의미 있음
    const p = parsed as Record<string, unknown>
    const hasAny = ['group_company', 'category', 'min_severity'].some(
      (k) => typeof p[k] === 'string' && (p[k] as string).length > 0,
    )
    if (!hasAny) return null
  }
  return JSON.stringify(parsed)
}

// 신규 위젯 (HTML form POST)
app.post('/', async (c) => {
  const auth = getAuthContext(c)
  if (!auth) return c.text('auth required', 401)

  const form = await c.req.formData().catch(() => null)
  if (!form) return c.redirect('/?error=' + encodeURIComponent('폼 파싱 실패'), 303)

  const widget_type = form.get('widget_type')
  const title = String(form.get('title') ?? '').trim()
  const configRaw = String(form.get('config_json') ?? '').trim()

  if (!isValidWidgetType(widget_type)) {
    return c.redirect('/?error=' + encodeURIComponent('잘못된 위젯 타입'), 303)
  }
  if (!title) {
    return c.redirect('/?error=' + encodeURIComponent('제목은 필수입니다.'), 303)
  }
  if (title.length > 100) {
    return c.redirect('/?error=' + encodeURIComponent('제목은 100자 이하'), 303)
  }
  const configJson = parseConfigJson(widget_type, configRaw)
  if (!configJson) {
    return c.redirect('/?error=' + encodeURIComponent('위젯 설정이 유효하지 않습니다.'), 303)
  }

  const newId = await createWidget(c.env.DB, {
    widget_type,
    title,
    config_json: configJson,
    created_by_user_id: auth.user.id || null,
  })

  await writeAudit(c.env.DB, 'widget_create', 'dashboard_widgets', newId, auth.user.username, {
    widget_type,
    title,
  })

  return c.redirect('/?flash=' + encodeURIComponent(`위젯 추가됨: ${title}`), 303)
})

// 수정
app.post('/:id', async (c) => {
  const auth = getAuthContext(c)
  if (!auth) return c.text('auth required', 401)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id < 1) return c.text('invalid id', 400)
  const existing = await getWidget(c.env.DB, id)
  if (!existing) return c.text('not found', 404)

  if (
    auth.user.role !== 'admin' &&
    existing.created_by_user_id !== auth.user.id
  ) {
    return c.redirect('/?error=' + encodeURIComponent('생성자 또는 관리자만 수정할 수 있습니다.'), 303)
  }

  const form = await c.req.formData().catch(() => null)
  if (!form) return c.redirect('/?error=' + encodeURIComponent('폼 파싱 실패'), 303)
  const title = String(form.get('title') ?? '').trim()
  const configRaw = String(form.get('config_json') ?? '').trim()
  if (!title || title.length > 100) {
    return c.redirect('/?error=' + encodeURIComponent('제목 유효성 오류'), 303)
  }
  const configJson = parseConfigJson(existing.widget_type, configRaw)
  if (!configJson) {
    return c.redirect('/?error=' + encodeURIComponent('위젯 설정이 유효하지 않습니다.'), 303)
  }

  await updateWidget(c.env.DB, id, {
    title,
    config_json: configJson,
    updated_by_user_id: auth.user.id || null,
  })
  await writeAudit(c.env.DB, 'widget_update', 'dashboard_widgets', id, auth.user.username, { title })

  return c.redirect('/?flash=' + encodeURIComponent('위젯 수정됨'), 303)
})

// 삭제
app.post('/:id/delete', async (c) => {
  const auth = getAuthContext(c)
  if (!auth) return c.text('auth required', 401)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id < 1) return c.text('invalid id', 400)
  const existing = await getWidget(c.env.DB, id)
  if (!existing) return c.text('not found', 404)

  if (auth.user.role !== 'admin' && existing.created_by_user_id !== auth.user.id) {
    return c.redirect('/?error=' + encodeURIComponent('생성자 또는 관리자만 삭제할 수 있습니다.'), 303)
  }

  await deleteWidget(c.env.DB, id)
  await writeAudit(c.env.DB, 'widget_delete', 'dashboard_widgets', id, auth.user.username, {
    title: existing.title,
  })

  return c.redirect('/?flash=' + encodeURIComponent('위젯 삭제됨'), 303)
})

// 순서 이동 — 위/아래
app.post('/:id/move/:direction', async (c) => {
  const auth = getAuthContext(c)
  if (!auth) return c.text('auth required', 401)
  const id = Number(c.req.param('id'))
  const direction = c.req.param('direction')
  if (!Number.isInteger(id) || (direction !== 'up' && direction !== 'down')) {
    return c.text('invalid params', 400)
  }
  const existing = await getWidget(c.env.DB, id)
  if (!existing) return c.text('not found', 404)
  // 순서 변경은 누구나 가능 (협업 보드 성격)
  await moveWidget(c.env.DB, id, direction)
  return c.redirect('/', 303)
})

export default app
