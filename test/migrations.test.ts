// 마이그레이션 하니스 가드 테스트.
// d1-shim 의 applyMigrations 는 각 statement 를 try-catch 로 감싸 실패를 조용히 삼킨다
// (d1-shim.ts:133-137). 따라서 "마이그레이션 파일을 배열에 추가" 만으로는 컬럼이 실제로
// 생성됐는지 보장되지 않는다 → PRAGMA table_info 로 컬럼 존재를 단정한다.

import { describe, it, expect } from 'vitest'
import { createD1ShimWithRaw, applyMigrations } from './d1-shim'

describe('migrations', () => {
  it('0008 가 assets 에 impact_system / impact_system_source 컬럼을 추가한다', async () => {
    const db = createD1ShimWithRaw()
    applyMigrations(db)

    const { results } = await db
      .prepare('PRAGMA table_info(assets)')
      .all<{ name: string }>()
    const cols = results.map((r) => r.name)

    expect(cols).toContain('impact_system')
    expect(cols).toContain('impact_system_source')
  })

  it('기존 v3.1 assets 컬럼이 보존된다 (회귀 가드)', async () => {
    const db = createD1ShimWithRaw()
    applyMigrations(db)

    const { results } = await db
      .prepare('PRAGMA table_info(assets)')
      .all<{ name: string }>()
    const cols = results.map((r) => r.name)

    for (const c of ['id', 'name', 'vendor', 'hostname', 'group_company', 'owner', 'notes']) {
      expect(cols).toContain(c)
    }
  })
})
