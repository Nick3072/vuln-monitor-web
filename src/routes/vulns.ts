import { Hono } from 'hono'
import type { ApiResponse, Bindings, MatchInput, MatchedVuln } from '../types'
import { writeAudit } from '../lib/audit'
import { canReadRowGroup, requireSystemOrAdmin } from '../middleware/permissions'

const app = new Hono<{ Bindings: Bindings }>()

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

interface MatchPayload {
  matches: MatchInput[]
  backfill_mode: boolean
}

function parseOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function validateMatchPayload(body: unknown): ValidationResult<MatchPayload> {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Request body must be a JSON object' }
  }
  const b = body as Record<string, unknown>
  if (!Array.isArray(b.matches)) {
    return { ok: false, error: 'Field `matches` must be an array' }
  }

  const backfill_mode = b.backfill_mode === true

  const matches: MatchInput[] = []
  for (let i = 0; i < b.matches.length; i++) {
    const raw = b.matches[i]
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, error: `matches[${i}] must be an object` }
    }
    const r = raw as Record<string, unknown>

    if (!Number.isInteger(r.solution_id) || (r.solution_id as number) < 1) {
      return { ok: false, error: `matches[${i}].solution_id must be a positive integer` }
    }
    if (typeof r.cve_id !== 'string' || r.cve_id.trim().length === 0) {
      return { ok: false, error: `matches[${i}].cve_id is required` }
    }
    if (typeof r.source !== 'string' || r.source.trim().length === 0) {
      return { ok: false, error: `matches[${i}].source is required` }
    }

    const reasons = Array.isArray(r.match_reasons)
      ? (r.match_reasons as unknown[]).filter((x): x is string => typeof x === 'string')
      : null

    matches.push({
      solution_id: r.solution_id as number,
      cve_id: (r.cve_id as string).trim(),
      source: (r.source as string).trim(),
      severity: parseOptionalString(r.severity),
      title: parseOptionalString(r.title),
      description: parseOptionalString(r.description),
      url: parseOptionalString(r.url),
      published: parseOptionalString(r.published),
      first_seen_at: parseOptionalString(r.first_seen_at),
      match_score: typeof r.match_score === 'number' ? r.match_score : null,
      match_reasons: reasons,
      epss_score: typeof r.epss_score === 'number' ? r.epss_score : null,
      is_kev: r.is_kev === true || r.is_kev === 1,
      cvss_score: typeof r.cvss_score === 'number' ? r.cvss_score : null,
    })
  }

  return { ok: true, value: { matches, backfill_mode } }
}

app.post('/match', async (c) => {
  // v3.6 대량 매칭 업로드는 전 그룹 교차 쓰기 → system(n8n)/admin 만 허용(operator 차단).
  const perm = requireSystemOrAdmin(c)
  if (!perm.ok) return c.json({ success: false, error: perm.error }, perm.status)

  const body = await c.req.json().catch(() => null)
  const validated = validateMatchPayload(body)
  if (!validated.ok) {
    return c.json({ success: false, error: validated.error }, 400)
  }

  const db = c.env.DB
  const { matches, backfill_mode } = validated.value

  let inserted = 0
  let flagged = 0
  let skipped = 0
  let duplicate = 0

  for (const m of matches) {
    const exists = await db
      .prepare('SELECT id FROM solutions WHERE id = ?')
      .bind(m.solution_id)
      .first<{ id: number }>()

    if (!exists) {
      skipped += 1
      continue
    }

    // Dedup via UNIQUE(solution_id, cve_id) introduced in migration 0002.
    // INSERT OR IGNORE + changes() == 1 means this is a genuinely new CVE for this solution.
    const firstSeen = m.first_seen_at ?? m.published ?? null
    const reasonsJson = Array.isArray(m.match_reasons) ? JSON.stringify(m.match_reasons) : null
    const isKevInt = m.is_kev ? 1 : 0

    const insRes = await db
      .prepare(
        `INSERT OR IGNORE INTO matched_vulns
           (solution_id, cve_id, source, severity, title, description, url, published,
            first_seen_at, detected_at,
            match_score, match_reasons, epss_score, is_kev, cvss_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP,
                 ?, ?, ?, ?, ?)`,
      )
      .bind(
        m.solution_id,
        m.cve_id,
        m.source,
        m.severity,
        m.title,
        m.description,
        m.url,
        m.published,
        firstSeen,
        m.match_score ?? null,
        reasonsJson,
        m.epss_score ?? null,
        isKevInt,
        m.cvss_score ?? null,
      )
      .run()

    if (insRes.meta.changes === 0) {
      duplicate += 1
      continue
    }
    inserted += 1

    // v3.2: 신규 CVE 가 탐지되면 'resolved' 수동 오버라이드를 해제한다.
    // 'vulnerable' 수동 표시는 건드리지 않는다 (운영자 의도 보존).
    const upd = await db
      .prepare(
        `UPDATE solutions
            SET is_vulnerable = 1,
                last_matched_cve = ?,
                last_matched_at = CURRENT_TIMESTAMP,
                manual_status = CASE
                  WHEN manual_status = 'resolved' THEN NULL
                  ELSE manual_status
                END,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
      )
      .bind(m.cve_id, m.solution_id)
      .run()
    flagged += upd.meta.changes
  }

  await writeAudit(db, 'match_upload', 'matched_vulns', 0, 'n8n', {
    received: matches.length,
    inserted,
    flagged,
    skipped,
    duplicate,
    backfill_mode,
  })

  const response: ApiResponse<{
    received: number
    inserted: number
    flagged: number
    skipped: number
    duplicate: number
    first_seen_count: number
    backfill_mode: boolean
  }> = {
    success: true,
    data: {
      received: matches.length,
      inserted,
      flagged,
      skipped,
      duplicate,
      first_seen_count: inserted,
      backfill_mode,
    },
  }
  return c.json(response)
})

app.post('/clear', async (c) => {
  // v3.6 전역 취약 플래그 초기화는 파괴적 교차 그룹 변경 → system/admin 만 허용(operator 차단).
  const perm = requireSystemOrAdmin(c)
  if (!perm.ok) return c.json({ success: false, error: perm.error }, perm.status)

  const db = c.env.DB
  const res = await db
    .prepare(
      `UPDATE solutions
          SET is_vulnerable = 0,
              last_matched_cve = NULL,
              last_matched_at = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE is_vulnerable = 1`,
    )
    .run()

  await writeAudit(db, 'clear_flags', 'solutions', 0, 'api', { cleared: res.meta.changes })

  const response: ApiResponse<{ cleared: number }> = {
    success: true,
    data: { cleared: res.meta.changes },
  }
  return c.json(response)
})

app.get('/history/:id', async (c) => {
  const raw = c.req.param('id')
  const id = Number(raw)
  if (!Number.isInteger(id) || id < 1) {
    return c.json({ success: false, error: 'Invalid id' }, 400)
  }

  // v3.6 IDOR 가드 — 솔루션의 그룹사를 먼저 조회해 권한 검증(타그룹은 404).
  const sol = await c.env.DB
    .prepare('SELECT group_company FROM solutions WHERE id = ?')
    .bind(id)
    .first<{ group_company: string | null }>()
  if (!sol || !canReadRowGroup(c, sol.group_company)) {
    return c.json({ success: false, error: 'Solution not found' }, 404)
  }

  const { results } = await c.env.DB
    .prepare('SELECT * FROM matched_vulns WHERE solution_id = ? ORDER BY detected_at DESC')
    .bind(id)
    .all<MatchedVuln>()

  const response: ApiResponse<MatchedVuln[]> = {
    success: true,
    data: results,
    meta: { total: results.length },
  }
  return c.json(response)
})

export default app
