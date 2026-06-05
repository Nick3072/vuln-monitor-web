// 매칭용 문자열 정규화 + alias 자동 생성
// 동일 규칙이 D1 백필 SQL(0003), n8n Pre-Match Filter, Workers 등록 경로 3곳에서 일관되게 사용됨.

export function normalizeIdentifier(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .replace(/[\s\-_]+/g, '')
    .replace(/[^a-z0-9가-힣]/g, '')
}

// 벤더별 표기 변형 — n8n AI 프롬프트에 있던 지식을 코드로 옮김.
// 등록 시 자동으로 솔루션에 추가 alias 로 들어가 매칭 후보가 됨.
const VENDOR_VARIANTS: Record<string, string[]> = {
  fortinet: ['fortinet', 'forti'],
  paloaltonetworks: ['palo alto networks', 'paloalto', 'pan'],
  checkpoint: ['check point', 'checkpoint'],
  cisco: ['cisco systems', 'cisco'],
  juniper: ['juniper networks', 'juniper'],
  f5: ['f5 networks', 'f5', 'big-ip', 'bigip'],
  sonicwall: ['sonicwall', 'dell sonicwall'],
  monitorapp: ['monitorapp', '모니터랩'],
  imperva: ['imperva'],
  trellix: ['trellix', 'mcafee'],
  crowdstrike: ['crowdstrike'],
  sentinelone: ['sentinelone'],
  symantec: ['symantec', 'broadcom'],
  microsoft: ['microsoft', 'msft'],
  ivanti: ['ivanti', 'pulse secure'],
}

// 제품 카테고리 → 동의어 (한↔영)
// v2.5 다종 솔루션 확장: OS/DB/HW/Library/Crypto/WEB/WAS/SW 추가.
// 키는 src/views/category-metadata.ts 의 CATEGORY_METADATA 와 일치시켜야 한다.
const CATEGORY_SYNONYMS: Record<string, string[]> = {
  FW: ['firewall', '방화벽', 'fw', 'next-generation firewall', 'ngfw'],
  WAF: ['waf', 'web application firewall', '웹방화벽', 'aiwaf', 'webshield'],
  IPS: ['ips', 'intrusion prevention', '침입방지'],
  IDS: ['ids', 'intrusion detection', '침입탐지'],
  DDoS: ['ddos', 'anti-ddos', 'ddos protection'],
  EDR: ['edr', 'endpoint detection', 'endpoint protection'],
  SIEM: ['siem', 'security information event management', '통합로그'],
  VPN: ['vpn', 'virtual private network'],
  OS: ['os', 'operating system', 'windows', 'linux', 'ubuntu', 'centos', 'rhel', 'debian', '운영체제'],
  DB: ['db', 'database', 'mysql', 'postgresql', 'oracle', 'mssql', 'mariadb', '데이터베이스'],
  HW: ['hardware', 'firmware', '하드웨어', '펌웨어', 'appliance'],
  Library: ['library', 'lib', '라이브러리'],
  Crypto: ['crypto', 'cryptography', 'openssl', 'libssl', 'libcrypto', 'tls', 'ssl', '암호'],
  WEB: ['webserver', 'web server', 'http server', 'apache', 'httpd', 'nginx', 'iis', '웹서버'],
  WAS: [
    'was',
    'app server',
    'application server',
    'tomcat',
    'jboss',
    'wildfly',
    'weblogic',
    'websphere',
    'jeus',
    '웹앱서버',
  ],
  SW: ['software', 'application', '소프트웨어'],
  Other: [],
}

// 벤더별 제품군 패밀리 (F5 i-Series → BIG-IP 등)
const PRODUCT_FAMILY: Record<string, string[]> = {
  // F5 i-Series, r-Series, ASM, AFM, APM, LTM → BIG-IP 패밀리
  'f5-big-ip': [
    'big-ip',
    'bigip',
    'asm',
    'ltm',
    'afm',
    'apm',
    'gtm',
    'advanced waf',
    'viprion',
  ],
  // Fortinet 패밀리
  'fortinet-fortigate': ['fortigate', 'fortios'],
  'fortinet-fortiweb': ['fortiweb'],
  'fortinet-fortimanager': ['fortimanager', 'fortianalyzer'],
  // Palo Alto
  'paloalto-panos': ['pan-os', 'panos', 'panorama', 'globalprotect'],
  // Cisco
  'cisco-asa': ['asa', 'firepower', 'ftd', 'anyconnect'],
}

export interface AliasResult {
  aliases: string[]
  vendorNorm: string
  productNorm: string
}

export function generateAliases(input: {
  vendor: string
  product: string
  category: string | null
}): AliasResult {
  const vendorNorm = normalizeIdentifier(input.vendor)
  const productNorm = normalizeIdentifier(input.product)
  const aliasSet = new Set<string>()

  aliasSet.add(input.vendor.toLowerCase())
  aliasSet.add(input.product.toLowerCase())
  aliasSet.add(vendorNorm)
  aliasSet.add(productNorm)

  // 벤더 변형 추가
  for (const variants of Object.values(VENDOR_VARIANTS)) {
    if (variants.includes(input.vendor.toLowerCase().trim())) {
      variants.forEach((v) => aliasSet.add(v))
    }
  }

  // 카테고리 동의어 추가
  if (input.category && CATEGORY_SYNONYMS[input.category]) {
    CATEGORY_SYNONYMS[input.category].forEach((s) => aliasSet.add(s))
  }

  // 제품군 패밀리 매칭 — product 토큰에 F5 모델번호가 들어오면 BIG-IP 패밀리로 확장
  const productLower = input.product.toLowerCase()
  const vendorLower = input.vendor.toLowerCase()

  if (vendorLower.includes('f5') || /^[ir]\d{3,5}$/i.test(productLower.trim())) {
    PRODUCT_FAMILY['f5-big-ip'].forEach((s) => aliasSet.add(s))
  }
  if (vendorLower.includes('fortinet')) {
    if (/fortigate|fortios/i.test(productLower)) {
      PRODUCT_FAMILY['fortinet-fortigate'].forEach((s) => aliasSet.add(s))
    }
  }
  if (vendorLower.includes('palo alto') || vendorLower.includes('paloalto')) {
    PRODUCT_FAMILY['paloalto-panos'].forEach((s) => aliasSet.add(s))
  }
  if (vendorLower.includes('cisco')) {
    if (/asa|firepower|ftd|anyconnect/i.test(productLower)) {
      PRODUCT_FAMILY['cisco-asa'].forEach((s) => aliasSet.add(s))
    }
  }

  const aliases = Array.from(aliasSet)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)

  return { aliases, vendorNorm, productNorm }
}

// CPE part 추출: cpe:2.3:a:fortinet:fortigate:7.0.5 → cpe:2.3:a:fortinet:fortigate
export function extractCpePart(cpeName: string): string {
  return cpeName.split(':').slice(0, 5).join(':')
}

// 시맨틱 버전 비교용
export function parseSemver(v: string | null | undefined): number[] | null {
  if (!v) return null
  const m = String(v).match(/(\d+)\.(\d+)\.?(\d+)?\.?(\d+)?/)
  if (!m) return null
  return [+m[1], +m[2], +(m[3] || 0), +(m[4] || 0)]
}

export function semverCmp(a: number[], b: number[]): number {
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}
