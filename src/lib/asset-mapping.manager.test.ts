// v3.4 부서(owner)/담당자(manager) 분리 — 장비 입력 → 솔루션 분해 시 전파 검증.

import { describe, it, expect } from 'vitest'
import {
  mapEquipmentToSolutions,
  validateEquipmentInput,
  csvRowToEquipmentRaw,
} from './asset-mapping'

describe('manager(담당자) 전파', () => {
  it('mapEquipmentToSolutions 가 owner/manager 를 모든 컴포넌트에 공유한다', () => {
    const sols = mapEquipmentToSolutions({
      vendor: 'Fortinet',
      model: 'FortiGate-100F',
      hostname: 'fw-01',
      os_version: '7.4.1',
      openssl_version: '1.1.1k',
      owner: '보안팀',
      manager: '홍길동',
    })
    expect(sols.length).toBeGreaterThanOrEqual(2)
    for (const s of sols) {
      expect(s.owner).toBe('보안팀')
      expect(s.manager).toBe('홍길동')
    }
  })

  it('validateEquipmentInput 가 manager 를 파싱한다', () => {
    const r = validateEquipmentInput({
      vendor: 'V',
      model: 'M',
      hostname: 'h',
      os_version: '1.0',
      owner: '인프라팀',
      manager: '김철수',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.owner).toBe('인프라팀')
      expect(r.value.manager).toBe('김철수')
    }
  })

  it('csvRowToEquipmentRaw 가 manager 컬럼을 매핑한다', () => {
    const raw = csvRowToEquipmentRaw({
      vendor: 'V',
      model: 'M',
      hostname: 'h',
      os_version: '1.0',
      owner: '웹팀',
      manager: '이영희',
    })
    expect(raw.owner).toBe('웹팀')
    expect(raw.manager).toBe('이영희')
  })
})
