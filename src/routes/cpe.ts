import { Hono } from 'hono'
import type { ApiResponse, Bindings, CpeSuggestion } from '../types'
import { suggestCpe } from '../lib/cpe'

const app = new Hono<{ Bindings: Bindings }>()

// GET /api/cpe/suggest?q=fortinet+fortigate&limit=8
// 등록 폼 autocomplete + n8n 워크플로우 자동 enrichment 모두에서 사용.
app.get('/suggest', async (c) => {
  const q = c.req.query('q')?.trim() ?? ''
  if (q.length < 2) {
    return c.json({ success: false, error: 'q must be at least 2 chars' }, 400)
  }
  const limit = Math.min(Number(c.req.query('limit') ?? 8) || 8, 20)
  const suggestions = await suggestCpe(c.env, q, limit)
  const response: ApiResponse<CpeSuggestion[]> = {
    success: true,
    data: suggestions,
    meta: { total: suggestions.length },
  }
  return c.json(response)
})

export default app
