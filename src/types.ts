export interface Bindings {
  DB: D1Database
  API_KEY: string
  ENVIRONMENT: string
  N8N_REMATCH_WEBHOOK_URL?: string
  N8N_BACKFILL_WEBHOOK_URL?: string
  N8N_REMATCH_SECRET?: string
  NVD_API_KEY?: string
  // v2.4 추가
  AI?: Ai
  VECTORIZE?: VectorizeIndex
  // v2.7 추가 — 운영자 세션 로그인
  // v3.0 부트스트랩 후엔 ADMIN_PASSWORD 제거 가능 (D1 users 테이블이 진실 공급원).
  ADMIN_PASSWORD?: string // v2.7 호환용. v3.0 부트스트랩 후 더 이상 사용되지 않음.
  SESSION_SECRET?: string // HMAC 서명 키 (32+ 자 랜덤). 없으면 세션 발급 불가능
  // v3.5 로그인 화면 안내 (옵셔널) — 잠금/오류 시 운영자 연락처·도움말 링크 노출
  ADMIN_CONTACT?: string // 관리자 연락처(이메일/내선 등). 미설정 시 안내 미노출
  HELP_URL?: string // 도움말/문의 페이지 URL. 미설정 시 안내 미노출
}

// v3.0 — 다중 사용자
export type UserRole = 'admin' | 'operator' | 'system'

export interface User {
  id: number
  username: string
  display_name: string | null
  role: UserRole
  is_active: number
  session_version: number
  last_login_at: string | null
  created_at: string
  updated_at: string
}

// users + user_group_companies JOIN 결과
export interface UserWithGroups extends User {
  groups: string[]
}

// v3.6 그룹사 레지스트리 — group_companies 테이블 1행.
//   group_company 는 NAME 문자열 키 유지. 이 레지스트리는 "존재하는 그룹사"의 정규 목록
//   (장비 0개 그룹 포함) + 생성 메타데이터 + 삭제 가드 근거를 제공.
export interface GroupCompany {
  id: number
  name: string
  created_by_user_id: number | null
  created_at: string
}

// 레지스트리 + 파생 카운트(선택 화면/관리 화면 목록용). 카운트는 group_company 이름으로 집계.
export interface GroupCompanyWithCounts extends GroupCompany {
  assetCount: number // assets 행 수 (group_company = name)
  solutionCount: number // solutions(컴포넌트) 행 수
  vulnerableCount: number // is_vulnerable=1 컴포넌트 수
}

// v3.5 로그인 보안 — login_attempts 테이블 (감사/잠금 판정용). success: 0/1
export interface LoginAttempt {
  id: number
  username: string | null
  ip: string | null
  user_agent: string | null
  success: number
  reason: string | null
  created_at: string
}

export type WidgetType = 'filter_preset' | 'note'

export interface DashboardWidget {
  id: number
  widget_type: WidgetType
  title: string
  config_json: string // JSON 문자열 — UI 에서 파싱
  widget_order: number
  is_hidden: number
  created_by_user_id: number | null
  updated_by_user_id: number | null
  created_at: string
  updated_at: string
}

// 필터 프리셋 위젯 config 페이로드
export interface FilterPresetConfig {
  group_company?: string | null
  category?: string | null
  min_severity?: 'critical' | 'high' | 'medium' | 'low' | null
  // v3.3 영향시스템 필터
  impact_system?: ImpactSystem | null
}

// 노트 위젯 config 페이로드
export interface NoteConfig {
  content: string
  color?: 'blue' | 'yellow' | 'red' | 'green'
}

export interface Solution {
  id: number
  vendor: string
  product: string
  category: string
  current_version: string
  hostname: string | null
  owner: string | null // v3.4 의미상 "부서(department)"
  manager: string | null // v3.4 담당자(person in charge)
  notes: string | null
  group_company: string | null
  is_vulnerable: number
  last_matched_cve: string | null
  last_matched_at: string | null
  created_at: string
  updated_at: string
  // v2.4 매칭 메타데이터
  cpe_part: string | null
  cpe_version_range: string | null
  aliases: string | null
  vendor_normalized: string | null
  product_normalized: string | null
  embedding_status: string | null
  embedding_text: string | null
  embedding_updated_at: string | null
  // v2.5 다종 카테고리 확장
  cpe_uri: string | null
  category_attributes: string | null // JSON 문자열
  source: string | null // 'web' | 'api' | 'bulk_csv' | 'legacy'
  // v3.1 부모 솔루션(assets) 연결 — soft FK. 백필/등록 시 채워짐.
  asset_id: number | null
  // v3.2 수동 취약점 상태 오버라이드
  manual_status: string | null // null=자동(n8n) | 'vulnerable' | 'resolved'
  status_note: string | null
  status_updated_at: string | null
  status_updated_by: string | null
}

// 수동 취약점 상태 변경 액션
export type ManualVulnAction = 'vulnerable' | 'resolved' | 'auto'

// 수동 '취약' 표시 입력 (운영자가 n8n 미검출 취약점을 직접 등록)
export interface MarkVulnerableInput {
  cve_id?: string | null // 미입력 시 시스템이 MANUAL-<id>-<n> 부여
  severity?: string | null // critical | high | medium | low
  title?: string | null
  note?: string | null
}

// ============================================================
// v3.3 영향시스템(impact_system) — 회사 공식 "영향 시스템" 6종(자산 분류축).
//   - solutions.category(컴포넌트 타입)와 직교하는 별개 차원.
//   - 코드값 저장, 한국어 표시명은 src/views/impact-system-metadata.ts 에서 매핑.
// ============================================================
export type ImpactSystem =
  | 'PC'
  | 'SERVER'
  | 'WEBWAS'
  | 'DATABASE'
  | 'NETWORK'
  | 'APPLICATION'

// 분류 출처: 'derived'=자동추론(재추론 갱신 대상) | 'manual'=운영자 확정(재추론이 안 덮음).
export type ImpactSystemSource = 'derived' | 'manual'

// ============================================================
// v3.1 부모 "솔루션"(자산) 엔티티 — assets 테이블
//   - 운영자가 등록·관리하는 단위. 하나의 자산이 OS/HW/OpenSSL 등 컴포넌트 N개를 소유.
//   - 자연키: (group_company, hostname). hostname 이 비어있으면 단독 자산.
//   - 취약 여부/카테고리는 저장하지 않고 컴포넌트 집계로 파생.
// ============================================================
export interface Asset {
  id: number
  name: string
  vendor: string | null
  hostname: string | null
  group_company: string | null
  owner: string | null // v3.4 의미상 "부서(department)"
  manager: string | null // v3.4 담당자(person in charge)
  notes: string | null
  created_at: string
  updated_at: string
  // v3.3 영향시스템 주 분류 (단일값). NULL = 미설정.
  impact_system: ImpactSystem | null
  impact_system_source: ImpactSystemSource | null
}

// assets + 소속 컴포넌트(solutions) 묶음 — 그룹 뷰 렌더용
export interface AssetWithComponents {
  asset: Asset
  components: Solution[]
  componentCount: number
  vulnerableCount: number
  hasVulnerable: boolean
}

// 부모 자산 생성/수정 입력
export interface AssetInput {
  name: string
  vendor: string | null
  hostname: string | null
  group_company: string | null
  owner: string | null // 부서(department)
  manager: string | null // 담당자(person in charge)
  notes: string | null
  // v3.3 영향시스템 주 분류. 옵셔널(후방호환). 운영자가 지정하면 source='manual' 로 저장.
  impact_system?: ImpactSystem | null
}

export interface SolutionInput {
  vendor: string
  product: string
  category: string
  current_version: string
  hostname: string | null
  owner: string | null // 부서(department)
  manager: string | null // 담당자(person in charge)
  notes: string | null
  group_company: string | null
  cpe_part: string | null
  cpe_version_range: string | null
  aliases: string[] | null
  // v2.5
  cpe_uri: string | null
  category_attributes: Record<string, unknown> | null
  // v3.1 — 등록 시 연결할 부모 자산. null 이면 (group_company, hostname) 기준 자동 resolve/create.
  asset_id?: number | null
}

// 일괄 등록 (CSV/JSON)
export type BulkSource = 'csv' | 'json'

export interface BulkImportRow {
  index: number // 1-based row number for error reporting
  input: SolutionInput
}

export interface BulkImportRowError {
  row: number
  vendor?: string
  product?: string
  error: string
}

export interface BulkImportResult {
  total: number // 입력 단위 수 (equipment 모드면 장비 수, legacy면 솔루션 수)
  created: number // 실제 생성된 솔루션 행 수
  errors: BulkImportRowError[]
  source: BulkSource
  kind?: 'legacy' | 'equipment'
  componentsExpanded?: number // equipment 모드에서 분해 시도된 총 컴포넌트 수
}

export interface MatchedVuln {
  id: number
  solution_id: number
  cve_id: string | null
  source: string | null
  severity: string | null
  title: string | null
  description: string | null
  url: string | null
  published: string | null
  detected_at: string
  first_seen_at: string | null
  // v2.4 매칭 신뢰도
  match_score: number | null
  match_reasons: string | null
  epss_score: number | null
  is_kev: number | null
  cvss_score: number | null
}

export interface MatchInput {
  solution_id: number
  cve_id: string
  source: string
  severity: string | null
  title: string | null
  description: string | null
  url: string | null
  published: string | null
  first_seen_at?: string | null
  match_score?: number | null
  match_reasons?: string[] | null
  epss_score?: number | null
  is_kev?: boolean | null
  cvss_score?: number | null
}

export interface CpeSuggestion {
  cpe_name: string
  cpe_part: string
  vendor: string
  product: string
  title: string | null
  deprecated: boolean
}

export interface SemanticMatchRequest {
  vulnerabilities: Array<{
    cve_id: string
    title?: string | null
    description?: string | null
  }>
  top_k?: number
  threshold?: number
}

export interface SemanticMatchHit {
  solution_id: number
  cve_id: string
  score: number
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  meta?: {
    total?: number
    page?: number
    limit?: number
  }
}
