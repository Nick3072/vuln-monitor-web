-- v3.6 그룹사 레지스트리 — group_company 를 NAME 문자열 키로 유지하되,
-- "존재하는 그룹사" 의 정규 목록(빈 그룹 포함) + 생성 메타데이터 + 삭제 가드 근거를 제공.
-- group_company_id FK 리팩토링은 하지 않음(YAGNI/리스크). 이 테이블은 레지스트리일 뿐.
-- 모든 DDL 은 IF NOT EXISTS / 멱등 백필 → 기존 데이터에 무해, 재실행 안전.
-- soft FK: created_by_user_id 는 users(id) 참조하지만 CASCADE 미사용(D1 제약 불안정).

-- ============================================================
-- 1) group_companies — 그룹사 정규 레지스트리
--    자연키이자 외부 조인 키: name (기존 TEXT group_company 와 동일 값).
--    name 은 trim/공백정규화된 표시 문자열 그대로 저장(정규화 책임은 앱 레이어 normalizeGroupName).
--    UNIQUE(name) 이 이미 인덱스를 제공하므로 별도 인덱스는 만들지 않는다(중복 제거).
-- ============================================================
CREATE TABLE IF NOT EXISTS group_companies (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL UNIQUE,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 2) 백필 — 기존에 흩어진 DISTINCT 비어있지 않은 group_company 를 레지스트리에 시드.
--    출처: solutions, assets, user_group_companies.
--    INSERT OR IGNORE 로 UNIQUE 충돌(=이미 존재) 무시 → 멱등.
--    'system' 의사 그룹(0005 에서 NULL 백필값)은 명시적으로 제외:
--      운영자에게 노출되는 실제 그룹사가 아니라 "미분류 컴포넌트" 버킷이므로
--      레지스트리에는 넣지 않는다. (admin 전용 미분류 진입점으로 별도 처리.)
-- ============================================================
INSERT OR IGNORE INTO group_companies (name)
  SELECT DISTINCT TRIM(group_company) FROM solutions
   WHERE group_company IS NOT NULL AND TRIM(group_company) NOT IN ('', 'system');

INSERT OR IGNORE INTO group_companies (name)
  SELECT DISTINCT TRIM(group_company) FROM assets
   WHERE group_company IS NOT NULL AND TRIM(group_company) NOT IN ('', 'system');

INSERT OR IGNORE INTO group_companies (name)
  SELECT DISTINCT TRIM(group_company) FROM user_group_companies
   WHERE group_company IS NOT NULL AND TRIM(group_company) NOT IN ('', 'system');
