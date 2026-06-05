# F7. 하이브리드 트리거 (Schedule + UI 갱신 버튼) Playbook

> **관찰용 Playbook** — 각 Phase의 명령어는 그대로 복사·붙여넣기 가능.
> 각 Phase 의 `[ ]` 체크박스를 수동으로 `[x]` 로 전환하면서 진행.
>
> **작성일:** 2026-04-24
> **대체 대상:** `F6_신규솔루션_웹훅누락_playbook.md` (push 모델 가정) → F7 (하이브리드)
> **Agent Team 산출물 종합:** `code-architect` × 2 + `security-reviewer` × 1
>
> **사용 ECC Skills:**
> `ecc:plan` · `ecc:code-architect` · `ecc:typescript-reviewer` · `ecc:security-reviewer`
> `ecc:frontend-design` · `ecc:verification-loop` · `ecc:database-reviewer`

---

## 0. 최종 목표

| # | 요구사항 | 구현 수단 |
|---|---------|----------|
| 1 | **평일 오전 9시 자동 점검** — 기 등록 솔루션 + 신규 솔루션 모두 | n8n Schedule Trigger `0 9 * * 1-5` (기존 유지) |
| 2 | **불특정 시간 신규 등록 시 UI 갱신 버튼으로 즉시 점검** | UI 버튼 → Worker `POST /solutions/refresh` → n8n Webhook Trigger (신규 추가) |
| 3 | **n8n 수동 실행 금지** — Worker 엔드포인트 경유만 | Webhook Trigger + Header Auth (x-rematch-secret) |
| 4 | 매칭된 CVE 는 UI 에 붉은 음영 표시 | 기존 `is_vulnerable=1 → bg-red-lt` 로직 유지 |
| 5 | 공용 엔드포인트의 CSRF/abuse 차단 | Sec-Fetch-Site + global rate limit (5분) |
| 6 | 노출된 시크릿 즉시 rotation | TEAMS_WEBHOOK_URL + N8N_REMATCH_SECRET |

---

## 🚨 1. 즉시 필수 조치 (배포 전 선행, CRITICAL)

> Agent 3(security-reviewer) 감사 결과 **이번 대화에서 시크릿 2개가 노출됨**. 코드 수정보다 **먼저** 처리.

### 1.1 TEAMS_WEBHOOK_URL 재생성

Power Automate 콘솔 접속 → 기존 플로우의 "When an HTTP request is received" 트리거 → `Regenerate URL`.

### 1.2 N8N_REMATCH_SECRET 교체

새 랜덤 32자 시크릿 생성:

```bash
# Git Bash / WSL
openssl rand -base64 32 | tr -d '=+/' | cut -c1-32

# PowerShell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
```

### 1.3 docker n8n `.env` 갱신 및 재기동

```bash
# .env 파일 편집
notepad c:/Users/cksgu/OneDrive/Desktop/DevTool/CloudFlare/n8n/.env

# 새 TEAMS_WEBHOOK_URL 과 N8N_REMATCH_SECRET 반영 후
cd c:/Users/cksgu/OneDrive/Desktop/DevTool/CloudFlare/n8n
docker compose down
docker compose up -d
docker logs n8n --tail 50
```

- [ ] TEAMS_WEBHOOK_URL 재생성
- [ ] N8N_REMATCH_SECRET 새 값 생성
- [ ] `.env` 갱신 및 docker compose 재기동
- [ ] n8n 컨테이너 정상 기동 로그 확인

### 1.4 Worker 시크릿 동기화

```bash
cd c:/Users/cksgu/OneDrive/Desktop/DevTool/CloudFlare/vuln-monitor-web

# N8N_REMATCH_SECRET (n8n .env 와 동일 값)
npx wrangler secret put N8N_REMATCH_SECRET

# N8N_BACKFILL_WEBHOOK_URL (UI 갱신 버튼이 호출할 n8n webhook URL)
# 예: https://n8n.example.com/webhook/vuln-refresh (F7 에서 n8n 에 신규 추가 예정)
npx wrangler secret put N8N_BACKFILL_WEBHOOK_URL

# (선택) ALLOWED_ORIGIN — Sec-Fetch-Site fallback 용
npx wrangler secret put ALLOWED_ORIGIN
# 입력: https://vuln-monitor-web.hyundai-autoever-corporation-hcloud.workers.dev

# 확인
npx wrangler secret list
```

- [ ] Worker `N8N_REMATCH_SECRET` 갱신
- [ ] Worker `N8N_BACKFILL_WEBHOOK_URL` 설정
- [ ] Worker `ALLOWED_ORIGIN` 설정 (선택)

---

## 2. 아키텍처 다이어그램

```
┌─────────────────────┐       ┌────────────────────────┐
│  Browser (사용자)   │       │ n8n Schedule Trigger   │
│  /solutions         │       │ cron: 0 9 * * 1-5      │
│                     │       └───────────┬────────────┘
│  [+ 새 솔루션 등록] │                   │
│  [🔄 취약점 갱신]   │                   │
└─────────┬───────────┘                   │
          │                               │
          │ POST /solutions/refresh       │
          │ Content-Type: application/json│
          │ Sec-Fetch-Site: same-origin   │
          ▼                               │
┌─────────────────────┐                   │
│  Cloudflare Worker  │                   │
│  - Sec-Fetch-Site   │                   │
│  - global rate limit│                   │
│  - audit_log INSERT │                   │
│  - waitUntil:       │                   │
│    triggerFullBackfill(env)             │
│                     │                   │
│  ◀── 202 Accepted ──┘                   │
└─────────┬───────────┘                   │
          │ POST N8N_BACKFILL_WEBHOOK_URL │
          │ x-rematch-secret: xxx         │
          ▼                               │
┌─────────────────────────────────────────┼───────────┐
│ n8n v2.4 워크플로 (신규)                ▼           │
│                                                     │
│  Webhook Trigger ──┐       ┌── Schedule Trigger     │
│  /webhook/         │       │                        │
│  vuln-refresh      │       │                        │
│        │           │       │                        │
│        ▼           │       ▼                        │
│  IF Validate       │  Set - Schedule Context        │
│  Secret            │  (trigger_type='schedule')     │
│        │           │       │                        │
│  Set - Webhook     │       │                        │
│  Context           │       │                        │
│  (trigger_type=    │       │                        │
│   'webhook')       │       │                        │
│        │           │       │                        │
│  [202 Accepted]    │       │                        │
│        │           │       │                        │
│        └─────────┬─┴───────┘                        │
│                  ▼                                  │
│           Merge - Trigger                           │
│                  ▼                                  │
│           Code - Backfill State  (🔧 L26 버그 수정) │
│                  ▼                                  │
│           HTTP - GET D1 Solutions                   │
│                  ▼                                  │
│           Code - Split by Mode  (🆕 신규 감지)      │
│                  │                                  │
│      ┌───────────┴──────────┐                       │
│      ▼                      ▼                       │
│  신규 솔루션              기존 솔루션                │
│  (1년 backfill)           (daily delta)             │
│      │                      │                       │
│      └──────────┬───────────┘                       │
│                 ▼                                   │
│      [NVD/KrCERT/CISA/OpenCVE Crawler]              │
│                 ▼                                   │
│      AI Agent (Claude Sonnet 4.6)                   │
│                 ▼                                   │
│      IF Has Matches → HTTP POST D1 Match            │
│                 ▼                                   │
│      IF Should Notify Teams (🔧 조건식 재작성)       │
│                 ▼                                   │
│      HTTP - Teams Webhook                           │
│                 ▼                                   │
│      Code - Persist State  (🆕 seenSolutionIds)     │
└─────────────────────────────────────────────────────┘
                 │
                 ▼
         POST /api/vulns/match
                 │
                 ▼
┌─────────────────────────────┐
│ Worker /api/vulns/match     │
│ - matched_vulns INSERT      │
│ - solutions.is_vulnerable=1 │
└─────────────────────────────┘
                 │
                 ▼
         UI 새로고침 → 붉은 음영 🔴
```

---

## 3. Phase 분해 (Agent Team 종합)

| Phase | 담당 영역 | ECC Skill | 예상 시간 | 복잡도 |
|-------|-----------|-----------|-----------|--------|
| P0 | 시크릿 rotation (§1) | — | 0.5h | Low |
| P1 | n8n v2.4 워크플로 신규 파일 작성 | `ecc:code-architect` | 3.0h | **High** |
| P2 | Worker UI 갱신 버튼 | `ecc:frontend-design` | 1.0h | Low |
| P3 | Worker `POST /solutions/refresh` 엔드포인트 | `ecc:code-architect` | 1.0h | Medium |
| P4 | 보안 하드닝 (Sec-Fetch-Site + rate limit) | `ecc:security-reviewer` | 0.5h | Low |
| P5 | TS 빌드 / 배포 | — | 0.5h | Low |
| P6 | E2E 검증 (UI → audit_log → n8n → 붉은 음영) | `ecc:verification-loop` | 1.0h | Medium |
| P7 | 코드 리뷰 | `ecc:typescript-reviewer` + `ecc:security-reviewer` | 0.5h | Low |
| P8 | 문서화 / 롤백 계획 | — | 0.5h | Low |
| **합계** | | | **~8.5h** | — |

---

## 4. Phase 1 — n8n v2.4 워크플로 작성

### 4.1 파일 전략

```bash
# v2.3 복사 → v2.4 베이스
cp c:/Users/cksgu/OneDrive/Desktop/DevTool/CloudFlare/n8n/Workflow/v2.3_vuln-monitor-with-d1.json \
   c:/Users/cksgu/OneDrive/Desktop/DevTool/CloudFlare/n8n/Workflow/v2.4_vuln-monitor-hybrid.json
```

- v2.3 `active: false` 유지 (현재도 inactive)
- v2.4 완성 후 n8n UI 에 import → 테스트 → Active ON
- v2.3 은 30일 보존 후 삭제 (롤백 창)

### 4.2 추가될 신규 노드 (8개)

| 이름 | 타입 | 역할 |
|------|------|------|
| `Webhook Trigger` | `n8n-nodes-base.webhook` | Worker → n8n 진입점. path `/webhook/vuln-refresh` |
| `IF - Validate Secret` | `n8n-nodes-base.if` | `x-rematch-secret` 헤더 검증 |
| `HTTP - 401 Unauthorized` | `n8n-nodes-base.respondToWebhook` | secret 불일치 시 401 |
| `Set - Webhook Context` | `n8n-nodes-base.set` | `trigger_type='webhook'` 주입 |
| `HTTP - 202 Accepted` | `n8n-nodes-base.respondToWebhook` | fire-and-forget 응답 |
| `Set - Schedule Context` | `n8n-nodes-base.set` | `trigger_type='schedule'` 주입 |
| `Merge - Trigger` | `n8n-nodes-base.merge` | 두 진입점 통합 |
| `Code - Split by Mode` | `n8n-nodes-base.code` | seenSolutionIds diff → 신규/기존 분리 |

### 4.3 기존 노드 수정 (6개)

| 노드 | 변경 내용 |
|------|-----------|
| `Code - Backfill State` | **L26 `$getWorkflowStaticData('global').lastBackfillAt = null;` 라인 제거** + trigger_type 읽기 |
| `Code - Combine D1 + Vulns` | `backfill_partial` 모드 분기 추가 |
| `Code - Parse AI JSON` | `trigger_type` 필드 전달 |
| `IF - Should Notify Teams` | 조건식 재작성: `(schedule AND first_seen_count>0) OR (webhook AND matches>0)` |
| `Code - Persist State` | `seenSolutionIds` union 저장. webhook 호출은 `lastBackfillAt` 갱신 제외 |
| `AI Agent` (systemMessage) | on-demand refresh 컨텍스트 추가 (`[UI 갱신 요청]` 태그) |

### 4.4 Backfill State 신규 JS (핵심 패치)

```javascript
// Code - Backfill State (v2.4)
// 🔧 L26 리셋 라인 완전 제거
// 🆕 seenSolutionIds 추가

const staticData = $getWorkflowStaticData('global');

// Merge 이전 Set 노드에서 주입된 trigger_type
const triggerType = $input.first().json.trigger_type ?? 'schedule';

const lastBackfillAt = staticData.lastBackfillAt ?? null;
const seenSolutionIds = staticData.seenSolutionIds ?? [];

let mode;
if (triggerType === 'webhook') {
  mode = 'webhook_pending';  // Split by Mode 에서 확정
} else {
  mode = lastBackfillAt ? 'daily' : 'backfill_full';
}

const now = new Date();
const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
const yearAgo = new Date(now - 365 * 86400000).toISOString().split('T')[0];

return [{json: {
  trigger_type: triggerType,
  mode,
  lastBackfillAt,
  seenSolutionIds,
  nowIso: now.toISOString(),
  nvdPubStart: yesterday + 'T00:00:00.000',
  nvdPubEnd: yesterday + 'T23:59:59.999',
  nvdBackfillStart: yearAgo + 'T00:00:00.000',
  nvdBackfillEnd: now.toISOString().split('T')[0] + 'T23:59:59.999',
  backfillDays: 365
}}];
```

### 4.5 Split by Mode 신규 JS

```javascript
// Code - Split by Mode (신규)
const state = $('Code - Backfill State').first().json;
const solutionsResp = $('HTTP - GET D1 Solutions').first().json;
const allSolutions = solutionsResp?.data ?? [];

const seenSet = new Set(state.seenSolutionIds);
const newSolutions = allSolutions.filter(s => !seenSet.has(s.id));
const existingSolutions = allSolutions.filter(s => seenSet.has(s.id));

// mode 확정
let mode = state.mode;
if (state.trigger_type === 'webhook') {
  mode = newSolutions.length > 0 ? 'backfill_partial' : 'daily';
}

const newVendors = [...new Set(newSolutions.map(s => s.vendor).filter(Boolean))];

return [{json: {
  ...state,
  mode,
  newSolutionIds: newSolutions.map(s => s.id),
  newVendors,
  newSolutions,
  existingSolutions,
  allSolutions,
  crawlerPubStart: (mode === 'daily') ? state.nvdPubStart : state.nvdBackfillStart,
  crawlerPubEnd:   (mode === 'daily') ? state.nvdPubEnd   : state.nvdBackfillEnd,
  targetVendors:   (mode === 'backfill_partial') ? newVendors : null
}}];
```

### 4.6 Mode 결정 트리

```
trigger_type?
├─ 'webhook' (UI 갱신)
│   └─ newSolutions.length > 0?
│       ├─ YES → 'backfill_partial' (신규 vendor 만 1년치)
│       └─ NO  → 'daily'            (어제치만)
│
└─ 'schedule' (평일 9AM)
    └─ lastBackfillAt 존재?
        ├─ YES → 'daily'            (어제치만)
        └─ NO  → 'backfill_full'    (최초 1회, 전체 1년치)
```

### 4.7 Teams 알림 IF 조건 재작성

```javascript
const triggerType = $('Code - Parse AI JSON').first().json.trigger_type;
const firstSeenCount = $json.data?.first_seen_count ?? 0;
const matchCount = $('Code - Parse AI JSON').first().json.matches?.length ?? 0;

const scheduleCondition = triggerType === 'schedule' && firstSeenCount > 0;
const webhookCondition  = triggerType === 'webhook'  && matchCount > 0;

return scheduleCondition || webhookCondition;
```

### 4.8 Webhook 노드 설정 (n8n UI)

- Method: `POST`
- Path: `vuln-refresh`
- Authentication: **Header Auth** (필수 — CRITICAL 보안 이슈)
  - Header Name: `x-rematch-secret`
  - Header Value: `{{$env.N8N_REMATCH_SECRET}}`
- Response Mode: `respondToWebhook` 노드로 위임

### 4.9 체크리스트

- [ ] `v2.4_vuln-monitor-hybrid.json` 파일 생성
- [ ] L26 리셋 버그 제거
- [ ] 신규 노드 8개 추가
- [ ] 기존 노드 6개 수정
- [ ] Webhook 노드에 Header Auth 강제 설정
- [ ] n8n UI 에 import 후 manual test (Worker curl 로 모의 호출)
- [ ] v2.4 Active ON, v2.3 Active OFF

### 4.10 초기 seenSolutionIds 마이그레이션

v2.4 최초 실행 시 모든 기존 솔루션이 '신규'로 인식되어 `backfill_partial` 폭주 가능.

**옵션 A (추천):** v2.4 최초 실행을 Schedule 경유로 수동 트리거 → `backfill_full` 이 돈 뒤 seenSolutionIds 자동 저장.

**옵션 B:** n8n UI 에서 staticData 수동 편집 — Settings → Data → Workflow Static Data 에 현재 솔루션 ID 목록 주입.

```bash
# 옵션 A 준비: 현재 솔루션 ID 목록 확인
npx wrangler d1 execute vuln-monitor-db --remote --command="SELECT id FROM solutions ORDER BY id;"
```

- [ ] 마이그레이션 옵션 선택 (A 또는 B)
- [ ] 최초 backfill_full 실행 확인

---

## 5. Phase 2 — UI 갱신 버튼 추가

### 5.1 변경 파일

`src/views/solutions-list.tsx` L33-43 (기존 "+ 새 솔루션 등록" 버튼 블록)

### 5.2 변경 내용

**두 버튼을 `btn-list` 로 묶고 "취약점 갱신" 버튼을 먼저 배치:**

```tsx
<div class="col-auto ms-auto d-print-none">
  <div class="btn-list">
    <button
      type="button"
      id="btn-global-refresh"
      class="btn btn-outline-secondary d-inline-flex align-items-center"
      title="전체 솔루션 대상 취약점 재스캔 요청"
    >
      <i id="refresh-icon" class="ti ti-refresh me-1"></i>
      <span id="refresh-label">취약점 갱신</span>
    </button>
    <button
      type="button"
      class="btn btn-primary d-inline-flex align-items-center"
      data-bs-toggle="modal"
      data-bs-target="#solution-modal"
      data-mode="create"
    >
      <i class="ti ti-plus me-1"></i>새 솔루션 등록
    </button>
  </div>
</div>
```

### 5.3 JS 핸들러 (기존 `<script>` 블록 L106-153 안에 추가)

```javascript
// 취약점 갱신 버튼 핸들러
var refreshBtn = document.getElementById('btn-global-refresh');
var refreshIcon = document.getElementById('refresh-icon');
var refreshLabel = document.getElementById('refresh-label');
if (refreshBtn) {
  refreshBtn.addEventListener('click', async function() {
    refreshBtn.disabled = true;
    refreshIcon.className = 'spinner-border spinner-border-sm me-1';
    refreshLabel.textContent = '갱신 중...';

    try {
      var res = await fetch('/solutions/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _action: 'global_refresh' })
      });
      var data = await res.json();
      if (res.status === 202) {
        showFlash('success', '취약점 갱신 요청 전송됨. 수 분 후 새로고침하면 결과 확인 가능.');
      } else if (res.status === 429 || res.status === 409) {
        showFlash('error', '최근 5분 내 갱신 요청이 있었습니다. 잠시 후 재시도하세요.');
      } else {
        showFlash('error', '갱신 요청 실패: ' + (data.error || '알 수 없는 오류'));
      }
    } catch (e) {
      showFlash('error', '네트워크 오류로 갱신 요청 실패');
    } finally {
      refreshBtn.disabled = false;
      refreshIcon.className = 'ti ti-refresh me-1';
      refreshLabel.textContent = '취약점 갱신';
    }
  });
}

function showFlash(type, msg) {
  var cls = type === 'success' ? 'alert-success' : 'alert-danger';
  var icon = type === 'success' ? 'circle-check' : 'alert-circle';
  var html = '<div class="alert ' + cls + ' alert-dismissible mb-3" role="alert">' +
             '<div class="d-flex"><div><i class="ti ti-' + icon + ' me-2"></i></div>' +
             '<div>' + msg + '</div></div>' +
             '<a class="btn-close" data-bs-dismiss="alert" aria-label="close"></a></div>';
  var container = document.querySelector('.container-xl');
  if (container) container.insertAdjacentHTML('afterbegin', html);
}
```

### 5.4 체크리스트

- [ ] 버튼 JSX 삽입
- [ ] JS 핸들러 추가
- [ ] Tabler 아이콘 `ti-refresh`, `ti-clock` 확인
- [ ] 로컬 `wrangler dev` 로 버튼 상태 전환 시각 확인

---

## 6. Phase 3 — Worker `POST /solutions/refresh` 엔드포인트

### 6.1 변경 파일

- `src/types.ts` (+5 LOC)
- `src/routes/web.tsx` (+40 LOC)

### 6.2 `src/types.ts` 추가

```typescript
// Bindings 인터페이스 확장
export interface Bindings {
  DB: D1Database
  API_KEY: string
  ENVIRONMENT: string
  N8N_REMATCH_WEBHOOK_URL?: string
  N8N_BACKFILL_WEBHOOK_URL?: string
  N8N_REMATCH_SECRET?: string
  ALLOWED_ORIGIN?: string  // 🆕 Sec-Fetch-Site fallback
}

// 신규
export interface RefreshResponse {
  requested_at: string
}
```

### 6.3 `src/routes/web.tsx` 추가 (L297 `export default app` 직전)

```typescript
import { triggerFullBackfill } from '../lib/rematch'

// ... 기존 핸들러들 ...

app.post('/solutions/refresh', async (c) => {
  // [1] Sec-Fetch-Site 검증 (CSRF 방어, 가장 단순하고 효과적)
  const secFetchSite = c.req.header('Sec-Fetch-Site')
  if (secFetchSite && secFetchSite !== 'same-origin') {
    return c.json({ success: false, error: 'Cross-origin requests not allowed' }, 403)
  }

  // [2] (선택) Origin 화이트리스트 — Sec-Fetch-Site 미지원 브라우저 대비
  const allowedOrigin = c.env.ALLOWED_ORIGIN
  const requestOrigin = c.req.header('Origin')
  if (allowedOrigin && requestOrigin && requestOrigin !== allowedOrigin) {
    return c.json({ success: false, error: 'Origin not allowed' }, 403)
  }

  const db = c.env.DB

  // [3] Global rate limit — audit_log target_id=0, target_table='global'
  const recent = await db
    .prepare(
      `SELECT 1 AS hit FROM audit_log
        WHERE action = 'global_rematch_requested'
          AND target_table = 'global'
          AND target_id = 0
          AND created_at > datetime('now','-5 minutes')
        LIMIT 1`,
    )
    .first<{ hit: number }>()

  if (recent) {
    return c.json(
      { success: false, error: 'rate_limited', retry_after: 300 },
      429,
    )
  }

  // [4] 요청 기록 (race window 닫기)
  await writeAudit(db, 'global_rematch_requested', 'global', 0, 'web-ui', {
    triggered_by: 'ui-refresh-button',
  })

  // [5] fire-and-forget webhook 호출
  c.executionCtx.waitUntil(
    triggerFullBackfill(c.env)
      .then((result) =>
        writeAudit(
          db,
          result.ok ? 'global_rematch_dispatched' : 'global_rematch_dispatch_failed',
          'global',
          0,
          'web-ui',
          result,
        ),
      )
      .catch(() => {}),
  )

  // [6] 202 Accepted
  return c.json(
    { success: true, data: { requested_at: new Date().toISOString() } },
    202,
  )
})
```

### 6.4 체크리스트

- [ ] `types.ts` 에 `ALLOWED_ORIGIN` + `RefreshResponse` 추가
- [ ] `web.tsx` 에 `triggerFullBackfill` import
- [ ] `POST /solutions/refresh` 핸들러 추가
- [ ] Sec-Fetch-Site + rate limit + audit_log + waitUntil 전부 포함

---

## 7. Phase 4 — 보안 하드닝 (Agent 3 감사 결과 반영)

### 7.1 CRITICAL 조치 — 이미 Phase 3 에 포함

- [x] Sec-Fetch-Site 검증 (§6.3 [1])
- [x] global rate limit (§6.3 [3])
- [x] n8n Webhook Header Auth (§4.8)

### 7.2 HIGH 조치 (배포 전 포함)

- [ ] generic error message — `lib/rematch.ts` 이미 처리 완료 확인
- [ ] `audit_log.payload_json` 에 webhook URL 이 들어가지 않는지 확인 (rematch.ts 는 이미 보호됨)
- [ ] n8n Webhook URL 공개 금지 — 내부 인프라 URL 은 git 비공개

### 7.3 MEDIUM 조치 (배포 후 후속)

- [ ] `auth.ts` timing-safe 비교 적용 (`crypto.subtle.timingSafeEqual`)
- [ ] Cloudflare Access (Zero Trust) 로 웹 UI 전체 접근 통제
- [ ] `app.onError` production generic message 분리

### 7.4 Race condition 해결 (옵션)

현재 audit_log SELECT → INSERT 사이 race 가능. 완전 원자성 필요 시 Cloudflare KV 로 마이그레이션:

```typescript
// (옵션) KV 기반 global lock
const locked = await c.env.RATE_LIMIT_KV.get('backfill:global')
if (locked) return c.json({ success: false, error: 'rate_limited' }, 429)
await c.env.RATE_LIMIT_KV.put('backfill:global', '1', { expirationTtl: 300 })
```

> 현 단계에서는 audit_log 방식 유지 (내부 도구 + race 영향 제한적).

---

## 8. Phase 5 — 빌드 및 배포

### 8.1 타입 체크

```bash
cd c:/Users/cksgu/OneDrive/Desktop/DevTool/CloudFlare/vuln-monitor-web
npx tsc --noEmit --pretty false
```

- [ ] EXIT=0

### 8.2 로컬 dev

```bash
npx wrangler dev --local
# 별도 터미널
curl -i -X POST http://localhost:8787/solutions/refresh \
  -H "Content-Type: application/json" \
  -H "Sec-Fetch-Site: same-origin" \
  -d '{"_action":"global_refresh"}'
# 기대: 202 + {"success":true,"data":{"requested_at":"..."}}

# Cross-origin 차단 테스트
curl -i -X POST http://localhost:8787/solutions/refresh \
  -H "Content-Type: application/json" \
  -H "Sec-Fetch-Site: cross-site" \
  -d '{}'
# 기대: 403
```

- [ ] 정상 요청 202
- [ ] Sec-Fetch-Site cross-site 차단 403
- [ ] 연속 요청 시 2번째 429

### 8.3 배포

```bash
npx wrangler deploy --minify
```

- [ ] 배포 성공, 버전 ID: `____________________`

---

## 9. Phase 6 — E2E 검증

### 9.1 신규 솔루션 등록 (불특정 시간)

1. 브라우저에서 `/solutions` 접속
2. "+ 새 솔루션 등록" → Fortinet/FortiOS/FW/7.4.1 입력 → 등록
3. 기대: flash "Fortinet FortiOS 등록 완료", 행은 아직 **음영 없음** (is_vulnerable=0)

### 9.2 "🔄 취약점 갱신" 버튼 클릭

1. 버튼 클릭
2. 기대: 버튼 스피너 → flash "취약점 갱신 요청 전송됨. 수 분 후 새로고침하면 결과 확인 가능."

### 9.3 audit_log 확인 (즉시)

```bash
npx wrangler d1 execute vuln-monitor-db --remote --command="SELECT id, action, target_table, target_id, actor, payload_json, created_at FROM audit_log WHERE action LIKE 'global_%' ORDER BY id DESC LIMIT 5;"
```

기대:
- `global_rematch_requested` (actor=web-ui) 1건
- `global_rematch_dispatched` (actor=web-ui, payload result.ok=true) 1건

### 9.4 연속 클릭 차단 확인

버튼 즉시 재클릭:
- 기대: flash "최근 5분 내 갱신 요청이 있었습니다."

### 9.5 n8n Execution 확인

브라우저 `http://localhost:5678` → Executions 탭 → `v2.4_vuln-monitor-hybrid` 최신 실행:

- [ ] Webhook Trigger 진입 확인
- [ ] IF - Validate Secret → true 분기
- [ ] Set - Webhook Context (trigger_type='webhook')
- [ ] Code - Backfill State → mode=webhook_pending
- [ ] Code - Split by Mode → newSolutionIds=[N], mode=backfill_partial
- [ ] Backfill Crawler → Fortinet vendor 만 크롤
- [ ] AI Agent → matches 배열
- [ ] HTTP POST D1 Match → 200
- [ ] Teams Webhook → 발송됨

### 9.6 matched_vulns 확인

```bash
npx wrangler d1 execute vuln-monitor-db --remote --command="SELECT solution_id, cve_id, severity, published, detected_at FROM matched_vulns WHERE solution_id=(SELECT MAX(id) FROM solutions) ORDER BY published DESC LIMIT 20;"

npx wrangler d1 execute vuln-monitor-db --remote --command="SELECT id, vendor, product, is_vulnerable, last_matched_cve, last_matched_at FROM solutions ORDER BY id DESC LIMIT 3;"
```

- [ ] matched_vulns 1건 이상
- [ ] solutions.is_vulnerable = 1
- [ ] last_matched_cve 채워짐

### 9.7 UI 붉은 음영 확인

`/solutions` 새로고침:

- [ ] Fortinet FortiOS 행 `bg-red-lt` 배경
- [ ] 상태 컬럼에 `status-red` 배지 + CVE ID
- [ ] CVE 2건 이상이면 "총 N건" 배지

### 9.8 스케줄 검증 (다음 평일 9AM)

- [ ] 익일 또는 다음 평일 9AM n8n Execution 발생
- [ ] Schedule Trigger → Set - Schedule Context (trigger_type='schedule')
- [ ] mode=daily (이미 backfill_full 완료 상태)
- [ ] 신규 CVE 없으면 Teams 알림 생략, 있으면 발송

---

## 10. Phase 7 — 코드 리뷰

### 10.1 TypeScript 리뷰

```
/typescript-reviewer src/routes/web.tsx 의 POST /solutions/refresh 핸들러와 src/views/solutions-list.tsx 의 버튼 JSX + JS 핸들러 리뷰
```

- [ ] CRITICAL / HIGH 0건

### 10.2 보안 리뷰

```
/security-review src/routes/web.tsx + src/types.ts + n8n/Workflow/v2.4_vuln-monitor-hybrid.json (Webhook Header Auth 강제 여부)
```

- [ ] Sec-Fetch-Site + rate limit + Header Auth 3중 방어 확인

### 10.3 회귀 테스트

```bash
# 기존 /api/solutions POST 가 여전히 작동 (push 경로 백워드 호환)
curl -i -X POST "https://vuln-monitor-web.<account>.workers.dev/api/solutions" \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"vendor":"Paloalto","product":"PAN-OS","category":"FW","current_version":"12.1.1"}'

# 기존 /api/solutions/:id/rematch 개별 rematch
curl -i -X POST "https://vuln-monitor-web.<account>.workers.dev/api/solutions/1/rematch" \
  -H "Authorization: Bearer <API_KEY>"
```

- [ ] API 경로들 여전히 작동 (push 로직은 미사용이나 유지)

---

## 11. Phase 8 — 롤백 계획

### 11.1 Worker 롤백

```bash
cd c:/Users/cksgu/OneDrive/Desktop/DevTool/CloudFlare/vuln-monitor-web
npx wrangler rollback --message "revert: F7 hybrid trigger"
```

### 11.2 n8n 롤백

n8n UI:
1. `v2.4_vuln-monitor-hybrid` Active OFF
2. `v2.3_vuln-monitor-with-d1` Active ON (기존 staticData 유지됨)

### 11.3 시크릿 롤백 (필요시)

```bash
# 이전 값으로 되돌림 (기록이 있다면)
npx wrangler secret put N8N_REMATCH_SECRET
```

---

## 12. DoD (완료 기준)

- [ ] §1 시크릿 rotation 완료
- [ ] §4 v2.4 워크플로 Active + v2.3 OFF
- [ ] §5 UI 갱신 버튼 표시
- [ ] §6 `POST /solutions/refresh` 202 응답
- [ ] §7 보안 CRITICAL/HIGH 이슈 0건
- [ ] §8 배포 성공
- [ ] §9.1-9.7 UI 등록 → 갱신 버튼 → 붉은 음영까지 전 플로우
- [ ] §9.8 다음 평일 9AM 자동 점검 확인
- [ ] §10 리뷰 통과
- [ ] §11 롤백 절차 문서화

---

## 13. 백로그 (후속 개선)

- [ ] `/solutions/refresh` polling — n8n 처리 완료를 UI 가 감지해 자동 새로고침 (audit_log 의 `global_rematch_dispatched` 감지)
- [ ] rate limit 상태를 서버 렌더링 시 복원 (페이지 로드 직후 버튼 disabled 유지)
- [ ] Cloudflare Access 로 웹 UI 전체 인증
- [ ] `auth.ts` timing-safe 비교
- [ ] KV 기반 원자적 global lock
- [ ] Workflow v2.5: backfill progress 엔드포인트 (진행률 표시)

---

## 14. 사용된 ECC Skills 요약

| Phase | Skill | 목적 |
|-------|-------|------|
| 계획 | `ecc:plan` | 요구사항 재진술, Phase 분해 |
| n8n 설계 | `ecc:code-architect` (Agent 2) | v2.4 신규 워크플로 노드 구조 |
| Worker 설계 | `ecc:code-architect` (Agent 1) | UI + endpoint + rate limit |
| 보안 감사 | `ecc:security-reviewer` (Agent 3) | CSRF, 시크릿 rotation, race condition |
| 구현 | 직접 Edit | 파일별 수정 |
| TS 검토 | `ecc:typescript-reviewer` | 변경 diff 전용 리뷰 |
| UI 품질 | `ecc:frontend-design` | 버튼 상태 전환 UX |
| 검증 | `ecc:verification-loop` | E2E 자동화 확장 |
| DB | `ecc:database-reviewer` (선택) | audit_log 쿼리 인덱스 최적화 |

---

## 15. 미해결 설계 질문 (사용자 확인 필요)

Agent 1, 2 가 남긴 질문 중 배포 전 확정 필요한 것:

1. **n8n Webhook URL 접근성** — Worker(Cloudflare edge)가 Docker 컨테이너(localhost:5678)를 어떻게 호출할 것인가?
   - 옵션 a: Cloudflare Tunnel 로 n8n 노출
   - 옵션 b: n8n 공인 도메인 확보 (예: n8n.hyundai-autoever...)
   - 옵션 c: ngrok/cloudflared 임시 터널

2. **초기 seenSolutionIds 마이그레이션** (§4.10)
   - 옵션 A: Schedule 경유 backfill_full 최초 1회 (추천)
   - 옵션 B: n8n staticData 수동 주입

3. **Webhook 모드 Teams 알림 범위**
   - 전체 매칭 포함 vs 상위 N건만

4. **API 라우트 `POST /api/solutions/refresh-all` 추가 여부**
   - Bearer Auth 보호 API 버전. 외부 시스템 통합 계획이 있으면 추가

---

**최종 메모:**

이번 설계는 **push(수동 갱신) + pull(스케줄 자동)** 하이브리드이며, 기존 v2.3 의 pull 기조를 유지하면서 "사용자가 필요할 때 즉시 점검" 요구사항을 UI 버튼 하나로 해결합니다. `lib/rematch.ts` 의 기존 `triggerFullBackfill` 코드를 재사용하므로 Worker 측 신규 로직은 최소화됩니다. 핵심 작업은 **n8n v2.4 워크플로 구성 (Phase 1)** 이며 복잡도가 가장 높습니다.
