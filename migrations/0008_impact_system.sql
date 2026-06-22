-- v3.3 영향시스템(impact_system) 분류 차원 도입
-- 회사 공식 "영향 시스템" 6종(PC / Server / Web·WAS / Database / Network / Application)을
-- 자산(assets) 레벨 분류축으로 추가한다. 컴포넌트 category(17종)와 직교한다.
--   - 저장값(코드): PC | SERVER | WEBWAS | DATABASE | NETWORK | APPLICATION
--   - 한국어 표시명은 코드와 분리(src/views/impact-system-metadata.ts).
--
-- ※ SQLite/D1 특성상 ADD COLUMN 은 IF NOT EXISTS 미지원 → remote 에 1회만 적용.
--   (선례: 0007_manual_vuln_status.sql:5 주석)
-- ※ 추론 백필을 SQL 로 하지 않는다. 코드(src/lib/impact-system.ts: deriveImpactSystem +
--   recomputeImpactSystems)에서만 수행 → 단일 진실 공급원 유지(SQL/코드 이중화 방지).
-- ※ DB CHECK 제약은 D1 ALTER 로 불가 → 값 검증은 앱 boundary(IMPACT_SYSTEMS 화이트리스트).
-- ※ 인덱스는 보류 — 6종 저카디널리티 단독 인덱스는 풀스캔보다 느릴 수 있음. 측정 후 필요 시
--   (group_company, impact_system) 복합으로 추가.

-- 1) 주 분류 (단일값). NULL = 미설정.
ALTER TABLE assets ADD COLUMN impact_system TEXT;

-- 2) 분류 출처. 'derived'=자동추론(재추론 시 갱신 대상) | 'manual'=운영자 확정(절대 덮어쓰지 않음).
--    NULL = 미설정. 선례: solutions.source (0004_multi_category_support.sql:24).
ALTER TABLE assets ADD COLUMN impact_system_source TEXT;
