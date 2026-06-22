// v3.3 비밀번호 정책 검증 — 길이 + 문자군 다양성.
// 규칙: 길이 >= 10 AND 4종 문자군(소문자·대문자·숫자·특수문자) 중 3종 이상 포함.
// 외부 의존성 없는 순수 함수 — Workers/테스트 양쪽에서 동일하게 동작.

const MIN_LENGTH = 10 // 최소 길이
const MIN_CHARACTER_CLASSES = 3 // 충족해야 하는 문자군 종류 수

export const PASSWORD_POLICY_HINT =
  '비밀번호는 최소 10자이며, 영문 대문자·소문자·숫자·특수문자 중 3종 이상을 포함해야 합니다.'

/**
 * 비밀번호가 정책을 만족하는지 검증한다.
 * - 길이 >= 10
 * - 소문자[a-z] / 대문자[A-Z] / 숫자[0-9] / 특수문자(영숫자 아님) 중 3종 이상 포함
 *
 * 위반 시 { ok:false, error } — error 는 PASSWORD_POLICY_HINT 를 활용한 한국어 메시지.
 */
export function validatePasswordPolicy(
  pw: string,
): { ok: true } | { ok: false; error: string } {
  // 외부 데이터 신뢰 금지: 문자열이 아니거나 비어 있으면 즉시 위반 처리
  if (typeof pw !== 'string' || pw.length < MIN_LENGTH) {
    return { ok: false, error: PASSWORD_POLICY_HINT }
  }

  const hasLower = /[a-z]/.test(pw)
  const hasUpper = /[A-Z]/.test(pw)
  const hasDigit = /[0-9]/.test(pw)
  // 특수문자 = 영문 대소문자·숫자가 아닌 모든 문자(공백 포함)
  const hasSpecial = /[^a-zA-Z0-9]/.test(pw)

  const classCount = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length

  if (classCount < MIN_CHARACTER_CLASSES) {
    return { ok: false, error: PASSWORD_POLICY_HINT }
  }

  return { ok: true }
}
