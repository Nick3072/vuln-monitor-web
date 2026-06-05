-- v2.4 매칭 메타데이터: CPE / aliases / 정규화 / 임베딩 추적
-- 하위호환: ALTER ADD COLUMN 만 사용 (모든 컬럼 NULL 허용). 기존 v2.3 워크플로우와 동시 운영 가능.

-- ============================================================
-- 1) solutions 매칭 메타데이터 컬럼
-- ============================================================
ALTER TABLE solutions ADD COLUMN cpe_part TEXT;
ALTER TABLE solutions ADD COLUMN cpe_version_range TEXT;
ALTER TABLE solutions ADD COLUMN aliases TEXT;
ALTER TABLE solutions ADD COLUMN vendor_normalized TEXT;
ALTER TABLE solutions ADD COLUMN product_normalized TEXT;

-- ============================================================
-- 2) Cloudflare Vectorize 임베딩 추적
-- ============================================================
ALTER TABLE solutions ADD COLUMN embedding_status TEXT DEFAULT 'pending';
ALTER TABLE solutions ADD COLUMN embedding_text TEXT;
ALTER TABLE solutions ADD COLUMN embedding_updated_at DATETIME;

-- ============================================================
-- 3) 매칭 신뢰도 추적용: matched_vulns 부가 컬럼
-- ============================================================
ALTER TABLE matched_vulns ADD COLUMN match_score INTEGER;
ALTER TABLE matched_vulns ADD COLUMN match_reasons TEXT;
ALTER TABLE matched_vulns ADD COLUMN epss_score REAL;
ALTER TABLE matched_vulns ADD COLUMN is_kev INTEGER DEFAULT 0;
ALTER TABLE matched_vulns ADD COLUMN cvss_score REAL;

-- ============================================================
-- 4) CPE 후보 캐시 (NVD API 호출 절감용 — 등록 폼 자동완성에서 사용)
-- ============================================================
CREATE TABLE IF NOT EXISTS cpe_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  cpe_name TEXT NOT NULL,
  cpe_part TEXT NOT NULL,
  vendor TEXT NOT NULL,
  product TEXT NOT NULL,
  title TEXT,
  deprecated INTEGER DEFAULT 0,
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cpe_cache_query ON cpe_cache(query, fetched_at);
CREATE INDEX IF NOT EXISTS idx_cpe_cache_part ON cpe_cache(cpe_part);

-- ============================================================
-- 5) 인덱스
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sol_cpe_part ON solutions(cpe_part);
CREATE INDEX IF NOT EXISTS idx_sol_vendor_norm ON solutions(vendor_normalized);
CREATE INDEX IF NOT EXISTS idx_sol_product_norm ON solutions(product_normalized);
CREATE INDEX IF NOT EXISTS idx_sol_embedding_status ON solutions(embedding_status);

-- ============================================================
-- 6) 기존 행 vendor_normalized / product_normalized 백필
--    (소문자 + 공백·하이픈·언더스코어 제거)
-- ============================================================
UPDATE solutions
   SET vendor_normalized =
         REPLACE(REPLACE(REPLACE(LOWER(vendor), ' ', ''), '-', ''), '_', '')
 WHERE vendor_normalized IS NULL;

UPDATE solutions
   SET product_normalized =
         REPLACE(REPLACE(REPLACE(LOWER(product), ' ', ''), '-', ''), '_', '')
 WHERE product_normalized IS NULL;

-- 기존 솔루션은 임베딩 재생성 대기열로 표시
UPDATE solutions
   SET embedding_status = 'pending'
 WHERE embedding_status IS NULL;
