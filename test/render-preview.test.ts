// 팀리드 시각검증용 — SolutionsList(grouped) 를 정적 HTML 로 렌더해 verify/preview.html 생성.
// vitest 가 TSX 를 변환하므로 가장 안정적인 렌더 경로. 스크린샷은 Playwright 로 별도 촬영.
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { SolutionsList } from '../src/views/solutions-list'
import { Dashboard, type ImpactSystemSummary } from '../src/views/dashboard'
import { AdminUsersPage } from '../src/views/admin-users'
import type { Solution, AssetWithComponents, MatchedVuln, UserWithGroups } from '../src/types'

// 전체 필드를 채운 Solution 기본값 + override
function mkComp(p: Partial<Solution>): Solution {
  return {
    id: 0, vendor: 'V', product: 'P', category: 'OS', current_version: '1.0',
    hostname: null, owner: null, manager: null, notes: null, group_company: null,
    is_vulnerable: 0, last_matched_cve: null, last_matched_at: null,
    created_at: '2026-06-01', updated_at: '2026-06-01',
    cpe_part: null, cpe_version_range: null, aliases: null,
    vendor_normalized: null, product_normalized: null,
    embedding_status: null, embedding_text: null, embedding_updated_at: null,
    cpe_uri: null, category_attributes: null, source: 'web', asset_id: 1,
    manual_status: null, status_note: null, status_updated_at: null, status_updated_by: null,
    ...p,
  }
}

describe('시각검증 렌더', () => {
  it('grouped 뷰 → verify/preview.html', () => {
    const GC = '공용'
    // 자산1: SNIPER ONE-i 5300 (사용자 이미지 재현) — 컴포넌트 5개, 혼합 상태
    const sniperComps: Solution[] = [
      mkComp({ id: 11, vendor: 'OpenSSL', product: 'OpenSSL', category: 'Crypto', current_version: '3.3.5', hostname: 'PJ-FI-IDS', group_company: GC, owner: '네트웍보안기술팀', is_vulnerable: 1, manual_status: 'vulnerable', status_note: 'KISA 권고 수동 확인', last_matched_cve: 'CVE-2024-6119' }),
      mkComp({ id: 12, vendor: 'OpenSSH', product: 'OpenSSH', category: 'Other', current_version: '10.2p', hostname: 'PJ-FI-IDS', group_company: GC, owner: '네트웍보안기술팀', manual_status: 'resolved', status_note: '패치 적용 완료(10.2p)' }),
      mkComp({ id: 13, vendor: 'SQLite', product: 'SQLite', category: 'DB', current_version: '3.7.17', hostname: 'PJ-FI-IDS', group_company: GC, owner: '네트웍보안기술팀', is_vulnerable: 1, last_matched_cve: 'CVE-2023-7104' }),
      mkComp({ id: 14, vendor: 'Wins', product: 'SNIPER ONE-i 5300', category: 'HW', current_version: 'v3.3.1.15', hostname: 'PJ-FI-IDS', group_company: GC, owner: '네트웍보안기술팀' }),
      mkComp({ id: 15, vendor: 'Wins', product: 'SNIPER ONE-i 5300', category: 'OS', current_version: 'v4.0.8_k5.4.0', hostname: 'PJ-FI-IDS', group_company: GC, owner: '네트웍보안기술팀' }),
      // 최장 카테고리 라벨('WAS (애플리케이션 서버)') + 긴 벤더/제품 — 겹침/오버플로 스트레스
      mkComp({ id: 16, vendor: 'Apache Software Foundation', product: 'Tomcat Application Server', category: 'WAS', current_version: '9.0.85', hostname: 'PJ-FI-IDS', group_company: GC, owner: '네트웍보안기술팀', is_vulnerable: 1, last_matched_cve: 'CVE-2025-24813' }),
    ]
    // 자산2: FortiOS (fw_hq_10) — 수동취약 FW 1개
    const fortiComps: Solution[] = [
      mkComp({ id: 21, vendor: 'Fortinet', product: 'FortiOS', category: 'FW', current_version: '7.4.1', hostname: 'fw_hq_10', group_company: GC, owner: '네트웍보안기술팀', is_vulnerable: 1, manual_status: 'vulnerable', status_note: '수동 확인된 취약점' }),
    ]

    const assets: AssetWithComponents[] = [
      { asset: { id: 1, name: 'SNIPER ONE-i 5300', vendor: 'Wins', hostname: 'PJ-FI-IDS', group_company: GC, owner: '네트웍보안기술팀', manager: '홍길동', notes: null, created_at: '2026-06-01', updated_at: '2026-06-01', impact_system: 'NETWORK', impact_system_source: 'manual' }, components: sniperComps, componentCount: 6, vulnerableCount: 4, hasVulnerable: true },
      { asset: { id: 2, name: 'FortiOS', vendor: 'Fortinet', hostname: 'fw_hq_10', group_company: GC, owner: '네트웍보안기술팀', manager: '김철수', notes: null, created_at: '2026-06-01', updated_at: '2026-06-01', impact_system: 'NETWORK', impact_system_source: 'derived' }, components: fortiComps, componentCount: 1, vulnerableCount: 1, hasVulnerable: true },
    ]

    const matchesBySolution = new Map<number, MatchedVuln[]>()
    const mkMatch = (sid: number, cve: string, sev: string): MatchedVuln => ({
      id: sid * 10, solution_id: sid, cve_id: cve, source: 'NVD', severity: sev, title: `${cve} 설명`, description: null, url: `https://nvd.nist.gov/vuln/detail/${cve}`, published: '2026-05-20', detected_at: '2026-05-21T03:00:00Z', first_seen_at: null, match_score: 90, match_reasons: null, epss_score: null, is_kev: 0, cvss_score: 8.1,
    })
    matchesBySolution.set(11, [mkMatch(11, 'CVE-2024-6119', 'high')])
    matchesBySolution.set(13, [mkMatch(13, 'CVE-2023-7104', 'medium'), mkMatch(13, 'CVE-2023-0001', 'low')])
    matchesBySolution.set(21, [mkMatch(21, 'CVE-2024-21762', 'critical')])

    const el = SolutionsList({
      view: 'grouped',
      assets,
      solutions: [...sniperComps, ...fortiComps],
      matchesBySolution,
      unlinkedCount: 2,
      assetOptions: [{ id: 1, name: 'SNIPER ONE-i 5300', group_company: GC }, { id: 2, name: 'FortiOS', group_company: GC }],
      groupSummaries: [{ name: GC, total: 6, vulnerable: 3 }],
      activeGroup: null,
      activeCategory: null,
      activeImpact: null,
      activeMinSeverity: null,
      activeVulnStatus: null,
      activeQ: null,
      currentUser: { username: 'admin', role: 'admin', groups: [GC] },
    })

    const html = String(el)
    expect(html.startsWith('<')).toBe(true)
    expect(html).toContain('수동취약')
    // v3.3 영향시스템 배지 + 재분류 버튼 렌더 확인
    expect(html).toContain('영향시스템 재분류')
    expect(html).toContain('Network')
    mkdirSync('verify', { recursive: true })
    writeFileSync('verify/preview.html', html, 'utf-8')
  })

  it('list(평면) 뷰 정렬 컬럼 + 부서/담당자 → verify/preview-list.html', () => {
    const GC = '본사'
    const flat: Solution[] = [
      mkComp({ id: 31, vendor: 'OpenSSL', product: 'OpenSSL', category: 'Crypto', current_version: '3.3.5', hostname: 'srv-01', group_company: GC, owner: '인프라팀', manager: '홍길동', is_vulnerable: 1 }),
      mkComp({ id: 32, vendor: 'Apache', product: 'httpd', category: 'WEB', current_version: '2.4.58', hostname: 'web-01', group_company: GC, owner: '웹운영팀', manager: '이영희', manual_status: 'resolved' }),
      mkComp({ id: 33, vendor: 'Microsoft', product: 'SQL Server', category: 'DB', current_version: '2019', hostname: 'db-01', group_company: '자회사A', owner: 'DBA팀', manager: '김철수' }),
      mkComp({ id: 34, vendor: 'Fortinet', product: 'FortiOS', category: 'FW', current_version: '7.4.1', hostname: 'fw-01', group_company: GC, owner: '보안팀', manager: '박보안', is_vulnerable: 1, manual_status: 'vulnerable' }),
    ]
    const el = SolutionsList({
      view: 'list',
      assets: [],
      solutions: flat,
      matchesBySolution: new Map(),
      unlinkedCount: 0,
      assetOptions: [],
      groupSummaries: [{ name: GC, total: 3, vulnerable: 2 }, { name: '자회사A', total: 1, vulnerable: 0 }],
      activeGroup: null,
      activeCategory: null,
      activeImpact: null,
      activeMinSeverity: null,
      activeVulnStatus: null,
      activeQ: null,
      currentUser: { username: 'admin', role: 'admin', groups: [GC] },
    })
    const html = String(el)
    expect(html).toContain('담당자')
    expect(html).toContain('vm-th-sort')
    mkdirSync('verify', { recursive: true })
    writeFileSync('verify/preview-list.html', html, 'utf-8')
  })

  it('dashboard 영향시스템 그리드 → verify/preview-dashboard.html', () => {
    const impactSummaries: ImpactSystemSummary[] = [
      { impact_system: 'NETWORK', assetCount: 12, vulnerableAssetCount: 5, componentCount: 31, vulnerableComponentCount: 9 },
      { impact_system: 'SERVER', assetCount: 8, vulnerableAssetCount: 2, componentCount: 24, vulnerableComponentCount: 3 },
      { impact_system: 'WEBWAS', assetCount: 5, vulnerableAssetCount: 3, componentCount: 14, vulnerableComponentCount: 6 },
      { impact_system: 'DATABASE', assetCount: 4, vulnerableAssetCount: 1, componentCount: 6, vulnerableComponentCount: 1 },
      { impact_system: 'PC', assetCount: 20, vulnerableAssetCount: 0, componentCount: 20, vulnerableComponentCount: 0 },
      { impact_system: 'APPLICATION', assetCount: 3, vulnerableAssetCount: 1, componentCount: 5, vulnerableComponentCount: 2 },
      { impact_system: null, assetCount: 2, vulnerableAssetCount: 0, componentCount: 3, vulnerableComponentCount: 0 },
    ]

    const demoWidgets = [
      { id: 1, widget_type: 'filter_preset' as const, title: '본사 네트워크 Critical', config_json: JSON.stringify({ group_company: '본사', impact_system: 'NETWORK', min_severity: 'critical' }), widget_order: 1, is_hidden: 0, created_by_user_id: 1, updated_by_user_id: 1, created_at: '2026-06-01', updated_at: '2026-06-01' },
      { id: 2, widget_type: 'note' as const, title: '점검 메모', config_json: JSON.stringify({ content: '분기 정기점검 6/15 예정 — 방화벽 펌웨어 업그레이드', color: 'yellow' }), widget_order: 2, is_hidden: 0, created_by_user_id: 1, updated_by_user_id: 1, created_at: '2026-06-01', updated_at: '2026-06-01' },
    ]
    const el = Dashboard({
      stats: { total: 103, vulnerable: 21, lastMatchedAt: '2026-06-05T01:00:00Z', assetTotal: 54, componentTotal: 103 },
      groupSummaries: [{ name: '본사', total: 60, vulnerable: 12 }, { name: '자회사A', total: 43, vulnerable: 9 }],
      categorySummaries: [
        { name: 'OS', total: 30, vulnerable: 4 },
        { name: 'FW', total: 12, vulnerable: 5 },
        { name: 'DB', total: 10, vulnerable: 2 },
      ],
      impactSummaries,
      activeGroup: null,
      recentGroups: [],
      widgets: demoWidgets,
      currentUser: { username: 'admin', role: 'admin', groups: ['본사'], id: 1 },
    })

    const html = String(el)
    expect(html).toContain('영향 시스템별 현황')
    expect(html).toContain('이 필터로 목록 보기')
    expect(html).toContain('컴포넌트 카테고리별 현황')
    mkdirSync('verify', { recursive: true })
    writeFileSync('verify/preview-dashboard.html', html, 'utf-8')
  })

  it('admin-users 버튼 일관성 → verify/preview-admin.html', () => {
    const users: UserWithGroups[] = [
      { id: 1, username: 'admin', display_name: '시스템 관리자', role: 'admin', is_active: 1, session_version: 1, last_login_at: '2026-06-05 09:00', created_at: '2026-01-01', updated_at: '2026-06-05', groups: ['system'] },
      { id: 2, username: 'sec.kim', display_name: '김보안', role: 'operator', is_active: 1, session_version: 1, last_login_at: '2026-06-04 18:20', created_at: '2026-02-01', updated_at: '2026-06-04', groups: ['본사'] },
      { id: 3, username: 'ops.lee', display_name: '이운영', role: 'operator', is_active: 0, session_version: 1, last_login_at: null, created_at: '2026-03-01', updated_at: '2026-05-01', groups: ['자회사A'] },
    ]
    const el = AdminUsersPage({
      users,
      currentUser: { username: 'admin', role: 'admin', groups: ['system'] },
    })
    const html = String(el)
    expect(html).toContain('vm-act-col')
    mkdirSync('verify', { recursive: true })
    writeFileSync('verify/preview-admin.html', html, 'utf-8')
  })
})
