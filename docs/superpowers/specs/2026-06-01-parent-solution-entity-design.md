# 부모 "솔루션" 엔티티 도입 — 설계/구현 계약

- 날짜: 2026-06-01
- 대상: `vuln-monitor-web` (Cloudflare Workers + Hono/JSX + D1)
- 승인: 사용자 — 부모 엔티티 신설 / (그룹사+호스트명) 식별 / 장비 등록=부모 생성 / 부모 그룹 뷰 기본 (모두 권장안)

## 0. 용어
| UI 표기 | 내부 테이블 | 의미 |
|---|---|---|
| 솔루션(자산) = 부모 | 신규 `assets` | 운영자가 등록·관리하는 단위 (예: SNIPER ONE-i 5300) |
| 구성요소(컴포넌트) = 자식 | 기존 `solutions` (유지) | OS/HW/OpenSSL/DB... 버전 행 |

기존 `solutions` / `matched_vulns` / n8n 자동화는 **이름·계약 그대로 유지.** 부모는 신규 `assets` 테이블 추가만.

## 1. 데이터 모델 — migrations/0006_assets.sql (스키마만)
```sql
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

ALTER TABLE solutions ADD COLUMN asset_id INTEGER;  -- soft FK, 앱 레벨 cascade
CREATE INDEX IF NOT EXISTS idx_solutions_asset ON solutions(asset_id);
```
- 자연키 = `(group_company, hostname)` — hostname 이 비어있지 않을 때만 그룹핑.
- FK CASCADE 미사용(D1 불안정) → 부모 삭제는 앱에서 자식+matched_vulns 일괄 삭제.
- 부모 취약/카테고리는 저장하지 않고 **쿼리 집계**.

## 2. 백필 — lib/assets.ts `backfillAssets(db, scope?)` (멱등)
- hostname 있는 행: `(group_company, hostname)`별 부모 1개. name = 대표 제품(HW>OS>FW>첫 컴포넌트), 없으면 hostname.
- hostname 없는 행: 행마다 단독 부모. name = `"vendor product"`.
- `asset_id` 이미 있는 행은 skip. 반환 `{ assetsCreated, componentsLinked }`.
- 트리거: 목록 상단 배너 "미연결 N건 — [지금 묶기]" → `POST /solutions/assets/backfill` (본인이 쓰기 가능한 그룹사 범위만; admin=전체).

## 3. 등록/관리
- 장비 등록 = `assets` 1개 + 컴포넌트 N개를 같은 `asset_id`로 연결. (mapEquipmentToSolutions 결과에 asset 부여)
- 단건 등록 = 부모 선택 드롭다운(같은 그룹사) 또는 "새 솔루션으로" → 단독 부모.
- 컴포넌트 추가 = 부모 카드의 "구성요소 추가" → 기존 `asset_id`에 행 추가.
- 신규 라우트(web.tsx, HTML form/redirect):
  - `POST /solutions/asset/:id` — 부모 수정(name/vendor/hostname/group/owner/notes). group 변경 시 자식 `group_company` 동기화.
  - `POST /solutions/asset/:id/delete` — 부모+자식 일괄 삭제(권한·감사 포함).
  - `POST /solutions/assets/backfill` — 백필 실행 후 redirect.
- 공통 헬퍼 `resolveOrCreateAsset(db, key)` — 모든 INSERT 경로(web/api/bulk)에서 호출.

## 4. 뷰 (solutions-list.tsx)
- 기본 뷰 = `grouped` (부모 카드 목록, 펼침). 토글 `[솔루션별(기본)] [개별(평면)]`.
- 부모 카드: 상태 롤업·솔루션명·그룹사·호스트명·담당·컴포넌트수·취약수·[구성요소 추가][수정][삭제] + 컴포넌트 표.
- 백필 배너(unlinkedCount>0). 필터(group/category)는 컴포넌트 기준, 매칭 컴포넌트를 가진 부모 표시.

## 5. 대시보드
- "솔루션 수"=부모 수, "구성요소 수"=기존 solutions 수 병기. 취약 솔루션=취약 컴포넌트 보유 부모 수. 카테고리 집계는 컴포넌트 기준 유지.

## 6. 매칭/n8n
- 변경 없음. `matched_vulns.solution_id`→컴포넌트. bulk API 계약 유지(내부 asset_id 부여만).

## 7. 타입 계약 (types.ts — 팀리드가 사전 고정)
```ts
export interface Asset {
  id: number; name: string; vendor: string | null; hostname: string | null;
  group_company: string | null; owner: string | null; notes: string | null;
  created_at: string; updated_at: string;
}
export interface AssetWithComponents {
  asset: Asset; components: Solution[]; componentCount: number;
  vulnerableCount: number; hasVulnerable: boolean;
}
export interface AssetInput {
  name: string; vendor: string | null; hostname: string | null;
  group_company: string | null; owner: string | null; notes: string | null;
}
// Solution / SolutionInput 에 asset_id 추가
```

### View props 계약
```ts
// SolutionsList (Agent-2 정의, web.tsx 가 충족)
view: 'grouped' | 'list'
assets: AssetWithComponents[]      // grouped 뷰
solutions: Solution[]              // list(평면) 뷰
matchesBySolution: Map<number, MatchedVuln[]>
unlinkedCount: number
groupSummaries, activeGroup, activeCategory, flash, currentUser  // 기존과 동일
// 단건 등록 부모 선택용:
assetOptions: { id: number; name: string; group_company: string | null }[]

// DashboardStats 에 optional 추가: assetTotal?: number; componentTotal?: number
```

## 8. 테스트/검증 (프로덕션 D1 remote — 절대 미접근)
- vitest + node:sqlite D1 shim 으로 실제 lib/assets.ts 함수 검증.
- 시나리오 하니스: 0001~0006 적용 → 이미지 데이터(공용/PJ-FI-IDS 5컴포넌트 + null-host 레거시 + matched_vuln) 시드 → backfill → getAssetsWithComponents 단언.
- `tsc --noEmit` 그린, wrangler d1 remote 실행 금지.

## 9. 범위 외 (YAGNI)
- 부모 병합 UI, min_severity 필터 실제 적용, 컴포넌트→다른 부모 이동.
