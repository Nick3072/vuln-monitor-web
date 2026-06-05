-- v2.5 다종 솔루션 등록 확장: CPE 2.3 URI + 카테고리별 속성(JSON) + 등록 출처
-- 모든 ALTER 는 ADD COLUMN (NULL 허용) → 기존 행에 무해, v2.3/v2.4 동시 운영 가능.

-- ============================================================
-- 1) 완전 CPE 2.3 URI 저장 (cpe_part 는 보조용으로 유지)
--    예: cpe:2.3:a:openssl:openssl:1.1.1k:*:*:*:*:*:*:*
-- ============================================================
ALTER TABLE solutions ADD COLUMN cpe_uri TEXT;
CREATE INDEX IF NOT EXISTS idx_sol_cpe_uri ON solutions(cpe_uri);

-- ============================================================
-- 2) 카테고리별 가변 속성 (JSON 문자열)
--    예: {"architecture":"x86_64","kernel":"5.15"} (OS)
--        {"engine":"InnoDB","port":3306}            (DB)
--        {"firmware":"1.2.3","model":"FG-100F"}     (HW)
--    SQLite JSON1 함수(json_extract) 로 검색 가능.
-- ============================================================
ALTER TABLE solutions ADD COLUMN category_attributes TEXT;

-- ============================================================
-- 3) 등록 출처 추적 (감사·롤백·일괄등록 식별용)
--    값: 'web' | 'api' | 'bulk_csv'
-- ============================================================
ALTER TABLE solutions ADD COLUMN source TEXT DEFAULT 'web';

-- 기존 행은 출처 미상 → 'legacy' 로 백필 (DEFAULT 는 향후 INSERT 에만 적용)
UPDATE solutions SET source = 'legacy' WHERE source IS NULL;

-- ============================================================
-- 4) 카테고리 검색 빈도 증가 대비 인덱스
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sol_category ON solutions(category);
