// 시각검증 — 조치 이력 화면.
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { History } from '../src/views/history'
import type { RemediationEntry } from '../src/lib/history'

function entry(p: Partial<RemediationEntry>): RemediationEntry {
  return {
    auditId: 1, resolvedAt: '2026-06-06 10:00:00', actor: 'sec.kim', method: 'manual',
    note: null, cve: null, solutionId: 1, vendor: 'Fortinet', product: 'FortiOS',
    hostname: 'fw_hq_10', category: 'FW', currentVersion: '7.4.4', groupCompany: '본사',
    assetId: 1, currentlyVulnerable: false, ...p,
  }
}

describe('조치 이력 렌더', () => {
  it('admin 데이터 → verify/preview-history.html', () => {
    const entries: RemediationEntry[] = [
      entry({ auditId: 3, resolvedAt: '2026-06-06 14:20:00', method: 'update', cve: 'CVE-2024-21762', note: '7.4.1 → 7.4.4 패치 적용', vendor: 'Fortinet', product: 'FortiOS', currentVersion: '7.4.4', groupCompany: '본사' }),
      entry({ auditId: 2, resolvedAt: '2026-06-05 09:10:00', method: 'manual', cve: 'CVE-2023-7104', note: 'KISA 권고 설정 변경(우회 적용)', vendor: 'SQLite', product: 'SQLite', category: 'DB', currentVersion: '3.7.17', hostname: 'PJ-FI-IDS', groupCompany: '본사', currentlyVulnerable: true }),
      entry({ auditId: 1, resolvedAt: '2026-06-04 18:00:00', method: 'update', cve: null, note: null, vendor: 'Apache', product: 'Tomcat', category: 'WAS', currentVersion: '9.0.85', hostname: 'web-01', groupCompany: '자회사A' }),
    ]
    const html = String(
      History({
        entries, total: 3, page: 1, pageSize: 50,
        filters: { group: null, from: null, to: null, q: null },
        groupSummaries: [{ name: '본사', total: 60, vulnerable: 12 }, { name: '자회사A', total: 43, vulnerable: 9 }],
        activeGroup: null, isAggregate: true,
        currentUser: { username: 'admin', role: 'admin', groups: [], id: 1 },
      }),
    )
    expect(html).toContain('조치 이력')
    expect(html).toContain('버전 업데이트')
    expect(html).toContain('수동 조치')
    expect(html).toContain('재취약')
    mkdirSync('verify', { recursive: true })
    writeFileSync('verify/preview-history.html', html, 'utf-8')
  })

  it('빈 상태 → verify/preview-history-empty.html', () => {
    const html = String(
      History({
        entries: [], total: 0, page: 1, pageSize: 50,
        filters: { group: '본사', from: null, to: null, q: null },
        groupSummaries: [{ name: '본사', total: 1, vulnerable: 0 }],
        activeGroup: '본사', isAggregate: false,
        currentUser: { username: 'sec.kim', role: 'operator', groups: ['본사'], id: 2 },
      }),
    )
    expect(html).toContain('조치 이력이 없습니다')
    mkdirSync('verify', { recursive: true })
    writeFileSync('verify/preview-history-empty.html', html, 'utf-8')
  })
})
