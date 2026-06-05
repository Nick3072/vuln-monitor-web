-- v3.1 부모 "솔루션(자산)" 엔티티 신설
-- assets 테이블 추가 + solutions 에 asset_id(soft FK) 컬럼 추가.
-- 모든 DDL 은 IF NOT EXISTS / ADD COLUMN(NULL 허용) → 기존 데이터에 무해, 멱등 실행 가능.
-- FK CASCADE 미사용 (D1 제약 불안정) → 삭제 cascade 는 앱 레벨(deleteAssetCascade)에서 처리.

-- ============================================================
-- 1) assets — 운영자가 관리하는 상위 자산(장비) 엔티티
--    자연키: (group_company, hostname). hostname 이 비어있지 않을 때만 중복 방지.
--    취약 여부·카테고리는 저장하지 않고 소속 컴포넌트(solutions) 집계로 파생.
-- ============================================================
CREATE TABLE IF NOT EXISTS assets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  vendor        TEXT,
  hostname      TEXT,
  group_company TEXT,
  owner         TEXT,
  notes         TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_assets_group_host ON assets(group_company, hostname);

-- ============================================================
-- 2) solutions 에 asset_id 컬럼 추가 (soft FK)
--    NULL = 아직 미연결(백필 미완). 앱에서 backfillAssets 로 일괄 연결.
-- ============================================================
ALTER TABLE solutions ADD COLUMN asset_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_solutions_asset ON solutions(asset_id);
