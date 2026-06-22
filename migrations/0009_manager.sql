-- v3.4 담당 → 부서/담당자 분리
-- 기존 owner 컬럼은 "부서(department)" 의미로 유지(UI 라벨만 담당→부서로 변경).
-- 신규 manager 컬럼 = "담당자(person in charge)".
-- solutions(컴포넌트)·assets(부모) 양쪽에 추가해 평면뷰 정렬·상세 표시 모두 지원.
--
-- ※ ADD COLUMN 은 IF NOT EXISTS 미지원(SQLite/D1) → remote 에 1회만 적용.
--   배포 시: wrangler d1 execute vuln-monitor-db --remote --file=migrations/0009_manager.sql

ALTER TABLE solutions ADD COLUMN manager TEXT;
ALTER TABLE assets ADD COLUMN manager TEXT;
