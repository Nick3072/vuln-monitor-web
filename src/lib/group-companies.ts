// v3.6 그룹사 레지스트리 데이터 헬퍼.
// group_company 는 NAME 문자열 키 유지. 이 모듈은 정규 목록 + 파생 카운트 + 생성/삭제 가드.
// users.ts/assets.ts 관례(prepare/bind/first/all, INSERT OR IGNORE, db.batch) 준수. 전 파라미터 바인딩.

import type { GroupCompany, GroupCompanyWithCounts, UserRole } from '../types'

// 0005 가 NULL group_company 를 백필하는 의사 그룹. 일반 그룹사로 등록 금지.
export const SYSTEM_GROUP = 'system'
const RESERVED_NAMES = new Set([SYSTEM_GROUP])
const MAX_NAME_LENGTH = 100

/**
 * name 정규화: trim + 내부 연속 공백 1칸 축소. 대소문자는 보존(기존 GROUP BY 동작 일치).
 * 저장·비교(삭제 가드 포함) 모두 이 결과를 사용해 공백 변형으로 인한 분절/가드 우회를 막는다.
 */
export function normalizeGroupName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

export type GroupNameValidation = { ok: true; name: string } | { ok: false; error: string }

/**
 * 등록 입력 검증. 통과 시 정규화된 name, 실패 시 한국어 사유.
 * 거부: 빈값/공백만, 예약어('system'), 길이 초과.
 */
export function validateGroupName(raw: string): GroupNameValidation {
  const name = normalizeGroupName(raw ?? '')
  if (name.length === 0) {
    return { ok: false, error: '그룹사 이름을 입력해주세요.' }
  }
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    return { ok: false, error: `"${name}" 은(는) 예약된 이름이라 사용할 수 없습니다.` }
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `그룹사 이름은 ${MAX_NAME_LENGTH}자 이하여야 합니다.` }
  }
  return { ok: true, name }
}

// ============================================================
// 조회
// ============================================================

/** 레지스트리에 name 이 존재하는지. (정확 일치 — name 은 항상 정규화 저장) */
export async function groupExists(db: D1Database, name: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS hit FROM group_companies WHERE name = ? LIMIT 1')
    .bind(normalizeGroupName(name))
    .first<{ hit: number }>()
  return row != null
}

/**
 * 레지스트리 전체 + 파생 카운트(자산 수 / 컴포넌트(solution) 수 / 취약 컴포넌트 수).
 * 레지스트리를 기준으로 두 집계 맵을 메모리 머지 → 장비 0개 그룹도 포함(레지스트리의 핵심 가치).
 * 카운트는 정확 일치(group_company = name) — NULL-group 행은 어느 그룹에도 잡히지 않음(의도).
 */
export async function listAllGroupCompanies(db: D1Database): Promise<GroupCompanyWithCounts[]> {
  const [registry, solAgg, assetAgg] = await Promise.all([
    db.prepare('SELECT * FROM group_companies ORDER BY name').all<GroupCompany>(),
    db
      .prepare(
        `SELECT group_company AS name, COUNT(*) AS total,
                SUM(CASE WHEN is_vulnerable = 1 THEN 1 ELSE 0 END) AS vulnerable
           FROM solutions
          WHERE group_company IS NOT NULL AND TRIM(group_company) != ''
          GROUP BY group_company`,
      )
      .all<{ name: string; total: number; vulnerable: number }>(),
    db
      .prepare(
        `SELECT group_company AS name, COUNT(*) AS cnt
           FROM assets
          WHERE group_company IS NOT NULL AND TRIM(group_company) != ''
          GROUP BY group_company`,
      )
      .all<{ name: string; cnt: number }>(),
  ])

  const solByName = new Map(solAgg.results.map((r) => [r.name, r]))
  const assetByName = new Map(assetAgg.results.map((r) => [r.name, r.cnt]))

  return registry.results.map((g) => {
    const sol = solByName.get(g.name)
    return {
      ...g,
      assetCount: assetByName.get(g.name) ?? 0,
      solutionCount: sol?.total ?? 0,
      vulnerableCount: sol?.vulnerable ?? 0,
    }
  })
}

/**
 * 사용자 권한 스코프 적용 목록.
 * - role 'admin' | 'system' → 전체 레지스트리.
 * - role 'operator'        → 레지스트리 소유분 ∪ 본인 매핑 이름.
 *     매핑(user_group_companies)에만 있고 레지스트리 누락인 이름은 즉석 생성(INSERT OR IGNORE)해
 *     "배정됐는데 선택 불가" 상태를 방지한다.
 */
export async function listGroupCompaniesForUser(
  db: D1Database,
  user: { role: UserRole; groups: string[] },
): Promise<GroupCompanyWithCounts[]> {
  if (user.role === 'admin' || user.role === 'system') {
    return listAllGroupCompanies(db)
  }

  const owned = new Set(user.groups.map(normalizeGroupName).filter((n) => n.length > 0 && !RESERVED_NAMES.has(n.toLowerCase())))
  if (owned.size === 0) return []

  // 레지스트리에 누락된 소유 그룹을 즉석 시드(멱등) → 이후 목록에 반드시 나타남.
  const all = await listAllGroupCompanies(db)
  const present = new Set(all.map((g) => g.name))
  const missing = [...owned].filter((n) => !present.has(n))
  if (missing.length > 0) {
    await db.batch(
      missing.map((n) =>
        db.prepare('INSERT OR IGNORE INTO group_companies (name) VALUES (?)').bind(n),
      ),
    )
    const refreshed = await listAllGroupCompanies(db)
    return refreshed.filter((g) => owned.has(g.name))
  }

  return all.filter((g) => owned.has(g.name))
}

// ============================================================
// 생성 (+ 운영자 자동 배정)
// ============================================================

export interface CreateGroupResult {
  created: boolean // false = 이미 존재하던 그룹(adopt)
  name: string
  id: number
}

/**
 * 신규 그룹사 등록 (+ 결정 #3: 운영자 자동 배정).
 * - validateGroupName 통과 필수(빈값/'system'/길이 → throw).
 * - INSERT OR IGNORE → 이름으로 재-SELECT 로 결정적 created/id 판정.
 * - autoAssignOperator=true 면 user_group_companies(createdByUserId, name) INSERT OR IGNORE
 *   (created 값과 무관하게 실행 → 이미 있던 그룹을 '입양'해도 본인 배정됨).
 * 호출자(groups.tsx)가 운영자에게 '기존 이름 거부' 정책을 추가로 적용한다(타테넌트 탈취 차단).
 */
export async function createGroupCompany(
  db: D1Database,
  rawName: string,
  createdByUserId: number | null,
  opts: { autoAssignOperator: boolean },
): Promise<CreateGroupResult> {
  const v = validateGroupName(rawName)
  if (!v.ok) throw new Error(v.error)
  const name = v.name

  const insertStmts = [
    db
      .prepare('INSERT OR IGNORE INTO group_companies (name, created_by_user_id) VALUES (?, ?)')
      .bind(name, createdByUserId),
  ]
  if (opts.autoAssignOperator && createdByUserId != null) {
    insertStmts.push(
      db
        .prepare('INSERT OR IGNORE INTO user_group_companies (user_id, group_company) VALUES (?, ?)')
        .bind(createdByUserId, name),
    )
  }
  await db.batch(insertStmts)

  // 재-SELECT 로 결정적 id 확보. created 는 방금 INSERT 의 changes 가 아니라
  // 호출 전 존재 여부로 결정하기 어려우므로, "이 호출에서 만들어졌는지"는 created_by 비교가 아니라
  // 단순히 '이미 존재했는가'를 별도 판정하지 않고 호출자가 groupExists 로 사전 검사한다.
  const row = await db
    .prepare('SELECT id FROM group_companies WHERE name = ?')
    .bind(name)
    .first<{ id: number }>()
  if (!row) throw new Error('그룹사 생성에 실패했습니다.')

  return { created: true, name, id: row.id }
}

// ============================================================
// 삭제 가드
// ============================================================

/**
 * 그룹 내 "장비" 수 = assets + 컴포넌트(solutions). 삭제 가드 근거.
 * 정규화 이름 정확 일치. 둘 중 하나라도 > 0 이면 삭제 차단.
 */
export async function countEquipmentInGroup(
  db: D1Database,
  name: string,
): Promise<{ assetCount: number; solutionCount: number }> {
  const norm = normalizeGroupName(name)
  const [a, s] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS cnt FROM assets WHERE group_company = ?').bind(norm).first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) AS cnt FROM solutions WHERE group_company = ?').bind(norm).first<{ cnt: number }>(),
  ])
  return { assetCount: a?.cnt ?? 0, solutionCount: s?.cnt ?? 0 }
}

export interface DeleteGroupResult {
  deleted: boolean
  removedUserMappings: number
}

/**
 * 그룹사 삭제 — 가드: 소속 장비(assets) 또는 컴포넌트(solutions) 가 1개라도 있으면 throw.
 * (삭제 직전 재검증 → 렌더-제출 사이 경합 방지.)
 * 통과 시 group_companies + user_group_companies 매핑을 함께 정리(앱 레벨 cascade).
 */
export async function deleteGroupCompany(db: D1Database, name: string): Promise<DeleteGroupResult> {
  const norm = normalizeGroupName(name)
  const { assetCount, solutionCount } = await countEquipmentInGroup(db, norm)
  if (assetCount > 0 || solutionCount > 0) {
    throw new Error(
      `해당 그룹사에 장비 ${assetCount}대 / 컴포넌트 ${solutionCount}개가 남아있어 삭제할 수 없습니다. 먼저 장비를 이동하거나 삭제하세요.`,
    )
  }

  const results = await db.batch([
    db.prepare('DELETE FROM group_companies WHERE name = ?').bind(norm),
    db.prepare('DELETE FROM user_group_companies WHERE group_company = ?').bind(norm),
  ])
  const deleted = (results[0]?.meta.changes ?? 0) > 0
  const removedUserMappings = results[1]?.meta.changes ?? 0
  return { deleted, removedUserMappings }
}
