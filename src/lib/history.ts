// v3.7 조치 이력(remediation history) 데이터 헬퍼.
// 출처: audit_log(action='manual_vuln_resolved') INNER JOIN solutions — 현존 장비만(삭제분 제외).
// 그룹 스코핑은 호출자(resolveEffectiveGroup)가 결정한 group 으로 s.group_company 바인드.
//   audit_log 에는 group_company 컬럼이 없으므로 반드시 INNER JOIN + group 바인드(테넌트 격리 핵심).

export type ResolveMethod = 'manual' | 'update'

/** 조치 방식 정규화 — 'update' 만 업데이트, 그 외/누락은 'manual'(기본). */
export function normalizeResolveMethod(raw: string | null | undefined): ResolveMethod {
  return raw === 'update' ? 'update' : 'manual'
}

export interface RemediationEntry {
  auditId: number
  resolvedAt: string
  actor: string
  method: ResolveMethod
  note: string | null
  cve: string | null
  solutionId: number
  vendor: string
  product: string
  hostname: string | null
  category: string
  currentVersion: string
  groupCompany: string | null
  assetId: number | null
  currentlyVulnerable: boolean // 조치 후 다시 취약해졌는지(경고 배지용)
}

export interface HistoryQueryOpts {
  group: string | null // resolveEffectiveGroup 결과. null = admin 전체(필터 없음)
  from: string | null // 'YYYY-MM-DD'
  to: string | null // 'YYYY-MM-DD'
  q: string | null
  page: number // 1-base
  pageSize: number
}

interface AuditJoinRow {
  audit_id: number
  created_at: string
  actor: string | null
  payload_json: string | null
  target_id: number
  vendor: string
  product: string
  hostname: string | null
  category: string
  current_version: string
  group_company: string | null
  last_matched_cve: string | null
  is_vulnerable: number
  asset_id: number | null
}

function buildWhere(opts: HistoryQueryOpts): { sql: string; binds: unknown[] } {
  const where: string[] = [`a.action = 'manual_vuln_resolved'`, `a.target_table = 'solutions'`]
  const binds: unknown[] = []
  if (opts.group !== null) {
    where.push('s.group_company = ?')
    binds.push(opts.group)
  }
  if (opts.from) {
    where.push('a.created_at >= ?')
    binds.push(`${opts.from} 00:00:00`)
  }
  if (opts.to) {
    where.push('a.created_at <= ?')
    binds.push(`${opts.to} 23:59:59`)
  }
  if (opts.q) {
    where.push('(s.vendor LIKE ? OR s.product LIKE ? OR s.hostname LIKE ?)')
    const like = `%${opts.q}%`
    binds.push(like, like, like)
  }
  return { sql: where.join(' AND '), binds }
}

function parsePayloadMethod(json: string | null): { method: ResolveMethod; note: string | null; cve: string | null } {
  if (!json) return { method: 'manual', note: null, cve: null }
  try {
    const p = JSON.parse(json) as Record<string, unknown>
    const method = normalizeResolveMethod(typeof p.method === 'string' ? p.method : null)
    const note = typeof p.note === 'string' && p.note.trim() ? p.note.trim() : null
    const cve = typeof p.cve_id === 'string' && p.cve_id.trim() ? p.cve_id.trim() : null
    return { method, note, cve }
  } catch {
    return { method: 'manual', note: null, cve: null }
  }
}

/**
 * 조치 이력 목록 + 전체 건수. INNER JOIN 으로 삭제된 솔루션은 자동 제외.
 */
export async function getRemediationHistory(
  db: D1Database,
  opts: HistoryQueryOpts,
): Promise<{ entries: RemediationEntry[]; total: number }> {
  const { sql: whereSql, binds } = buildWhere(opts)
  const offset = Math.max(0, (opts.page - 1) * opts.pageSize)

  const [listRes, countRow] = await Promise.all([
    db
      .prepare(
        `SELECT a.id AS audit_id, a.created_at, a.actor, a.payload_json, a.target_id,
                s.vendor, s.product, s.hostname, s.category, s.current_version,
                s.group_company, s.last_matched_cve, s.is_vulnerable, s.asset_id
           FROM audit_log a
           JOIN solutions s ON s.id = a.target_id AND a.target_table = 'solutions'
          WHERE ${whereSql}
          ORDER BY a.created_at DESC
          LIMIT ? OFFSET ?`,
      )
      .bind(...binds, opts.pageSize, offset)
      .all<AuditJoinRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n
           FROM audit_log a
           JOIN solutions s ON s.id = a.target_id AND a.target_table = 'solutions'
          WHERE ${whereSql}`,
      )
      .bind(...binds)
      .first<{ n: number }>(),
  ])

  const entries: RemediationEntry[] = listRes.results.map((r) => {
    const parsed = parsePayloadMethod(r.payload_json)
    return {
      auditId: r.audit_id,
      resolvedAt: r.created_at,
      actor: r.actor ?? '—',
      method: parsed.method,
      note: parsed.note,
      cve: parsed.cve ?? r.last_matched_cve ?? null,
      solutionId: r.target_id,
      vendor: r.vendor,
      product: r.product,
      hostname: r.hostname,
      category: r.category,
      currentVersion: r.current_version,
      groupCompany: r.group_company,
      assetId: r.asset_id,
      currentlyVulnerable: r.is_vulnerable === 1,
    }
  })

  return { entries, total: countRow?.n ?? 0 }
}
