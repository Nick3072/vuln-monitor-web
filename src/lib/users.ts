// v3.0 사용자 + 그룹사 매핑 CRUD. middleware/auth, routes/admin, routes/auth 가 공유.

import type { User, UserRole, UserWithGroups } from '../types'
import { hashPassword } from './password'

const SYSTEM_USERNAME = '_system_automation'

// v3.6 그룹 매핑 INSERT 시, 레지스트리(group_companies)에도 동일 이름을 보장한다.
//   (admin 사용자 관리에서 임의 그룹명 배정 → 레지스트리/매핑 skew = "배정됐는데 선택 불가" 방지.)
//   예약어 'system' 은 레지스트리에 넣지 않는다(미분류 버킷이라 일반 그룹 아님).
function groupMappingStatements(db: D1Database, userId: number, groups: string[]) {
  return groups.flatMap((g) => {
    const stmts = [
      db
        .prepare('INSERT OR IGNORE INTO user_group_companies (user_id, group_company) VALUES (?, ?)')
        .bind(userId, g),
    ]
    if (g.trim().toLowerCase() !== 'system') {
      stmts.unshift(
        db.prepare('INSERT OR IGNORE INTO group_companies (name) VALUES (?)').bind(g),
      )
    }
    return stmts
  })
}

export function isSystemUsername(name: string): boolean {
  return name === SYSTEM_USERNAME
}

/**
 * username 으로 사용자 단건 조회. 비활성/시스템 사용자도 포함하므로 호출자가 필터 책임.
 */
export async function getUserByUsername(db: D1Database, username: string): Promise<User | null> {
  const row = await db
    .prepare(
      'SELECT id, username, display_name, role, is_active, session_version, last_login_at, created_at, updated_at FROM users WHERE username = ?',
    )
    .bind(username)
    .first<User>()
  return row ?? null
}

export async function getUserById(db: D1Database, id: number): Promise<User | null> {
  const row = await db
    .prepare(
      'SELECT id, username, display_name, role, is_active, session_version, last_login_at, created_at, updated_at FROM users WHERE id = ?',
    )
    .bind(id)
    .first<User>()
  return row ?? null
}

/**
 * 로그인 검증용으로 password_hash 까지 가져옴. 호출자에서 verifyPassword 실행.
 */
export async function getUserCredentials(
  db: D1Database,
  username: string,
): Promise<(User & { password_hash: string }) | null> {
  const row = await db
    .prepare(
      'SELECT id, username, password_hash, display_name, role, is_active, session_version, last_login_at, created_at, updated_at FROM users WHERE username = ?',
    )
    .bind(username)
    .first<User & { password_hash: string }>()
  return row ?? null
}

/**
 * 사용자가 담당하는 그룹사 목록 조회.
 */
export async function getUserGroups(db: D1Database, userId: number): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT group_company FROM user_group_companies WHERE user_id = ? ORDER BY group_company')
    .bind(userId)
    .all<{ group_company: string }>()
  return results.map((r) => r.group_company)
}

export async function getUserWithGroups(
  db: D1Database,
  userId: number,
): Promise<UserWithGroups | null> {
  const user = await getUserById(db, userId)
  if (!user) return null
  const groups = await getUserGroups(db, userId)
  return { ...user, groups }
}

/**
 * 전체 사용자 목록 (관리자 페이지용). 시스템 사용자 포함.
 */
export async function listUsers(db: D1Database): Promise<UserWithGroups[]> {
  const { results } = await db
    .prepare(
      'SELECT id, username, display_name, role, is_active, session_version, last_login_at, created_at, updated_at FROM users ORDER BY role DESC, username',
    )
    .all<User>()

  if (results.length === 0) return []

  // user_group_companies 를 1번 쿼리로 가져와 메모리에서 매핑
  const placeholders = results.map(() => '?').join(',')
  const { results: mappings } = await db
    .prepare(
      `SELECT user_id, group_company FROM user_group_companies WHERE user_id IN (${placeholders}) ORDER BY group_company`,
    )
    .bind(...results.map((u) => u.id))
    .all<{ user_id: number; group_company: string }>()

  const groupsByUser = new Map<number, string[]>()
  for (const m of mappings) {
    const arr = groupsByUser.get(m.user_id) ?? []
    arr.push(m.group_company)
    groupsByUser.set(m.user_id, arr)
  }

  return results.map((u) => ({ ...u, groups: groupsByUser.get(u.id) ?? [] }))
}

/**
 * admin 사용자 수 — 부트스트랩 가드용.
 */
export async function countAdmins(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1")
    .first<{ n: number }>()
  return row?.n ?? 0
}

export interface CreateUserInput {
  username: string
  password: string
  display_name: string | null
  role: UserRole
  groups: string[]
}

/**
 * 신규 사용자 생성. 비번 해싱 + 그룹사 매핑 INSERT 를 트랜잭션 없이 순차 처리 (D1 batch 사용).
 */
export async function createUser(db: D1Database, input: CreateUserInput): Promise<number> {
  const hash = await hashPassword(input.password)

  const insertUser = db
    .prepare(
      `INSERT INTO users (username, password_hash, display_name, role, is_active, session_version)
       VALUES (?, ?, ?, ?, 1, 1)`,
    )
    .bind(input.username, hash, input.display_name, input.role)

  const result = await insertUser.run()
  const userId = Number(result.meta.last_row_id)

  if (input.groups.length > 0) {
    await db.batch(groupMappingStatements(db, userId, input.groups))
  }

  return userId
}

export interface UpdateUserInput {
  display_name?: string | null
  role?: UserRole
  is_active?: 0 | 1
  groups?: string[] // 전체 교체 (null/undefined 면 미변경)
  new_password?: string // 있으면 해싱 후 password_hash 갱신 + session_version++
}

export async function updateUser(db: D1Database, userId: number, input: UpdateUserInput): Promise<void> {
  // 1) users 필드 업데이트
  const sets: string[] = []
  const binds: unknown[] = []
  if (input.display_name !== undefined) {
    sets.push('display_name = ?')
    binds.push(input.display_name)
  }
  if (input.role !== undefined) {
    sets.push('role = ?')
    binds.push(input.role)
  }
  if (input.is_active !== undefined) {
    sets.push('is_active = ?')
    binds.push(input.is_active)
  }
  if (input.new_password) {
    const hash = await hashPassword(input.new_password)
    sets.push('password_hash = ?')
    binds.push(hash)
    sets.push('session_version = session_version + 1')
  } else if (input.is_active === 0) {
    // 비활성화도 세션 무효화 트리거
    sets.push('session_version = session_version + 1')
  }
  if (sets.length > 0) {
    sets.push("updated_at = CURRENT_TIMESTAMP")
    binds.push(userId)
    await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run()
  }

  // 2) 그룹사 매핑 전체 교체 (요청 시에만)
  if (input.groups !== undefined) {
    await db.prepare('DELETE FROM user_group_companies WHERE user_id = ?').bind(userId).run()
    if (input.groups.length > 0) {
      await db.batch(groupMappingStatements(db, userId, input.groups))
    }
  }
}

export async function deleteUser(db: D1Database, userId: number): Promise<void> {
  // ON DELETE CASCADE 가 user_group_companies 도 정리
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
}

/**
 * 마지막 로그인 시각 갱신 (로그인 성공 직후 호출).
 */
export async function touchLastLogin(db: D1Database, userId: number): Promise<void> {
  await db
    .prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(userId)
    .run()
}
