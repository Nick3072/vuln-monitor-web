// src/lib/login-attempts.test.ts — isLockedOut 임계 경계/제외 규칙 + null 가드 단위 테스트.
// D1 은 prepare().bind().first() 체이닝을 흉내내는 경량 인메모리 fake 로 대체.

import { describe, it, expect } from 'vitest'
import { isLockedOut, MAX_FAILURES } from './login-attempts'

interface FakeAttempt {
  ip: string | null
  username: string | null
  success: number
  reason: string | null
}

// isLockedOut 의 고정 SQL(ip=? AND username=? AND success=0 AND reason<>'locked' AND 최근 15분)을
// 메모리상에서 동일하게 평가하는 fake. created_at 시간 창은 테스트 데이터를 모두 "최근"으로 간주.
function makeDb(attempts: ReadonlyArray<FakeAttempt>): D1Database {
  const prepare = (_sql: string) => ({
    bind: (ip: string | null, username: string | null) => ({
      first: async <T>(): Promise<T> => {
        const n = attempts.filter(
          (a) =>
            a.ip === ip &&
            a.username === username &&
            a.success === 0 &&
            a.reason !== 'locked',
        ).length
        return { n } as unknown as T
      },
    }),
  })
  return { prepare } as unknown as D1Database
}

const fail = (ip: string, username: string, reason = 'bad_password'): FakeAttempt => ({
  ip,
  username,
  success: 0,
  reason,
})

describe('isLockedOut', () => {
  const key = { ip: '10.0.0.1', username: 'alice' }

  it('실패 4건이면 잠금 아님(임계 미만)', async () => {
    // Arrange
    const attempts = Array.from({ length: MAX_FAILURES - 1 }, () => fail(key.ip, key.username))
    const db = makeDb(attempts)

    // Act
    const locked = await isLockedOut(db, key)

    // Assert
    expect(locked).toBe(false)
  })

  it('실패 5건이면 잠금(임계 도달)', async () => {
    // Arrange
    const attempts = Array.from({ length: MAX_FAILURES }, () => fail(key.ip, key.username))
    const db = makeDb(attempts)

    // Act
    const locked = await isLockedOut(db, key)

    // Assert
    expect(locked).toBe(true)
  })

  it("reason='locked' 기록은 카운트에서 제외", async () => {
    // Arrange — 실패 4건 + locked 3건. locked 는 제외되므로 임계 미만.
    const attempts = [
      ...Array.from({ length: MAX_FAILURES - 1 }, () => fail(key.ip, key.username)),
      ...Array.from({ length: 3 }, () => fail(key.ip, key.username, 'locked')),
    ]
    const db = makeDb(attempts)

    // Act
    const locked = await isLockedOut(db, key)

    // Assert
    expect(locked).toBe(false)
  })

  it('ip 가 null 이면 false (쿼리 미실행)', async () => {
    // Arrange
    const db = makeDb([])

    // Act
    const locked = await isLockedOut(db, { ip: null, username: 'alice' })

    // Assert
    expect(locked).toBe(false)
  })

  it('username 이 null 이면 false (쿼리 미실행)', async () => {
    // Arrange
    const db = makeDb([])

    // Act
    const locked = await isLockedOut(db, { ip: '10.0.0.1', username: null })

    // Assert
    expect(locked).toBe(false)
  })

  it('다른 ip/username 의 실패는 카운트하지 않음', async () => {
    // Arrange — key 와 무관한 5건만 존재.
    const attempts = Array.from({ length: MAX_FAILURES }, () => fail('192.168.0.9', 'bob'))
    const db = makeDb(attempts)

    // Act
    const locked = await isLockedOut(db, key)

    // Assert
    expect(locked).toBe(false)
  })
})
