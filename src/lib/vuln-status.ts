/**
 * src/lib/vuln-status.ts
 *
 * v3.2 수동 취약점 상태 오버라이드 로직.
 * - markVulnerable  : 운영자가 직접 취약 표시 (n8n 미검출 CVE 수동 등록)
 * - markResolved    : 조치 완료 표시 (매칭 이력 보존)
 * - clearManualStatus : 자동(n8n) 판정으로 복귀 (수동 행 삭제 후 재계산)
 * - applyManualVulnAction : 라우트 디스패치용 헬퍼
 */

import type { ManualVulnAction, MarkVulnerableInput } from '../types'

// ─ 수동 '취약' 표시 ─────────────────────────────────────────────
/**
 * 솔루션을 수동으로 '취약'으로 표시한다.
 * - cve_id 미입력 시 MANUAL-<solutionId>-<timestamp> 자동 생성 (UNIQUE 충돌 방지)
 * - matched_vulns 에 source='manual' 행을 INSERT OR IGNORE 로 삽입
 * - solutions 의 is_vulnerable, manual_status, last_matched_cve 등 갱신
 */
export async function markVulnerable(
  db: D1Database,
  solutionId: number,
  by: string,
  input: MarkVulnerableInput,
): Promise<void> {
  // cve_id 고유성 보장: 미입력 시 시스템 생성
  const cveId =
    input.cve_id?.trim() && input.cve_id.trim().length > 0
      ? input.cve_id.trim()
      : `MANUAL-${solutionId}-${Date.now()}`

  const title = input.title?.trim() || input.note?.trim() || null

  // matched_vulns: source='manual' 행 삽입 (이미 같은 cve_id 존재 시 무시)
  await db
    .prepare(
      `INSERT OR IGNORE INTO matched_vulns
         (solution_id, cve_id, source, severity, title, description,
          detected_at, first_seen_at)
       VALUES (?, ?, 'manual', ?, ?, ?,
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(solutionId, cveId, input.severity ?? null, title, input.note ?? null)
    .run()

  // solutions 갱신: 취약 표시 + 수동 오버라이드 메타 기록
  await db
    .prepare(
      `UPDATE solutions
          SET is_vulnerable       = 1,
              manual_status       = 'vulnerable',
              last_matched_cve    = ?,
              last_matched_at     = CURRENT_TIMESTAMP,
              status_note         = ?,
              status_updated_at   = CURRENT_TIMESTAMP,
              status_updated_by   = ?,
              updated_at          = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .bind(cveId, input.note ?? null, by, solutionId)
    .run()
}

// ─ 수동 '조치완료(해결)' 표시 ─────────────────────────────────────
/**
 * 솔루션을 조치 완료(해결됨)로 표시한다.
 * - is_vulnerable=0, manual_status='resolved'
 * - matched_vulns 이력은 삭제하지 않고 보존 (감사 추적용)
 */
export async function markResolved(
  db: D1Database,
  solutionId: number,
  by: string,
  note: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE solutions
          SET is_vulnerable       = 0,
              manual_status       = 'resolved',
              status_note         = ?,
              status_updated_at   = CURRENT_TIMESTAMP,
              status_updated_by   = ?,
              updated_at          = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .bind(note, by, solutionId)
    .run()
}

// ─ 자동(n8n) 판정으로 복귀 ────────────────────────────────────────
/**
 * 수동 오버라이드를 해제하고 n8n 판정으로 복귀한다.
 * 1. source='manual' matched_vulns 행 삭제
 * 2. 남은 matched_vulns 행 유무로 is_vulnerable 재계산
 * 3. solutions 갱신: manual_status=NULL, last_matched_* 재설정
 */
export async function clearManualStatus(
  db: D1Database,
  solutionId: number,
  by: string,
): Promise<void> {
  // 수동으로 삽입된 matched_vulns 제거
  await db
    .prepare(`DELETE FROM matched_vulns WHERE solution_id = ? AND source = 'manual'`)
    .bind(solutionId)
    .run()

  // 남은 행 중 가장 최근 행으로 is_vulnerable 재계산
  const latest = await db
    .prepare(
      `SELECT cve_id, detected_at
         FROM matched_vulns
        WHERE solution_id = ?
        ORDER BY detected_at DESC
        LIMIT 1`,
    )
    .bind(solutionId)
    .first<{ cve_id: string | null; detected_at: string }>()

  const isVulnerable = latest !== null ? 1 : 0
  const lastCve = latest?.cve_id ?? null
  const lastAt = latest?.detected_at ?? null

  await db
    .prepare(
      `UPDATE solutions
          SET is_vulnerable       = ?,
              manual_status       = NULL,
              last_matched_cve    = ?,
              last_matched_at     = ?,
              status_note         = NULL,
              status_updated_at   = CURRENT_TIMESTAMP,
              status_updated_by   = ?,
              updated_at          = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .bind(isVulnerable, lastCve, lastAt, by, solutionId)
    .run()
}

// ─ 액션 디스패치 헬퍼 ───────────────────────────────────────────
/**
 * 라우트에서 action 문자열로 적절한 함수를 호출한다.
 * action: 'vulnerable' | 'resolved' | 'auto'
 */
export async function applyManualVulnAction(
  db: D1Database,
  solutionId: number,
  by: string,
  action: ManualVulnAction,
  input: MarkVulnerableInput,
): Promise<void> {
  switch (action) {
    case 'vulnerable':
      return markVulnerable(db, solutionId, by, input)
    case 'resolved':
      return markResolved(db, solutionId, by, input.note ?? null)
    case 'auto':
      return clearManualStatus(db, solutionId, by)
  }
}
