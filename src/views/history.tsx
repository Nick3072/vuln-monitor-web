// v3.7 조치 이력(remediation history) 화면 — 취약 → 조치완료 처리 이벤트 목록.
// 출처: audit_log(manual_vuln_resolved) JOIN solutions. 그룹 스코핑은 라우트에서 강제됨.
import { Layout } from './layout'
import { categoryDisplayName } from './category-metadata'
import type { RemediationEntry, ResolveMethod } from '../lib/history'
import type { GroupSummary } from './dashboard'

export interface HistoryFilters {
  group: string | null
  from: string | null
  to: string | null
  q: string | null
}

interface HistoryProps {
  entries: RemediationEntry[]
  total: number
  page: number
  pageSize: number
  filters: HistoryFilters
  groupSummaries: GroupSummary[]
  activeGroup: string | null
  isAggregate: boolean
  currentUser?: {
    username: string
    role: 'admin' | 'operator' | 'system'
    groups: string[]
    id?: number
  }
}

export function History(props: HistoryProps) {
  const isAdmin = props.currentUser?.role === 'admin'
  const totalPages = Math.max(1, Math.ceil(props.total / props.pageSize))

  return (
    <Layout title="조치 이력" currentPath="/history" currentUser={props.currentUser} activeGroup={props.activeGroup}>
      <div class="page-header d-print-none">
        <div class="container-xl">
          <div class="row g-2 align-items-center">
            <div class="col">
              <div class="page-pretitle">이력</div>
              <h2 class="page-title">
                <i class="ti ti-history me-2"></i>조치 이력
              </h2>
              <div class="text-muted mt-1">취약점에 대해 조치완료 처리한 내역입니다. (총 {props.total}건)</div>
            </div>
          </div>
        </div>
      </div>

      <div class="page-body">
        <div class="container-xl">
          <FilterBar filters={props.filters} groupSummaries={props.groupSummaries} isAdmin={isAdmin} />

          <div class="card">
            <div class="card-body p-0">
              {props.entries.length === 0 ? (
                <EmptyState />
              ) : (
                <div class="table-responsive">
                  <table class="table table-vcenter card-table">
                    <thead>
                      <tr>
                        <th>조치일시</th>
                        <th>제품 / 호스트</th>
                        {isAdmin ? <th>그룹사</th> : null}
                        <th>카테고리</th>
                        <th>해결 CVE</th>
                        <th>버전</th>
                        <th>조치 방식</th>
                        <th>조치자</th>
                        <th>메모</th>
                        <th>현재</th>
                      </tr>
                    </thead>
                    <tbody>
                      {props.entries.map((e) => (
                        <HistoryRow entry={e} isAdmin={isAdmin} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {totalPages > 1 ? (
              <div class="card-footer d-flex align-items-center">
                <span class="text-muted small">
                  {props.page} / {totalPages} 페이지 · 총 {props.total}건
                </span>
                <Pager page={props.page} totalPages={totalPages} filters={props.filters} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Layout>
  )
}

function FilterBar(props: { filters: HistoryFilters; groupSummaries: GroupSummary[]; isAdmin: boolean }) {
  const f = props.filters
  return (
    <form method="get" action="/history" class="card mb-3">
      <div class="card-body py-2">
        <div class="row g-2 align-items-end">
          {props.isAdmin ? (
            <div class="col-12 col-md-3">
              <label class="form-label small mb-1">그룹사</label>
              <select name="group" class="form-select">
                <option value="">전체</option>
                {props.groupSummaries.map((g) => (
                  <option value={g.name} selected={f.group === g.name}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div class="col-6 col-md-2">
            <label class="form-label small mb-1">시작일</label>
            <input type="date" name="from" class="form-control" value={f.from ?? ''} />
          </div>
          <div class="col-6 col-md-2">
            <label class="form-label small mb-1">종료일</label>
            <input type="date" name="to" class="form-control" value={f.to ?? ''} />
          </div>
          <div class="col-12 col-md-3">
            <label class="form-label small mb-1">검색</label>
            <input
              type="text"
              name="q"
              class="form-control"
              placeholder="벤더 · 제품 · 호스트명"
              value={f.q ?? ''}
            />
          </div>
          <div class="col-12 col-md-2 d-flex gap-2">
            <button type="submit" class="btn btn-primary flex-fill">
              <i class="ti ti-filter me-1"></i>적용
            </button>
            <a href="/history" class="btn btn-outline-secondary" title="필터 초기화">
              <i class="ti ti-x"></i>
            </a>
          </div>
        </div>
      </div>
    </form>
  )
}

function HistoryRow(props: { entry: RemediationEntry; isAdmin: boolean }) {
  const e = props.entry
  return (
    <tr>
      <td class="text-muted small" style="white-space:nowrap">
        {formatDate(e.resolvedAt)}
      </td>
      <td>
        <div>
          <strong>{e.vendor}</strong> {e.product}
        </div>
        <div class="text-muted small">
          <i class="ti ti-server-2 me-1"></i>
          {e.hostname ?? '호스트 미지정'}
        </div>
      </td>
      {props.isAdmin ? (
        <td>
          {e.groupCompany ? (
            <span class="badge bg-purple-lt">{e.groupCompany}</span>
          ) : (
            <span class="text-muted">—</span>
          )}
        </td>
      ) : null}
      <td>
        <span class="badge bg-blue-lt">{categoryDisplayName(e.category)}</span>
      </td>
      <td>
        {e.cve ? <code class="text-muted">{e.cve}</code> : <span class="text-muted">—</span>}
      </td>
      <td>
        <code class="vm-ver">{e.currentVersion}</code>
      </td>
      <td>
        <MethodBadge method={e.method} />
      </td>
      <td class="text-muted small">{e.actor}</td>
      <td class="text-muted small" style="max-width:18rem">
        <span class="d-inline-block text-truncate" style="max-width:18rem" title={e.note ?? ''}>
          {e.note ?? '—'}
        </span>
      </td>
      <td>
        {e.currentlyVulnerable ? (
          <span class="badge bg-red text-white" title="조치 후 다시 취약 상태로 전환됨">
            <i class="ti ti-alert-triangle me-1"></i>재취약
          </span>
        ) : (
          <span class="badge bg-green-lt">유지</span>
        )}
      </td>
    </tr>
  )
}

function MethodBadge(props: { method: ResolveMethod }) {
  if (props.method === 'update') {
    return (
      <span class="badge bg-azure-lt">
        <i class="ti ti-package me-1"></i>버전 업데이트
      </span>
    )
  }
  return (
    <span class="badge bg-teal-lt">
      <i class="ti ti-tool me-1"></i>수동 조치
    </span>
  )
}

function Pager(props: { page: number; totalPages: number; filters: HistoryFilters }) {
  const qs = (page: number) => {
    const p = new URLSearchParams()
    if (props.filters.group) p.set('group', props.filters.group)
    if (props.filters.from) p.set('from', props.filters.from)
    if (props.filters.to) p.set('to', props.filters.to)
    if (props.filters.q) p.set('q', props.filters.q)
    p.set('page', String(page))
    return `/history?${p.toString()}`
  }
  const prev = Math.max(1, props.page - 1)
  const next = Math.min(props.totalPages, props.page + 1)
  return (
    <ul class="pagination m-0 ms-auto">
      <li class={`page-item ${props.page <= 1 ? 'disabled' : ''}`}>
        <a class="page-link" href={qs(prev)}>
          <i class="ti ti-chevron-left"></i> 이전
        </a>
      </li>
      <li class={`page-item ${props.page >= props.totalPages ? 'disabled' : ''}`}>
        <a class="page-link" href={qs(next)}>
          다음 <i class="ti ti-chevron-right"></i>
        </a>
      </li>
    </ul>
  )
}

function EmptyState() {
  return (
    <div class="empty">
      <div class="empty-icon">
        <i class="ti ti-checklist" style="font-size:3rem;color:var(--tblr-green)"></i>
      </div>
      <p class="empty-title">조치 이력이 없습니다</p>
      <p class="empty-subtitle text-muted">
        솔루션 관리에서 취약 항목을 <strong>조치완료</strong> 처리하면 여기에 이력이 표시됩니다.
      </p>
      <div class="empty-action">
        <a href="/solutions" class="btn btn-primary">
          <i class="ti ti-list me-1"></i>솔루션 관리로 이동
        </a>
      </div>
    </div>
  )
}

function formatDate(raw: string | null): string {
  if (!raw) return '—'
  return raw.replace('T', ' ').replace('Z', '').slice(0, 19)
}
