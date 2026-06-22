// src/lib/impact-system.test.ts — deriveImpactSystem 순수 함수 + 정규화 단위 테스트.

import { describe, it, expect } from 'vitest'
import { deriveImpactSystem, normalizeImpactSystem, isValidImpactSystem } from './impact-system'

const c = (...cats: string[]) => cats.map((category) => ({ category }))

describe('deriveImpactSystem', () => {
  it('네트워크 장비 카테고리는 NETWORK', () => {
    expect(deriveImpactSystem(c('FW'))).toBe('NETWORK')
    expect(deriveImpactSystem(c('WAF', 'WEB'))).toBe('NETWORK') // 1순위 편향: WAF+WEB → NETWORK
    expect(deriveImpactSystem(c('VPN', 'OS'))).toBe('NETWORK')
    expect(deriveImpactSystem(c('DDoS'))).toBe('NETWORK') // 대소문자 무시
  })

  it('WEB/WAS 보유 → WEBWAS', () => {
    expect(deriveImpactSystem(c('WEB', 'OS', 'Crypto'))).toBe('WEBWAS')
    expect(deriveImpactSystem(c('WAS', 'DB', 'OS'))).toBe('WEBWAS') // WAS 우선(DB보다)
  })

  it('DB 보유 + WEB/WAS 없음 → DATABASE', () => {
    expect(deriveImpactSystem(c('DB', 'OS'))).toBe('DATABASE')
    expect(deriveImpactSystem(c('DB', 'Crypto'))).toBe('DATABASE')
  })

  it('OS 일반 서버 → SERVER', () => {
    expect(deriveImpactSystem(c('OS'))).toBe('SERVER')
    expect(deriveImpactSystem(c('OS', 'SW', 'HW'))).toBe('SERVER') // HW 는 PC 후보 밖 → 서버
  })

  it('OS + EDR + PC 후보 카테고리만 → PC', () => {
    expect(deriveImpactSystem(c('OS', 'EDR'))).toBe('PC')
    expect(deriveImpactSystem(c('OS', 'EDR', 'SW', 'Crypto'))).toBe('PC')
  })

  it('OS 없이 SW/Library 단독 → APPLICATION', () => {
    expect(deriveImpactSystem(c('SW'))).toBe('APPLICATION')
    expect(deriveImpactSystem(c('Library'))).toBe('APPLICATION')
  })

  it('OS 없이 EDR 단독 → PC', () => {
    expect(deriveImpactSystem(c('EDR'))).toBe('PC')
  })

  it('컴포넌트 없음/판별 불가 → null', () => {
    expect(deriveImpactSystem([])).toBeNull()
    expect(deriveImpactSystem(c('Other'))).toBeNull()
    expect(deriveImpactSystem(c(''))).toBeNull()
  })
})

describe('normalizeImpactSystem', () => {
  it('표기 변형을 코드값으로 흡수', () => {
    expect(normalizeImpactSystem('Web/WAS')).toBe('WEBWAS')
    expect(normalizeImpactSystem('network')).toBe('NETWORK')
    expect(normalizeImpactSystem(' Database ')).toBe('DATABASE')
  })
  it('유효하지 않으면 null', () => {
    expect(normalizeImpactSystem('SwitchGear')).toBeNull()
    expect(normalizeImpactSystem(null)).toBeNull()
    expect(normalizeImpactSystem(42)).toBeNull()
  })
})

describe('isValidImpactSystem', () => {
  it('코드값만 통과', () => {
    expect(isValidImpactSystem('SERVER')).toBe(true)
    expect(isValidImpactSystem('server')).toBe(false) // 정규화 안 함
    expect(isValidImpactSystem('FOO')).toBe(false)
  })
})
