import type { Bindings, CpeSuggestion } from '../types'
import { extractCpePart } from './normalize'

interface NvdCpeResponse {
  products?: Array<{
    cpe: {
      cpeName: string
      cpeNameId?: string
      deprecated?: boolean
      titles?: Array<{ title: string; lang: string }>
    }
  }>
}

const CACHE_TTL_HOURS = 24 * 7 // 7일

// NVD CPE Dictionary 검색 — D1 캐시 우선, miss 시 외부 API 호출
export async function suggestCpe(
  env: Bindings,
  query: string,
  limit: number = 8,
): Promise<CpeSuggestion[]> {
  const q = query.trim()
  if (q.length < 2) return []

  // 1) D1 캐시 조회 (7일 이내)
  const cached = await env.DB.prepare(
    `SELECT cpe_name, cpe_part, vendor, product, title, deprecated
       FROM cpe_cache
      WHERE query = ?
        AND fetched_at > datetime('now', '-${CACHE_TTL_HOURS} hours')
      ORDER BY deprecated ASC, fetched_at DESC
      LIMIT ?`,
  )
    .bind(q.toLowerCase(), limit)
    .all<{
      cpe_name: string
      cpe_part: string
      vendor: string
      product: string
      title: string | null
      deprecated: number
    }>()

  if (cached.results.length > 0) {
    return cached.results.map((r) => ({
      cpe_name: r.cpe_name,
      cpe_part: r.cpe_part,
      vendor: r.vendor,
      product: r.product,
      title: r.title,
      deprecated: r.deprecated === 1,
    }))
  }

  // 2) NVD API 호출
  const params = new URLSearchParams({
    keywordSearch: q,
    resultsPerPage: String(Math.min(limit * 2, 20)),
  })
  const url = `https://services.nvd.nist.gov/rest/json/cpes/2.0?${params.toString()}`
  const headers: Record<string, string> = { 'user-agent': 'vuln-monitor-web/2.4' }
  if (env.NVD_API_KEY) {
    headers.apiKey = env.NVD_API_KEY
  }

  let suggestions: CpeSuggestion[] = []
  try {
    const res = await fetch(url, { headers })
    if (!res.ok) {
      return []
    }
    const data = (await res.json()) as NvdCpeResponse
    suggestions = (data.products ?? [])
      .map((p) => {
        const parts = p.cpe.cpeName.split(':')
        const vendor = parts[3] ?? ''
        const product = parts[4] ?? ''
        const titleEn = p.cpe.titles?.find((t) => t.lang === 'en')?.title
        return {
          cpe_name: p.cpe.cpeName,
          cpe_part: extractCpePart(p.cpe.cpeName),
          vendor,
          product,
          title: titleEn ?? p.cpe.titles?.[0]?.title ?? null,
          deprecated: Boolean(p.cpe.deprecated),
        }
      })
      .filter((s) => s.vendor && s.product)
  } catch {
    return []
  }

  // 3) 캐시 저장 (deprecated 는 뒤로)
  if (suggestions.length > 0) {
    const stmt = env.DB.prepare(
      `INSERT INTO cpe_cache (query, cpe_name, cpe_part, vendor, product, title, deprecated)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    const batch = suggestions.map((s) =>
      stmt.bind(q.toLowerCase(), s.cpe_name, s.cpe_part, s.vendor, s.product, s.title, s.deprecated ? 1 : 0),
    )
    try {
      await env.DB.batch(batch)
    } catch {
      // 캐시 실패는 무시 — 검색 결과는 그대로 반환.
    }
  }

  return suggestions.slice(0, limit)
}
