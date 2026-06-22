// src/lib/password-policy.test.ts — validatePasswordPolicy 순수 함수 단위 테스트.
// 규칙: 길이 >= 10 AND 문자군(소문자·대문자·숫자·특수문자) 중 3종 이상.

import { describe, it, expect } from 'vitest'
import { validatePasswordPolicy, PASSWORD_POLICY_HINT } from './password-policy'

// ─────────────────────────────────────────────────────────────
// 1. 길이 경계
// ─────────────────────────────────────────────────────────────
describe('validatePasswordPolicy — 길이 경계', () => {
  it('9자(3종 충족)는 거부된다 — 길이 미달', () => {
    // Aa1bcdefg = 9자, 소문자+대문자+숫자(3종) 이지만 길이 부족
    const r = validatePasswordPolicy('Aa1bcdefg')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toBe(PASSWORD_POLICY_HINT)
  })

  it('정확히 10자 + 3종이면 통과한다 — 길이 경계', () => {
    // Aa1bcdefgh = 10자, 소문자+대문자+숫자(3종)
    expect(validatePasswordPolicy('Aa1bcdefgh')).toEqual({ ok: true })
  })

  it('빈 문자열은 거부된다', () => {
    expect(validatePasswordPolicy('').ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// 2. 문자군 다양성 — 통과 케이스
// ─────────────────────────────────────────────────────────────
describe('validatePasswordPolicy — 3종 이상 통과', () => {
  it('소문자+대문자+숫자(3종)는 통과한다', () => {
    expect(validatePasswordPolicy('Password12')).toEqual({ ok: true })
  })

  it('소문자+대문자+특수문자(3종)는 통과한다', () => {
    expect(validatePasswordPolicy('Password!!')).toEqual({ ok: true })
  })

  it('소문자+숫자+특수문자(3종)는 통과한다', () => {
    expect(validatePasswordPolicy('password1!')).toEqual({ ok: true })
  })

  it('4종 모두 포함하면 통과한다', () => {
    expect(validatePasswordPolicy('Passw0rd!@')).toEqual({ ok: true })
  })
})

// ─────────────────────────────────────────────────────────────
// 3. 문자군 다양성 — 2종 이하 거부
// ─────────────────────────────────────────────────────────────
describe('validatePasswordPolicy — 2종 이하 거부', () => {
  it('10자지만 소문자+대문자(2종)만이면 거부된다', () => {
    const r = validatePasswordPolicy('PasswordAbc')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toBe(PASSWORD_POLICY_HINT)
  })

  it('길이 충족 + 소문자만(1종)이면 거부된다', () => {
    const r = validatePasswordPolicy('abcdefghij')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toBe(PASSWORD_POLICY_HINT)
  })

  it('길이 충족 + 숫자만(1종)이면 거부된다', () => {
    const r = validatePasswordPolicy('1234567890')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toBe(PASSWORD_POLICY_HINT)
  })

  it('길이 충족 + 특수문자만(1종)이면 거부된다', () => {
    const r = validatePasswordPolicy('!@#$%^&*()')
    expect(r.ok).toBe(false)
  })

  it('길이 충족 + 숫자+특수문자(2종)만이면 거부된다', () => {
    expect(validatePasswordPolicy('1234!@#$%^').ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// 4. 특수문자 정의 경계 — 영숫자 아닌 모든 문자
// ─────────────────────────────────────────────────────────────
describe('validatePasswordPolicy — 특수문자 정의', () => {
  it('공백도 특수문자로 인정된다 (소문자+대문자+공백 → 3종)', () => {
    // 'Abc def ghi' = 11자, 소문자+대문자+공백(특수) = 3종
    expect(validatePasswordPolicy('Abc def ghi')).toEqual({ ok: true })
  })

  it('유니코드 한글은 특수문자로 인정된다 (소문자+대문자+한글 → 3종)', () => {
    // 'Abcdefgh가나' = 10자, 소문자+대문자+한글(영숫자 아님) = 3종
    expect(validatePasswordPolicy('Abcdefgh가나')).toEqual({ ok: true })
  })
})
