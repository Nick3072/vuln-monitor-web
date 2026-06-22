// v3.6 시각검증 — "장비 등록" 모달에서 그룹사 수동 입력 제거 + 활성 그룹 배지/전체 안내 확인.
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { SolutionsList } from '../src/views/solutions-list'

function render(activeGroup: string | null, role: 'admin' | 'operator', groups: string[]) {
  return String(
    SolutionsList({
      view: 'grouped',
      assets: [],
      solutions: [],
      matchesBySolution: new Map(),
      unlinkedCount: 0,
      assetOptions: [],
      groupSummaries: [{ name: '본사', total: 3, vulnerable: 1 }],
      activeGroup,
      activeCategory: null,
      activeImpact: null,
      activeMinSeverity: null,
      activeVulnStatus: null,
      activeQ: null,
      currentUser: { username: role === 'admin' ? 'admin' : 'sec.kim', role, groups },
    }),
  )
}

describe('장비 등록 모달 그룹사 자동화 렌더', () => {
  it('operator(활성=본사): 그룹사 수동 입력 없음 + 배지 표시', () => {
    const html = render('본사', 'operator', ['본사'])
    // 장비 등록 모달에 수동 그룹사 입력(asset-group)이 더 이상 없어야 함
    expect(html).not.toContain('id="asset-group"')
    expect(html).toContain('현재 진입한 그룹사로 등록됩니다')
    mkdirSync('verify', { recursive: true })
    writeFileSync('verify/preview-equipment-operator.html', html, 'utf-8')
  })

  it('admin(전체): 등록 비활성 + 안내', () => {
    const html = render(null, 'admin', [])
    expect(html).not.toContain('id="asset-group"')
    expect(html).toContain('특정 그룹사로 진입한 뒤 등록하세요')
    mkdirSync('verify', { recursive: true })
    writeFileSync('verify/preview-equipment-admin-all.html', html, 'utf-8')
  })
})
