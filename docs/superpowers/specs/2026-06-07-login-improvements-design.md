# 로그인 개선 설계 — 본인 비밀번호 변경 · 로그인 보안 · 로그인 UX

- 날짜: 2026-06-07
- 대상: `vuln-monitor-web` (Cloudflare Workers + Hono + hono/jsx + D1)
- 범위(사용자 확정): **A1** 본인 비밀번호 변경 · **B1+B3** 레이트리밋+감사 로깅 · **C1~C4** 로그인 페이지 UX
- 범위 외(권고만): B2 Turnstile, B4 TOTP, B5 마지막 로그인 표시(부분 반영), C5 다크모드, D1 `GET /logout` CSRF 제거

## 확정된 결정

1. **로그인 시도 저장**: D1 신규 테이블 `login_attempts` (B1·B3 공유). 보존 90일, 로그인 성공 시 기회적 정리.
2. **레이트리밋 정책**: `IP + username` 조합 기준, 최근 15분 내 5회 실패 → 약 15분 임시 차단(시간 경과 시 자동 해제). 영구 잠금 없음.
3. **비밀번호 정책**: 최소 10자 + {대문자·소문자·숫자·특수} 4종 중 3종 이상. 생성·부트스트랩·관리자 수정·본인 변경 4곳 공통.
4. **본인 변경 UX**: 현재 비번 확인 필수 + 변경 후 세션 자동 재발급(로그아웃 안 됨).
5. **C 항목**: C1 시스템 소개+도움말, C2 관리자 연락처 동적화(`ADMIN_CONTACT` env), C3 비번 표시 토글, C4 Caps Lock 경고.

## 인터페이스 계약 (에이전트 공통 기준)

### `migrations/0010_login_security.sql`
```sql
CREATE TABLE IF NOT EXISTS login_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT,
  ip          TEXT,
  user_agent  TEXT,
  success     INTEGER NOT NULL,
  reason      TEXT,                 -- 'ok'|'bad_credentials'|'inactive'|'locked'|'system_blocked'
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_la_ip_user_time ON login_attempts(ip, username, created_at);
CREATE INDEX IF NOT EXISTS idx_la_time         ON login_attempts(created_at);
```

### `lib/password-policy.ts`
```ts
export const PASSWORD_POLICY_HINT: string
export function validatePasswordPolicy(pw: string): { ok: true } | { ok: false; error: string }
// 길이 >= 10 AND [a-z],[A-Z],[0-9],[기타] 4종 중 3종 이상
```

### `lib/login-attempts.ts`
```ts
export const MAX_FAILURES = 5
export const WINDOW_MINUTES = 15
export const RETENTION_DAYS = 90
export interface RecordAttemptInput {
  username: string | null; ip: string | null; userAgent: string | null
  success: boolean; reason: string
}
export async function recordAttempt(db: D1Database, input: RecordAttemptInput): Promise<void> // never throws
export async function isLockedOut(db: D1Database, key: { ip: string | null; username: string | null }): Promise<boolean>
// COUNT WHERE ip=? AND username=? AND success=0 AND reason<>'locked' AND created_at > datetime('now','-15 minutes') >= 5
export async function cleanupOldAttempts(db: D1Database): Promise<void> // DELETE < now-90d, never throws
```

### `views/auth-enhance.ts`
```ts
export const AUTH_FORM_SCRIPT: string // 외부 의존성 없는 순수 JS 문자열
```
비번 입력 UX 규약(login·account 공용 마크업):
```html
<div class="input-group input-group-flat">
  <input type="password" id="<id>" ... />
  <span class="input-group-text">
    <a href="#" class="link-secondary js-pw-toggle" data-target="#<id>" aria-label="비밀번호 표시"><i class="ti ti-eye"></i></a>
  </span>
</div>
<small class="form-hint text-warning d-none js-capslock"><i class="ti ti-alert-triangle me-1"></i>Caps Lock이 켜져 있습니다.</small>
```
- 스크립트는 `.js-pw-toggle` 클릭 시 `data-target` input type 토글(password↔text) + 아이콘(ti-eye↔ti-eye-off).
- `type=password` input에서 `getModifierState('CapsLock')` 감지 시 같은 폼의 `.js-capslock` `d-none` 토글.
- 뷰에서는 `<script dangerouslySetInnerHTML={{ __html: AUTH_FORM_SCRIPT }} />` 로 주입(이스케이프 회피).

### `views/login.tsx` — LoginPageProps
```ts
interface LoginPageProps {
  error?: string | null; next?: string | null; flash?: string | null
  adminContact?: string | null  // NEW (C2)
  helpUrl?: string | null        // NEW (C1)
}
```

### `types.ts` — Bindings 추가
```ts
ADMIN_CONTACT?: string
HELP_URL?: string
```
및 `LoginAttempt` 인터페이스(테이블 매핑).

### `routes/account.tsx` (신규, 보호 라우트)
- `GET /account` → AccountPage(아이디·역할·담당 그룹사·마지막 로그인 + 비번 변경 폼)
- `POST /account/password` → 현재 비번 검증 → 정책 검증 → `updateUser({new_password})`(session_version++) → **새 sver로 세션 쿠키 재발급** → flash. `writeAudit('password_self_change', ...)`.
- `index.ts` `protectedApp.route('/account', account)`.

## 변경 파일
| 신규 | 수정 |
|------|------|
| `migrations/0010_login_security.sql` | `routes/auth.tsx` |
| `lib/login-attempts.ts` (+test) | `views/login.tsx` |
| `lib/password-policy.ts` (+test) | `views/layout.tsx` |
| `views/auth-enhance.ts` | `routes/admin.tsx` |
| `routes/account.tsx` | `types.ts` |
| `views/account.tsx` | `index.ts` |

## 특이사항/운영 주의
- 마이그레이션은 배포 시 `wrangler d1 migrations apply` 필요(자동 아님).
- `ADMIN_CONTACT`/`HELP_URL`은 선택 env. 미설정 시 기존 문구/숨김 폴백.
- `CF-Connecting-IP` 부재(로컬) 시 IP 기준 잠금은 동작하지 않음(프로덕션 CF에선 항상 존재).
- `GET /logout` CSRF는 본 범위 외 — 후속 권고.
