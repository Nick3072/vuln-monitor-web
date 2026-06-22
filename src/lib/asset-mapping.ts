// v2.6 운영자 친화 장비 등록: 한 장비의 통합 입력을 솔루션 행 N개로 자동 분해.
// 운영자가 "벤더 + 장비모델 + Hostname + OS버전" 만 필수로 입력하면,
// 백엔드가 매핑 사전을 사용해 OS / HW / DB / OpenSSL / WEB / WAS 컴포넌트를
// 각각 (vendor, product, category, current_version) 솔루션 행으로 변환한다.
// CPE / aliases / category_attributes 같은 매칭 메타데이터는 운영자에게 노출되지 않으며
// 등록 후 백엔드의 자동 enrichment 흐름(generateAliases, suggestCpe)이 이어서 채운다.

import { normalizeIdentifier } from './normalize'
import type { SolutionInput } from '../types'

// === 매핑 사전 ===

// 장비 벤더 → 기본 OS 제품. 정규화된 키(normalizeIdentifier)로 lookup.
// 매핑되지 않은 벤더는 장비모델을 OS 제품으로 사용하는 fallback.
const VENDOR_OS_PRODUCT: Record<string, string> = {
  fortinet: 'FortiOS',
  paloaltonetworks: 'PAN-OS',
  paloalto: 'PAN-OS',
  checkpoint: 'Gaia',
  cisco: 'IOS', // ASA/NX-OS 등은 운영자가 model 에 명시 (예: model="Cisco ASA")
  juniper: 'Junos OS',
  f5: 'BIG-IP TMOS',
  sonicwall: 'SonicOS',
  microsoft: 'Windows Server',
  canonical: 'Ubuntu',
  ubuntu: 'Ubuntu',
  redhat: 'Enterprise Linux',
  centos: 'CentOS',
  debian: 'Debian',
  vmware: 'ESXi',
  citrix: 'NetScaler',
  ivanti: 'Connect Secure',
  trellix: 'Endpoint Security',
  crowdstrike: 'Falcon',
}

// DB 엔진 select → (vendor, product) 매핑
export const DB_ENGINE_MAP: Record<string, { vendor: string; product: string }> = {
  MySQL: { vendor: 'Oracle', product: 'MySQL' },
  MariaDB: { vendor: 'MariaDB', product: 'MariaDB' },
  PostgreSQL: { vendor: 'PostgreSQL', product: 'PostgreSQL' },
  Oracle: { vendor: 'Oracle', product: 'Database' },
  MSSQL: { vendor: 'Microsoft', product: 'SQL Server' },
  MongoDB: { vendor: 'MongoDB', product: 'MongoDB' },
  SQLite: { vendor: 'SQLite', product: 'SQLite' },
  Redis: { vendor: 'Redis', product: 'Redis' },
  Tibero: { vendor: 'TmaxData', product: 'Tibero' },
}

// WEB 엔진 select → (vendor, product) 매핑
export const WEB_ENGINE_MAP: Record<string, { vendor: string; product: string }> = {
  Apache: { vendor: 'Apache', product: 'httpd' },
  Nginx: { vendor: 'Nginx', product: 'Nginx' },
  IIS: { vendor: 'Microsoft', product: 'Internet Information Services' },
  Tengine: { vendor: 'Alibaba', product: 'Tengine' },
  Caddy: { vendor: 'Caddy', product: 'Caddy' },
  LiteSpeed: { vendor: 'LiteSpeed', product: 'OpenLiteSpeed' },
}

// WAS 엔진 select → (vendor, product) 매핑
export const WAS_ENGINE_MAP: Record<string, { vendor: string; product: string }> = {
  Tomcat: { vendor: 'Apache', product: 'Tomcat' },
  JBoss: { vendor: 'Red Hat', product: 'JBoss' },
  WildFly: { vendor: 'Red Hat', product: 'WildFly' },
  WebLogic: { vendor: 'Oracle', product: 'WebLogic' },
  WebSphere: { vendor: 'IBM', product: 'WebSphere' },
  JEUS: { vendor: 'TmaxSoft', product: 'JEUS' },
}

// OpenSSL 고정값
const OPENSSL_FIXED = { vendor: 'OpenSSL', product: 'OpenSSL' }

// === 입력 타입 ===

// 사전 정의된 슬롯에 없는 임의 컴포넌트(OpenSSH, Docker, Redis 등) — 운영자가 동적으로 추가
// 운영자 편의를 위해 vendor 는 받지 않음. 백엔드가 product 를 vendor 로도 사용 (예: OpenSSH/OpenSSH).
export interface ExtraComponent {
  category: string // CATEGORY_METADATA 의 키 (Library/SW/Crypto/HW/...) 또는 임의 문자열
  product: string
  version: string
}

// 운영자가 한 장비를 등록할 때 전달하는 통합 입력 형태
export interface EquipmentInput {
  vendor: string // 필수 - 장비 벤더
  model: string // 필수 - 장비 모델 (HW 컴포넌트 product 로도 사용)
  hostname: string // 필수
  os_version: string // 필수 - 입력 시 자동으로 OS 솔루션 행 생성

  // 선택 (모두 빈 값이면 무시)
  hw_version?: string | null // 하드웨어/펌웨어 버전
  db_engine?: string | null // DB_ENGINE_MAP 키 또는 임의 문자열
  db_version?: string | null
  openssl_version?: string | null
  web_engine?: string | null // WEB_ENGINE_MAP 키 또는 임의 문자열
  web_version?: string | null
  was_engine?: string | null // WAS_ENGINE_MAP 키 또는 임의 문자열
  was_version?: string | null

  // 사전 정의 슬롯 외 추가 컴포넌트 (OpenSSH / Docker / Memcached 등)
  extra_components?: ExtraComponent[] | null

  group_company?: string | null
  owner?: string | null // 부서(department)
  manager?: string | null // 담당자(person in charge)
  notes?: string | null
}

// === 헬퍼 ===

function trimOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

// 벤더 정규화 후 OS 제품 lookup. 매핑이 없으면 model 그대로 fallback.
function resolveOsProduct(vendor: string, model: string): string {
  const norm = normalizeIdentifier(vendor)
  return VENDOR_OS_PRODUCT[norm] ?? model
}

// === 메인 변환 함수 ===

/**
 * 운영자가 입력한 한 장비(EquipmentInput) 를 매칭 엔진이 처리할 수 있는 SolutionInput 배열로 분해한다.
 *
 * - OS 행은 항상 생성 (os_version 필수 검증은 호출자가 수행)
 * - 나머지 컴포넌트는 해당 버전이 채워져 있을 때만 생성
 * - 각 행은 동일 hostname / group_company / owner / notes 메타를 공유
 */
export function mapEquipmentToSolutions(input: EquipmentInput): SolutionInput[] {
  const solutions: SolutionInput[] = []

  const vendor = input.vendor.trim()
  const model = input.model.trim()
  const hostname = input.hostname.trim()
  const osVersion = input.os_version.trim()

  const sharedMeta: Pick<
    SolutionInput,
    'hostname' | 'owner' | 'manager' | 'group_company' | 'notes' | 'cpe_part' | 'cpe_version_range' | 'cpe_uri' | 'aliases' | 'category_attributes'
  > = {
    hostname,
    owner: trimOrNull(input.owner),
    manager: trimOrNull(input.manager),
    group_company: trimOrNull(input.group_company),
    notes: trimOrNull(input.notes),
    cpe_part: null,
    cpe_version_range: null,
    cpe_uri: null,
    aliases: null,
    category_attributes: null,
  }

  // 1) OS — 항상 생성
  solutions.push({
    vendor,
    product: resolveOsProduct(vendor, model),
    category: 'OS',
    current_version: osVersion,
    ...sharedMeta,
  })

  // 2) HW — 펌웨어/하드웨어 버전이 있을 때
  const hwVer = trimOrNull(input.hw_version)
  if (hwVer) {
    solutions.push({
      vendor,
      product: model, // 장비 모델 자체가 HW 제품
      category: 'HW',
      current_version: hwVer,
      ...sharedMeta,
    })
  }

  // 3) DB — engine + version 둘 다 있을 때
  const dbEngine = trimOrNull(input.db_engine)
  const dbVersion = trimOrNull(input.db_version)
  if (dbEngine && dbVersion) {
    const mapped = DB_ENGINE_MAP[dbEngine]
    solutions.push({
      vendor: mapped?.vendor ?? dbEngine,
      product: mapped?.product ?? dbEngine,
      category: 'DB',
      current_version: dbVersion,
      ...sharedMeta,
    })
  }

  // 4) OpenSSL — version 만으로 충분 (제품 고정)
  const opensslVer = trimOrNull(input.openssl_version)
  if (opensslVer) {
    solutions.push({
      vendor: OPENSSL_FIXED.vendor,
      product: OPENSSL_FIXED.product,
      category: 'Crypto',
      current_version: opensslVer,
      ...sharedMeta,
    })
  }

  // 5) WEB
  const webEngine = trimOrNull(input.web_engine)
  const webVersion = trimOrNull(input.web_version)
  if (webEngine && webVersion) {
    const mapped = WEB_ENGINE_MAP[webEngine]
    solutions.push({
      vendor: mapped?.vendor ?? webEngine,
      product: mapped?.product ?? webEngine,
      category: 'WEB',
      current_version: webVersion,
      ...sharedMeta,
    })
  }

  // 6) WAS
  const wasEngine = trimOrNull(input.was_engine)
  const wasVersion = trimOrNull(input.was_version)
  if (wasEngine && wasVersion) {
    const mapped = WAS_ENGINE_MAP[wasEngine]
    solutions.push({
      vendor: mapped?.vendor ?? wasEngine,
      product: mapped?.product ?? wasEngine,
      category: 'WAS',
      current_version: wasVersion,
      ...sharedMeta,
    })
  }

  // 7) 추가 컴포넌트 (OpenSSH / Docker / Memcached 등 운영자가 동적으로 추가)
  // 운영자는 카테고리/제품/버전 3개만 입력. vendor 는 product 와 동일하게 사용.
  if (input.extra_components && input.extra_components.length > 0) {
    for (const ec of input.extra_components) {
      const cat = (ec.category ?? '').trim()
      const prod = (ec.product ?? '').trim()
      const ver = (ec.version ?? '').trim()
      if (!cat || !prod || !ver) continue
      solutions.push({
        vendor: prod, // 별도 벤더 입력 없으므로 product 를 vendor 로도 사용
        product: prod,
        category: cat,
        current_version: ver,
        ...sharedMeta,
      })
    }
  }

  return solutions
}

// === 검증 ===

/**
 * EquipmentInput 의 필수 필드 검증. 통과 시 정리된 객체 반환, 실패 시 에러 메시지.
 */
export function validateEquipmentInput(
  raw: unknown,
): { ok: true; value: EquipmentInput } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'Request body must be an object' }
  }
  const r = raw as Record<string, unknown>

  const required: Array<keyof EquipmentInput> = ['vendor', 'model', 'hostname', 'os_version']
  for (const k of required) {
    const v = r[k]
    if (typeof v !== 'string' || v.trim().length === 0) {
      return { ok: false, error: `필수 항목 누락: ${k}` }
    }
  }

  // extra_components 검증: 배열이어야 하고 각 항목은 {category, product, version} 3개 모두 비어있지 않아야 한다.
  // 3개 중 1~2개만 채워진 행은 에러 (운영자 실수 방지).
  let extras: ExtraComponent[] | null = null
  if (r.extra_components !== undefined && r.extra_components !== null) {
    if (!Array.isArray(r.extra_components)) {
      return { ok: false, error: 'extra_components must be an array' }
    }
    const cleaned: ExtraComponent[] = []
    for (let i = 0; i < r.extra_components.length; i++) {
      const raw = r.extra_components[i]
      if (typeof raw !== 'object' || raw === null) continue
      const row = raw as Record<string, unknown>
      const category = trimOrNull(row.category)
      const product = trimOrNull(row.product)
      const version = trimOrNull(row.version)
      const anyFilled = category || product || version
      if (!anyFilled) continue // 빈 행은 무시
      const allFilled = category && product && version
      if (!allFilled) {
        return {
          ok: false,
          error: `추가 컴포넌트 ${i + 1}번 행: 카테고리/제품/버전 모두 입력하거나 모두 비워주세요.`,
        }
      }
      cleaned.push({ category, product, version })
    }
    extras = cleaned.length > 0 ? cleaned : null
  }

  return {
    ok: true,
    value: {
      vendor: (r.vendor as string).trim(),
      model: (r.model as string).trim(),
      hostname: (r.hostname as string).trim(),
      os_version: (r.os_version as string).trim(),
      hw_version: trimOrNull(r.hw_version),
      db_engine: trimOrNull(r.db_engine),
      db_version: trimOrNull(r.db_version),
      openssl_version: trimOrNull(r.openssl_version),
      web_engine: trimOrNull(r.web_engine),
      web_version: trimOrNull(r.web_version),
      was_engine: trimOrNull(r.was_engine),
      was_version: trimOrNull(r.was_version),
      extra_components: extras,
      group_company: trimOrNull(r.group_company),
      owner: trimOrNull(r.owner),
      manager: trimOrNull(r.manager),
      notes: trimOrNull(r.notes),
    },
  }
}

// === CSV ===

/**
 * CSV 헤더가 신규 "장비 중심" 포맷인지 판별.
 * `model` 컬럼이 존재하고 `product` 컬럼은 없으면 신규.
 */
export function isEquipmentCsvHeader(headers: string[]): boolean {
  const set = new Set(headers.map((h) => h.toLowerCase()))
  return set.has('model') && !set.has('product')
}

/**
 * CSV row(헤더→문자열 맵) → EquipmentInput 형태(검증 전).
 * 빈 행 무시 책임은 호출자에 있다.
 */
export function csvRowToEquipmentRaw(row: Record<string, string>): Record<string, unknown> {
  return {
    vendor: row.vendor ?? '',
    model: row.model ?? '',
    hostname: row.hostname ?? '',
    os_version: row.os_version ?? '',
    hw_version: row.hw_version ?? null,
    db_engine: row.db_engine ?? null,
    db_version: row.db_version ?? null,
    openssl_version: row.openssl_version ?? null,
    web_engine: row.web_engine ?? null,
    web_version: row.web_version ?? null,
    was_engine: row.was_engine ?? null,
    was_version: row.was_version ?? null,
    group_company: row.group_company ?? null,
    owner: row.owner ?? null,
    manager: row.manager ?? null,
    notes: row.notes ?? null,
  }
}
