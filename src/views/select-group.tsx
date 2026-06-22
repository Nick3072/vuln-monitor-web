// v3.6 그룹사 선택 화면 — 로그인 후 항상 거치는 standalone 페이지.
// login.tsx 처럼 공유 Layout/Navbar 미사용(게이트 루프 회피). 자체 헤더에 로그아웃 포함.

import { ALL_GROUPS_SENTINEL } from '../lib/active-group'
import { SYSTEM_GROUP } from '../lib/group-companies'

const TABLER_VERSION = '1.0.0-beta20'

export interface GroupCardData {
  name: string
  assetCount: number
  solutionCount: number
  vulnerableCount: number
}

interface SelectGroupPageProps {
  groups: GroupCardData[]
  currentUser: { username: string; role: 'admin' | 'operator' | 'system'; id: number }
  isAdmin: boolean
  next?: string | null
  flash?: string | null
  error?: string | null
  systemBucketCount?: number // admin 전용: 'system'(미분류) 버킷 컴포넌트 수
}

export function SelectGroupPage(props: SelectGroupPageProps) {
  const next = props.next ?? '/'
  const flashMsg = formatFlash(props.flash)
  const errorMsg = formatError(props.error)
  const isAdmin = props.isAdmin
  const hasNoGroups = props.groups.length === 0 && !isAdmin
  // 생성 모달 datalist — 기존 이름 제시(오타 분절 완화)
  const existingNames = props.groups.map((g) => g.name)

  return (
    <html lang="ko">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>그룹사 선택 — Vuln Monitor</title>
        <link
          rel="stylesheet"
          href={`https://cdn.jsdelivr.net/npm/@tabler/core@${TABLER_VERSION}/dist/css/tabler.min.css`}
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css"
        />
        <style>{`
          body {
            font-feature-settings: "cv11", "ss01";
            background:
              radial-gradient(1200px 600px at 100% -10%, rgba(32,107,196,.06), transparent 60%),
              linear-gradient(180deg, #f7f9fc 0%, #eef1f6 100%);
            min-height: 100vh;
          }
          .sg-card { border:1px solid rgba(20,30,60,.08); border-radius:.65rem; transition:transform .15s ease, box-shadow .15s ease; }
          .sg-card:hover { transform: translateY(-2px); box-shadow:0 6px 24px -8px rgba(20,30,60,.18); border-color:rgba(32,107,196,.35); }
          .sg-card.is-vuln { border-left:3px solid #c92a2a; }
          .sg-card.is-special { border:1px dashed rgba(32,107,196,.5); background:rgba(32,107,196,.03); }
        `}</style>
      </head>
      <body>
        <div class="page">
          {/* 헤더 — 브랜드 + 사용자 칩 + 로그아웃(0그룹 운영자도 탈출 가능) */}
          <header class="navbar navbar-expand-md d-print-none">
            <div class="container-xl">
              <span class="navbar-brand d-flex align-items-center">
                <i class="ti ti-shield-check text-primary me-2" style="font-size:1.5rem"></i>
                <span class="fw-bold">Vuln Monitor</span>
              </span>
              <div class="ms-auto d-flex align-items-center gap-2">
                <span class="badge bg-blue-lt">
                  <i class="ti ti-user me-1"></i>
                  {props.currentUser.username}
                  <span class="text-secondary ms-1">({props.currentUser.role})</span>
                </span>
                <form method="post" action="/logout" class="d-inline">
                  <button type="submit" class="btn btn-sm btn-outline-danger">
                    <i class="ti ti-logout me-1"></i>로그아웃
                  </button>
                </form>
              </div>
            </div>
          </header>

          <div class="page-wrapper">
            <div class="page-body">
              <div class="container-xl">
                <div class="row g-2 align-items-center mb-3">
                  <div class="col">
                    <div class="page-pretitle">접근</div>
                    <h2 class="page-title">
                      <i class="ti ti-building-community me-2"></i>그룹사 선택
                    </h2>
                    <div class="text-muted mt-1">
                      관리할 그룹사를 선택하세요.
                      {isAdmin ? ' 관리자는 전체 현황도 볼 수 있습니다.' : ''}
                    </div>
                  </div>
                  <div class="col-auto ms-auto">
                    <button
                      type="button"
                      class="btn btn-primary"
                      data-bs-toggle="modal"
                      data-bs-target="#group-create-modal"
                    >
                      <i class="ti ti-plus me-1"></i>그룹사 생성
                    </button>
                  </div>
                </div>

                {flashMsg ? (
                  <div class="alert alert-success alert-dismissible mb-3" role="alert">
                    <i class="ti ti-circle-check me-2"></i>
                    {flashMsg}
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="닫기"></button>
                  </div>
                ) : null}
                {errorMsg ? (
                  <div class="alert alert-danger alert-dismissible mb-3" role="alert">
                    <i class="ti ti-alert-circle me-2"></i>
                    {errorMsg}
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="닫기"></button>
                  </div>
                ) : null}

                {hasNoGroups ? (
                  <EmptyNoGroups />
                ) : (
                  <div class="row row-cards">
                    {isAdmin ? <AllGroupsCard next={next} /> : null}
                    {isAdmin && (props.systemBucketCount ?? 0) > 0 ? (
                      <SystemBucketCard next={next} count={props.systemBucketCount ?? 0} />
                    ) : null}
                    {props.groups.map((g) => (
                      <GroupGridCard card={g} isAdmin={isAdmin} next={next} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <CreateGroupModal next={next} existingNames={existingNames} />

        <script
          defer
          src={`https://cdn.jsdelivr.net/npm/@tabler/core@${TABLER_VERSION}/dist/js/tabler.min.js`}
        ></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `document.addEventListener('DOMContentLoaded',function(){
  document.querySelectorAll('form[data-confirm]').forEach(function(f){
    f.addEventListener('submit',function(ev){ if(!confirm(f.getAttribute('data-confirm')||'진행하시겠습니까?')) ev.preventDefault(); });
  });
});`,
          }}
        />
      </body>
    </html>
  )
}

function GroupGridCard(props: { card: GroupCardData; isAdmin: boolean; next: string }) {
  const c = props.card
  const canDelete = props.isAdmin && c.assetCount === 0 && c.solutionCount === 0
  return (
    <div class="col-12 col-md-6 col-lg-4">
      <div class={`card card-sm h-100 sg-card ${c.vulnerableCount > 0 ? 'is-vuln' : ''}`}>
        <div class="card-body">
          <div class="d-flex align-items-start">
            <span class="avatar bg-blue-lt">
              <i class="ti ti-building"></i>
            </span>
            <div class="ms-2 me-auto" style="min-width:0">
              <div class="fw-bold text-truncate">{c.name}</div>
              <div class="text-muted small mt-1">
                장비 {c.assetCount}대 · 컴포넌트 {c.solutionCount}개
                {c.vulnerableCount > 0 ? (
                  <span class="badge bg-red text-white ms-1">취약 {c.vulnerableCount}</span>
                ) : (
                  <span class="badge bg-green-lt ms-1">정상</span>
                )}
              </div>
            </div>
            {props.isAdmin ? (
              <form
                method="post"
                action="/groups/delete"
                class="d-inline"
                data-confirm={`그룹사 "${c.name}"을(를) 삭제하시겠습니까? 되돌릴 수 없습니다.`}
              >
                <input type="hidden" name="name" value={c.name} />
                <button
                  type="submit"
                  class="btn btn-sm btn-icon text-danger"
                  disabled={!canDelete}
                  title={
                    canDelete
                      ? '그룹사 삭제'
                      : `등록된 장비/컴포넌트가 있어 삭제할 수 없습니다 (장비 ${c.assetCount} · 컴포넌트 ${c.solutionCount})`
                  }
                >
                  <i class="ti ti-trash"></i>
                </button>
              </form>
            ) : null}
          </div>
        </div>
        <div class="card-footer p-2">
          <form method="post" action="/select-group/activate">
            <input type="hidden" name="group" value={c.name} />
            <input type="hidden" name="next" value={props.next} />
            <button type="submit" class="btn btn-primary w-100">
              <i class="ti ti-login-2 me-1"></i>진입
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function AllGroupsCard(props: { next: string }) {
  return (
    <div class="col-12 col-md-6 col-lg-4">
      <div class="card card-sm h-100 sg-card is-special">
        <div class="card-body">
          <div class="d-flex align-items-start">
            <span class="avatar bg-azure-lt">
              <i class="ti ti-layout-grid"></i>
            </span>
            <div class="ms-2 me-auto">
              <div class="fw-bold">전체 현황 보기</div>
              <div class="text-muted small mt-1">모든 그룹사 합산 대시보드</div>
            </div>
          </div>
        </div>
        <div class="card-footer p-2">
          <form method="post" action="/select-group/activate">
            <input type="hidden" name="group" value={ALL_GROUPS_SENTINEL} />
            <input type="hidden" name="next" value={props.next} />
            <button type="submit" class="btn btn-outline-primary w-100">
              <i class="ti ti-chart-bar me-1"></i>전체 보기
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function SystemBucketCard(props: { next: string; count: number }) {
  return (
    <div class="col-12 col-md-6 col-lg-4">
      <div class="card card-sm h-100 sg-card is-special">
        <div class="card-body">
          <div class="d-flex align-items-start">
            <span class="avatar bg-secondary-lt">
              <i class="ti ti-folder-question"></i>
            </span>
            <div class="ms-2 me-auto">
              <div class="fw-bold">미분류 (system)</div>
              <div class="text-muted small mt-1">
                그룹사 미지정 컴포넌트 {props.count}개 · 재배정 필요
              </div>
            </div>
          </div>
        </div>
        <div class="card-footer p-2">
          <form method="post" action="/select-group/activate">
            <input type="hidden" name="group" value={SYSTEM_GROUP} />
            <input type="hidden" name="next" value={props.next} />
            <button type="submit" class="btn btn-outline-secondary w-100">
              <i class="ti ti-login-2 me-1"></i>미분류 보기
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function EmptyNoGroups() {
  return (
    <div class="card">
      <div class="card-body">
        <div class="empty">
          <div class="empty-icon">
            <i class="ti ti-building-off" style="font-size:3rem;color:var(--tblr-secondary)"></i>
          </div>
          <p class="empty-title">담당 그룹사가 없습니다</p>
          <p class="empty-subtitle text-muted">
            아직 배정된 그룹사가 없습니다. 새 그룹사를 생성하거나 시스템 관리자에게 배정을 요청하세요.
          </p>
          <div class="empty-action">
            <button
              type="button"
              class="btn btn-primary"
              data-bs-toggle="modal"
              data-bs-target="#group-create-modal"
            >
              <i class="ti ti-plus me-1"></i>그룹사 생성
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CreateGroupModal(props: { next: string; existingNames: string[] }) {
  return (
    <div class="modal modal-blur fade" id="group-create-modal" tabindex={-1}>
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">그룹사 생성</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <form method="post" action="/groups">
            <div class="modal-body">
              <div class="mb-2">
                <label class="form-label required">그룹사 이름</label>
                <input
                  type="text"
                  name="name"
                  class="form-control"
                  list="existing-group-names"
                  placeholder="예: 본사, 자회사A"
                  autocomplete="off"
                  maxlength={100}
                  required
                />
                <datalist id="existing-group-names">
                  {props.existingNames.map((n) => (
                    <option value={n}></option>
                  ))}
                </datalist>
              </div>
              <input type="hidden" name="next" value={props.next} />
              <small class="form-hint">생성 후 자동으로 담당 그룹사에 추가되고 해당 그룹으로 진입합니다.</small>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-link link-secondary" data-bs-dismiss="modal">
                취소
              </button>
              <button type="submit" class="btn btn-primary">
                <i class="ti ti-plus me-1"></i>생성
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function formatFlash(flash: string | null | undefined): string | null {
  if (!flash) return null
  if (flash === 'created') return '그룹사가 생성되었습니다.'
  if (flash === 'deleted') return '그룹사가 삭제되었습니다.'
  return flash
}

function formatError(error: string | null | undefined): string | null {
  if (!error) return null
  if (error === 'no_group') return '담당 그룹사가 없습니다. 관리자에게 배정을 요청하세요.'
  if (error === 'forbidden_group') return '담당하지 않는 그룹사입니다. 본인 그룹사를 선택하세요.'
  return error
}
