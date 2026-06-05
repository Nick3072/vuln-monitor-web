// 팀리드 시각검증용 — SolutionsList(grouped) 를 정적 HTML 로 렌더해 verify/preview.html 생성.
// vitest 가 TSX 를 변환하므로 가장 안정적인 렌더 경로. 스크린샷은 Playwright 로 별도 촬영.
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { SolutionsList } from '../src/views/solutions-list'
import type { Solution, AssetWithComponents, MatchedVuln } from '../src/types'

// 전체 필드를 채운 Solution 기본값 + override
function mkComp(p: Partial<Solution>): Solution {
  return {
    id: 0, vendor: 'V', product: 'P', category: 'OS', current_version: '1.0',
    hostname: null, owner: null, notes: null, group_company: null,
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
      { asset: { id: 1, name: 'SNIPER ONE-i 5300', vendor: 'Wins', hostname: 'PJ-FI-IDS', group_company: GC, owner: '네트웍보안기술팀', notes: null, created_at: '2026-06-01', updated_at: '2026-06-01' }, components: sniperComps, componentCount: 6, vulnerableCount: 4, hasVulnerable: true },
      { asset: { id: 2, name: 'FortiOS', vendor: 'Fortinet', hostname: 'fw_hq_10', group_company: GC, owner: '네트웍보안기술팀', notes: null, created_at: '2026-06-01', updated_at: '2026-06-01' }, components: fortiComps, componentCount: 1, vulnerableCount: 1, hasVulnerable: true },
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
      currentUser: { username: 'admin', role: 'admin', groups: [GC] },
    })

    const html = String(el)
    expect(html.startsWith('<')).toBe(true)
    expect(html).toContain('수동취약')
    mkdirSync('verify', { recursive: true })
    writeFileSync('verify/preview.html', html, 'utf-8')
  })
})
