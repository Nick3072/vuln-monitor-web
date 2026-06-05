// v3.1 부모 "솔루션(자산)" 엔티티 데이터 헬퍼.
// assets 테이블 CRUD + backfill + 그룹 뷰 집계.
// D1 soft FK: FK CASCADE 미사용. 삭제 cascade 는 deleteAssetCascade 가 처리.
// 모든 SQL 파라미터는 바인딩 변수로 처리(SQL 인젝션 방지).

import type { Asset, AssetInput, AssetWithComponents, Solution } from '../types'

// ============================================================
// 순수 헬퍼: deriveAssetName
// ============================================================

/**
 * 컴포넌트 목록과 hostname 으로부터 자산의 대표 이름을 결정한다.
 * 우선순위: HW 컴포넌트 product > OS > FW > 첫 번째 컴포넌트 "vendor product" > hostname > 'unnamed'
 */
export function deriveAssetName(
  components: { category: string; product: string; vendor: string }[],
  hostname: string | null,
): string {
  // 카테고리 우선순위 순서
  const PRIORITY_CATEGORIES = ['HW', 'OS', 'FW']
  for (const cat of PRIORITY_CATEGORIES) {
    const comp = components.find((c) => c.category === cat)
    if (comp) return comp.product
  }
  // 우선순위 카테고리에 없으면 첫 번째 컴포넌트의 "vendor product"
  if (components.length > 0) {
    const first = components[0]
    return `${first.vendor} ${first.product}`.trim()
  }
  // 컴포넌트가 없으면 hostname
  if (hostname && hostname.trim().length > 0) return hostname.trim()
  return 'unnamed'
}

// ============================================================
// D1 헬퍼: null-safe 그룹사 비교 SQL 생성
// ============================================================

/**
 * group_company 가 null 일 수 있는 경우에 null-safe 비교 조건 반환.
 * SQLite 에서 NULL = NULL 은 false 이므로 IS NULL 별도 처리 필요.
 */
function nullSafeGroupEq(column: string): string {
  return `(${column} = ? OR (${column} IS NULL AND ? IS NULL))`
}

// ============================================================
// resolveOrCreateAsset
// ============================================================

/**
 * hostname 이 비어있지 않으면 (group_company, hostname) 기준으로 기존 asset 조회.
 * 존재하면 기존 id 반환. 없으면 INSERT 후 새 id 반환.
 * hostname 이 비어있거나 null 이면 항상 신규 INSERT (단독 자산).
 */
export async function resolveOrCreateAsset(
  db: D1Database,
  key: {
    name: string
    vendor: string | null
    hostname: string | null
    group_company: string | null
    owner: string | null
  },
): Promise<number> {
  const hostname = key.hostname?.trim() ?? null
  const hostnameEmpty = !hostname

  if (!hostnameEmpty) {
    // hostname 있는 경우: (group_company, hostname) 로 조회
    const existing = await db
      .prepare(
        `SELECT id FROM assets
          WHERE ${nullSafeGroupEq('group_company')}
            AND hostname = ?
          LIMIT 1`,
      )
      .bind(key.group_company, key.group_company, hostname)
      .first<{ id: number }>()

    if (existing) return existing.id
  }

  // 신규 INSERT
  const result = await db
    .prepare(
      `INSERT INTO assets (name, vendor, hostname, group_company, owner)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(key.name, key.vendor, hostname, key.group_company, key.owner)
    .run()

  return Number(result.meta.last_row_id)
}

// ============================================================
// getAssetById
// ============================================================

export async function getAssetById(db: D1Database, id: number): Promise<Asset | null> {
  return db.prepare('SELECT * FROM assets WHERE id = ?').bind(id).first<Asset>()
}

// ============================================================
// updateAsset
// ============================================================

export async function updateAsset(
  db: D1Database,
  id: number,
  input: AssetInput,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE assets
          SET name = ?, vendor = ?, hostname = ?, group_company = ?,
              owner = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .bind(input.name, input.vendor, input.hostname, input.group_company, input.owner, input.notes, id)
    .run()

  return (result.meta.changes ?? 0) > 0
}

// ============================================================
// deleteAssetCascade
// ============================================================

/**
 * 자산과 소속 컴포넌트를 일괄 삭제한다.
 * 순서: matched_vulns 삭제 → solutions 삭제 → asset 삭제.
 * 반환: 삭제된 컴포넌트(solutions 행) 수.
 */
export async function deleteAssetCascade(
  db: D1Database,
  id: number,
): Promise<{ deletedComponents: number }> {
  // 1) 소속 컴포넌트 ID 목록
  const { results: comps } = await db
    .prepare('SELECT id FROM solutions WHERE asset_id = ?')
    .bind(id)
    .all<{ id: number }>()

  const deletedComponents = comps.length

  if (comps.length > 0) {
    const ids = comps.map((c) => c.id)
    const placeholders = ids.map(() => '?').join(',')

    // 2) matched_vulns 삭제 (ON DELETE CASCADE 없으므로 직접)
    await db
      .prepare(`DELETE FROM matched_vulns WHERE solution_id IN (${placeholders})`)
      .bind(...ids)
      .run()

    // 3) solutions 삭제
    await db
      .prepare(`DELETE FROM solutions WHERE id IN (${placeholders})`)
      .bind(...ids)
      .run()
  }

  // 4) asset 삭제
  await db.prepare('DELETE FROM assets WHERE id = ?').bind(id).run()

  return { deletedComponents }
}

// ============================================================
// getAssetsWithComponents
// ============================================================

/**
 * assets + 소속 컴포넌트(solutions) 조회 → 취약 집계 → 정렬 반환.
 * - group 필터: assets.group_company 기준 (null-safe)
 * - category 필터: solutions.category 기준 → 해당 카테고리 컴포넌트가 1개 이상인 자산만 포함
 * - 정렬: hasVulnerable 내림차순 → asset.name 오름차순
 */
export async function getAssetsWithComponents(
  db: D1Database,
  opts: { group?: string | null; category?: string | null },
): Promise<AssetWithComponents[]> {
  // 1) assets 로드 (group 필터)
  let assetsQuery: D1PreparedStatement
  if (opts.group != null) {
    assetsQuery = db
      .prepare(`SELECT * FROM assets WHERE ${nullSafeGroupEq('group_company')} ORDER BY name ASC`)
      .bind(opts.group, opts.group)
  } else {
    assetsQuery = db.prepare('SELECT * FROM assets ORDER BY name ASC')
  }
  const { results: assets } = await assetsQuery.all<Asset>()

  if (assets.length === 0) return []

  // 2) 컴포넌트 로드 (asset_id IN (...) + optional category 필터)
  const assetIds = assets.map((a) => a.id)
  const idPlaceholders = assetIds.map(() => '?').join(',')

  let componentsQuery: D1PreparedStatement
  if (opts.category) {
    componentsQuery = db
      .prepare(
        `SELECT * FROM solutions
          WHERE asset_id IN (${idPlaceholders})
            AND category = ?
          ORDER BY is_vulnerable DESC, category ASC`,
      )
      .bind(...assetIds, opts.category)
  } else {
    componentsQuery = db
      .prepare(
        `SELECT * FROM solutions
          WHERE asset_id IN (${idPlaceholders})
          ORDER BY is_vulnerable DESC, category ASC`,
      )
      .bind(...assetIds)
  }
  const { results: components } = await componentsQuery.all<Solution>()

  // 3) asset_id 기준으로 컴포넌트 그룹핑
  const compsByAsset = new Map<number, Solution[]>()
  for (const comp of components) {
    if (comp.asset_id == null) continue
    const arr = compsByAsset.get(comp.asset_id) ?? []
    arr.push(comp)
    compsByAsset.set(comp.asset_id, arr)
  }

  // 4) 집계 + category 필터 적용 (매칭 컴포넌트가 없는 자산은 제외)
  const withComponents: AssetWithComponents[] = []
  for (const asset of assets) {
    const compsForAsset = compsByAsset.get(asset.id) ?? []
    // category 필터가 있으면 해당 카테고리 컴포넌트가 없는 자산은 skip
    if (opts.category && compsForAsset.length === 0) continue

    const vulnerableCount = compsForAsset.filter((c) => c.is_vulnerable === 1).length
    const hasVulnerable = vulnerableCount > 0
    withComponents.push({
      asset,
      components: compsForAsset,
      componentCount: compsForAsset.length,
      vulnerableCount,
      hasVulnerable,
    })
  }

  // 5) 정렬: hasVulnerable 우선 → asset.name 오름차순
  withComponents.sort((a, b) => {
    if (a.hasVulnerable !== b.hasVulnerable) return a.hasVulnerable ? -1 : 1
    return a.asset.name.localeCompare(b.asset.name)
  })

  return withComponents
}

// ============================================================
// countUnlinkedComponents
// ============================================================

/**
 * asset_id 가 NULL 인 솔루션(컴포넌트) 수를 반환한다.
 * group 필터가 있으면 해당 그룹사로 범위를 좁힌다.
 */
export async function countUnlinkedComponents(
  db: D1Database,
  opts: { group?: string | null },
): Promise<number> {
  let row: { cnt: number } | null

  if (opts.group != null) {
    row = await db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM solutions
          WHERE asset_id IS NULL
            AND ${nullSafeGroupEq('group_company')}`,
      )
      .bind(opts.group, opts.group)
      .first<{ cnt: number }>()
  } else {
    row = await db
      .prepare('SELECT COUNT(*) AS cnt FROM solutions WHERE asset_id IS NULL')
      .first<{ cnt: number }>()
  }

  return row?.cnt ?? 0
}

// ============================================================
// listAssetOptions
// ============================================================

/**
 * 드롭다운용 자산 목록 (id, name, group_company).
 * group 필터가 있으면 해당 그룹사 자산만 반환.
 */
export async function listAssetOptions(
  db: D1Database,
  opts: { group?: string | null },
): Promise<{ id: number; name: string; group_company: string | null }[]> {
  let query: D1PreparedStatement

  if (opts.group != null) {
    query = db
      .prepare(
        `SELECT id, name, group_company FROM assets
          WHERE ${nullSafeGroupEq('group_company')}
          ORDER BY name ASC`,
      )
      .bind(opts.group, opts.group)
  } else {
    query = db.prepare('SELECT id, name, group_company FROM assets ORDER BY name ASC')
  }

  const { results } = await query.all<{
    id: number
    name: string
    group_company: string | null
  }>()
  return results
}

// ============================================================
// backfillAssets
// ============================================================

/**
 * asset_id 가 NULL 인 컴포넌트(solutions)들을 부모 자산(assets)에 연결한다.
 * - hostname 있는 행: (group_company, hostname) 그룹별로 부모 1개 resolve/create
 * - hostname 없는 행: 행마다 단독 자산 create (name = "vendor product")
 * - 이미 asset_id 있는 행은 skip (멱등)
 * - opts.groups 있으면 해당 group_company 만 처리
 */
export async function backfillAssets(
  db: D1Database,
  opts?: { groups?: string[] | null },
): Promise<{ assetsCreated: number; componentsLinked: number }> {
  // 처리 범위 필터
  const groupFilter =
    opts?.groups && opts.groups.length > 0
      ? `AND group_company IN (${opts.groups.map(() => '?').join(',')})`
      : ''
  const groupBinds: unknown[] = opts?.groups && opts.groups.length > 0 ? opts.groups : []

  // ─ Part A: hostname 있는 행 ─────────────────────────────────
  // (group_company, hostname) 로 그룹핑 → 그룹별 처리
  const { results: hostnameGroups } = await db
    .prepare(
      `SELECT group_company, hostname, GROUP_CONCAT(id) AS ids
         FROM solutions
        WHERE asset_id IS NULL
          AND hostname IS NOT NULL
          AND TRIM(hostname) != ''
          ${groupFilter}
        GROUP BY group_company, hostname`,
    )
    .bind(...groupBinds)
    .all<{ group_company: string | null; hostname: string; ids: string }>()

  let assetsCreated = 0
  let componentsLinked = 0

  for (const grp of hostnameGroups) {
    const rowIds = grp.ids.split(',').map(Number).filter(Boolean)
    if (rowIds.length === 0) continue

    // 이 그룹의 컴포넌트 정보를 로드해서 대표 이름/owner 결정
    // (한 장비의 컴포넌트들은 동일 owner 를 공유하므로 첫 값으로 자산 owner 보존)
    const placeholders = rowIds.map(() => '?').join(',')
    const { results: comps } = await db
      .prepare(
        `SELECT id, vendor, product, category, owner FROM solutions WHERE id IN (${placeholders})`,
      )
      .bind(...rowIds)
      .all<{ id: number; vendor: string; product: string; category: string; owner: string | null }>()

    const name = deriveAssetName(
      comps.map((c) => ({ category: c.category, product: c.product, vendor: c.vendor })),
      grp.hostname,
    )

    // 대표 vendor/owner — 비어있지 않은 첫 컴포넌트 값 우선 (마이그레이션 시 담당/벤더 유실 방지)
    const firstComp = comps[0]
    const assetOwner = comps.find((c) => c.owner != null && c.owner !== '')?.owner ?? null
    const priorCount = await countAssetsBeforeInsert(db, grp.group_company, grp.hostname)

    const assetId = await resolveOrCreateAsset(db, {
      name,
      vendor: firstComp?.vendor ?? null,
      hostname: grp.hostname,
      group_company: grp.group_company,
      owner: assetOwner,
    })

    // 새로 생성된 경우 카운트 (resolveOrCreate 가 기존 것을 반환하면 created++ 안 함)
    const newCount = await countAssetsBeforeInsert(db, grp.group_company, grp.hostname)
    if (newCount > priorCount) assetsCreated++

    // 컴포넌트 링크
    const linked = await db
      .prepare(`UPDATE solutions SET asset_id = ? WHERE id IN (${placeholders}) AND asset_id IS NULL`)
      .bind(assetId, ...rowIds)
      .run()

    componentsLinked += linked.meta.changes ?? 0
  }

  // ─ Part B: hostname 없는 행 ──────────────────────────────────
  const { results: standaloneRows } = await db
    .prepare(
      `SELECT id, vendor, product, group_company, owner
         FROM solutions
        WHERE asset_id IS NULL
          AND (hostname IS NULL OR TRIM(hostname) = '')
          ${groupFilter}`,
    )
    .bind(...groupBinds)
    .all<{
      id: number
      vendor: string
      product: string
      group_company: string | null
      owner: string | null
    }>()

  for (const row of standaloneRows) {
    const name = `${row.vendor} ${row.product}`.trim()
    const assetId = await resolveOrCreateAsset(db, {
      name,
      vendor: row.vendor,
      hostname: null, // hostname 없음 → 항상 신규
      group_company: row.group_company,
      owner: row.owner,
    })
    assetsCreated++

    await db
      .prepare('UPDATE solutions SET asset_id = ? WHERE id = ? AND asset_id IS NULL')
      .bind(assetId, row.id)
      .run()
    componentsLinked++
  }

  return { assetsCreated, componentsLinked }
}

// ─ 내부 헬퍼: (group_company, hostname) 로 기존 asset 개수 조회 (신규 생성 여부 판단용) ─
async function countAssetsBeforeInsert(
  db: D1Database,
  group_company: string | null,
  hostname: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM assets
        WHERE ${nullSafeGroupEq('group_company')}
          AND hostname = ?`,
    )
    .bind(group_company, group_company, hostname)
    .first<{ cnt: number }>()
  return row?.cnt ?? 0
}
