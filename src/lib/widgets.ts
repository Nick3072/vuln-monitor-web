// v3.0 공유 대시보드 위젯 CRUD.

import type { DashboardWidget, WidgetType } from '../types'

export async function listWidgets(db: D1Database): Promise<DashboardWidget[]> {
  const { results } = await db
    .prepare(
      `SELECT id, widget_type, title, config_json, widget_order, is_hidden,
              created_by_user_id, updated_by_user_id, created_at, updated_at
         FROM dashboard_widgets
        WHERE is_hidden = 0
        ORDER BY widget_order ASC, id ASC`,
    )
    .all<DashboardWidget>()
  return results
}

export async function getWidget(db: D1Database, id: number): Promise<DashboardWidget | null> {
  const row = await db
    .prepare(
      `SELECT id, widget_type, title, config_json, widget_order, is_hidden,
              created_by_user_id, updated_by_user_id, created_at, updated_at
         FROM dashboard_widgets WHERE id = ?`,
    )
    .bind(id)
    .first<DashboardWidget>()
  return row ?? null
}

export interface CreateWidgetInput {
  widget_type: WidgetType
  title: string
  config_json: string
  created_by_user_id: number | null
}

export async function createWidget(db: D1Database, input: CreateWidgetInput): Promise<number> {
  // 신규 위젯은 가장 아래에 배치 (max widget_order + 1)
  const orderRow = await db
    .prepare('SELECT COALESCE(MAX(widget_order), 0) AS m FROM dashboard_widgets')
    .first<{ m: number }>()
  const nextOrder = (orderRow?.m ?? 0) + 1

  const result = await db
    .prepare(
      `INSERT INTO dashboard_widgets
         (widget_type, title, config_json, widget_order, created_by_user_id, updated_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.widget_type,
      input.title,
      input.config_json,
      nextOrder,
      input.created_by_user_id,
      input.created_by_user_id,
    )
    .run()

  return Number(result.meta.last_row_id)
}

export interface UpdateWidgetInput {
  title?: string
  config_json?: string
  updated_by_user_id: number | null
}

export async function updateWidget(
  db: D1Database,
  id: number,
  input: UpdateWidgetInput,
): Promise<void> {
  const sets: string[] = []
  const binds: unknown[] = []
  if (input.title !== undefined) {
    sets.push('title = ?')
    binds.push(input.title)
  }
  if (input.config_json !== undefined) {
    sets.push('config_json = ?')
    binds.push(input.config_json)
  }
  sets.push('updated_by_user_id = ?')
  binds.push(input.updated_by_user_id)
  sets.push('updated_at = CURRENT_TIMESTAMP')
  binds.push(id)
  await db.prepare(`UPDATE dashboard_widgets SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run()
}

export async function deleteWidget(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM dashboard_widgets WHERE id = ?').bind(id).run()
}

/**
 * 위/아래 1칸 이동. swap target 의 widget_order 와 교환.
 */
export async function moveWidget(
  db: D1Database,
  id: number,
  direction: 'up' | 'down',
): Promise<void> {
  const current = await getWidget(db, id)
  if (!current) return
  const op = direction === 'up' ? '<' : '>'
  const order = direction === 'up' ? 'DESC' : 'ASC'
  const sibling = await db
    .prepare(
      `SELECT id, widget_order FROM dashboard_widgets
        WHERE widget_order ${op} ? AND is_hidden = 0
        ORDER BY widget_order ${order}, id ${order}
        LIMIT 1`,
    )
    .bind(current.widget_order)
    .first<{ id: number; widget_order: number }>()
  if (!sibling) return

  await db.batch([
    db
      .prepare('UPDATE dashboard_widgets SET widget_order = ? WHERE id = ?')
      .bind(sibling.widget_order, current.id),
    db
      .prepare('UPDATE dashboard_widgets SET widget_order = ? WHERE id = ?')
      .bind(current.widget_order, sibling.id),
  ])
}
