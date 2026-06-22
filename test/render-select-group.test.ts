// v3.6 시각검증 렌더 — 그룹사 선택 화면(admin/operator/empty) + operator 스코프 대시보드.
// JSX → 정적 HTML 로 렌더해 verify/*.html 생성. 스크린샷은 verify/screenshot-select-group.mjs 로 촬영.
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { SelectGroupPage, type GroupCardData } from '../src/views/select-group'
import { Dashboard } from '../src/views/dashboard'

const adminGroups: GroupCardData[] = [
  { name: '본사', assetCount: 24, solutionCount: 61, vulnerableCount: 12 },
  { name: '자회사A', assetCount: 8, solutionCount: 19, vulnerableCount: 0 },
  { name: '신규그룹(빈)', assetCount: 0, solutionCount: 0, vulnerableCount: 0 },
]

describe('그룹사 선택 화면 시각검증', () => {
  it('admin — 전체/미분류/그룹 카드 + 삭제 버튼 → verify/preview-select-group-admin.html', () => {
    const el = SelectGroupPage({
      groups: adminGroups,
      currentUser: { username: 'admin', role: 'admin', id: 1 },
      isAdmin: true,
      next: '/',
      flash: null,
      error: null,
      systemBucketCount: 3,
    })
    const html = String(el)
    expect(html).toContain('그룹사 선택')
    expect(html).toContain('전체 현황 보기')
    expect(html).toContain('미분류 (system)')
    expect(html).toContain('본사')
    mkdirSync('verify', { recursive: true })
    writeFileSync('verify/preview-select-group-admin.html', html, 'utf-8')
  })

  it('operator — 본인 그룹만, 전체/미분류 없음 → verify/preview-select-group-operator.html', () => {
    const el = SelectGroupPage({
      groups: [{ name: '본사', assetCount: 24, solutionCount: 61, vulnerableCount: 12 }],
      currentUser: { username: 'sec.kim', role: 'operator', id: 2 },
      isAdmin: false,
      next: '/',
      flash: 'created',
      error: null,
    })
    const html = String(el)
    expect(html).toContain('본사')
    expect(html).not.toContain('전체 현황 보기')
    expect(html).not.toContain('미분류 (system)')
    mkdirSync('verify', { recursive: true })
    writeFileSync('verify/preview-select-group-operator.html', html, 'utf-8')
  })

  it('operator(0그룹) — 빈 상태 → verify/preview-select-group-empty.html', () => {
    const el = SelectGroupPage({
      groups: [],
      currentUser: { username: 'new.op', role: 'operator', id: 3 },
      isAdmin: false,
      next: '/',
    })
    const html = String(el)
    expect(html).toContain('담당 그룹사가 없습니다')
    mkdirSync('verify', { recursive: true })
    writeFileSync('verify/preview-select-group-empty.html', html, 'utf-8')
  })

  it('operator 대시보드 — ScopeIndicator(타그룹 전환 없음) → verify/preview-dashboard-operator.html', () => {
    const el = Dashboard({
      stats: { total: 61, vulnerable: 12, lastMatchedAt: '2026-06-05T01:00:00Z', assetTotal: 24, componentTotal: 61 },
      groupSummaries: [{ name: '본사', total: 61, vulnerable: 12 }],
      categorySummaries: [{ name: 'OS', total: 20, vulnerable: 3 }],
      impactSummaries: [
        { impact_system: 'NETWORK', assetCount: 10, vulnerableAssetCount: 4, componentCount: 25, vulnerableComponentCount: 7 },
      ],
      activeGroup: '본사',
      isAggregate: false,
      recentGroups: [],
      widgets: [],
      currentUser: { username: 'sec.kim', role: 'operator', groups: ['본사'], id: 2 },
    })
    const html = String(el)
    // operator 는 전체 전환 바가 아니라 스코프 인디케이터를 본다.
    expect(html).toContain('그룹사 변경')
    expect(html).not.toContain('전체 현황')
    mkdirSync('verify', { recursive: true })
    writeFileSync('verify/preview-dashboard-operator.html', html, 'utf-8')
  })
})
