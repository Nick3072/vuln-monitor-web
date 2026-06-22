/**
 * test/d1-shim.ts
 *
 * D1Database 인터페이스의 최소 구현체.
 * Node.js 22+ 의 실험적 node:sqlite 모듈(DatabaseSync)을 래핑한다.
 * vitest(node 환경)에서 실제 lib/assets.ts 함수를 테스트하는 데 사용.
 *
 * 구현 범위:
 *   - prepare(sql) → { bind(...args) → { all<T>(), first<T>(), run() }, all/first/run() }
 * 나머지 D1Database 메서드(exec, dump, batch)는 stub(미구현) 처리.
 */

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ─ 타입 정의 ─────────────────────────────────────────────────
// @cloudflare/workers-types 없이도 컴파일 가능하도록 인라인으로 선언

export interface D1Result<T = Record<string, unknown>> {
  results: T[]
}

export interface D1RunResult {
  meta: { last_row_id: number; changes: number }
}

export interface D1Statement<T = Record<string, unknown>> {
  bind(...args: unknown[]): D1Statement<T>
  all<R = T>(): Promise<D1Result<R>>
  first<R = T>(): Promise<R | null>
  run(): Promise<D1RunResult>
}

export interface D1DatabaseShim {
  prepare<T = Record<string, unknown>>(sql: string): D1Statement<T>
  batch<T = Record<string, unknown>>(statements: D1Statement<T>[]): Promise<D1RunResult[]>
}

// ─ 구현 ─────────────────────────────────────────────────────

class D1StatementImpl<T = Record<string, unknown>> implements D1Statement<T> {
  private readonly binds: unknown[]

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    binds: unknown[] = [],
  ) {
    this.binds = binds
  }

  bind(...args: unknown[]): D1StatementImpl<T> {
    return new D1StatementImpl(this.db, this.sql, [...this.binds, ...args])
  }

  async all<R = T>(): Promise<D1Result<R>> {
    const stmt = this.db.prepare(this.sql)
    // DatabaseSync.prepare 의 all() 은 동기적으로 결과 반환
    const rows = stmt.all(...this.binds.map(sqliteVal)) as R[]
    return { results: rows }
  }

  async first<R = T>(): Promise<R | null> {
    const stmt = this.db.prepare(this.sql)
    const row = stmt.get(...this.binds.map(sqliteVal)) as R | undefined
    return row ?? null
  }

  async run(): Promise<D1RunResult> {
    const stmt = this.db.prepare(this.sql)
    // DatabaseSync prepared statement 의 run() 은 { changes, lastInsertRowid } 반환
    const result = stmt.run(...this.binds.map(sqliteVal)) as {
      changes: number
      lastInsertRowid: number | bigint
    }
    return {
      meta: {
        last_row_id: Number(result.lastInsertRowid),
        changes: result.changes,
      },
    }
  }
}

/**
 * SQLite 바인딩 값 변환 — undefined/null 처리 포함.
 */
function sqliteVal(v: unknown): unknown {
  if (v === undefined) return null
  return v
}

/**
 * D1Database shim 생성 — 인메모리 SQLite(:memory:) 사용.
 */
export function createD1Shim(): D1DatabaseShim {
  const db = new DatabaseSync(':memory:')
  // WAL 활성화(일반 테스트에서는 불필요하지만 실 DB 와 동일한 동작)
  db.exec('PRAGMA journal_mode=WAL;')

  return {
    prepare<T = Record<string, unknown>>(sql: string): D1Statement<T> {
      return new D1StatementImpl<T>(db, sql)
    },
    async batch<T = Record<string, unknown>>(statements: D1Statement<T>[]): Promise<D1RunResult[]> {
      // 실제 D1 batch 는 순차 원자 적용 → 테스트에서도 순차 실행으로 동등 동작.
      const out: D1RunResult[] = []
      for (const s of statements) out.push(await s.run())
      return out
    },
  } as D1DatabaseShim
}

/**
 * 마이그레이션 파일 0001~0008 을 순서대로 실행한다.
 * ALTER TABLE 이 실패할 경우(이미 열이 있는 경우) 경고 없이 무시.
 * 주의: 이 무시 동작 때문에 컬럼 생성 자체를 검증하려면 PRAGMA table_info 단정이 필요하다
 *       (test/migrations.test.ts 참조).
 */
export function applyMigrations(db: D1DatabaseShim): void {
  const migrationsDir = join(process.cwd(), 'migrations')
  const files = [
    '0001_init.sql',
    '0002_groups_and_dedup.sql',
    '0003_matching_metadata.sql',
    '0004_multi_category_support.sql',
    '0005_multi_user_auth.sql',
    '0006_assets.sql',
    '0007_manual_vuln_status.sql',
    '0008_impact_system.sql',
    '0009_manager.sql',
    '0010_login_security.sql',
    '0011_group_companies.sql',
    '0012_audit_action_index.sql',
  ]

  // DatabaseSync 에 직접 접근하기 위해 내부 인스턴스에 접근
  // (shim 은 prepare 만 노출하므로, exec 는 별도 DatabaseSync 참조가 필요)
  // 해결: shim 에 rawExec 를 노출하도록 구조를 약간 확장
  const rawDb = (db as unknown as { _rawDb: DatabaseSync })._rawDb
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8')
    // 세미콜론으로 분리한 개별 문장을 하나씩 실행 (ALTER TABLE 등 개별 실패 허용)
    const statements = sql.split(';').map((s: string) => s.trim()).filter((s: string) => s.length > 0)
    for (const stmt of statements) {
      try {
        rawDb.exec(stmt + ';')
      } catch {
        // ALTER TABLE ... ADD COLUMN 이 이미 있는 열 추가 시도면 무시
      }
    }
  }
}

/**
 * rawDb 를 노출하는 확장 shim 생성 — applyMigrations 에서 사용.
 */
export function createD1ShimWithRaw(): D1DatabaseShim & { _rawDb: DatabaseSync } {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA journal_mode=WAL;')

  const shim = {
    _rawDb: db,
    prepare<T = Record<string, unknown>>(sql: string): D1Statement<T> {
      return new D1StatementImpl<T>(db, sql)
    },
    async batch<T = Record<string, unknown>>(statements: D1Statement<T>[]): Promise<D1RunResult[]> {
      const out: D1RunResult[] = []
      for (const s of statements) out.push(await s.run())
      return out
    },
  }
  return shim as D1DatabaseShim & { _rawDb: DatabaseSync }
}
