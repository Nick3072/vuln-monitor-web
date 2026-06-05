-- v2.3 구조개선: 그룹사 컬럼 + 매칭 dedup 기반
-- 하위호환: ALTER ADD COLUMN 만 사용하므로 v2.2 n8n payload 도 그대로 동작.

-- 1) 솔루션 - 그룹사
ALTER TABLE solutions ADD COLUMN group_company TEXT;
CREATE INDEX IF NOT EXISTS idx_solutions_group ON solutions(group_company);

-- 2) 매칭 - 최초 감지 시각 (백필 시 CVE published 로 덮어쓸 수 있음)
ALTER TABLE matched_vulns ADD COLUMN first_seen_at DATETIME;

-- 3) 기존 중복 정리: v2.2가 UNIQUE 없이 운영됐으므로 같은 (solution_id, cve_id)가
--    여러 행으로 존재할 수 있음. UNIQUE INDEX 생성 전에 가장 이른 id 1건만 남기고 삭제.
--    MIN(id) = 가장 먼저 감지된 행(= 실제 first_seen 에 가장 가까움).
DELETE FROM matched_vulns
WHERE id NOT IN (
  SELECT MIN(id) FROM matched_vulns
  GROUP BY solution_id, cve_id
);

-- 4) (solution_id, cve_id) 고유 인덱스 - n8n 백필이 반복 수집해도 중복 방지
CREATE UNIQUE INDEX IF NOT EXISTS uq_matched_sol_cve
  ON matched_vulns(solution_id, cve_id);

-- 5) 최신 매칭 탐색을 위한 보조 인덱스
CREATE INDEX IF NOT EXISTS idx_matched_solution_detected
  ON matched_vulns(solution_id, detected_at DESC);

-- 6) 기존 행 first_seen_at 백필: detected_at 으로 대체 (NULL 인 것만)
UPDATE matched_vulns
   SET first_seen_at = detected_at
 WHERE first_seen_at IS NULL;
