/**
 * QA render test — Agent-C
 * Renders SolutionsList with realistic Korean mock data and writes preview.html
 * for visual inspection via Playwright.
 */
import { describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SolutionsList } from '../src/views/solutions-list'
import type { SolutionsListProps } from '../src/views/solutions-list'
import type { AssetWithComponents, MatchedVuln } from '../src/types'

// ── Mock data ────────────────────────────────────────────────

const now = '2026-06-01T05:00:00.000Z'

function baseSolution(overrides: Partial<ReturnType<typeof baseSolution>['0']> & { id: number; vendor: string; product: string; category: string; current_version: string }) {
  return {
    id: overrides.id,
    vendor: overrides.vendor,
    product: overrides.product,
    category: overrides.category,
    current_version: overrides.current_version,
    hostname: overrides.hostname ?? null,
    owner: overrides.owner ?? null,
    notes: overrides.notes ?? null,
    group_company: overrides.group_company ?? null,
    is_vulnerable: overrides.is_vulnerable ?? 0,
    last_matched_cve: overrides.last_matched_cve ?? null,
    last_matched_at: overrides.last_matched_at ?? null,
    created_at: now,
    updated_at: now,
    cpe_part: overrides.cpe_part ?? null,
    cpe_version_range: overrides.cpe_version_range ?? null,
    aliases: overrides.aliases ?? null,
    vendor_normalized: null,
    product_normalized: null,
    embedding_status: null,
    embedding_text: null,
    embedding_updated_at: null,
    cpe_uri: overrides.cpe_uri ?? null,
    category_attributes: overrides.category_attributes ?? null,
    source: 'bulk_csv',
    asset_id: overrides.asset_id ?? null,
    manual_status: overrides.manual_status ?? null,
    status_note: overrides.status_note ?? null,
    status_updated_at: null,
    status_updated_by: null,
  }
}

// Asset 1: SNIPER ONE-i 5300 (IDS 장비, 공용/PJ-FI-IDS/네트웍보안기술팀)
// has: auto-vulnerable OpenSSL (is_vulnerable=1), manual-vulnerable FW component, resolved OS
const sniper_os = baseSolution({
  id: 101, vendor: 'ESTsecurity', product: 'SNIPER ONE-i OS', category: 'OS',
  current_version: '5300-7.2.1', hostname: 'sniper-ids-01',
  group_company: '공용/PJ-FI-IDS', owner: '네트웍보안기술팀', asset_id: 10,
  is_vulnerable: 0,
  manual_status: 'resolved', status_note: '2026-05-10 패치 적용',
})
const sniper_hw = baseSolution({
  id: 102, vendor: 'ESTsecurity', product: 'SNIPER ONE-i 5300 HW', category: 'HW',
  current_version: '5300-3.1', hostname: 'sniper-ids-01',
  group_company: '공용/PJ-FI-IDS', owner: '네트웍보안기술팀', asset_id: 10,
  is_vulnerable: 0,
})
const sniper_openssl = baseSolution({
  id: 103, vendor: 'OpenSSL', product: 'OpenSSL', category: 'Library',
  current_version: '1.1.1k', hostname: 'sniper-ids-01',
  group_company: '공용/PJ-FI-IDS', owner: '네트웍보안기술팀', asset_id: 10,
  is_vulnerable: 1, last_matched_cve: 'CVE-2023-0215',
  cpe_part: 'cpe:2.3:a:openssl:openssl',
})
const sniper_openssh = baseSolution({
  id: 104, vendor: 'OpenBSD', product: 'OpenSSH', category: 'Library',
  current_version: '8.4p1', hostname: 'sniper-ids-01',
  group_company: '공용/PJ-FI-IDS', owner: '네트웍보안기술팀', asset_id: 10,
  is_vulnerable: 0,
})
const sniper_sqlite = baseSolution({
  id: 105, vendor: 'SQLite', product: 'SQLite', category: 'DB',
  current_version: '3.39.2', hostname: 'sniper-ids-01',
  group_company: '공용/PJ-FI-IDS', owner: '네트웍보안기술팀', asset_id: 10,
  is_vulnerable: 0,
})

const assetSniper: AssetWithComponents = {
  asset: {
    id: 10,
    name: 'SNIPER ONE-i 5300',
    vendor: 'ESTsecurity',
    hostname: 'sniper-ids-01',
    group_company: '공용/PJ-FI-IDS',
    owner: '네트웍보안기술팀',
    notes: null,
    created_at: now,
    updated_at: now,
  },
  components: [sniper_os, sniper_hw, sniper_openssl, sniper_openssh, sniper_sqlite],
  componentCount: 5,
  vulnerableCount: 2,
  hasVulnerable: true,
}

// Asset 2: FortiOS FW (fw_hq_10) — manual vulnerable FW component + normal SSH
const forti_fw = baseSolution({
  id: 201, vendor: 'Fortinet', product: 'FortiOS', category: 'OS',
  current_version: '7.4.1', hostname: 'fw_hq_10',
  group_company: '본사', owner: '보안팀', asset_id: 20,
  is_vulnerable: 0,
  manual_status: 'vulnerable', status_note: '수동 점검: TLS 1.0 사용 확인됨',
})
const forti_hw = baseSolution({
  id: 202, vendor: 'Fortinet', product: 'FortiGate-100F HW', category: 'HW',
  current_version: '2.0.3', hostname: 'fw_hq_10',
  group_company: '본사', owner: '보안팀', asset_id: 20,
  is_vulnerable: 0,
})
const forti_ssh = baseSolution({
  id: 203, vendor: 'OpenBSD', product: 'OpenSSH', category: 'Library',
  current_version: '8.9p1', hostname: 'fw_hq_10',
  group_company: '본사', owner: '보안팀', asset_id: 20,
  is_vulnerable: 0,
})

const assetForti: AssetWithComponents = {
  asset: {
    id: 20,
    name: 'FortiOS FW',
    vendor: 'Fortinet',
    hostname: 'fw_hq_10',
    group_company: '본사',
    owner: '보안팀',
    notes: '본사 주방화벽',
    created_at: now,
    updated_at: now,
  },
  components: [forti_fw, forti_hw, forti_ssh],
  componentCount: 3,
  vulnerableCount: 1,
  hasVulnerable: true,
}

// Asset 3: Normal server (no vulnerabilities)
const srv_os = baseSolution({
  id: 301, vendor: 'Canonical', product: 'Ubuntu', category: 'OS',
  current_version: '22.04.4', hostname: 'srv-app-prod-01',
  group_company: '본사', owner: '인프라팀', asset_id: 30,
  is_vulnerable: 0,
})
const srv_nginx = baseSolution({
  id: 302, vendor: 'nginx', product: 'nginx', category: 'WEB',
  current_version: '1.24.0', hostname: 'srv-app-prod-01',
  group_company: '본사', owner: '인프라팀', asset_id: 30,
  is_vulnerable: 0,
})

const assetServer: AssetWithComponents = {
  asset: {
    id: 30,
    name: 'App Server Prod-01',
    vendor: 'Canonical',
    hostname: 'srv-app-prod-01',
    group_company: '본사',
    owner: '인프라팀',
    notes: null,
    created_at: now,
    updated_at: now,
  },
  components: [srv_os, srv_nginx],
  componentCount: 2,
  vulnerableCount: 0,
  hasVulnerable: false,
}

// matchesBySolution: OpenSSL (103) has 2 CVEs
const cveOpenSSL: MatchedVuln[] = [
  {
    id: 1001, solution_id: 103, cve_id: 'CVE-2023-0215',
    source: 'NVD', severity: 'high',
    title: 'OpenSSL BIO_read_ex() use-after-free',
    description: 'A use-after-free vulnerability in OpenSSL...',
    url: 'https://nvd.nist.gov/vuln/detail/CVE-2023-0215',
    published: '2023-02-08', detected_at: '2026-05-20T09:00:00Z',
    first_seen_at: '2026-05-20T09:00:00Z',
    match_score: 0.97, match_reasons: null,
    epss_score: 0.0072, is_kev: 0, cvss_score: 7.5,
  },
  {
    id: 1002, solution_id: 103, cve_id: 'CVE-2023-0286',
    source: 'NVD', severity: 'high',
    title: 'OpenSSL X.400 address type confusion',
    description: 'A type confusion vulnerability...',
    url: 'https://nvd.nist.gov/vuln/detail/CVE-2023-0286',
    published: '2023-02-08', detected_at: '2026-05-20T09:05:00Z',
    first_seen_at: '2026-05-20T09:05:00Z',
    match_score: 0.94, match_reasons: null,
    epss_score: 0.0041, is_kev: 0, cvss_score: 7.4,
  },
]

const matchesBySolution = new Map<number, MatchedVuln[]>([
  [103, cveOpenSSL],
])

const props: SolutionsListProps = {
  view: 'grouped',
  assets: [assetSniper, assetForti, assetServer],
  solutions: [],
  matchesBySolution,
  unlinkedCount: 0,
  assetOptions: [
    { id: 10, name: 'SNIPER ONE-i 5300', group_company: '공용/PJ-FI-IDS' },
    { id: 20, name: 'FortiOS FW', group_company: '본사' },
    { id: 30, name: 'App Server Prod-01', group_company: '본사' },
  ],
  groupSummaries: [
    { name: '본사', total: 5, vulnerable: 1 },
    { name: '공용/PJ-FI-IDS', total: 5, vulnerable: 2 },
  ],
  activeGroup: null,
  activeCategory: null,
  flash: undefined,
  currentUser: {
    username: 'admin',
    role: 'admin',
    groups: [],
  },
}

describe('QA render — SolutionsList preview', () => {
  it('renders to HTML and writes verify/preview.html', () => {
    const element = SolutionsList(props)
    // Hono JSX elements: toString() renders to HTML
    const html = element.toString()

    const outPath = resolve(__dirname, '../verify/preview.html')
    writeFileSync(outPath, html, 'utf-8')
    console.log('Written:', outPath, `(${html.length} bytes)`)

    // Basic sanity assertions
    if (!html.includes('vm-pill')) {
      throw new Error('vm-pill class not found in output')
    }
    if (!html.includes('vm-pill--manual')) {
      throw new Error('vm-pill--manual class not found in output')
    }
    if (!html.includes('vm-pill--vuln')) {
      throw new Error('vm-pill--vuln class not found in output')
    }
    if (!html.includes('vm-pill--resolved')) {
      throw new Error('vm-pill--resolved class not found in output')
    }
    if (!html.includes('vm-pill--ok')) {
      throw new Error('vm-pill--ok class not found in output')
    }
    if (!html.includes('colgroup')) {
      throw new Error('colgroup not found — fixed layout missing')
    }
    if (!html.includes('수동취약')) {
      throw new Error('수동취약 text not found')
    }
    if (!html.includes('SNIPER ONE-i 5300')) {
      throw new Error('asset name not found in output')
    }
    if (!html.includes('FortiOS FW')) {
      throw new Error('FortiOS asset not found in output')
    }
    console.log('All pill/colgroup sanity checks passed')
  })
})
