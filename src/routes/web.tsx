import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Bindings, MatchedVuln, Solution, SolutionInput, AssetInput } from '../types'
import {
  Dashboard,
  type SolutionMatchGroup,
  type GroupSummary,
  type CategorySummary,
} from '../views/dashboard'
import { SolutionsList, type FlashMessage, type SolutionsView } from '../views/solutions-list'
import { writeAudit } from '../lib/audit'
import { generateAliases } from '../lib/normalize'
import { suggestCpe } from '../lib/cpe'
import { upsertSolutionEmbedding, deleteSolutionEmbedding } from '../lib/embeddings'
import { triggerRematch } from '../lib/rematch'
import {
  canWriteGroup,
  requireAdmin,
  resolveEffectiveGroup,
  resolveWriteGroup,
  allowedGroupsForUser,
} from '../middleware/permissions'
import { getAuthContext } from '../middleware/auth'
import { listWidgets } from '../lib/widgets'
import {
  resolveOrCreateAsset,
  updateAsset,
  deleteAssetCascade,
  backfillAssets,
  getAssetsWithComponents,
  countUnlinkedComponents,
  listAssetOptions,
  getAssetById,
  applyDerivedImpactSystem,
  recomputeImpactSystems,
  getImpactSystemSummary,
} from '../lib/assets'
import { applyManualVulnAction } from '../lib/vuln-status'
import { normalizeImpactSystem } from '../lib/impact-system'
import { getRemediationHistory, normalizeResolveMethod } from '../lib/history'
import { History } from '../views/history'
import type { ManualVulnAction } from '../types'

const app = new Hono<{ Bindings: Bindings }>()

// v3.5 심각도 순서 (낮음 → 높음). 필터는 "선택값 이상" 포함.
type Severity = 'low' | 'medium' | 'high' | 'critical'
const SEVERITY_ORDER: Severity[] = ['low', 'medium', 'high', 'critical']

function normalizeMinSeverity(raw: string | undefined): Severity | null {
  const v = (raw ?? '').trim().toLowerCase()
  return SEVERITY_ORDER.find((s) => s === v) ?? null
}

// 선택 심각도 이상(>=)의 값 배열. min 이 없으면 필터 미적용(null).
function severitiesAtLeast(min: Severity | null): string[] | null {
  if (!min) return null
  const idx = SEVERITY_ORDER.indexOf(min)
  return idx < 0 ? null : SEVERITY_ORDER.slice(idx)
}

// CSV 일괄 등록 모달의 "샘플 CSV 다운로드" 링크용 — v2.6 "장비 중심" 신규 포맷.
// 한 행 = 한 장비. vendor/model/hostname/os_version 필수, 나머지는 옵션.
// 원본은 docs/bulk_solutions_template.csv 와 동기 유지.
const BULK_CSV_TEMPLATE = `vendor,model,hostname,os_version,hw_version,db_engine,db_version,openssl_version,web_engine,web_version,was_engine,was_version,group_company,owner,manager,notes
Fortinet,FortiGate-100F,fw-hq-01,7.4.1,,,,1.1.1k,,,,,본사,보안팀,홍길동,HA Primary
Microsoft,Windows Server,srv-app-prod-01,2022,,MSSQL,2019,1.1.1k,IIS,10.0,,,본사,인프라팀,김철수,Std Edition
Canonical,Ubuntu Server,web-front-01,22.04,,MySQL,8.0.36,3.0.5,Apache,2.4.58,Tomcat,9.0.85,자회사A,웹운영팀,이영희,Production
Red Hat,Enterprise Linux,db-prod-01,9.1,,PostgreSQL,14.5,3.0.5,,,,,본사,DBA팀,
PaloAlto,PA-3220,pa-fw-edge-01,11.0.0,11.0.0,,,,,,,,본사,보안팀,
Cisco,Catalyst 9300,sw-core-01,17.9.4,,,,,,,,,본사,네트워크팀,
`

app.get('/static/bulk_solutions_template.csv', (c) =>
  c.body(BULK_CSV_TEMPLATE, 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="bulk_solutions_template.csv"',
    'cache-control': 'public, max-age=300',
  }),
)

interface DashboardAggregates {
  total: number
  vulnerable: number
  last_matched_at: string | null
}

interface SolutionMatchRow {
  solution_id: number
  vendor: string
  product: string
  current_version: string
  hostname: string | null
  group_company: string | null
  cve_count: number
  latest_detected_at: string
  latest_cve: string | null
  latest_severity: string | null
  latest_source: string | null
  latest_url: string | null
  latest_title: string | null
  latest_published: string | null
}

app.get('/', async (c) => {
  const db = c.env.DB
  // v3.6 읽기 스코핑 — operator 는 강제 스코프, admin 은 선택/전체.
  const scope = await resolveEffectiveGroup(c, c.req.query('group') ?? null)
  if (!scope.ok) return c.redirect(scope.redirectTo, 302)
  const group = scope.group
  const allowedGroups = allowedGroupsForUser(c) // operator=본인 groups, admin/system=null

  const [stats, recent, groups, allMatches, categories, assetTotalRow, impactSummary] = await Promise.all([
    // v3.6 stats 도 그룹 스코프 — 전역 누수 차단(group!==null 이면 해당 그룹만 집계).
    (group
      ? db
          .prepare(
            `SELECT
               (SELECT COUNT(*) FROM solutions WHERE group_company = ?) AS total,
               (SELECT COUNT(*) FROM solutions WHERE group_company = ? AND is_vulnerable = 1) AS vulnerable,
               (SELECT MAX(mv.detected_at) FROM matched_vulns mv
                  JOIN solutions s ON s.id = mv.solution_id
                 WHERE s.group_company = ?) AS last_matched_at`,
          )
          .bind(group, group, group)
      : db.prepare(
          `SELECT
             (SELECT COUNT(*) FROM solutions) AS total,
             (SELECT COUNT(*) FROM solutions WHERE is_vulnerable = 1) AS vulnerable,
             (SELECT MAX(detected_at) FROM matched_vulns) AS last_matched_at`,
        )
    ).first<DashboardAggregates>(),
    // solution 단위 접힌 최근 매칭 (최대 15 solution)
    (group
      ? db.prepare(
          `SELECT s.id AS solution_id, s.vendor, s.product, s.current_version,
                  s.hostname, s.group_company,
                  COUNT(mv.id) AS cve_count,
                  MAX(mv.detected_at) AS latest_detected_at,
                  (SELECT cve_id    FROM matched_vulns WHERE solution_id = s.id ORDER BY detected_at DESC LIMIT 1) AS latest_cve,
                  (SELECT severity  FROM matched_vulns WHERE solution_id = s.id ORDER BY detected_at DESC LIMIT 1) AS latest_severity,
                  (SELECT source    FROM matched_vulns WHERE solution_id = s.id ORDER BY detected_at DESC LIMIT 1) AS latest_source,
                  (SELECT url       FROM matched_vulns WHERE solution_id = s.id ORDER BY detected_at DESC LIMIT 1) AS latest_url,
                  (SELECT title     FROM matched_vulns WHERE solution_id = s.id ORDER BY detected_at DESC LIMIT 1) AS latest_title,
                  (SELECT published FROM matched_vulns WHERE solution_id = s.id ORDER BY detected_at DESC LIMIT 1) AS latest_published
             FROM matched_vulns mv
             JOIN solutions s ON s.id = mv.solution_id
            WHERE s.group_company = ?
            GROUP BY s.id
            ORDER BY latest_detected_at DESC
            LIMIT 15`,
        ).bind(group)
      : db.prepare(
          `SELECT s.id AS solution_id, s.vendor, s.product, s.current_version,
                  s.hostname, s.group_company,
                  COUNT(mv.id) AS cve_count,
                  MAX(mv.detected_at) AS latest_detected_at,
                  (SELECT cve_id    FROM matched_vulns WHERE solution_id = s.id ORDER BY detected_at DESC LIMIT 1) AS latest_cve,
                  (SELECT severity  FROM matched_vulns WHERE solution_id = s.id ORDER BY detected_at DESC LIMIT 1) AS latest_severity,
                  (SELECT source    FROM matched_vulns WHERE solution_id = s.id ORDER BY detected_at DESC LIMIT 1) AS latest_source,
                  (SELECT url       FROM matched_vulns WHERE solution_id = s.id ORDER BY detected_at DESC LIMIT 1) AS latest_url,
                  (SELECT title     FROM matched_vulns WHERE solution_id = s.id ORDER BY detected_at DESC LIMIT 1) AS latest_title,
                  (SELECT published FROM matched_vulns WHERE solution_id = s.id ORDER BY detected_at DESC LIMIT 1) AS latest_published
             FROM matched_vulns mv
             JOIN solutions s ON s.id = mv.solution_id
            GROUP BY s.id
            ORDER BY latest_detected_at DESC
            LIMIT 15`,
        )
    ).all<SolutionMatchRow>(),
    // v3.6 그룹 목록 — operator 는 본인 그룹만(타테넌트 이름 누수 차단), admin 은 전체.
    (allowedGroups === null
      ? db.prepare(
          `SELECT group_company AS name, COUNT(*) AS total,
                  SUM(CASE WHEN is_vulnerable = 1 THEN 1 ELSE 0 END) AS vulnerable
             FROM solutions
            WHERE group_company IS NOT NULL AND TRIM(group_company) != ''
            GROUP BY group_company
            ORDER BY name`,
        )
      : allowedGroups.length === 0
        ? null
        : db
            .prepare(
              `SELECT group_company AS name, COUNT(*) AS total,
                      SUM(CASE WHEN is_vulnerable = 1 THEN 1 ELSE 0 END) AS vulnerable
                 FROM solutions
                WHERE group_company IN (${allowedGroups.map(() => '?').join(',')})
                GROUP BY group_company
                ORDER BY name`,
            )
            .bind(...allowedGroups)
    )?.all<GroupSummary>() ?? Promise.resolve({ results: [] as GroupSummary[] }),
    // 펼침용: 상위 15 solution_id 에 대한 전체 CVE (클라이언트 토글용, LIMIT 제한).
    // v3.6 group 스코프 — 전역 누수 차단.
    (group
      ? db.prepare(
          `SELECT mv.*
             FROM matched_vulns mv
             JOIN (
               SELECT mv2.solution_id, MAX(mv2.detected_at) AS latest
                 FROM matched_vulns mv2
                 JOIN solutions s ON s.id = mv2.solution_id
                WHERE s.group_company = ?
                GROUP BY mv2.solution_id
                ORDER BY latest DESC
                LIMIT 15
             ) top ON top.solution_id = mv.solution_id
            ORDER BY mv.solution_id, mv.detected_at DESC`,
        ).bind(group)
      : db.prepare(
          `SELECT mv.*
             FROM matched_vulns mv
             JOIN (
               SELECT solution_id, MAX(detected_at) AS latest
                 FROM matched_vulns
                 GROUP BY solution_id
                 ORDER BY latest DESC
                 LIMIT 15
             ) top ON top.solution_id = mv.solution_id
            ORDER BY mv.solution_id, mv.detected_at DESC`,
        )
    ).all<MatchedVuln>(),
    // v2.5.1: 카테고리별 솔루션 집계 (idx_sol_category 인덱스 사용)
    (group
      ? db.prepare(
          `SELECT category AS name, COUNT(*) AS total,
                  SUM(CASE WHEN is_vulnerable = 1 THEN 1 ELSE 0 END) AS vulnerable
             FROM solutions
            WHERE group_company = ?
            GROUP BY category
            ORDER BY total DESC, name`,
        ).bind(group)
      : db.prepare(
          `SELECT category AS name, COUNT(*) AS total,
                  SUM(CASE WHEN is_vulnerable = 1 THEN 1 ELSE 0 END) AS vulnerable
             FROM solutions
            GROUP BY category
            ORDER BY total DESC, name`,
        )
    ).all<CategorySummary>(),
    // v3.1: 자산(asset) 수 집계 — 대시보드 통계 표시용
    (group
      ? db.prepare(
          `SELECT COUNT(*) AS cnt FROM assets
            WHERE (group_company = ? OR (group_company IS NULL AND ? IS NULL))`,
        ).bind(group, group)
      : db.prepare('SELECT COUNT(*) AS cnt FROM assets')
    ).first<{ cnt: number }>(),
    // v3.3: 영향시스템별 자산 집계
    getImpactSystemSummary(db, { group }),
  ])

  const matchesBySolution = new Map<number, MatchedVuln[]>()
  for (const m of allMatches.results) {
    const arr = matchesBySolution.get(m.solution_id) ?? []
    arr.push(m)
    matchesBySolution.set(m.solution_id, arr)
  }

  const recentGroups: SolutionMatchGroup[] = recent.results.map((r) => ({
    solution_id: r.solution_id,
    vendor: r.vendor,
    product: r.product,
    current_version: r.current_version,
    hostname: r.hostname,
    group_company: r.group_company,
    cve_count: r.cve_count,
    latest: {
      cve_id: r.latest_cve,
      severity: r.latest_severity,
      source: r.latest_source,
      url: r.latest_url,
      title: r.latest_title,
      published: r.latest_published,
      detected_at: r.latest_detected_at,
    },
    allMatches: matchesBySolution.get(r.solution_id) ?? [],
  }))

  // v3.0 — 공유 위젯 + 현재 사용자 컨텍스트
  const widgets = await listWidgets(c.env.DB)
  const auth = getAuthContext(c)
  const flash = c.req.query('flash') ?? null
  const error = c.req.query('error') ?? null

  return c.html(
    <Dashboard
      stats={{
        total: stats?.total ?? 0,
        vulnerable: stats?.vulnerable ?? 0,
        lastMatchedAt: stats?.last_matched_at ?? null,
        // v3.1: 자산(부모) 수 + 구성요소(components) 수 병기
        assetTotal: assetTotalRow?.cnt ?? 0,
        componentTotal: stats?.total ?? 0,
      }}
      groupSummaries={groups.results}
      categorySummaries={categories.results}
      impactSummaries={impactSummary}
      activeGroup={group}
      isAggregate={scope.isAggregate}
      recentGroups={recentGroups}
      widgets={widgets}
      flash={flash}
      error={error}
      currentUser={
        auth
          ? {
              username: auth.user.username,
              role: auth.user.role,
              groups: auth.user.groups,
              id: auth.user.id,
            }
          : undefined
      }
    />,
  )
})

app.get('/solutions', async (c) => {
  // v3.6 읽기 스코핑 — operator 강제 스코프, admin 선택/전체.
  const scope = await resolveEffectiveGroup(c, c.req.query('group') ?? null)
  if (!scope.ok) return c.redirect(scope.redirectTo, 302)
  const group = scope.group
  const allowedGroups = allowedGroupsForUser(c)
  const category = c.req.query('category') ?? null
  // v3.3 영향시스템 필터 — 화이트리스트 정규화. 유효하지 않으면 null(필터 미적용).
  const impact = normalizeImpactSystem(c.req.query('impact'))
  // v3.5 추가 필터 — 심각도(min_severity) / 취약상태(vuln_status) / 텍스트 검색(q)
  const minSeverity = normalizeMinSeverity(c.req.query('min_severity'))
  const vulnStatus =
    c.req.query('vuln_status') === 'vulnerable'
      ? 'vulnerable'
      : c.req.query('vuln_status') === 'safe'
      ? 'safe'
      : null
  const q = (c.req.query('q') ?? '').trim() || null
  const viewParam = c.req.query('view')
  // v3.1: 기본 뷰 = 'grouped' (부모 카드). 쿼리 ?view=list 이면 평면 리스트.
  // FE(solutions-list.tsx) 가 SolutionsView 를 'grouped' | 'list' 로 갱신 예정 — 현재 타입 cast 유지.
  const view = (viewParam === 'list' ? 'list' : 'grouped') as SolutionsView

  const whereClauses: string[] = []
  const whereBinds: unknown[] = []
  if (group) {
    whereClauses.push('group_company = ?')
    whereBinds.push(group)
  }
  if (category) {
    whereClauses.push('category = ?')
    whereBinds.push(category)
  }
  // v3.3 list 뷰는 solutions 테이블 쿼리라 impact_system 컬럼이 없다 → asset 서브쿼리로 거른다.
  // grouped 뷰(getAssetsWithComponents)와 동일 모집단을 보장하기 위해 두 경로에 함께 적용한다.
  if (impact) {
    whereClauses.push('asset_id IN (SELECT id FROM assets WHERE impact_system = ?)')
    whereBinds.push(impact)
  }
  // v3.5 취약 상태
  if (vulnStatus === 'vulnerable') {
    whereClauses.push('is_vulnerable = 1')
  } else if (vulnStatus === 'safe') {
    whereClauses.push('is_vulnerable = 0')
  }
  // v3.5 텍스트 검색 — 반드시 바인딩(인젝션 방지)
  if (q) {
    whereClauses.push('(vendor LIKE ? OR product LIKE ? OR hostname LIKE ?)')
    const like = `%${q}%`
    whereBinds.push(like, like, like)
  }
  // v3.5 심각도 — 선택값 이상(>=)을 가진 매칭 CVE 보유 컴포넌트
  const sevAllowed = severitiesAtLeast(minSeverity)
  if (sevAllowed) {
    const ph = sevAllowed.map(() => '?').join(',')
    whereClauses.push(`id IN (SELECT solution_id FROM matched_vulns WHERE LOWER(severity) IN (${ph}))`)
    whereBinds.push(...sevAllowed)
  }
  const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : ''

  const db = c.env.DB

  // 기본 솔루션 목록(list 뷰용) + 그룹 요약 + v3.1 asset 데이터 병렬 로드
  const [solutionsRes, groupsRes, assetGroups, unlinkedCount, assetOptions] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM solutions${whereSql}
          ORDER BY is_vulnerable DESC, updated_at DESC`,
      )
      .bind(...whereBinds)
      .all<Solution>(),
    // v3.6 그룹 목록 — operator 는 본인 그룹만, admin 은 전체.
    (allowedGroups === null
      ? db.prepare(
          `SELECT group_company AS name, COUNT(*) AS total,
                  SUM(CASE WHEN is_vulnerable = 1 THEN 1 ELSE 0 END) AS vulnerable
             FROM solutions
            WHERE group_company IS NOT NULL AND TRIM(group_company) != ''
            GROUP BY group_company
            ORDER BY name`,
        )
      : allowedGroups.length === 0
        ? null
        : db
            .prepare(
              `SELECT group_company AS name, COUNT(*) AS total,
                      SUM(CASE WHEN is_vulnerable = 1 THEN 1 ELSE 0 END) AS vulnerable
                 FROM solutions
                WHERE group_company IN (${allowedGroups.map(() => '?').join(',')})
                GROUP BY group_company
                ORDER BY name`,
            )
            .bind(...allowedGroups)
    )?.all<GroupSummary>() ?? Promise.resolve({ results: [] as GroupSummary[] }),
    // v3.1: 그룹 뷰용 자산+컴포넌트 집계 (v3.3/v3.5: list 뷰와 모집단 일치 — 모든 필터 동반)
    getAssetsWithComponents(db, {
      group,
      category,
      impactSystem: impact,
      vulnerableOnly: vulnStatus === 'vulnerable',
      safeOnly: vulnStatus === 'safe',
      search: q,
      minSeverity: sevAllowed,
    }),
    // v3.1: 미연결 컴포넌트 수 (백필 배너용)
    countUnlinkedComponents(db, { group }),
    // v3.1: 단건 등록 부모 선택 드롭다운용
    listAssetOptions(db, { group }),
  ])

  // 취약 솔루션의 최근 CVE 목록(펼침용) — list 뷰 + grouped 뷰 모두 커버
  // list 뷰: solutionsRes 의 취약 컴포넌트
  // grouped 뷰: assetGroups 내 모든 취약 컴포넌트 ID 포함
  const vulnerableIdsSet = new Set<number>()
  solutionsRes.results.filter((s) => s.is_vulnerable === 1).forEach((s) => vulnerableIdsSet.add(s.id))
  // grouped 뷰 컴포넌트에서 추가
  for (const ag of assetGroups) {
    ag.components.filter((c) => c.is_vulnerable === 1).forEach((c) => vulnerableIdsSet.add(c.id))
  }
  const vulnerableIds = Array.from(vulnerableIdsSet)

  let matchesBySolution = new Map<number, MatchedVuln[]>()
  if (vulnerableIds.length > 0) {
    const placeholders = vulnerableIds.map(() => '?').join(',')
    const { results } = await db
      .prepare(
        `SELECT * FROM matched_vulns
          WHERE solution_id IN (${placeholders})
          ORDER BY solution_id, detected_at DESC`,
      )
      .bind(...vulnerableIds)
      .all<MatchedVuln>()
    for (const m of results) {
      const arr = matchesBySolution.get(m.solution_id) ?? []
      arr.push(m)
      matchesBySolution.set(m.solution_id, arr)
    }
  }

  const flash = parseFlash(c.req.query('flash'), c.req.query('msg'))

  const auth = getAuthContext(c)
  return c.html(
    <SolutionsList
      solutions={solutionsRes.results}
      matchesBySolution={matchesBySolution}
      groupSummaries={groupsRes.results}
      activeGroup={group}
      activeCategory={category}
      activeImpact={impact}
      activeMinSeverity={minSeverity}
      activeVulnStatus={vulnStatus}
      activeQ={q}
      view={view}
      flash={flash}
      // v3.1 신규 props
      assets={assetGroups}
      unlinkedCount={unlinkedCount}
      assetOptions={assetOptions}
      currentUser={
        auth
          ? {
              username: auth.user.username,
              role: auth.user.role,
              groups: auth.user.groups,
            }
          : undefined
      }
    />,
  )
})

// ============================================================
// v3.7 조치 이력(remediation history) — GET /history
// ============================================================
const HISTORY_PAGE_SIZE = 50

app.get('/history', async (c) => {
  // 읽기 스코핑 — operator 강제 스코프, admin 선택/전체. (audit_log 는 그룹컬럼 없음 → solutions 조인)
  const scope = await resolveEffectiveGroup(c, c.req.query('group') ?? null)
  if (!scope.ok) return c.redirect(scope.redirectTo, 302)
  const group = scope.group
  const allowedGroups = allowedGroupsForUser(c)

  const from = (c.req.query('from') ?? '').trim() || null
  const to = (c.req.query('to') ?? '').trim() || null
  const q = (c.req.query('q') ?? '').trim() || null
  const page = Math.max(1, Number(c.req.query('page')) || 1)

  const db = c.env.DB
  const [{ entries, total }, groupsRes] = await Promise.all([
    getRemediationHistory(db, { group, from, to, q, page, pageSize: HISTORY_PAGE_SIZE }),
    // 그룹 필터 select 용 — operator 는 본인 그룹만, admin 은 전체.
    allowedGroups === null
      ? db
          .prepare(
            `SELECT group_company AS name, COUNT(*) AS total,
                    SUM(CASE WHEN is_vulnerable = 1 THEN 1 ELSE 0 END) AS vulnerable
               FROM solutions
              WHERE group_company IS NOT NULL AND TRIM(group_company) != ''
              GROUP BY group_company ORDER BY name`,
          )
          .all<GroupSummary>()
      : allowedGroups.length === 0
        ? Promise.resolve({ results: [] as GroupSummary[] })
        : db
            .prepare(
              `SELECT group_company AS name, COUNT(*) AS total,
                      SUM(CASE WHEN is_vulnerable = 1 THEN 1 ELSE 0 END) AS vulnerable
                 FROM solutions
                WHERE group_company IN (${allowedGroups.map(() => '?').join(',')})
                GROUP BY group_company ORDER BY name`,
            )
            .bind(...allowedGroups)
            .all<GroupSummary>(),
  ])

  const auth = getAuthContext(c)
  return c.html(
    <History
      entries={entries}
      total={total}
      page={page}
      pageSize={HISTORY_PAGE_SIZE}
      filters={{ group, from, to, q }}
      groupSummaries={groupsRes.results}
      activeGroup={group}
      isAggregate={scope.isAggregate}
      currentUser={
        auth
          ? {
              username: auth.user.username,
              role: auth.user.role,
              groups: auth.user.groups,
              id: auth.user.id,
            }
          : undefined
      }
    />,
  )
})

app.post('/solutions', async (c) => {
  const form = await c.req.formData().catch(() => null)
  if (!form) return redirectFlash(c, 'error', '폼 파싱 실패')
  const parsed = parseSolutionForm(form)
  if ('error' in parsed) {
    return redirectFlash(c, 'error', parsed.error)
  }

  const db = c.env.DB

  // v3.6 그룹 쓰기 SSOT — operator 는 활성 그룹 강제(폼값 무시), admin 은 진입 그룹/전체면 거부.
  const requestedGroup = parsed.group_company
  const wg = await resolveWriteGroup(c, parsed.group_company)
  if (!wg.ok) {
    return redirectFlash(c, 'error', wg.error)
  }
  parsed.group_company = wg.group
  // 이중 방어 — 결정된 그룹을 소유 검증.
  const perm = canWriteGroup(c, parsed.group_company)
  if (!perm.ok) {
    return redirectFlash(c, 'error', perm.error)
  }

  // 자동 enrichment
  const { aliases: autoAliases, vendorNorm, productNorm } = generateAliases({
    vendor: parsed.vendor,
    product: parsed.product,
    category: parsed.category,
  })
  const mergedAliases = Array.from(
    new Set([...(parsed.aliases ?? []).map((s) => s.trim()), ...autoAliases]),
  )

  // CPE 자동 추천 (사용자가 명시하지 않은 경우만)
  let cpePart = parsed.cpe_part
  if (!cpePart) {
    const suggestions = await suggestCpe(c.env, `${parsed.vendor} ${parsed.product}`, 5)
    const best = suggestions.find((s) => !s.deprecated) ?? suggestions[0]
    cpePart = best?.cpe_part ?? null
  }

  const categoryAttrsJson = parsed.category_attributes
    ? JSON.stringify(parsed.category_attributes)
    : null

  // v3.1: asset_id — 폼에서 명시했거나 (group_company, hostname) 기준 자동 resolve/create
  const assetId =
    parsed.asset_id != null
      ? parsed.asset_id
      : await resolveOrCreateAsset(db, {
          name: parsed.hostname?.trim()
            ? parsed.hostname.trim()
            : `${parsed.vendor} ${parsed.product}`,
          vendor: parsed.vendor,
          hostname: parsed.hostname,
          group_company: parsed.group_company,
          owner: parsed.owner,
          manager: parsed.manager,
        })

  const insert = await db
    .prepare(
      `INSERT INTO solutions
         (vendor, product, category, current_version, hostname, owner, manager, notes, group_company,
          cpe_part, cpe_version_range, aliases, vendor_normalized, product_normalized,
          cpe_uri, category_attributes, source, embedding_status, asset_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'web', 'pending', ?)`,
    )
    .bind(
      parsed.vendor,
      parsed.product,
      parsed.category,
      parsed.current_version,
      parsed.hostname,
      parsed.owner,
      parsed.manager,
      parsed.notes,
      parsed.group_company,
      cpePart,
      parsed.cpe_version_range,
      JSON.stringify(mergedAliases),
      vendorNorm,
      productNorm,
      parsed.cpe_uri,
      categoryAttrsJson,
      assetId,
    )
    .run()

  const newId = Number(insert.meta.last_row_id)

  // v3.3 신규 컴포넌트 반영해 자산 영향시스템 자동 재분류 (manual 은 보존)
  await applyDerivedImpactSystem(db, assetId)

  await writeAudit(db, 'create', 'solutions', newId, 'web', {
    ...parsed,
    cpe_part: cpePart,
    aliases: mergedAliases,
    asset_id: assetId,
    // v3.6 위조/오배정 포렌식 — 폼이 보낸 값 vs 서버가 강제한 값.
    requested_group: requestedGroup,
    effective_group: parsed.group_company,
  })

  // 임베딩 + 자동 rematch
  c.executionCtx.waitUntil(
    (async () => {
      const created = await db
        .prepare('SELECT * FROM solutions WHERE id = ?')
        .bind(newId)
        .first<Solution>()
      if (created) {
        await upsertSolutionEmbedding(c.env, created).catch(() => undefined)
      }
      const result = await triggerRematch(c.env, newId).catch(() => ({
        ok: false as const,
        error: 'rematch threw',
      }))
      await writeAudit(
        db,
        result.ok ? 'rematch_requested' : 'rematch_request_failed',
        'solutions',
        newId,
        'web',
        { solution_id: newId, window_days: 365, result },
      )
    })(),
  )

  return redirectFlash(c, 'success', `${parsed.vendor} ${parsed.product} 등록 완료`)
})

app.post('/solutions/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) {
    return redirectFlash(c, 'error', '잘못된 ID 입니다.')
  }

  const form = await c.req.formData().catch(() => null)
  if (!form) return redirectFlash(c, 'error', '폼 파싱 실패')
  const parsed = parseSolutionForm(form)
  if ('error' in parsed) {
    return redirectFlash(c, 'error', parsed.error)
  }

  const db = c.env.DB

  // v3.0 권한 검증 — 기존 row + 새 입력 둘 다 검증
  const existing = await db
    .prepare('SELECT group_company FROM solutions WHERE id = ?')
    .bind(id)
    .first<{ group_company: string | null }>()
  if (!existing) {
    return redirectFlash(c, 'error', '솔루션을 찾을 수 없습니다.')
  }
  const permExisting = canWriteGroup(c, existing.group_company)
  if (!permExisting.ok) {
    return redirectFlash(c, 'error', permExisting.error)
  }
  // v3.6 수정 시 그룹 미입력이면 기존 그룹 유지(groups[0] 로의 오이동 방지).
  if (!parsed.group_company) {
    parsed.group_company = existing.group_company
  }
  const permNew = canWriteGroup(c, parsed.group_company)
  if (!permNew.ok) {
    return redirectFlash(c, 'error', permNew.error)
  }

  const { aliases: autoAliases, vendorNorm, productNorm } = generateAliases({
    vendor: parsed.vendor,
    product: parsed.product,
    category: parsed.category,
  })
  const mergedAliases = Array.from(
    new Set([...(parsed.aliases ?? []).map((s) => s.trim()), ...autoAliases]),
  )

  let cpePart = parsed.cpe_part
  if (!cpePart) {
    const suggestions = await suggestCpe(c.env, `${parsed.vendor} ${parsed.product}`, 5)
    const best = suggestions.find((s) => !s.deprecated) ?? suggestions[0]
    cpePart = best?.cpe_part ?? null
  }

  const categoryAttrsJson = parsed.category_attributes
    ? JSON.stringify(parsed.category_attributes)
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
      parsed.vendor,
      parsed.product,
      parsed.category,
      parsed.current_version,
      parsed.hostname,
      parsed.owner,
      parsed.manager,
      parsed.notes,
      parsed.group_company,
      cpePart,
      parsed.cpe_version_range,
      JSON.stringify(mergedAliases),
      vendorNorm,
      productNorm,
      parsed.cpe_uri,
      categoryAttrsJson,
      id,
    )
    .run()

  if (update.meta.changes === 0) {
    return redirectFlash(c, 'error', '솔루션을 찾을 수 없습니다.')
  }
  await writeAudit(db, 'update', 'solutions', id, 'web', { ...parsed, cpe_part: cpePart, aliases: mergedAliases })

  // 임베딩 재생성
  c.executionCtx.waitUntil(
    (async () => {
      const row = await db.prepare('SELECT * FROM solutions WHERE id = ?').bind(id).first<Solution>()
      if (row) {
        await upsertSolutionEmbedding(c.env, row).catch(() => undefined)
      }
    })(),
  )

  return redirectFlash(c, 'success', `${parsed.vendor} ${parsed.product} 수정 완료`)
})

app.post('/solutions/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) {
    return redirectFlash(c, 'error', '잘못된 ID 입니다.')
  }

  const db = c.env.DB

  // v3.0 권한 검증
  const existing = await db
    .prepare('SELECT group_company FROM solutions WHERE id = ?')
    .bind(id)
    .first<{ group_company: string | null }>()
  if (!existing) {
    return redirectFlash(c, 'error', '솔루션을 찾을 수 없습니다.')
  }
  const perm = canWriteGroup(c, existing.group_company)
  if (!perm.ok) {
    return redirectFlash(c, 'error', perm.error)
  }

  const del = await db.prepare('DELETE FROM solutions WHERE id = ?').bind(id).run()
  if (del.meta.changes === 0) {
    return redirectFlash(c, 'error', '솔루션을 찾을 수 없습니다.')
  }
  await writeAudit(db, 'delete', 'solutions', id, 'web', null)
  c.executionCtx.waitUntil(deleteSolutionEmbedding(c.env, id))
  return redirectFlash(c, 'success', '삭제 완료')
})

// ============================================================
// v3.2 수동 취약점 상태 오버라이드 라우트
// ============================================================

/**
 * POST /solutions/:id/vuln-status
 *
 * 폼 필드:
 *   action   — 'vulnerable' | 'resolved' | 'auto' (필수)
 *   note     — 메모/사유 (선택)
 *   cve_id   — CVE ID (action='vulnerable' 시 선택, 미입력 시 자동 생성)
 *   severity — critical|high|medium|low (action='vulnerable' 시 선택)
 *   title    — 취약점 제목 (action='vulnerable' 시 선택)
 *
 * 감사 액션명: 'manual_vuln_vulnerable' | 'manual_vuln_resolved' | 'manual_vuln_auto'
 */
app.post('/solutions/:id/vuln-status', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) {
    return redirectFlash(c, 'error', '잘못된 ID 입니다.')
  }

  const db = c.env.DB

  // 솔루션 존재 확인 + 권한 검증용 group_company 조회
  const existing = await db
    .prepare('SELECT group_company FROM solutions WHERE id = ?')
    .bind(id)
    .first<{ group_company: string | null }>()
  if (!existing) {
    return redirectFlash(c, 'error', '솔루션을 찾을 수 없습니다.')
  }

  // 그룹사 쓰기 권한 검증
  const perm = canWriteGroup(c, existing.group_company)
  if (!perm.ok) {
    return redirectFlash(c, 'error', perm.error)
  }

  const form = await c.req.formData().catch(() => null)
  if (!form) return redirectFlash(c, 'error', '폼 파싱 실패')
  const action = readField(form, 'action') as ManualVulnAction
  const note = readOptionalField(form, 'note')
  const cve_id = readOptionalField(form, 'cve_id')
  const severity = readOptionalField(form, 'severity')
  const title = readOptionalField(form, 'title')
  // v3.7 조치 방식(수동/업데이트) — resolved 액션에서만 의미. 조치 이력 화면에서 구분 표시.
  const method = normalizeResolveMethod(readOptionalField(form, 'method'))

  // action 값 유효성 검증
  const validActions: ManualVulnAction[] = ['vulnerable', 'resolved', 'auto']
  if (!validActions.includes(action)) {
    return redirectFlash(c, 'error', `유효하지 않은 action 입니다: ${action}`)
  }

  const actor = getAuthContext(c)?.user.username ?? 'web'

  try {
    await applyManualVulnAction(db, id, actor, action, { cve_id, severity, title, note })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '상태 변경 중 오류가 발생했습니다.'
    return redirectFlash(c, 'error', msg)
  }

  // 감사 로그 기록 (resolved 면 method 포함 → 조치 이력에서 수동/업데이트 구분)
  await writeAudit(db, `manual_vuln_${action}`, 'solutions', id, actor, {
    action,
    cve_id,
    severity,
    title,
    note,
    ...(action === 'resolved' ? { method } : {}),
  })

  // 액션별 한국어 완료 메시지
  const successMessages: Record<ManualVulnAction, string> = {
    vulnerable: '수동 취약 표시 완료',
    resolved: '조치완료 처리됨',
    auto: '자동(n8n) 판정으로 복귀',
  }
  return redirectFlash(c, 'success', successMessages[action])
})

// ============================================================
// v3.1 자산(asset) 라우트
// ============================================================

/**
 * POST /solutions/asset/:id — 자산 수정.
 * 폼 필드: name, vendor, hostname, group_company, owner, notes.
 * group_company 변경 시 소속 컴포넌트의 group_company 도 동기화.
 */
app.post('/solutions/asset/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return redirectFlash(c, 'error', '잘못된 자산 ID 입니다.')

  const db = c.env.DB
  const existing = await getAssetById(db, id)
  if (!existing) return redirectFlash(c, 'error', '자산을 찾을 수 없습니다.')

  // 기존 그룹사 권한 검증
  const permExisting = canWriteGroup(c, existing.group_company)
  if (!permExisting.ok) return redirectFlash(c, 'error', permExisting.error)

  const form = await c.req.formData().catch(() => null)
  if (!form) return redirectFlash(c, 'error', '폼 파싱 실패')
  const newGroupCompany = readOptionalField(form, 'group_company')
  // 새 그룹사 권한 검증
  const permNew = canWriteGroup(c, newGroupCompany ?? existing.group_company)
  if (!permNew.ok) return redirectFlash(c, 'error', permNew.error)

  // v3.3 영향시스템: 빈 값 = '자동 분류'(null → 즉시 재추론), 유효 코드 = 수동 확정(source='manual')
  const impactSel = normalizeImpactSystem(readOptionalField(form, 'impact_system'))

  const input: AssetInput = {
    name: readField(form, 'name') || existing.name,
    vendor: readOptionalField(form, 'vendor'),
    hostname: readOptionalField(form, 'hostname'),
    group_company: newGroupCompany,
    owner: readOptionalField(form, 'owner'),
    manager: readOptionalField(form, 'manager'),
    notes: readOptionalField(form, 'notes'),
    impact_system: impactSel,
  }

  const updated = await updateAsset(db, id, input)
  if (!updated) return redirectFlash(c, 'error', '자산 수정에 실패했습니다.')

  // '자동 분류'(빈 값) 선택 시 구성요소 기반으로 즉시 재추론
  if (impactSel === null) {
    await applyDerivedImpactSystem(db, id)
  }

  // group_company 변경 시 소속 컴포넌트 동기화
  if (newGroupCompany && newGroupCompany !== existing.group_company) {
    await db
      .prepare('UPDATE solutions SET group_company = ? WHERE asset_id = ?')
      .bind(newGroupCompany, id)
      .run()
  }

  const auth = getAuthContext(c)
  const actor = auth?.user.username ?? 'web'
  await writeAudit(db, 'update', 'assets', id, actor, input)

  return redirectFlash(c, 'success', `${input.name} 자산 수정 완료`)
})

/**
 * POST /solutions/asset/:id/delete — 자산 및 소속 컴포넌트 일괄 삭제.
 */
app.post('/solutions/asset/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return redirectFlash(c, 'error', '잘못된 자산 ID 입니다.')

  const db = c.env.DB
  const existing = await getAssetById(db, id)
  if (!existing) return redirectFlash(c, 'error', '자산을 찾을 수 없습니다.')

  const perm = canWriteGroup(c, existing.group_company)
  if (!perm.ok) return redirectFlash(c, 'error', perm.error)

  const { deletedComponents } = await deleteAssetCascade(db, id)

  const auth = getAuthContext(c)
  const actor = auth?.user.username ?? 'web'
  await writeAudit(db, 'delete', 'assets', id, actor, {
    name: existing.name,
    deletedComponents,
  })

  return redirectFlash(c, 'success', `자산 삭제 완료 (구성요소 ${deletedComponents}건 포함)`)
})

/**
 * POST /solutions/assets/backfill — 미연결 컴포넌트를 자산과 연결.
 * admin: 전체 범위. operator: 본인 그룹사만.
 */
app.post('/solutions/assets/backfill', async (c) => {
  const db = c.env.DB
  const auth = getAuthContext(c)

  // 인증 필요
  if (!auth) return redirectFlash(c, 'error', '인증 컨텍스트 없음')

  const isAdmin = auth.user.role === 'admin' || auth.user.role === 'system'
  // admin: groups=null(전체), operator: 본인 그룹사 목록
  const groups = isAdmin ? null : auth.user.groups

  const r = await backfillAssets(db, { groups: groups ?? undefined })

  // v3.3 백필 직후 영향시스템 자동 분류 (방금 생성된 자산 + 기존 미분류 자산)
  const recompute = await recomputeImpactSystems(db, { groups: groups ?? undefined })

  const actor = auth.user.username
  await writeAudit(db, 'backfill_assets', 'assets', 0, actor, {
    groups,
    assetsCreated: r.assetsCreated,
    componentsLinked: r.componentsLinked,
    impactClassified: recompute.updated,
  })

  return redirectFlash(
    c,
    'success',
    `${r.assetsCreated}개 솔루션 생성 · ${r.componentsLinked}개 구성요소 연결 · ${recompute.updated}개 영향시스템 분류`,
  )
})

/**
 * POST /solutions/assets/recompute — 자산 영향시스템 일괄 재분류(추론).
 * source='manual'(운영자 확정) 자산은 건드리지 않는다.
 * admin: 전체 범위. operator: 본인 그룹사만.
 */
app.post('/solutions/assets/recompute', async (c) => {
  const db = c.env.DB
  const auth = getAuthContext(c)
  if (!auth) return redirectFlash(c, 'error', '인증 컨텍스트 없음')

  const isAdmin = auth.user.role === 'admin' || auth.user.role === 'system'
  const groups = isAdmin ? null : auth.user.groups

  const r = await recomputeImpactSystems(db, { groups: groups ?? undefined })

  await writeAudit(db, 'recompute_impact', 'assets', 0, auth.user.username, {
    groups,
    scanned: r.scanned,
    updated: r.updated,
  })

  return redirectFlash(c, 'success', `${r.updated}개 자산 영향시스템 재분류 (검토 ${r.scanned}개)`)
})

export default app

function parseId(raw: string | undefined): number | null {
  if (!raw) return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 ? n : null
}

type FormParseResult = SolutionInput | { error: string }

const CPE_URI_RE = /^cpe:2\.3:[aho]:[^:]+:[^:]+:/

function parseSolutionForm(data: FormData): FormParseResult {
  const vendor = readField(data, 'vendor')
  const product = readField(data, 'product')
  const category = readField(data, 'category')
  const current_version = readField(data, 'current_version')
  if (!vendor || !product || !category || !current_version) {
    return { error: '필수 항목(벤더/제품/카테고리/버전)이 누락되었습니다.' }
  }

  const cpeUriRaw = readOptionalField(data, 'cpe_uri')
  if (cpeUriRaw && !CPE_URI_RE.test(cpeUriRaw)) {
    return { error: `CPE URI 형식이 올바르지 않습니다 (예: cpe:2.3:a:openssl:openssl:1.1.1k:*:*:*:*:*:*:*): ${cpeUriRaw}` }
  }

  const attrsRaw = readOptionalField(data, 'category_attributes')
  let categoryAttrs: Record<string, unknown> | null = null
  if (attrsRaw) {
    try {
      const parsed = JSON.parse(attrsRaw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { error: 'category_attributes 는 JSON 객체여야 합니다.' }
      }
      categoryAttrs = parsed as Record<string, unknown>
    } catch {
      return { error: 'category_attributes JSON 파싱 실패' }
    }
  }

  // v3.1: 폼에서 asset_id (숫자, 선택) 파싱
  const assetIdRaw = readField(data, 'asset_id')
  const assetId = assetIdRaw.length > 0 ? Number(assetIdRaw) || null : null

  return {
    vendor,
    product,
    category,
    current_version,
    hostname: readOptionalField(data, 'hostname'),
    owner: readOptionalField(data, 'owner'),
    manager: readOptionalField(data, 'manager'),
    notes: readOptionalField(data, 'notes'),
    group_company: readOptionalField(data, 'group_company'),
    cpe_part: readOptionalField(data, 'cpe_part'),
    cpe_version_range: readOptionalField(data, 'cpe_version_range'),
    aliases: parseAliasesFromForm(data.get('aliases')),
    cpe_uri: cpeUriRaw,
    category_attributes: categoryAttrs,
    asset_id: assetId,
  }
}

function parseAliasesFromForm(value: unknown): string[] | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const arr = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return arr.length > 0 ? arr : null
}

function readField(data: FormData, key: string): string {
  const raw = data.get(key)
  return typeof raw === 'string' ? raw.trim() : ''
}

function readOptionalField(data: FormData, key: string): string | null {
  const value = readField(data, key)
  return value.length === 0 ? null : value
}

function parseFlash(type: string | undefined, msg: string | undefined): FlashMessage | undefined {
  if (!type || !msg) return undefined
  if (type !== 'success' && type !== 'error') return undefined
  return { type, message: msg }
}

function redirectFlash(
  c: Context<{ Bindings: Bindings }>,
  type: 'success' | 'error',
  message: string,
) {
  const qs = `flash=${type}&msg=${encodeURIComponent(message)}`
  return c.redirect(`/solutions?${qs}`, 303)
}
