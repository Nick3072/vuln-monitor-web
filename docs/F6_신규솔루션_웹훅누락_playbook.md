# F6. 신규 솔루션 등록 시 Webhook 누락 — 재구축 Playbook

> ⚠️ **SUPERSEDED BY F7** (2026-04-24)
> 이 문서는 "Worker → n8n push (triggerRematch)" 가정 하에 작성되었으나,
> 실제 n8n v2.3 워크플로는 **Schedule Trigger 기반 pull 아키텍처**로 동작함이 확인됨.
> 최신 계획은 [F7_하이브리드트리거_playbook.md](F7_하이브리드트리거_playbook.md) 를 따라 진행.
> 본 문서는 **push 모델 전환 필요 시 참고용 아카이브**로 보존.

> **관찰용 Playbook** — 각 Phase의 명령어는 그대로 복사·붙여넣기 가능.
> 각 Phase 끝의 `[ ]` 체크박스를 수동으로 `[x]` 로 전환하면서 진행 상태 추적.
>
> **작성일:** 2026-04-24
> **담당 ECC Skills:** `ecc:plan` → `ecc:code-architect` → `ecc:typescript-reviewer` → `ecc:security-reviewer` → `ecc:verification-loop`
> **프로젝트:** `c:/Users/cksgu/OneDrive/Desktop/DevTool/CloudFlare/vuln-monitor-web`

---

## 0. 증상 요약

| 기대 동작 | 실제 동작 |
|-----------|-----------|
| UI "+ 새 솔루션 등록" → n8n 웹훅 발사 → 벤더 1년치 크롤링 → CVE 매칭 → 해당 행 붉은 음영 | DB에 INSERT 되고 끝. 웹훅 미발사. `is_vulnerable=0` 그대로. |
| `POST /api/solutions` (API) 로 등록 시에도 동일 동작 | API 경로는 정상 작동 (`triggerRematch` 호출됨) |

---

## 1. 원인 분석 (완료)

### 1.1 핵심 버그

`src/routes/web.tsx:211-241` 의 웹 폼 핸들러는 DB INSERT 만 수행하고 `triggerRematch()` 호출이 누락되어 있음.

```ts
// ❌ 현재 (web.tsx:238-241)
await writeAudit(db, 'create', 'solutions', newId, 'web', parsed)
return redirectFlash(c, 'success', `${parsed.vendor} ${parsed.product} 등록 완료`)
// → triggerRematch() 호출 없음!
```

반면 `src/routes/solutions.ts:142-157` (API) 는 정상 호출.

```ts
// ✅ API 경로 (solutions.ts:142-157) — 참고용
c.executionCtx.waitUntil(
  triggerRematch(c.env, newId)
    .then((result) => writeAudit(db, result.ok ? 'rematch_requested' : 'rematch_request_failed', ...))
)
```

### 1.2 잠재 원인(진단 필요)

- [ ] `wrangler secret` 에 `N8N_REMATCH_WEBHOOK_URL` 미설정
- [ ] Worker 쪽 `N8N_REMATCH_SECRET` ≠ docker `.env` 의 `N8N_REMATCH_SECRET`
- [ ] n8n `v2.4 rematch-on-demand` 워크플로 Active=false
- [ ] n8n Webhook path 변경됨 (Worker가 호출하는 URL 과 워크플로의 Path 불일치)

---

## 2. Phase 1: 진단 (Diagnosis)

> **목적:** 코드 수정 전에 환경 측 원인을 먼저 배제한다.

### 2.1 Worker 시크릿 확인

```bash
cd c:/Users/cksgu/OneDrive/Desktop/DevTool/CloudFlare/vuln-monitor-web
npx wrangler secret list
```

**기대 출력:**
```
┌──────────────────────────┐
│ Name                     │
├──────────────────────────┤
│ API_KEY                  │
│ N8N_REMATCH_WEBHOOK_URL  │
│ N8N_REMATCH_SECRET       │
│ N8N_BACKFILL_WEBHOOK_URL │
└──────────────────────────┘
```

- [ ] `N8N_REMATCH_WEBHOOK_URL` 존재 확인
- [ ] `N8N_REMATCH_SECRET` 존재 확인
- [ ] 누락 시 → Phase 3 로 이동

### 2.2 audit_log 에서 마지막 rematch 시도 확인

```bash
npx wrangler d1 execute vuln-monitor-db --remote --command="SELECT id, action, target_id, actor, payload_json, created_at FROM audit_log WHERE action LIKE 'rematch%' ORDER BY id DESC LIMIT 10;"
```

- [ ] 최근 새 솔루션 등록(create) 이후 `rematch_requested` 또는 `rematch_request_failed` 행이 있는지 확인
- [ ] `rematch_request_failed` 가 있으면 → `payload_json` 안의 `result.error` 확인 (예: `"N8N webhook not configured"` 면 시크릿 누락, `"n8n status 404"` 면 n8n path 오류)

### 2.3 최근 create 이벤트 확인

```bash
npx wrangler d1 execute vuln-monitor-db --remote --command="SELECT id, action, target_table, target_id, actor, created_at FROM audit_log WHERE action='create' AND target_table='solutions' ORDER BY id DESC LIMIT 5;"
```

- [ ] `actor='web'` 으로 생성된 솔루션이 있는지 확인 → 있다면 UI 경로 버그 확정

### 2.4 n8n 워크플로 상태 확인

브라우저에서 `http://localhost:5678` 접속 → `v2.4_vuln-rematch-on-demand` 워크플로 Active 토글 확인.

- [ ] Active = ON
- [ ] Webhook 노드의 Path 가 Worker 호출 URL 과 일치 (예: `/webhook/vuln-rematch`)

---

## 3. Phase 2: 시크릿 재설정 (필요시)

> Phase 1 에서 시크릿이 누락되었거나 불일치한 경우에만 수행.

### 3.1 공유 시크릿 값 확인

```bash
cat c:/Users/cksgu/OneDrive/Desktop/DevTool/CloudFlare/n8n/.env | grep N8N_REMATCH_SECRET
```

docker `.env` 의 값 = `s5OaZ3SN2t7xWujlYChe10gUw4GcLEVX` (이미 확인됨).

### 3.2 Worker 시크릿 등록

```bash
cd c:/Users/cksgu/OneDrive/Desktop/DevTool/CloudFlare/vuln-monitor-web

# (1) n8n 웹훅 URL — 실제 배포된 n8n URL 로 교체
npx wrangler secret put N8N_REMATCH_WEBHOOK_URL
# 프롬프트 입력: https://<n8n-host>/webhook/vuln-rematch

# (2) 공유 시크릿 — docker .env 와 동일한 값
npx wrangler secret put N8N_REMATCH_SECRET
# 프롬프트 입력: s5OaZ3SN2t7xWujlYChe10gUw4GcLEVX

# (3) (선택) 전체 백필 웹훅
npx wrangler secret put N8N_BACKFILL_WEBHOOK_URL
# 프롬프트 입력: https://<n8n-host>/webhook/vuln-full-backfill
```

- [ ] `N8N_REMATCH_WEBHOOK_URL` 재등록
- [ ] `N8N_REMATCH_SECRET` 재등록
- [ ] `wrangler secret list` 로 재확인

### 3.3 docker compose 재기동 (env 적용)

```bash
cd c:/Users/cksgu/OneDrive/Desktop/DevTool/CloudFlare/n8n
docker compose down
docker compose up -d
docker logs n8n --tail 50
```

- [ ] n8n 컨테이너 `Ready` 로그 확인

---

## 4. Phase 3: 코드 수정 (핵심 버그 픽스)

> **ECC Skill:** `ecc:code-architect` 로 설계 → 직접 edit → `ecc:typescript-reviewer` 로 검토

### 4.1 변경 대상

**파일:** `src/routes/web.tsx`
**위치:** `POST /solutions` 핸들러 (L211-L241)

### 4.2 수정 내용

**① import 추가** (L6 근처):

```ts
import { triggerRematch } from '../lib/rematch'
```

**② 핸들러 내부 수정** (L238 `writeAudit(...'create'...)` 직후):

```ts
await writeAudit(db, 'create', 'solutions', newId, 'web', parsed)

// Fire-and-forget: 1-year rematch via n8n webhook.
// waitUntil 로 응답을 지연시키지 않음.
c.executionCtx.waitUntil(
  triggerRematch(c.env, newId)
    .then((result) =>
      writeAudit(
        db,
        result.ok ? 'rematch_requested' : 'rematch_request_failed',
        'solutions',
        newId,
        'web',
        { solution_id: newId, window_days: 365, source: 'web-create', result },
      ),
    )
    .catch(() => {
      // waitUntil must not reject — writeAudit already swallows internal errors.
    }),
)

return redirectFlash(c, 'success', `${parsed.vendor} ${parsed.product} 등록 완료 — 1년치 CVE 매칭 요청됨`)
```

### 4.3 (선택) 수정 핸들러도 rematch 지원

**파일:** `src/routes/web.tsx`
**위치:** `POST /solutions/:id` 핸들러 (L243-L282)

버전(current_version) 이 변경되었을 때만 rematch 를 발사하도록:

```ts
// update 직후에
const versionChanged = /* 기존 row.current_version !== parsed.current_version */ 로 판단
if (versionChanged) {
  c.executionCtx.waitUntil(
    triggerRematch(c.env, id).then((result) =>
      writeAudit(db, result.ok ? 'rematch_requested' : 'rematch_request_failed',
        'solutions', id, 'web', { solution_id: id, source: 'web-update', result }),
    ).catch(() => {}),
  )
}
```

> **주의:** 위 패치를 적용하려면 `UPDATE` 전에 기존 row 를 SELECT 해서 `current_version` 비교가 필요함. 필수 아님 — 추후 별도 스프린트에서 처리 가능.

### 4.4 체크리스트

- [ ] `import { triggerRematch }` 추가
- [ ] `POST /solutions` 에 `waitUntil(triggerRematch(...))` 추가
- [ ] flash 메시지에 "1년치 CVE 매칭 요청됨" 문구 추가
- [ ] (선택) `POST /solutions/:id` 도 버전 변경 시 rematch 발사

---

## 5. Phase 4: 빌드 및 로컬 검증

### 5.1 타입 체크

```bash
cd c:/Users/cksgu/OneDrive/Desktop/DevTool/CloudFlare/vuln-monitor-web
npx tsc --noEmit --pretty false
```

- [ ] EXIT=0

### 5.2 로컬 dev 서버 기동

```bash
npx wrangler dev --local
```

별도 터미널에서:

```bash
curl -i http://localhost:8787/api/health
# → 200, {"success":true,"data":{"status":"ok",...}}
```

- [ ] 로컬 서버 기동 확인

---

## 6. Phase 5: 배포

```bash
cd c:/Users/cksgu/OneDrive/Desktop/DevTool/CloudFlare/vuln-monitor-web
npx wrangler deploy --minify
```

- [ ] 배포 성공, URL 응답 확인
- [ ] 배포 버전(커밋 해시/버전 ID) 기록: `____________________`

---

## 7. Phase 6: E2E 검증

### 7.1 신규 솔루션 등록 (UI)

1. 브라우저에서 `https://vuln-monitor-web.<account>.workers.dev/solutions` 접속
2. "+ 새 솔루션 등록" 클릭
3. 예시 입력:
   - 벤더: `Fortinet`
   - 제품: `FortiOS`
   - 카테고리: `FW`
   - 버전: `7.4.1`
   - 그룹사: `테스트`
4. 등록 버튼 클릭

- [ ] flash 메시지에 "1년치 CVE 매칭 요청됨" 표시

### 7.2 audit_log 확인 (즉시)

```bash
npx wrangler d1 execute vuln-monitor-db --remote --command="SELECT id, action, target_id, actor, payload_json, created_at FROM audit_log WHERE target_table='solutions' ORDER BY id DESC LIMIT 5;"
```

- [ ] `create` (actor=web) 행 존재
- [ ] `rematch_requested` (actor=web) 행 존재 — `result: { ok: true }`

> ❌ `rematch_request_failed` 가 보이면 → `payload_json.result.error` 로 원인 분기:
> - `N8N webhook not configured` → Phase 3 재확인
> - `n8n status 404` → n8n workflow Path 불일치
> - `n8n status 401` → `N8N_REMATCH_SECRET` 값 불일치
> - `n8n webhook request failed` → 네트워크/DNS 문제

### 7.3 n8n 실행 로그 확인

브라우저 `http://localhost:5678` → `Executions` 탭 → 최근 실행(`v2.4 rematch-on-demand`) 클릭.

- [ ] Webhook 노드 입력에 `{"solution_id": <id>, "window_days": 365}` 확인
- [ ] OpenCVE 크롤링 노드 정상 실행
- [ ] `HTTP - POST D1 Match` 노드에서 matched_vulns 업로드 성공 (HTTP 200)

### 7.4 매칭 결과 확인 (3-10분 대기 후)

```bash
# 최근 업로드된 매칭
npx wrangler d1 execute vuln-monitor-db --remote --command="SELECT solution_id, cve_id, severity, published, detected_at FROM matched_vulns WHERE solution_id=(SELECT MAX(id) FROM solutions) ORDER BY published DESC LIMIT 20;"

# 솔루션 취약 플래그
npx wrangler d1 execute vuln-monitor-db --remote --command="SELECT id, vendor, product, is_vulnerable, last_matched_cve, last_matched_at FROM solutions ORDER BY id DESC LIMIT 5;"
```

- [ ] matched_vulns 에 CVE 1건 이상 적재됨
- [ ] solutions.is_vulnerable = 1
- [ ] solutions.last_matched_cve / last_matched_at 채워짐

### 7.5 UI 붉은 음영 확인

`https://vuln-monitor-web.<account>.workers.dev/solutions` 새로고침.

- [ ] 방금 등록한 Fortinet FortiOS 행이 **`bg-red-lt`** 클래스로 붉은 음영 표시됨
- [ ] 상태 컬럼에 `status-red` 배지와 최신 CVE ID 표시됨
- [ ] CVE 2건 이상이면 "총 N건" 배지 표시됨

---

## 8. Phase 7: 코드 리뷰 & 보안 점검

### 8.1 ecc:typescript-reviewer

```
# Claude 에 대고 입력:
/typescript-reviewer src/routes/web.tsx 의 POST /solutions 핸들러 변경분 리뷰해줘
```

- [ ] CRITICAL/HIGH 이슈 0건

### 8.2 ecc:security-reviewer

```
/security-review src/routes/web.tsx 변경분에 대해
```

체크 항목:
- [ ] `triggerRematch` 호출이 인증(bearerAuth) 미들웨어 바깥 경로에서 발생하지만, 폼 자체는 CSRF 보호를 별도 계층에서 담당하고 있는지 확인
- [ ] `result.error` 가 audit_log 에만 기록되고 사용자 응답으로 노출되지 않는지 확인 (lib/rematch.ts 는 이미 URL 누출 방지 처리됨)
- [ ] flash 메시지에 내부 에러가 누출되지 않는지 확인

### 8.3 회귀 테스트

```bash
# 기존 API 경로도 여전히 동작하는지
curl -i -X POST "https://vuln-monitor-web.<account>.workers.dev/api/solutions" \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"vendor":"Paloalto","product":"PAN-OS","category":"FW","current_version":"12.1.1"}'
```

- [ ] 201 Created
- [ ] audit_log 에 `actor=api` + `rematch_requested` 기록

---

## 9. Phase 8: 롤백 플랜

변경은 `src/routes/web.tsx` 단일 파일에 국한됨.

```bash
# 롤백 (배포 히스토리 사용)
npx wrangler rollback --message "revert: F6 rematch on web create"
```

또는 git 기반 롤백:

```bash
git revert <F6-commit-sha>
npx wrangler deploy --minify
```

- [ ] 롤백 절차 명시됨

---

## 10. 완료 기준 (DoD)

- [ ] Phase 2.1: 시크릿 3개 모두 설정
- [ ] Phase 2.3: 최근 `create (actor=web)` 이벤트 확인
- [ ] Phase 3: 코드 수정 + tsc noEmit 통과
- [ ] Phase 6: 배포 성공
- [ ] Phase 7.1: 웹 UI 등록 → flash 성공 메시지
- [ ] Phase 7.2: `rematch_requested (actor=web, ok:true)` audit_log 1건
- [ ] Phase 7.3: n8n 실행 성공 (webhook → crawler → POST D1 Match)
- [ ] Phase 7.4: matched_vulns 적재 + solutions.is_vulnerable=1
- [ ] Phase 7.5: UI 붉은 음영 + CVE 배지 표시
- [ ] Phase 8: 회귀 테스트 API 경로 여전히 작동

---

## 11. 추가 개선 (백로그)

- [ ] `POST /solutions/:id` (UPDATE) 에서 버전 변경 시 자동 rematch (§4.3)
- [ ] rate-limit 을 현재 5분 → solution_id 별 1시간으로 확장 (중복 크롤링 방지)
- [ ] audit_log → Cloudflare Logpush 로 장기 보존
- [ ] n8n 워크플로 v2.5: backfill progress 알림 (크롤링 중/완료 시 UI 폴링용 엔드포인트)

---

## 12. 사용한 ECC Skills 요약

| Phase | Skill | 목적 |
|-------|-------|------|
| 계획 수립 | `ecc:plan` | 요구사항 재진술 + Phase 분해 |
| 설계 검증 | `ecc:code-architect` (선택) | web.tsx 변경 범위 영향 분석 |
| 구현 | 직접 Edit | `src/routes/web.tsx` 패치 |
| TS 검토 | `ecc:typescript-reviewer` | 변경 diff 전용 리뷰 |
| 보안 검토 | `ecc:security-reviewer` | 시크릿 누출/CSRF/에러 누출 |
| 최종 검증 | `ecc:verification-loop` | E2E Phase 6 자동화 확장 (선택) |

---

**작성자 메모:**
이 Playbook 은 "재구축" 이라기보다는 **웹 폼 핸들러 1개 파일의 누락 호출 복구** 가 핵심입니다. n8n 워크플로, DB 스키마, 뷰 코드는 이미 v2.3 Playbook 에서 완성되어 있으며 변경 불필요. 따라서 실제 변경은 `src/routes/web.tsx` 몇 줄 + 시크릿 검증 + E2E 검증 순서로 진행합니다.
