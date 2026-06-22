import { Hono } from 'hono'
import type { ApiResponse, Bindings, SemanticMatchHit, SemanticMatchRequest } from '../types'
import { querySimilarSolutions } from '../lib/embeddings'
import { canWriteGroup } from '../middleware/permissions'

const app = new Hono<{ Bindings: Bindings }>()

// POST /api/match/semantic
// n8n Pre-Match Filter 노드가 호출. 의미 기반 유사도로 키워드 매칭 누락분을 보완.
// body: { vulnerabilities: [{cve_id, title, description}], top_k?: 5, threshold?: 0.65 }
app.post('/semantic', async (c) => {
  const body = (await c.req.json().catch(() => null)) as SemanticMatchRequest | null
  if (!body || !Array.isArray(body.vulnerabilities)) {
    return c.json({ success: false, error: 'Invalid request body' }, 400)
  }

  const topK = Math.min(body.top_k ?? 5, 20)
  const threshold = body.threshold ?? 0.65
  const hits: SemanticMatchHit[] = []

  for (const v of body.vulnerabilities) {
    const text = [v.title ?? '', v.description ?? ''].join('. ').trim()
    if (!text) continue
    const matches = await querySimilarSolutions(c.env, text, topK)
    for (const m of matches) {
      if (m.score >= threshold) {
        hits.push({
          solution_id: m.solution_id,
          cve_id: v.cve_id,
          score: Math.round(m.score * 1000) / 1000,
        })
      }
    }
  }

  const response: ApiResponse<SemanticMatchHit[]> = {
    success: true,
    data: hits,
    meta: { total: hits.length },
  }
  return c.json(response)
})

// POST /api/match/embed/:id  — solution_id 의 임베딩을 강제 재생성
// 운영자가 메타데이터 (aliases/notes) 수정 후 임베딩만 다시 만들 때 사용.
app.post('/embed/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id < 1) {
    return c.json({ success: false, error: 'Invalid id' }, 400)
  }
  const row = await c.env.DB.prepare(
    `SELECT id, vendor, product, category, aliases, notes, group_company
       FROM solutions WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: number
      vendor: string
      product: string
      category: string
      aliases: string | null
      notes: string | null
      group_company: string | null
    }>()
  if (!row) {
    return c.json({ success: false, error: 'Solution not found' }, 404)
  }
  // v3.6 그룹 권한 가드 — operator 는 본인 그룹 솔루션만 임베딩 재생성 가능.
  const perm = canWriteGroup(c, row.group_company)
  if (!perm.ok) {
    return c.json({ success: false, error: perm.error }, perm.status)
  }
  const { upsertSolutionEmbedding } = await import('../lib/embeddings')
  const result = await upsertSolutionEmbedding(c.env, row)
  return c.json({ success: result.ok, data: { solution_id: id, status: result.status } })
})

export default app
