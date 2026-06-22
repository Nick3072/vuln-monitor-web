// v3.5 로그인 보안 감사 — 시도 기록 + IP·계정 단위 잠금 판정 + 보존기간 정리.
// 감사 기록 실패가 로그인 흐름을 깨면 안 되므로 기록/정리 함수는 절대 throw 하지 않음.

// 최근 WINDOW_MINUTES 분 내 연속 실패 임계값. 초과 시 잠금.
export const MAX_FAILURES = 5
// 잠금 판정 시간 창(분).
export const WINDOW_MINUTES = 15
// login_attempts 보존 기간(일). 초과분은 cleanupOldAttempts 가 삭제.
export const RETENTION_DAYS = 90

export interface RecordAttemptInput {
  username: string | null
  ip: string | null
  userAgent: string | null
  success: boolean
  reason: string
}

/**
 * 로그인 시도 1건을 login_attempts 에 INSERT.
 * 감사 기록 실패가 로그인 흐름을 깨면 안 되므로 try/catch 로 흡수하고 절대 throw 하지 않음.
 */
export async function recordAttempt(db: D1Database, input: RecordAttemptInput): Promise<void> {
  try {
    await db
      .prepare(
        'INSERT INTO login_attempts (username, ip, user_agent, success, reason) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(input.username, input.ip, input.userAgent, input.success ? 1 : 0, input.reason)
      .run()
  } catch {
    // 감사 실패는 무시 — 로그인 흐름 보호 우선.
  }
}

/**
 * ip+username 조합 기준으로 최근 WINDOW_MINUTES 분 내 실패가 MAX_FAILURES 이상이면 잠금(true).
 * ip 또는 username 이 null 이면 잠금 판정 불가 → false.
 * reason='locked' 인 기록은 잠금으로 인한 차단 자체이므로 카운트에서 제외(자기증식 방지).
 *
 * ⚠️ 한계(의도된 보수적 1차 방어): 잠금 키가 (ip, username) 쌍이므로
 *   - 동일 IP에서 매 시도 username 을 바꾸는 계정 열거/스프레이,
 *   - 분산 IP(봇넷)로 동일 username 을 노리는 크리덴셜 스터핑
 *   은 쌍별로 분산되어 임계에 도달하지 않을 수 있다. '동일 IP가 동일 계정을 연속 실패'
 *   하는 경우를 차단하는 설계이며, 광범위 분산 공격 방어가 필요하면
 *   username 단위·ip 단위 합산 판정을 OR 로 추가해야 한다.
 *
 * 시간 창은 WINDOW_MINUTES 상수에서 SQL 모디파이어를 생성해 단일 출처로 바인딩한다.
 */
export async function isLockedOut(
  db: D1Database,
  key: { ip: string | null; username: string | null },
): Promise<boolean> {
  if (key.ip === null || key.username === null) return false

  // 조회 실패(예: 마이그레이션 0010 미적용으로 테이블 부재, 일시적 D1 오류) 시
  // 잠금을 적용하지 않고 fail-open — 잠금은 심층방어이지 로그인 정상화의 전제 조건이 아니며,
  // 조회 예외로 로그인 자체를 막아선 안 된다(기록/정리 함수와 동일한 안전 원칙).
  try {
    const row = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND username = ? AND success = 0 AND reason <> 'locked' AND created_at > datetime('now', ?)",
      )
      .bind(key.ip, key.username, `-${WINDOW_MINUTES} minutes`)
      .first<{ n: number }>()

    return (row?.n ?? 0) >= MAX_FAILURES
  } catch {
    return false
  }
}

/**
 * RETENTION_DAYS 초과 기록 정리(주기적 호출용). 정리 실패가 흐름을 깨면 안 되므로 throw 하지 않음.
 */
export async function cleanupOldAttempts(db: D1Database): Promise<void> {
  try {
    await db
      .prepare("DELETE FROM login_attempts WHERE created_at < datetime('now', ?)")
      .bind(`-${RETENTION_DAYS} days`)
      .run()
  } catch {
    // 정리 실패는 무시 — 다음 주기에 재시도.
  }
}
