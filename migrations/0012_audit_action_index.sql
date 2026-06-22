-- v3.7 조치 이력(remediation history) 조회 성능 — audit_log 복합 인덱스.
--   /history 주쿼리: WHERE action='manual_vuln_resolved' AND target_table='solutions'
--                    ORDER BY created_at DESC LIMIT ? OFFSET ?
--   기존 idx_audit_created(created_at) 만으로는 action 필터를 못 태워 대형 테이블에서 비효율.
-- 스키마 무변경(인덱스만) → 멱등/무해, 재실행 안전.
CREATE INDEX IF NOT EXISTS idx_audit_action_created ON audit_log(action, created_at);
