// v3.6 공용 HTTP 유틸 — 로그인/그룹선택 리다이렉트가 동일 새너타이저를 쓰도록 추출.
// (이전엔 routes/auth.tsx 내부에만 있어 groups.tsx 와 중복될 위험 → 단일 출처화.)

// 같은 출처 내부 경로만 허용 — 첫 글자는 '/' + 두번째는 '/'·'\\' 가 아니어야 함.
//   ('//evil.com' 프로토콜상대 + '/\\evil.com'(브라우저가 '//' 로 정규화) 모두 차단)
const SAFE_NEXT_RE = /^\/[^/\\]/

// 그룹 선택/관리 경로 — next 가 여기로 오면 선택 후 재진입 시 자기 루프가 되므로 폴백.
const SELECTION_PATHS = ['/select-group', '/groups']

// 제어문자(개행/탭/NUL 등) 포함 여부 — 헤더 인젝션·오픈리다이렉트 우회 차단.
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

/**
 * open-redirect 방지: 같은 출처 내부의 절대 경로만 허용. 그 외엔 fallback('/').
 */
export function safeNext(raw: string | undefined | null): string {
  if (!raw) return '/'
  if (raw.length > 512) return '/'
  if (hasControlChars(raw)) return '/'
  if (!SAFE_NEXT_RE.test(raw)) return '/'
  return raw
}

/**
 * 그룹 활성화 후 이동 대상 결정 — safeNext 통과 + 선택/그룹 경로면 '/' 로 폴백(루프 방지).
 */
export function safeNextAfterSelection(raw: string | undefined | null): string {
  const next = safeNext(raw)
  if (SELECTION_PATHS.some((p) => next === p || next.startsWith(p + '/') || next.startsWith(p + '?'))) {
    return '/'
  }
  return next
}
