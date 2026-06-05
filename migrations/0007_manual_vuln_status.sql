-- v3.2 수동 취약점 상태 오버라이드
-- n8n 이 검출하지 못한 취약점을 운영자가 수동으로 '취약' 표시하거나,
-- 조치 완료 시 '해결'로 표시할 수 있도록 상태 오버라이드 컬럼 추가.
-- 모든 ALTER 는 ADD COLUMN(NULL 허용) → 기존 데이터 무해.
-- ※ SQLite 특성상 ADD COLUMN 은 IF NOT EXISTS 미지원 → 1회만 적용.

-- manual_status: NULL=자동(n8n 판정) | 'vulnerable'=수동 취약 | 'resolved'=조치완료(수동 해결)
ALTER TABLE solutions ADD COLUMN manual_status TEXT;
-- status_note: 수동 변경 사유/메모
ALTER TABLE solutions ADD COLUMN status_note TEXT;
-- status_updated_at / by: 수동 변경 감사 추적
ALTER TABLE solutions ADD COLUMN status_updated_at DATETIME;
ALTER TABLE solutions ADD COLUMN status_updated_by TEXT;

CREATE INDEX IF NOT EXISTS idx_solutions_manual_status ON solutions(manual_status);
