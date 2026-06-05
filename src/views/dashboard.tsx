import { Layout } from './layout'
import { raw } from 'hono/html'
import type { DashboardWidget, MatchedVuln } from '../types'
import { CATEGORY_KEYS, CATEGORY_METADATA, categoryDisplayName } from './category-metadata'

export interface DashboardStats {
  total: number
  vulnerable: number
  lastMatchedAt: string | null
  // v3.1 부모 자산 수 / 구성요소 수 (optional — 없으면 기존 total 표시)
  assetTotal?: number
  componentTotal?: number
}

export interface GroupSummary {
  name: string
  total: number
  vulnerable: number
}

export interface CategorySummary {
  name: string
  total: number
  vulnerable: number
}

export interface LatestMatch {
  cve_id: string | null
  severity: string | null
  source: string | null
  url: string | null
  title: string | null
  published: string | null
  detected_at: string
}

export interface SolutionMatchGroup {
  solution_id: number
  vendor: string
  product: string
  current_version: string
  hostname: string | null
  group_company: string | null
  cve_count: number
  latest: LatestMatch
  allMatches: MatchedVuln[]
}

interface DashboardProps {
  stats: DashboardStats
  groupSummaries: GroupSummary[]
  categorySummaries: CategorySummary[]
  activeGroup: string | null
  recentGroups: SolutionMatchGroup[]
  widgets: DashboardWidget[]
  flash?: string | null
  error?: string | null
  currentUser?: {
    username: string
    role: 'admin' | 'operator' | 'system'
    groups: string[]
    id: number
  }
}

export function Dashboard(props: DashboardProps) {
  const healthy = props.stats.total - props.stats.vulnerable
  // v3.1: 부모 자산 수가 있으면 그것을 primary 숫자로 표시, 없으면 기존 total
  const assetDisplayValue = props.stats.assetTotal ?? props.stats.total
  const assetSubtitle = props.stats.assetTotal != null
    ? `구성요소 ${props.stats.componentTotal ?? props.stats.total}개 · 취약 ${props.stats.vulnerable}`
    : `정상 ${healthy} · 취약 ${props.stats.vulnerable}`

  return (
    <Layout title="대시보드" currentPath="/" currentUser={props.currentUser}>
      <div class="page-header d-print-none">
        <div class="container-xl">
          <div class="row g-2 align-items-center">
            <div class="col">
              <div class="page-pretitle">개요</div>
              <h2 class="page-title">보안솔루션 취약점 모니터링</h2>
            </div>
            <div class="col-auto ms-auto d-print-none">
              <div class="btn-list">
                <button
                  type="button"
                  class="btn btn-outline-primary"
                  data-bs-toggle="modal"
                  data-bs-target="#widget-create-modal"
                >
                  <i class="ti ti-plus me-1"></i>위젯 추가
                </button>
                <a href="/solutions" class="btn btn-primary d-inline-flex align-items-center">
                  <i class="ti ti-list me-1"></i> 솔루션 목록
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="page-body">
        <div class="container-xl">
          {props.flash ? (
            <div class="alert alert-success alert-dismissible mb-3" role="alert">
              <i class="ti ti-circle-check me-2"></i>
              {props.flash}
              <a class="btn-close" data-bs-dismiss="alert" aria-label="close"></a>
            </div>
          ) : null}
          {props.error ? (
            <div class="alert alert-danger alert-dismissible mb-3" role="alert">
              <i class="ti ti-alert-circle me-2"></i>
              {props.error}
              <a class="btn-close" data-bs-dismiss="alert" aria-label="close"></a>
            </div>
          ) : null}

          <div class="row row-deck row-cards">
            <StatCard
              title="총 솔루션 수"
              value={String(assetDisplayValue)}
              subtitle={assetSubtitle}
              icon="server-2"
              color="blue"
            />
            <StatCard
              title="취약 솔루션 수"
              value={String(props.stats.vulnerable)}
              subtitle={
                props.stats.vulnerable > 0
                  ? '즉시 패치 검토 필요'
                  : '매칭된 취약점 없음'
              }
              icon="alert-triangle"
              color={props.stats.vulnerable > 0 ? 'red' : 'green'}
            />
            <StatCard
              title="최근 매칭 시각"
              value={formatDate(props.stats.lastMatchedAt) ?? '—'}
              subtitle={
                props.stats.lastMatchedAt
                  ? 'n8n 워크플로우 마지막 실행'
                  : 'n8n 실행 대기'
              }
              icon="clock"
              color="azure"
              compact
            />
          </div>

          {props.groupSummaries.length > 0 ? (
            <GroupFilterBar
              groups={props.groupSummaries}
              activeGroup={props.activeGroup}
            />
          ) : null}

          <CategoryGrid items={props.categorySummaries} activeGroup={props.activeGroup} />

          <WidgetsSection
            widgets={props.widgets}
            currentUserId={props.currentUser?.id ?? 0}
            isAdmin={props.currentUser?.role === 'admin'}
            groups={props.groupSummaries.map((g) => g.name)}
          />

          <div class="row row-cards mt-3">
            <div class="col-12">
              <div class="card">
                <div class="card-header">
                  <h3 class="card-title">
                    <i class="ti ti-alert-circle me-1 text-red"></i>
                    최근 매칭된 취약점 {props.activeGroup ? `— ${props.activeGroup}` : ''}
                  </h3>
                  <div class="card-actions">
                    <span class="text-muted">솔루션별 최신 1건 · 최대 15건</span>
                  </div>
                </div>
                <div class="card-body p-0">
                  {props.recentGroups.length === 0 ? (
                    <div class="empty">
                      <div class="empty-icon">
                        <i class="ti ti-mood-check" style="font-size:3rem;color:var(--tblr-green)"></i>
                      </div>
                      <p class="empty-title">매칭된 취약점이 없습니다</p>
                      <p class="empty-subtitle text-muted">
                        n8n 워크플로우 실행 시 CVE 매칭 결과가 여기에 표시됩니다.
                      </p>
                    </div>
                  ) : (
                    <div class="table-responsive">
                      <table class="table table-vcenter card-table">
                        <thead>
                          <tr>
                            <th style="width:2.5rem"></th>
                            <th>제품 / 호스트</th>
                            <th>버전</th>
                            <th>그룹사</th>
                            <th>최근 CVE</th>
                            <th>심각도</th>
                            <th>CVE 수</th>
                            <th>출처</th>
                            <th>감지</th>
                          </tr>
                        </thead>
                        <tbody>
                          {props.recentGroups.map((g) => (
                            <SolutionMatchRow group={g} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {raw(`<script>
document.addEventListener('DOMContentLoaded', function() {
  // CVE 펼침 토글
  document.querySelectorAll('[data-toggle-cves]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = btn.getAttribute('data-toggle-cves');
      var row = document.getElementById('cves-' + id);
      if (!row) return;
      var hidden = row.classList.toggle('d-none');
      btn.setAttribute('aria-expanded', String(!hidden));
      var icon = btn.querySelector('i');
      if (icon) {
        icon.classList.toggle('ti-chevron-down', hidden);
        icon.classList.toggle('ti-chevron-up', !hidden);
      }
    });
  });

  // 위젯 삭제 confirm
  document.querySelectorAll('form[data-confirm]').forEach(function(form) {
    form.addEventListener('submit', function(ev) {
      if (!confirm(form.getAttribute('data-confirm') || '진행하시겠습니까?')) ev.preventDefault();
    });
  });

  // === 위젯 생성 모달: 유형 전환 + 제출 시 config_json 직렬화 ===
  var typeSelect = document.getElementById('widget-type-select');
  var filterFields = document.getElementById('widget-filter-fields');
  var noteFields = document.getElementById('widget-note-fields');
  function toggleWidgetType() {
    if (!typeSelect) return;
    var t = typeSelect.value;
    if (filterFields) filterFields.style.display = (t === 'filter_preset') ? '' : 'none';
    if (noteFields) noteFields.style.display = (t === 'note') ? '' : 'none';
  }
  if (typeSelect) {
    typeSelect.addEventListener('change', toggleWidgetType);
    toggleWidgetType();
  }
  var createForm = document.getElementById('widget-create-form');
  if (createForm) {
    createForm.addEventListener('submit', function(ev) {
      var t = (typeSelect && typeSelect.value) || 'filter_preset';
      var cfg = {};
      if (t === 'filter_preset') {
        var g = (document.getElementById('filter-group') || {}).value || '';
        var c = (document.getElementById('filter-category') || {}).value || '';
        var s = (document.getElementById('filter-severity') || {}).value || '';
        if (g.trim()) cfg.group_company = g.trim();
        if (c.trim()) cfg.category = c.trim();
        if (s.trim()) cfg.min_severity = s.trim();
        if (Object.keys(cfg).length === 0) {
          ev.preventDefault();
          alert('필터 항목을 최소 1개 이상 선택해주세요.');
          return;
        }
      } else {
        var content = ((document.getElementById('note-content') || {}).value || '').trim();
        var color = (document.getElementById('note-color') || {}).value || 'blue';
        if (!content) {
          ev.preventDefault();
          alert('노트 내용을 입력해주세요.');
          return;
        }
        cfg.content = content;
        cfg.color = color;
      }
      var hidden = document.getElementById('widget-config-json');
      if (hidden) hidden.value = JSON.stringify(cfg);
    });
  }

  // === 위젯 수정 모달들: 제출 시 config_json 직렬화 ===
  document.querySelectorAll('.widget-edit-form').forEach(function(form) {
    form.addEventListener('submit', function() {
      var t = form.getAttribute('data-widget-type');
      var cfg = {};
      if (t === 'filter_preset') {
        var g = (form.querySelector('.widget-edit-group') || {}).value || '';
        var c = (form.querySelector('.widget-edit-cat') || {}).value || '';
        var s = (form.querySelector('.widget-edit-sev') || {}).value || '';
        if (g.trim()) cfg.group_company = g.trim();
        if (c.trim()) cfg.category = c.trim();
        if (s.trim()) cfg.min_severity = s.trim();
      } else {
        var content = ((form.querySelector('.widget-edit-content') || {}).value || '').trim();
        var color = (form.querySelector('.widget-edit-color') || {}).value || 'blue';
        cfg.content = content;
        cfg.color = color;
      }
      var hidden = form.querySelector('.widget-edit-config-json');
      if (hidden) hidden.value = JSON.stringify(cfg);
    });
  });
});
</script>`)}
    </Layout>
  )
}

function CategoryGrid(props: { items: CategorySummary[]; activeGroup: string | null }) {
  if (props.items.length === 0) return null
  const scopeLabel = props.activeGroup ? `— ${props.activeGroup}` : ''
  return (
    <div class="row row-cards mt-3">
      <div class="col-12">
        <div class="card">
          <div class="card-header py-2">
            <h3 class="card-title mb-0">
              <i class="ti ti-category me-1 text-azure"></i>
              카테고리별 현황 {scopeLabel}
            </h3>
            <div class="card-actions">
              <span class="text-muted small">총 {props.items.length}개 카테고리</span>
            </div>
          </div>
          <div class="card-body p-2">
            <div class="row g-2">
              {props.items.map((c) => (
                <div class="col-6 col-md-4 col-lg-3 col-xl-2">
                  <a
                    href={`/solutions?${
                      props.activeGroup
                        ? `group=${encodeURIComponent(props.activeGroup)}&`
                        : ''
                    }category=${encodeURIComponent(c.name)}`}
                    class="card card-sm text-decoration-none text-reset"
                    title="솔루션 목록에서 이 카테고리만 보기"
                  >
                    <div class="card-body p-2 text-center">
                      <div class="text-muted small text-truncate">
                        {categoryDisplayName(c.name)}
                      </div>
                      <div class="h3 mb-1 mt-1">{c.total}</div>
                      {c.vulnerable > 0 ? (
                        <span class="badge bg-red text-white">취약 {c.vulnerable}</span>
                      ) : (
                        <span class="badge bg-green-lt">정상</span>
                      )}
                    </div>
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function GroupFilterBar(props: { groups: GroupSummary[]; activeGroup: string | null }) {
  return (
    <div class="row row-cards mt-3">
      <div class="col-12">
        <div class="card">
          <div class="card-body py-2 d-flex flex-wrap gap-2 align-items-center">
            <span class="text-muted me-2">
              <i class="ti ti-building me-1"></i>그룹사
            </span>
            <a
              href="/"
              class={`btn btn-sm ${
                props.activeGroup === null ? 'btn-primary' : 'btn-outline-secondary'
              }`}
            >
              전체
            </a>
            {props.groups.map((g) => {
              const active = props.activeGroup === g.name
              return (
                <a
                  href={`/?group=${encodeURIComponent(g.name)}`}
                  class={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}`}
                >
                  {g.name}
                  <span class="badge bg-secondary text-white ms-2">{g.total}</span>
                  {g.vulnerable > 0 ? (
                    <span class="badge bg-red text-white ms-1">{g.vulnerable}</span>
                  ) : null}
                </a>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function SolutionMatchRow(props: { group: SolutionMatchGroup }) {
  const g = props.group
  const hasMultiple = g.cve_count > 1
  return (
    <>
      <tr class="bg-red-lt">
        <td>
          {hasMultiple ? (
            <button
              type="button"
              class="btn btn-sm btn-icon btn-ghost-secondary"
              data-toggle-cves={String(g.solution_id)}
              aria-expanded="false"
              aria-label="CVE 목록 펼치기"
            >
              <i class="ti ti-chevron-down"></i>
            </button>
          ) : (
            <span class="text-muted">—</span>
          )}
        </td>
        <td>
          <div>
            <strong>{g.vendor}</strong> {g.product}
          </div>
          <div class="text-muted small">
            <i class="ti ti-server-2 me-1"></i>
            {g.hostname ?? '호스트 미지정'}
          </div>
        </td>
        <td>
          <code class="text-muted">{g.current_version}</code>
        </td>
        <td>
          {g.group_company ? (
            <span class="badge bg-purple-lt">{g.group_company}</span>
          ) : (
            <span class="text-muted">—</span>
          )}
        </td>
        <td>
          {g.latest.url ? (
            <a href={g.latest.url} target="_blank" rel="noopener noreferrer">
              {g.latest.cve_id ?? '—'}
            </a>
          ) : (
            g.latest.cve_id ?? '—'
          )}
        </td>
        <td>
          <SeverityBadge severity={g.latest.severity} />
        </td>
        <td>
          <span class="badge bg-red text-white">{g.cve_count}</span>
        </td>
        <td>
          <span class="badge bg-secondary-lt">{g.latest.source ?? '—'}</span>
        </td>
        <td class="text-muted">{formatDate(g.latest.detected_at)}</td>
      </tr>
      {hasMultiple ? (
        <tr id={`cves-${g.solution_id}`} class="d-none">
          <td colspan={9} class="bg-red-lt">
            <div class="p-2">
              <div class="small text-muted mb-2">
                감지된 {g.cve_count}건 전체 (최근순)
              </div>
              <table class="table table-sm mb-0 bg-white">
                <thead>
                  <tr>
                    <th>CVE</th>
                    <th>심각도</th>
                    <th>출처</th>
                    <th>공개</th>
                    <th>감지</th>
                    <th>제목</th>
                  </tr>
                </thead>
                <tbody>
                  {g.allMatches.map((m) => (
                    <tr>
                      <td>
                        {m.url ? (
                          <a href={m.url} target="_blank" rel="noopener noreferrer">
                            {m.cve_id ?? '—'}
                          </a>
                        ) : (
                          m.cve_id ?? '—'
                        )}
                      </td>
                      <td>
                        <SeverityBadge severity={m.severity} />
                      </td>
                      <td>
                        <span class="badge bg-secondary-lt">{m.source ?? '—'}</span>
                      </td>
                      <td class="text-muted small">{m.published ?? '—'}</td>
                      <td class="text-muted small">{formatDate(m.detected_at)}</td>
                      <td class="text-truncate" style="max-width:28rem">
                        {m.title ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

interface StatCardProps {
  title: string
  value: string
  subtitle: string
  icon: string
  color: string
  compact?: boolean
}

function StatCard(props: StatCardProps) {
  return (
    <div class="col-sm-6 col-lg-4">
      <div class="card card-sm">
        <div class="card-body">
          <div class="row align-items-center">
            <div class="col-auto">
              <span class={`bg-${props.color} text-white avatar`}>
                <i class={`ti ti-${props.icon}`}></i>
              </span>
            </div>
            <div class="col">
              <div class={props.compact ? 'font-weight-medium' : 'h1 m-0'}>{props.value}</div>
              <div class="text-secondary">{props.title}</div>
              <div class="text-muted small mt-1">{props.subtitle}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SeverityBadge(props: { severity: string | null }) {
  if (!props.severity) {
    return <span class="badge bg-secondary-lt">N/A</span>
  }
  const sev = props.severity.toLowerCase()
  const classMap: Record<string, string> = {
    critical: 'bg-red text-white',
    high: 'bg-orange text-white',
    medium: 'bg-yellow',
    low: 'bg-azure-lt',
  }
  const cls = classMap[sev] ?? 'bg-secondary-lt'
  return <span class={`badge ${cls}`}>{props.severity}</span>
}

function formatDate(raw: string | null): string | null {
  if (!raw) return null
  return raw.replace('T', ' ').replace('Z', '').slice(0, 19)
}

// === v3.0 공유 대시보드 위젯 ===

function WidgetsSection(props: {
  widgets: DashboardWidget[]
  currentUserId: number
  isAdmin: boolean
  groups: string[]
}) {
  // CategoryGrid 와 동일한 row-cards mt-3 박스에 담아 시각적 일관성 유지
  return (
    <>
      <div class="row row-cards mt-3">
        <div class="col-12">
          <div class="card">
            <div class="card-header py-2">
              <h3 class="card-title mb-0">
                <i class="ti ti-layout-board me-1 text-azure"></i>
                공유 보드
              </h3>
              <div class="card-actions">
                <span class="text-muted small">필터 프리셋·공유 노트 · {props.widgets.length}개</span>
              </div>
            </div>
            <div class="card-body p-2">
              {props.widgets.length === 0 ? (
                <div class="text-center text-muted py-3 small">
                  아직 추가된 위젯이 없습니다. 상단의 <strong>위젯 추가</strong> 버튼으로 필터 프리셋 또는 공유 노트를 만들어보세요.
                </div>
              ) : (
                <div class="row g-2">
                  {props.widgets.map((w) => (
                    <WidgetCard
                      widget={w}
                      currentUserId={props.currentUserId}
                      isAdmin={props.isAdmin}
                      groups={props.groups}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <WidgetCreateModal groups={props.groups} />
      {props.widgets.map((w) =>
        canEditWidget(w, props.currentUserId, props.isAdmin) ? (
          <WidgetEditModal widget={w} groups={props.groups} />
        ) : null,
      )}
    </>
  )
}

function canEditWidget(w: DashboardWidget, userId: number, isAdmin: boolean): boolean {
  return isAdmin || w.created_by_user_id === userId
}

function safeParseConfig(json: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(json)
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>
  } catch {
    // ignore
  }
  return null
}

function WidgetCard(props: {
  widget: DashboardWidget
  currentUserId: number
  isAdmin: boolean
  groups: string[]
}) {
  const w = props.widget
  const config = safeParseConfig(w.config_json) ?? {}
  const editable = canEditWidget(w, props.currentUserId, props.isAdmin)

  if (w.widget_type === 'filter_preset') {
    const g = typeof config.group_company === 'string' ? config.group_company : null
    const cat = typeof config.category === 'string' ? config.category : null
    const sev = typeof config.min_severity === 'string' ? config.min_severity : null
    const params = new URLSearchParams()
    if (g) params.set('group', g)
    if (cat) params.set('category', cat)
    // min_severity 는 추후 솔루션 필터에서 처리 가능. 현재는 group/category 만 라우팅.
    return (
      <div class="col-12 col-md-6 col-lg-4">
        <div class="card card-sm h-100">
          <div class="card-body p-2">
            <div class="d-flex align-items-center mb-1">
              <i class="ti ti-filter text-azure me-1"></i>
              <strong class="me-auto">{w.title}</strong>
              <WidgetActions widget={w} editable={editable} />
            </div>
            <div class="small text-muted mb-2">
              {g ? <span class="badge bg-purple-lt me-1">{g}</span> : null}
              {cat ? <span class="badge bg-blue-lt me-1">{categoryDisplayName(cat)}</span> : null}
              {sev ? <span class="badge bg-orange-lt me-1">{sev}+</span> : null}
            </div>
            <a href={`/solutions?${params.toString()}`} class="btn btn-sm btn-outline-primary w-100">
              <i class="ti ti-arrow-right me-1"></i>적용
            </a>
          </div>
        </div>
      </div>
    )
  }

  // note
  const content = typeof config.content === 'string' ? config.content : ''
  const colorRaw = typeof config.color === 'string' ? config.color : 'blue'
  const colorCls = ['blue', 'yellow', 'red', 'green'].includes(colorRaw) ? colorRaw : 'blue'
  return (
    <div class="col-12 col-md-6 col-lg-4">
      <div class={`card card-sm h-100 border-${colorCls}`}>
        <div class="card-body p-2">
          <div class="d-flex align-items-center mb-1">
            <i class={`ti ti-note text-${colorCls} me-1`}></i>
            <strong class="me-auto">{w.title}</strong>
            <WidgetActions widget={w} editable={editable} />
          </div>
          <div class="small" style="white-space: pre-wrap; word-break: break-word">
            {content}
          </div>
          <div class="text-muted small mt-2">
            {w.updated_at.replace('T', ' ').slice(0, 16)}
          </div>
        </div>
      </div>
    </div>
  )
}

function WidgetActions(props: { widget: DashboardWidget; editable: boolean }) {
  const w = props.widget
  return (
    <div class="btn-list flex-nowrap">
      <form method="post" action={`/dashboard/widgets/${w.id}/move/up`} class="d-inline">
        <button type="submit" class="btn btn-sm btn-icon" title="위로">
          <i class="ti ti-chevron-up"></i>
        </button>
      </form>
      <form method="post" action={`/dashboard/widgets/${w.id}/move/down`} class="d-inline">
        <button type="submit" class="btn btn-sm btn-icon" title="아래로">
          <i class="ti ti-chevron-down"></i>
        </button>
      </form>
      {props.editable ? (
        <>
          <button
            type="button"
            class="btn btn-sm btn-icon"
            data-bs-toggle="modal"
            data-bs-target={`#widget-edit-modal-${w.id}`}
            title="수정"
          >
            <i class="ti ti-edit"></i>
          </button>
          <form
            method="post"
            action={`/dashboard/widgets/${w.id}/delete`}
            class="d-inline"
            data-confirm={`위젯 "${w.title}"을(를) 삭제하시겠습니까?`}
          >
            <button type="submit" class="btn btn-sm btn-icon text-danger" title="삭제">
              <i class="ti ti-trash"></i>
            </button>
          </form>
        </>
      ) : null}
    </div>
  )
}

function WidgetCreateModal(props: { groups: string[] }) {
  return (
    <div class="modal modal-blur fade" id="widget-create-modal" tabindex={-1}>
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">위젯 추가</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <form method="post" action="/dashboard/widgets" id="widget-create-form">
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label required">유형</label>
                <select name="widget_type" id="widget-type-select" class="form-select" required>
                  <option value="filter_preset">필터 프리셋 — 자주 쓰는 그룹사/카테고리 조합</option>
                  <option value="note">공유 노트 — 팀 메모</option>
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label required">제목</label>
                <input type="text" name="title" class="form-control" required maxlength={100} />
              </div>

              {/* 필터 프리셋 영역 */}
              <div id="widget-filter-fields">
                <div class="row g-2">
                  <div class="col-md-6">
                    <label class="form-label">그룹사</label>
                    <input type="text" id="filter-group" class="form-control" list="filter-group-list" placeholder="예: 본사" />
                    <datalist id="filter-group-list">
                      {props.groups.map((g) => (
                        <option value={g}></option>
                      ))}
                    </datalist>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">카테고리</label>
                    <select id="filter-category" class="form-select">
                      <option value="">(전체)</option>
                      {CATEGORY_KEYS.map((k) => (
                        <option value={k}>{CATEGORY_METADATA[k].displayName}</option>
                      ))}
                    </select>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">최소 심각도</label>
                    <select id="filter-severity" class="form-select">
                      <option value="">(전체)</option>
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* 노트 영역 */}
              <div id="widget-note-fields" style="display:none">
                <div class="row g-2">
                  <div class="col-12">
                    <label class="form-label">내용</label>
                    <textarea id="note-content" class="form-control" rows={4} maxlength={2000} placeholder="공유 메모..."></textarea>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">강조 색</label>
                    <select id="note-color" class="form-select">
                      <option value="blue">파랑 (기본)</option>
                      <option value="yellow">노랑 (주의)</option>
                      <option value="red">빨강 (긴급)</option>
                      <option value="green">초록 (완료/정상)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* config_json 직렬화 hidden */}
              <input type="hidden" name="config_json" id="widget-config-json" value="{}" />
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-link link-secondary" data-bs-dismiss="modal">
                취소
              </button>
              <button type="submit" class="btn btn-primary">
                <i class="ti ti-plus me-1"></i>추가
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function WidgetEditModal(props: { widget: DashboardWidget; groups: string[] }) {
  const w = props.widget
  const config = safeParseConfig(w.config_json) ?? {}
  const isFilter = w.widget_type === 'filter_preset'
  const prefillGroup = isFilter && typeof config.group_company === 'string' ? (config.group_company as string) : ''
  const prefillCat = isFilter && typeof config.category === 'string' ? (config.category as string) : ''
  const prefillSev = isFilter && typeof config.min_severity === 'string' ? (config.min_severity as string) : ''
  const prefillContent = !isFilter && typeof config.content === 'string' ? (config.content as string) : ''
  const prefillColor = !isFilter && typeof config.color === 'string' ? (config.color as string) : 'blue'
  return (
    <div class="modal modal-blur fade" id={`widget-edit-modal-${w.id}`} tabindex={-1}>
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">위젯 수정 — {w.title}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <form method="post" action={`/dashboard/widgets/${w.id}`} class="widget-edit-form" data-widget-type={w.widget_type}>
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label required">제목</label>
                <input type="text" name="title" class="form-control" required maxlength={100} value={w.title} />
              </div>

              {isFilter ? (
                <div class="row g-2">
                  <div class="col-md-6">
                    <label class="form-label">그룹사</label>
                    <input type="text" class="form-control widget-edit-group" list={`filter-group-list-edit-${w.id}`} value={prefillGroup} />
                    <datalist id={`filter-group-list-edit-${w.id}`}>
                      {props.groups.map((g) => (
                        <option value={g}></option>
                      ))}
                    </datalist>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">카테고리</label>
                    <select class="form-select widget-edit-cat">
                      <option value="">(전체)</option>
                      {CATEGORY_KEYS.map((k) => (
                        <option value={k} selected={k === prefillCat}>{CATEGORY_METADATA[k].displayName}</option>
                      ))}
                    </select>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">최소 심각도</label>
                    <select class="form-select widget-edit-sev">
                      <option value="" selected={prefillSev === ''}>(전체)</option>
                      <option value="critical" selected={prefillSev === 'critical'}>Critical</option>
                      <option value="high" selected={prefillSev === 'high'}>High</option>
                      <option value="medium" selected={prefillSev === 'medium'}>Medium</option>
                      <option value="low" selected={prefillSev === 'low'}>Low</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div class="row g-2">
                  <div class="col-12">
                    <label class="form-label">내용</label>
                    <textarea class="form-control widget-edit-content" rows={4} maxlength={2000}>{prefillContent}</textarea>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">강조 색</label>
                    <select class="form-select widget-edit-color">
                      <option value="blue" selected={prefillColor === 'blue'}>파랑</option>
                      <option value="yellow" selected={prefillColor === 'yellow'}>노랑</option>
                      <option value="red" selected={prefillColor === 'red'}>빨강</option>
                      <option value="green" selected={prefillColor === 'green'}>초록</option>
                    </select>
                  </div>
                </div>
              )}

              <input type="hidden" name="config_json" class="widget-edit-config-json" value={w.config_json} />
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-link link-secondary" data-bs-dismiss="modal">
                취소
              </button>
              <button type="submit" class="btn btn-primary">저장</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
