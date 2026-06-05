import type { Bindings, Solution } from '../types'

// Workers AI 임베딩 모델 — 768차원, 다국어 지원
// https://developers.cloudflare.com/workers-ai/models/bge-m3/
const EMBEDDING_MODEL = '@cf/baai/bge-m3'
const EMBEDDING_DIM = 768

export function buildEmbeddingText(s: {
  vendor: string
  product: string
  category: string
  aliases?: string | null
  notes?: string | null
}): string {
  const parts: string[] = []
  parts.push(`Vendor: ${s.vendor}`)
  parts.push(`Product: ${s.product}`)
  parts.push(`Category: ${s.category}`)

  if (s.aliases) {
    try {
      const arr = JSON.parse(s.aliases) as string[]
      if (Array.isArray(arr) && arr.length > 0) {
        parts.push(`Aliases: ${arr.slice(0, 15).join(', ')}`)
      }
    } catch {
      // ignore malformed aliases
    }
  }
  if (s.notes) {
    parts.push(`Notes: ${s.notes.slice(0, 200)}`)
  }
  return parts.join('. ')
}

interface AiEmbeddingResult {
  data: number[][]
  shape?: number[]
}

// 텍스트 → 벡터 (Workers AI bge-m3)
async function embedText(env: Bindings, text: string): Promise<number[] | null> {
  if (!env.AI) return null
  try {
    // Workers AI run: { text: string | string[] } → { data: number[][] }
    const result = (await env.AI.run(EMBEDDING_MODEL, { text: [text] })) as AiEmbeddingResult
    const vec = result.data?.[0]
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) return null
    return vec
  } catch {
    return null
  }
}

// 솔루션 임베딩 생성 + Vectorize 업서트 + D1 상태 갱신
export async function upsertSolutionEmbedding(
  env: Bindings,
  solution: Pick<Solution, 'id' | 'vendor' | 'product' | 'category' | 'aliases' | 'notes' | 'group_company'>,
): Promise<{ ok: boolean; status: string }> {
  if (!env.AI || !env.VECTORIZE) {
    await env.DB.prepare(
      `UPDATE solutions SET embedding_status = 'unavailable', embedding_updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
      .bind(solution.id)
      .run()
    return { ok: false, status: 'unavailable' }
  }

  const text = buildEmbeddingText(solution)
  const vec = await embedText(env, text)
  if (!vec) {
    await env.DB.prepare(
      `UPDATE solutions SET embedding_status = 'failed', embedding_updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
      .bind(solution.id)
      .run()
    return { ok: false, status: 'failed' }
  }

  try {
    await env.VECTORIZE.upsert([
      {
        id: `sol-${solution.id}`,
        values: vec,
        metadata: {
          solution_id: solution.id,
          vendor: solution.vendor,
          product: solution.product,
          category: solution.category,
          group_company: solution.group_company ?? '',
        },
      },
    ])
  } catch {
    await env.DB.prepare(
      `UPDATE solutions SET embedding_status = 'vectorize_failed', embedding_updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
      .bind(solution.id)
      .run()
    return { ok: false, status: 'vectorize_failed' }
  }

  await env.DB.prepare(
    `UPDATE solutions
        SET embedding_status = 'ready',
            embedding_text = ?,
            embedding_updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  )
    .bind(text, solution.id)
    .run()

  return { ok: true, status: 'ready' }
}

// CVE 텍스트 → 유사 솔루션 후보 검색
export async function querySimilarSolutions(
  env: Bindings,
  query: string,
  topK: number = 5,
): Promise<Array<{ solution_id: number; score: number }>> {
  if (!env.AI || !env.VECTORIZE) return []
  const vec = await embedText(env, query)
  if (!vec) return []

  try {
    const result = await env.VECTORIZE.query(vec, {
      topK,
      returnMetadata: 'indexed',
    })
    return (result.matches ?? []).map((m) => ({
      solution_id: Number((m.metadata as { solution_id?: number } | undefined)?.solution_id ?? m.id.replace(/^sol-/, '')),
      score: m.score,
    }))
  } catch {
    return []
  }
}

export async function deleteSolutionEmbedding(env: Bindings, solutionId: number): Promise<void> {
  if (!env.VECTORIZE) return
  try {
    await env.VECTORIZE.deleteByIds([`sol-${solutionId}`])
  } catch {
    // ignore — vector cleanup is best-effort
  }
}
