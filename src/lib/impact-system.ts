// v3.3 영향시스템(impact_system) 도메인 로직 — 단일 진실 공급원.
// - 회사 공식 "영향 시스템" 6종은 운영자가 선택하는 폐쇄 집합(자유입력 경로 없음).
//   → 동의어 사전(synonym map) 두지 않음(YAGNI). CSV/폼 boundary 정규화는 화이트리스트로 충분.
// - 컴포넌트 집계 → 영향시스템 추론(deriveImpactSystem)은 Phase 2 에서 추가한다.

import type { ImpactSystem } from '../types'

// assets.impact_system 에 저장되는 코드값. 순서 = UI 표시 순서.
export const IMPACT_SYSTEMS = [
  'PC',
  'SERVER',
  'WEBWAS',
  'DATABASE',
  'NETWORK',
  'APPLICATION',
] as const

const IMPACT_SYSTEM_SET: ReadonlySet<string> = new Set(IMPACT_SYSTEMS)

// impact_system_source 허용값.
export const IMPACT_SYSTEM_SOURCES = ['derived', 'manual'] as const

/** 값이 유효한 영향시스템 코드인지 판별 (타입 가드). */
export function isValidImpactSystem(v: unknown): v is ImpactSystem {
  return typeof v === 'string' && IMPACT_SYSTEM_SET.has(v)
}

/**
 * 입력(폼/CSV)을 영향시스템 코드로 정규화. 유효하면 코드값, 아니면 null.
 * 화이트리스트 기반: 공백/구분자 제거 + 대문자화 후 매칭(예: "Web/WAS" → "WEBWAS", "network" → "NETWORK").
 * 동의어 사전이 아니라 표기 변형만 흡수한다.
 */
export function normalizeImpactSystem(v: unknown): ImpactSystem | null {
  if (typeof v !== 'string') return null
  const canonical = v.trim().toUpperCase().replace(/[\s/_-]+/g, '')
  return isValidImpactSystem(canonical) ? (canonical as ImpactSystem) : null
}

// ============================================================
// deriveImpactSystem — 컴포넌트 category 집계 → 영향시스템 추론 (단일 진실 공급원)
// ============================================================
// 카테고리 비교는 대소문자 무시(예: category-metadata.ts 의 'DDoS','Library','Crypto').
// 추론값은 "보조 힌트"다 — 운영자 수동값(source='manual')은 절대 덮지 않는다(recomputeImpactSystems).

// 네트워크 장비 신호 카테고리.
const NETWORK_CATS: ReadonlySet<string> = new Set(['FW', 'WAF', 'IPS', 'IDS', 'DDOS', 'VPN'])
// PC(단말) 후보로 허용되는 카테고리 — 이 집합 밖이 하나라도 있으면 서버로 본다.
const PC_HINT_CATS: ReadonlySet<string> = new Set(['OS', 'SW', 'EDR', 'CRYPTO', 'LIBRARY'])

/**
 * 컴포넌트 카테고리 집합으로부터 영향시스템 주 분류를 추론한다.
 * 컴포넌트가 없거나 판별 불가하면 null(미분류) 반환.
 *
 * 우선순위(2.3):
 *  1) 네트워크 장비(FW/WAF/IPS/IDS/DDoS/VPN) → NETWORK   ※ 1순위는 보안팀 워크로드 가정(2.4)
 *  2) WEB 또는 WAS                            → WEBWAS
 *  3) DB (단, WEB/WAS 없음)                    → DATABASE
 *  4) OS 보유: 단말 신호(EDR)+PC 후보뿐이면 PC, 아니면 SERVER
 *  5) OS 없이 SW/Library 단독                  → APPLICATION
 *  6) OS 없이 EDR 단독                         → PC
 */
export function deriveImpactSystem(components: { category: string }[]): ImpactSystem | null {
  if (components.length === 0) return null

  const cats: ReadonlySet<string> = new Set(
    components.map((c) => (c.category ?? '').trim().toUpperCase()).filter((c) => c.length > 0),
  )
  if (cats.size === 0) return null

  const has = (c: string): boolean => cats.has(c)
  const hasAnyNetwork = [...cats].some((c) => NETWORK_CATS.has(c))

  if (hasAnyNetwork) return 'NETWORK'
  if (has('WEB') || has('WAS')) return 'WEBWAS'
  if (has('DB')) return 'DATABASE'

  if (has('OS')) {
    const onlyPcCats = [...cats].every((c) => PC_HINT_CATS.has(c))
    if (has('EDR') && onlyPcCats) return 'PC'
    return 'SERVER'
  }

  if (has('SW') || has('LIBRARY')) return 'APPLICATION'
  if (has('EDR')) return 'PC'

  return null
}
