import { Hono } from 'hono'
import type { ApiResponse, Bindings, ManualVulnAction, MarkVulnerableInput, Solution, SolutionInput } from '../types'
import { writeAudit } from '../lib/audit'
import { applyManualVulnAction } from '../lib/vuln-status'
import { triggerRematch } from '../lib/rematch'
import { generateAliases } from '../lib/normalize'
import { suggestCpe } from '../lib/cpe'
import { upsertSolutionEmbedding, deleteSolutionEmbedding } from '../lib/embeddings'
import {
  canWriteGroup,
  resolveEffectiveGroup,
  resolveWriteGroup,
  allowedGroupsForUser,
  canReadRowGroup,
} from '../middleware/permissions'
import { getAuthContext } from '../middleware/auth'
import { resolveOrCreateAsset, applyDerivedImpactSystem } from '../lib/assets'
import { normalizeResolveMethod } from '../lib/history'

const app = new Hono<{ Bindings: Bindings }>()

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

function parseOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

// v2.5: cpe_uri 형식 검증 (cpe:2.3:[aho]:vendor:product:version 이상)
const CPE_URI_RE = /^cpe:2\.3:[aho]:[^:]+:[^:]+:/

function parseCpeUri(value: unknown): string | null {
  const s = parseOptionalString(value)
  if (s === null) return null
  if (!CPE_URI_RE.test(s)) {
    throw new Error(`Invalid cpe_uri format (expected cpe:2.3:[aho]:vendor:product:...): ${s}`)
  }
  return s
}

// v2.5: category_attributes 입력 — 객체 그대로 / JSON 문자열 / null 허용
function parseCategoryAttributes(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('category_attributes must be valid JSON')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('category_attributes must be a JSON object')
    }
    return parsed as Record<string, unknown>
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new Error('category_attributes must be a JSON object')
}

function parseAliasesField(value: unknown): string[] | null {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) {
    const arr = value.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    return arr.length > 0 ? arr.map((s) => s.trim()) : null
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return parseAliasesField(parsed)
      }
    } catch {
      // fall through — treat as comma-separated
    }
    const arr = value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return arr.length > 0 ? arr : null
  }
  return null
}

export function validateSolutionInput(body: unknown): ValidationResult<SolutionInput> {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Request body must be a JSON object' }
  }
  const b = body as Record<string, unknown>

  const required = ['vendor', 'product', 'category', 'current_version'] as const
  for (const key of required) {
    if (typeof b[key] !== 'string' || (b[key] as string).trim().length === 0) {
      return { ok: false, error: `Missing or invalid field: ${key}` }
    }
  }

  let cpeUri: string | null
  let categoryAttrs: Record<string, unknown> | null
  try {
    cpeUri = parseCpeUri(b.cpe_uri)
    categoryAttrs = parseCategoryAttributes(b.category_attributes)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid optional field' }
  }

  // v3.1: optional asset_id (숫자 또는 null)
  let assetId: number | null = null
  if (b.asset_id !== undefined && b.asset_id !== null) {
    const n = Number(b.asset_id)
    if (Number.isInteger(n) && n >= 1) {
      assetId = n
    }
  }

  return {
    ok: true,
    value: {
      vendor: (b.vendor as string).trim(),
      product: (b.product as string).trim(),
      category: (b.category as string).trim(),
      current_version: (b.current_version as string).trim(),
      hostname: parseOptionalString(b.hostname),
      owner: parseOptionalString(b.owner),
      manager: parseOptionalString(b.manager),
      notes: parseOptionalString(b.notes),
      group_company: parseOptionalString(b.group_company),
      cpe_part: parseOptionalString(b.cpe_part),
      cpe_version_range: parseOptionalString(b.cpe_version_range),
      aliases: parseAliasesField(b.aliases),
      cpe_uri: cpeUri,
      category_attributes: categoryAttrs,
      asset_id: assetId,
    },
  }
}

function parseId(raw: string): number | null {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return null
  return n
}

// 등록/수정 시 CPE 가 비어있으면 NVD 에서 자동 추천 → 최상위 후보 채택
async function autoEnrichCpe(env: Bindings, input: SolutionInput): Promise<{ cpe_part: string | null; cpe_version_range: string | null }> {
  if (input.cpe_part) {
    return { cpe_part: input.cpe_part, cpe_version_range: input.cpe_version_range }
  }
  const query = `${input.vendor} ${input.product}`.trim()
  const suggestions = await suggestCpe(env, query, 5)
  const best = suggestions.find((s) => !s.deprecated) ?? suggestions[0]
  return {
    cpe_part: best?.cpe_part ?? null,
    cpe_version_range: input.cpe_version_range,
  }
}

app.get('/', async (c) => {
  // v3.6 읽기 스코핑 — operator 강제 스코프, admin/system 선택/전체.
  const scope = await resolveEffectiveGroup(c, c.req.query('group_company') ?? null)
  if (!scope.ok) return c.json({ success: false, error: scope.error }, scope.status)
  const group = scope.group
  const stmt = group
    ? c.env.DB.prepare(
        'SELECT * FROM solutions WHERE group_company = ? ORDER BY is_vulnerable DESC, updated_at DESC',
      ).bind(group)
    : c.env.DB.prepare('SELECT * FROM solutions ORDER BY is_vulnerable DESC, updated_at DESC')

  const { results } = await stmt.all<Solution>()

  const response: ApiResponse<Solution[]> = {
    success: true,
    data: results,
    meta: { total: results.length },
  }
  return c.json(response)
})

app.get('/groups', async (c) => {
  // v3.6 operator 는 본인 그룹만(타테넌트 이름 누수 차단), admin/system 은 전체.
  const allowedGroups = allowedGroupsForUser(c)
  if (allowedGroups !== null && allowedGroups.length === 0) {
    return c.json({ success: true, data: [], meta: { total: 0 } })
  }
  const stmt =
    allowedGroups === null
      ? c.env.DB.prepare(
          `SELECT group_company AS name, COUNT(*) AS total,
                  SUM(CASE WHEN is_vulnerable = 1 THEN 1 ELSE 0 END) AS vulnerable
             FROM solutions
            WHERE group_company IS NOT NULL AND TRIM(group_company) != ''
            GROUP BY group_company
            ORDER BY name`,
        )
      : c.env.DB.prepare(
          `SELECT group_company AS name, COUNT(*) AS total,
                  SUM(CASE WHEN is_vulnerable = 1 THEN 1 ELSE 0 END) AS vulnerable
             FROM solutions
            WHERE group_company IN (${allowedGroups.map(() => '?').join(',')})
            GROUP BY group_company
            ORDER BY name`,
        ).bind(...allowedGroups)
  const { results } = await stmt.all<{ name: string; total: number; vulnerable: number }>()

  const response: ApiResponse<typeof results> = {
    success: true,
    data: results,
    meta: { total: results.length },
  }
  return c.json(response)
})

app.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) {
    return c.json({ success: false, error: 'Invalid id' }, 400)
  }

  const row = await c.env.DB.prepare('SELECT * FROM solutions WHERE id = ?')
    .bind(id)
    .first<Solution>()

  if (!row) {
    return c.json({ success: false, error: 'Solution not found' }, 404)
  }

  // v3.6 IDOR 가드 — 타그룹 행은 존재 노출 없이 404.
  if (!canReadRowGroup(c, row.group_company)) {
    return c.json({ success: false, error: 'Solution not found' }, 404)
  }

  const response: ApiResponse<Solution> = { success: true, data: row }
  return c.json(response)
})

app.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  const validated = validateSolutionInput(body)
  if (!validated.ok) {
    return c.json({ success: false, error: validated.error }, 400)
  }

  const input = validated.value
  const db = c.env.DB

  // v3.6 그룹 쓰기 SSOT — operator 는 활성 그룹 강제(요청 group_company 무시),
  //   admin 진입그룹/전체거부, system(n8n) requested 신뢰.
  const wg = await resolveWriteGroup(c, input.group_company)
  if (!wg.ok) {
    return c.json({ success: false, error: wg.error }, wg.status)
  }
  input.group_company = wg.group
  const perm = canWriteGroup(c, input.group_company)
  if (!perm.ok) {
    return c.json({ success: false, error: perm.error }, perm.status)
  }

  // 자동 enrichment: aliases / vendor_normalized / product_normalized 즉시 계산
  const { aliases: autoAliases, vendorNorm, productNorm } = generateAliases({
    vendor: input.vendor,
    product: input.product,
    category: input.category,
  })
  const mergedAliases = Array.from(
    new Set([...(input.aliases ?? []).map((s) => s.trim()), ...autoAliases]),
  )

  // CPE 자동 추천 (백그라운드 호출 — 등록 응답 지연 최소화를 위해 inline 호출)
  const cpe = await autoEnrichCpe(c.env, input)

  const categoryAttrsJson = input.category_attributes
    ? JSON.stringify(input.category_attributes)
    : null

  // v3.1: asset_id — 명시됐거나 (group_company, hostname) 기준 자동 resolve/create
  const assetId =
    input.asset_id != null
      ? input.asset_id
      : await resolveOrCreateAsset(db, {
          name: input.hostname?.trim()
            ? input.hostname.trim()
            : `${input.vendor} ${input.product}`,
          vendor: input.vendor,
          hostname: input.hostname,
          group_company: input.group_company,
          owner: input.owner,
          manager: input.manager,
        })

  const insert = await db
    .prepare(
      `INSERT INTO solutions
         (vendor, product, category, current_version, hostname, owner, manager, notes, group_company,
          cpe_part, cpe_version_range, aliases, vendor_normalized, product_normalized,
          cpe_uri, category_attributes, source, embedding_status, asset_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api', 'pending', ?)`,
    )
    .bind(
      input.vendor,
      input.product,
      input.category,
      input.current_version,
      input.hostname,
      input.owner,
      input.manager,
      input.notes,
      input.group_company,
      cpe.cpe_part,
      cpe.cpe_version_range,
      JSON.stringify(mergedAliases),
      vendorNorm,
      productNorm,
      input.cpe_uri,
      categoryAttrsJson,
      assetId,
    )
    .run()

  const newId = Number(insert.meta.last_row_id)

  // v3.3 신규 컴포넌트 반영해 자산 영향시스템 자동 재분류 (manual 보존)
  await applyDerivedImpactSystem(db, assetId)

  const actor = getAuthContext(c)?.user.username ?? 'api'
  await writeAudit(db, 'create', 'solutions', newId, actor, {
    ...input,
    cpe_part: cpe.cpe_part,
    aliases: mergedAliases,
    asset_id: assetId,
  })

  const created = await db
    .prepare('SELECT * FROM solutions WHERE id = ?')
    .bind(newId)
    .first<Solution>()

  // 1) 임베딩 생성 (Vectorize)
  // 2) rematch 트리거 (n8n)
  // 모두 waitUntil 로 비동기 처리 — 사용자 응답은 즉시.
  c.executionCtx.waitUntil(
    (async () => {
      if (created) {
        await upsertSolutionEmbedding(c.env, created).catch(() => undefined)
      }
      const result = await triggerRematch(c.env, newId).catch(() => ({ ok: false as const, error: 'rematch threw' }))
      await writeAudit(
        db,
        result.ok ? 'rematch_requested' : 'rematch_request_failed',
        'solutions',
        newId,
        'api',
        { solution_id: newId, window_days: 365, result },
      )
    })(),
  )

  const response: ApiResponse<Solution> = { success: true, data: created ?? undefined }
  return c.json(response, 201)
})

// ─ v3.2 수동 취약점 상태 오버라이드 JSON API ─────────────────────
/**
 * POST /api/solutions/:id/vuln-status
 *
 * body: { action: 'vulnerable'|'resolved'|'auto', cve_id?, severity?, title?, note? }
 * Returns ApiResponse<{ solution_id: number; action: string }>
 */
app.post('/:id/vuln-status', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) {
    return c.json<ApiResponse>({ success: false, error: 'Invalid id' }, 400)
  }

  const body = await c.req.json().catch(() => null)
  if (typeof body !== 'object' || body === null) {
    return c.json<ApiResponse>({ success: false, error: 'Request body must be a JSON object' }, 400)
  }
  const b = body as Record<string, unknown>

  const validActions: ManualVulnAction[] = ['vulnerable', 'resolved', 'auto']
  const action = typeof b.action === 'string' ? (b.action as ManualVulnAction) : null
  if (!action || !validActions.includes(action)) {
    return c.json<ApiResponse>({ success: false, error: 'action must be one of: vulnerable, resolved, auto' }, 400)
  }

  const db = c.env.DB

  // 솔루션 존재 + 권한 검증
  const existing = await db
    .prepare('SELECT group_company FROM solutions WHERE id = ?')
    .bind(id)
    .first<{ group_company: string | null }>()
  if (!existing) {
    return c.json<ApiResponse>({ success: false, error: 'Solution not found' }, 404)
  }
  const perm = canWriteGroup(c, existing.group_company)
  if (!perm.ok) {
    return c.json<ApiResponse>({ success: false, error: perm.error }, perm.status)
  }

  const input: MarkVulnerableInput = {
    cve_id: typeof b.cve_id === 'string' ? b.cve_id.trim() || null : null,
    severity: typeof b.severity === 'string' ? b.severity.trim() || null : null,
    title: typeof b.title === 'string' ? b.title.trim() || null : null,
    note: typeof b.note === 'string' ? b.note.trim() || null : null,
  }

  const actor = getAuthContext(c)?.user.username ?? 'api'

  try {
    await applyManualVulnAction(db, id, actor, action, input)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Status update failed'
    return c.json<ApiResponse>({ success: false, error: msg }, 500)
  }

  // v3.7 resolved 면 조치 방식(method) 을 감사 payload 에 포함 → 조치 이력 화면 구분 표시.
  const auditPayload =
    action === 'resolved'
      ? { action, ...input, method: normalizeResolveMethod(typeof b.method === 'string' ? b.method : null) }
      : { action, ...input }
  await writeAudit(db, `manual_vuln_${action}`, 'solutions', id, actor, auditPayload)

  const response: ApiResponse<{ solution_id: number; action: string }> = {
    success: true,
    data: { solution_id: id, action },
  }
  return c.json(response)
})

app.post('/:id/rematch', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) {
    return c.json({ success: false, error: 'Invalid id' }, 400)
  }

  const db = c.env.DB
  const row = await db
    .prepare('SELECT id, group_company FROM solutions WHERE id = ?')
    .bind(id)
    .first<{ id: number; group_company: string | null }>()

  if (!row) {
    return c.json({ success: false, error: 'Solution not found' }, 404)
  }

  // v3.6 그룹 권한 가드 — operator 는 본인 그룹 솔루션만 rematch 트리거 가능.
  const perm = canWriteGroup(c, row.group_company)
  if (!perm.ok) {
    return c.json({ success: false, error: perm.error }, perm.status)
  }

  const recent = await db
    .prepare(
      `SELECT 1 AS hit FROM audit_log
        WHERE target_table = 'solutions' AND target_id = ?
          AND action IN ('rematch_requested','rematch_request_failed')
          AND created_at > datetime('now','-5 minutes')
        LIMIT 1`,
    )
    .bind(id)
    .first<{ hit: number }>()

  if (recent) {
    return c.json(
      { success: false, error: 'Rematch recently requested, try again later' },
      429,
    )
  }

  await writeAudit(db, 'rematch_requested', 'solutions', id, 'api', {
    solution_id: id,
    window_days: 365,
    source: 'manual',
    phase: 'accepted',
  })

  c.executionCtx.waitUntil(
    triggerRematch(c.env, id)
      .then((result) => {
        if (result.ok) return
        return writeAudit(db, 'rematch_request_failed', 'solutions', id, 'api', {
          solution_id: id,
          window_days: 365,
          source: 'manual',
          result,
        })
      })
      .catch(() => undefined),
  )

  return c.json(
    {
      success: true,
      data: { solution_id: id, requested_at: new Date().toISOString() },
    },
    202,
  )
})

app.put('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) {
    return c.json({ success: false, error: 'Invalid id' }, 400)
  }

  const body = await c.req.json().catch(() => null)
  const validated = validateSolutionInput(body)
  if (!validated.ok) {
    return c.json({ success: false, error: validated.error }, 400)
  }

  const input = validated.value
  const db = c.env.DB

  // v3.0 권한 검증 — 기존 row 의 group_company 와 새 input 의 group_company 둘 다 검증
  const existing = await db
    .prepare('SELECT group_company FROM solutions WHERE id = ?')
    .bind(id)
    .first<{ group_company: string | null }>()
  if (!existing) {
    return c.json({ success: false, error: 'Solution not found' }, 404)
  }
  const permExisting = canWriteGroup(c, existing.group_company)
  if (!permExisting.ok) {
    return c.json({ success: false, error: permExisting.error }, permExisting.status)
  }
  // v3.6 수정 시 그룹 미입력이면 기존 그룹 유지(groups[0] 오이동 방지).
  if (!input.group_company) {
    input.group_company = existing.group_company
  }
  const permNew = canWriteGroup(c, input.group_company)
  if (!permNew.ok) {
    return c.json({ success: false, error: permNew.error }, permNew.status)
  }

  const { aliases: autoAliases, vendorNorm, productNorm } = generateAliases({
    vendor: input.vendor,
    product: input.product,
    category: input.category,
  })
  const mergedAliases = Array.from(
    new Set([...(input.aliases ?? []).map((s) => s.trim()), ...autoAliases]),
  )

  // CPE 가 명시되지 않은 경우만 자동 추천 (이미 등록자가 지정한 CPE 보존)
  const cpe = await autoEnrichCpe(c.env, input)

  const categoryAttrsJson = input.category_attributes
    ? JSON.stringify(input.category_attributes)
    : null

  const update = await db
    .prepare(
      `UPDATE solutions
          SET vendor = ?, product = ?, category = ?, current_version = ?,
              hostname = ?, owner = ?, manager = ?, notes = ?, group_company = ?,
              cpe_part = ?, cpe_version_range = ?, aliases = ?,
              vendor_normalized = ?, product_normalized = ?,
              cpe_uri = ?, category_attributes = ?,
              embedding_status = 'pending',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .bind(
      input.vendor,
      input.product,
      input.category,
      input.current_version,
      input.hostname,
      input.owner,
      input.manager,
      input.notes,
      input.group_company,
      cpe.cpe_part,
      cpe.cpe_version_range,
      JSON.stringify(mergedAliases),
      vendorNorm,
      productNorm,
      input.cpe_uri,
      categoryAttrsJson,
      id,
    )
    .run()

  if (update.meta.changes === 0) {
    return c.json({ success: false, error: 'Solution not found' }, 404)
  }

  const updateActor = getAuthContext(c)?.user.username ?? 'api'
  await writeAudit(db, 'update', 'solutions', id, updateActor, { ...input, cpe_part: cpe.cpe_part, aliases: mergedAliases })

  const row = await db.prepare('SELECT * FROM solutions WHERE id = ?').bind(id).first<Solution>()

  // 임베딩 재생성 (메타데이터 변경 반영)
  c.executionCtx.waitUntil(
    row ? upsertSolutionEmbedding(c.env, row).catch(() => undefined) : Promise.resolve(),
  )

  const response: ApiResponse<Solution> = { success: true, data: row ?? undefined }
  return c.json(response)
})

app.delete('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) {
    return c.json({ success: false, error: 'Invalid id' }, 400)
  }

  const db = c.env.DB

  // v3.0 권한 검증
  const existing = await db
    .prepare('SELECT group_company FROM solutions WHERE id = ?')
    .bind(id)
    .first<{ group_company: string | null }>()
  if (!existing) {
    return c.json({ success: false, error: 'Solution not found' }, 404)
  }
  const perm = canWriteGroup(c, existing.group_company)
  if (!perm.ok) {
    return c.json({ success: false, error: perm.error }, perm.status)
  }

  const del = await db.prepare('DELETE FROM solutions WHERE id = ?').bind(id).run()

  if (del.meta.changes === 0) {
    return c.json({ success: false, error: 'Solution not found' }, 404)
  }

  const deleteActor = getAuthContext(c)?.user.username ?? 'api'
  await writeAudit(db, 'delete', 'solutions', id, deleteActor, null)

  // Vectorize 인덱스에서도 제거
  c.executionCtx.waitUntil(deleteSolutionEmbedding(c.env, id))

  return c.json({ success: true, data: { id } })
})

export default app
