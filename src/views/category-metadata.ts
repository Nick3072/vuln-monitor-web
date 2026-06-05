// v2.5.1 운영자 친화 카테고리 메타데이터.
// - solutions-list.tsx 모달: 카테고리별 동적 입력 필드 + 동적 라벨 렌더
// - dashboard.tsx: 카테고리별 집계 카드의 displayName 표시
// 동일 카테고리 키는 src/lib/normalize.ts 의 CATEGORY_SYNONYMS 와 일치 유지 필요.

export interface CategoryAttrField {
  key: string // category_attributes JSON 키
  label: string // 화면 라벨 (한국어)
  placeholder: string
}

export interface CategoryMeta {
  displayName: string // 모달 select 옵션 + 대시보드 카드 라벨
  versionLabel: string // current_version 동적 라벨
  versionPlaceholder: string
  attrs: CategoryAttrField[]
}

export const CATEGORY_METADATA: Record<string, CategoryMeta> = {
  OS: {
    displayName: 'OS (운영체제)',
    versionLabel: 'OS 버전',
    versionPlaceholder: '예: 22.04 / 2022',
    attrs: [
      { key: 'architecture', label: 'CPU 아키텍처', placeholder: 'x86_64 / arm64' },
      { key: 'kernel', label: '커널 버전', placeholder: '5.15.0' },
      { key: 'distro', label: '배포판', placeholder: 'Ubuntu / CentOS / RHEL' },
    ],
  },
  DB: {
    displayName: 'DB (데이터베이스)',
    versionLabel: 'DB 버전',
    versionPlaceholder: '예: 8.0.36',
    attrs: [
      { key: 'engine', label: '엔진', placeholder: 'InnoDB / PostgreSQL' },
      { key: 'port', label: '포트', placeholder: '3306' },
      { key: 'edition', label: 'Edition', placeholder: 'Enterprise / Community' },
    ],
  },
  HW: {
    displayName: 'HW (장비/펌웨어)',
    versionLabel: '펌웨어 버전',
    versionPlaceholder: '예: 1.2.3',
    attrs: [
      { key: 'firmware', label: '펌웨어 버전', placeholder: '1.2.3' },
      { key: 'model', label: '모델', placeholder: 'FG-100F' },
      { key: 'manufacturer', label: '제조사', placeholder: 'Fortinet' },
    ],
  },
  Library: {
    displayName: 'Library (라이브러리)',
    versionLabel: '라이브러리 버전',
    versionPlaceholder: '예: 1.1.1k',
    attrs: [
      { key: 'runtime', label: '런타임', placeholder: 'node20 / python3.11' },
      { key: 'linkage', label: '링키지', placeholder: 'static / dynamic' },
      { key: 'package_manager', label: '패키지 관리자', placeholder: 'npm / pip / cargo' },
    ],
  },
  Crypto: {
    displayName: 'Crypto (암호 라이브러리)',
    versionLabel: 'OpenSSL/암호 버전',
    versionPlaceholder: '예: 1.1.1k',
    attrs: [
      { key: 'protocol', label: 'TLS 프로토콜', placeholder: 'TLS1.2 / TLS1.3' },
      { key: 'fips', label: 'FIPS 모드', placeholder: 'true / false' },
      { key: 'backend', label: '암호 백엔드', placeholder: 'OpenSSL / BoringSSL' },
    ],
  },
  WEB: {
    displayName: 'WEB (웹서버)',
    versionLabel: '웹서버 버전',
    versionPlaceholder: '예: 2.4.58',
    attrs: [
      { key: 'product_family', label: '제품군', placeholder: 'Apache / Nginx / IIS' },
      { key: 'mpm', label: 'MPM 모드', placeholder: 'prefork / worker / event' },
      { key: 'ssl_backend', label: 'SSL 백엔드', placeholder: 'OpenSSL 1.1.1k' },
    ],
  },
  WAS: {
    displayName: 'WAS (애플리케이션 서버)',
    versionLabel: 'WAS 버전',
    versionPlaceholder: '예: 9.0.85',
    attrs: [
      { key: 'product_family', label: '제품군', placeholder: 'Tomcat / JBoss / WebLogic' },
      { key: 'jvm_version', label: 'JVM 버전', placeholder: '17.0.10' },
      { key: 'jvm_vendor', label: 'JVM 제조사', placeholder: 'OpenJDK / Oracle / Corretto' },
    ],
  },
  FW: {
    displayName: 'FW (방화벽)',
    versionLabel: 'OS/펌웨어 버전',
    versionPlaceholder: '예: 7.4.1',
    attrs: [
      { key: 'model', label: '모델', placeholder: 'FortiGate-100F' },
      { key: 'license', label: '라이선스', placeholder: 'Standard / Enterprise' },
    ],
  },
  WAF: {
    displayName: 'WAF (웹방화벽)',
    versionLabel: 'WAF 버전',
    versionPlaceholder: '',
    attrs: [
      { key: 'mode', label: '운영 모드', placeholder: 'Detection / Prevention' },
      { key: 'rules', label: '룰셋 버전', placeholder: '2024.05.01' },
    ],
  },
  IPS: {
    displayName: 'IPS (침입방지)',
    versionLabel: 'IPS 버전',
    versionPlaceholder: '',
    attrs: [{ key: 'signature_version', label: '시그니처 버전', placeholder: '' }],
  },
  IDS: {
    displayName: 'IDS (침입탐지)',
    versionLabel: 'IDS 버전',
    versionPlaceholder: '',
    attrs: [],
  },
  DDoS: {
    displayName: 'DDoS 방어',
    versionLabel: '버전',
    versionPlaceholder: '',
    attrs: [],
  },
  EDR: {
    displayName: 'EDR (단말 탐지)',
    versionLabel: 'EDR 버전',
    versionPlaceholder: '',
    attrs: [{ key: 'agent_version', label: '에이전트 버전', placeholder: '' }],
  },
  SIEM: {
    displayName: 'SIEM (통합로그)',
    versionLabel: 'SIEM 버전',
    versionPlaceholder: '',
    attrs: [],
  },
  VPN: {
    displayName: 'VPN',
    versionLabel: 'VPN 버전',
    versionPlaceholder: '',
    attrs: [],
  },
  SW: {
    displayName: 'SW (일반 소프트웨어)',
    versionLabel: '버전',
    versionPlaceholder: '',
    attrs: [
      { key: 'edition', label: 'Edition', placeholder: 'Enterprise / Community' },
      { key: 'license', label: '라이선스', placeholder: 'Perpetual / Subscription' },
    ],
  },
  Other: {
    displayName: '기타',
    versionLabel: '버전',
    versionPlaceholder: '',
    attrs: [],
  },
}

// 화면 표시용 — 대소문자/공백 무시 lookup.
const DISPLAY_NAME_LOOKUP: Record<string, string> = Object.entries(CATEGORY_METADATA).reduce(
  (acc, [key, meta]) => {
    acc[key.toLowerCase()] = meta.displayName
    return acc
  },
  {} as Record<string, string>,
)

export function categoryDisplayName(rawCategory: string | null | undefined): string {
  if (!rawCategory) return '기타'
  const lookup = DISPLAY_NAME_LOOKUP[rawCategory.toLowerCase().trim()]
  return lookup ?? rawCategory
}

// 카테고리 키 목록 (Object.keys 와 동일하지만 순서 보장용 export)
export const CATEGORY_KEYS = Object.keys(CATEGORY_METADATA)
