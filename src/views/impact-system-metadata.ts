// v3.3 영향시스템 표시 메타데이터 — 코드값 → 한국어 표시명/설명.
// 컴포넌트 택소노미(category-metadata.ts)와 물리적으로 분리한다(개념 혼동 방지).
//   - 저장/추론 로직은 src/lib/impact-system.ts
//   - 화면 표시는 이 파일

import type { ImpactSystem } from '../types'
import { IMPACT_SYSTEMS } from '../lib/impact-system'

export interface ImpactSystemMeta {
  code: ImpactSystem
  label: string // 한국어 표시명
  description: string
}

export const IMPACT_SYSTEM_METADATA: Record<ImpactSystem, ImpactSystemMeta> = {
  PC: { code: 'PC', label: 'PC', description: '업무용 단말 / 엔드포인트' },
  SERVER: { code: 'SERVER', label: 'Server', description: '범용 서버 (OS 기반)' },
  WEBWAS: { code: 'WEBWAS', label: 'Web/WAS', description: '웹서버 · 애플리케이션 서버' },
  DATABASE: { code: 'DATABASE', label: 'Database', description: '데이터베이스 시스템' },
  NETWORK: { code: 'NETWORK', label: 'Network', description: '네트워크 / 보안 장비' },
  APPLICATION: { code: 'APPLICATION', label: 'Application', description: '애플리케이션 / 미들웨어' },
}

/** 코드값 → 한국어 표시명. 미설정(null)·미지정 코드는 '미분류'/원문. */
export function impactSystemLabel(code: string | null | undefined): string {
  if (!code) return '미분류'
  const meta = IMPACT_SYSTEM_METADATA[code as ImpactSystem]
  return meta ? meta.label : code
}

// UI 표시 순서(IMPACT_SYSTEMS 와 동일).
export const IMPACT_SYSTEM_OPTIONS: ImpactSystemMeta[] = IMPACT_SYSTEMS.map(
  (code) => IMPACT_SYSTEM_METADATA[code],
)
