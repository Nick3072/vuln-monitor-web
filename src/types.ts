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
  owner: string | null
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
  owner: string | null
  notes: string | null
  created_at: string
  updated_at: string
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
  owner: string | null
  notes: string | null
}

export interface SolutionInput {
  vendor: string
  product: string
  category: string
  current_version: string
  hostname: string | null
  owner: string | null
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
