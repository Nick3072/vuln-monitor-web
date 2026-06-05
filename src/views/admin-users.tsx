import { Layout } from './layout'
import { raw } from 'hono/html'
import type { UserWithGroups } from '../types'

interface AdminUsersPageProps {
  users: UserWithGroups[]
  flash?: string | null
  error?: string | null
  currentUser?: {
    username: string
    role: 'admin' | 'operator' | 'system'
    groups: string[]
  }
}

export function AdminUsersPage(props: AdminUsersPageProps) {
  return (
    <Layout title="사용자 관리" currentPath="/admin/users" currentUser={props.currentUser}>
      <div class="page-header d-print-none">
        <div class="container-xl">
          <div class="row g-2 align-items-center">
            <div class="col">
              <h2 class="page-title">
                <i class="ti ti-users me-2"></i>사용자 관리
              </h2>
              <div class="text-muted">관리자만 접근 가능 — 운영자 계정과 그룹사 매핑을 관리</div>
            </div>
            <div class="col-auto ms-auto d-print-none">
              <button
                type="button"
                class="btn btn-primary"
                data-bs-toggle="modal"
                data-bs-target="#user-create-modal"
              >
                <i class="ti ti-user-plus me-1"></i>새 사용자
              </button>
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

          <div class="card">
            <div class="card-body p-0">
              <div class="table-responsive">
                <table class="table table-vcenter table-hover mb-0">
                  <thead>
                    <tr>
                      <th>아이디</th>
                      <th>이름</th>
                      <th class="w-1">권한</th>
                      <th>담당 그룹사</th>
                      <th class="w-1">상태</th>
                      <th>마지막 로그인</th>
                      <th class="w-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {props.users.map((u) => (
                      <UserRow user={u} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="mt-3 text-muted small">
            <i class="ti ti-info-circle me-1"></i>
            그룹사는 쉼표(,)로 구분해 여러 개 입력할 수 있습니다. 권한 변경/비번 변경/비활성화 시 기존 세션은 자동으로 무효화됩니다.
          </div>
        </div>
      </div>

      <UserCreateModal />
      {props.users.map((u) => (
        <UserEditModal user={u} />
      ))}

      {raw(`<script>
document.addEventListener('DOMContentLoaded', function() {
  // 삭제 확인
  document.querySelectorAll('form[data-confirm]').forEach(function(form) {
    form.addEventListener('submit', function(ev) {
      if (!confirm(form.getAttribute('data-confirm') || '진행하시겠습니까?')) ev.preventDefault();
    });
  });
});
</script>`)}
    </Layout>
  )
}

function UserRow(props: { user: UserWithGroups }) {
  const u = props.user
  const isSystem = u.username === '_system_automation'
  const roleCls = u.role === 'admin' ? 'bg-red text-white' : u.role === 'system' ? 'bg-secondary text-white' : 'bg-blue-lt'
  return (
    <tr class={u.is_active === 0 ? 'text-muted' : ''}>
      <td>
        <code>{u.username}</code>
        {isSystem ? <span class="badge bg-secondary-lt ms-1">시스템</span> : null}
      </td>
      <td>{u.display_name ?? '—'}</td>
      <td>
        <span class={`badge ${roleCls}`}>{u.role}</span>
      </td>
      <td>
        {u.groups.length === 0 ? (
          <span class="text-muted">—</span>
        ) : (
          u.groups.map((g) => <span class="badge bg-purple-lt me-1">{g}</span>)
        )}
      </td>
      <td>
        {u.is_active === 1 ? (
          <span class="status status-green">
            <span class="status-dot"></span>활성
          </span>
        ) : (
          <span class="status status-secondary">
            <span class="status-dot"></span>비활성
          </span>
        )}
      </td>
      <td class="text-muted small">{u.last_login_at ?? '—'}</td>
      <td class="text-end">
        {isSystem ? (
          <span class="text-muted small">읽기 전용</span>
        ) : (
          <div class="btn-list flex-nowrap">
            <button
              type="button"
              class="btn btn-sm btn-icon"
              data-bs-toggle="modal"
              data-bs-target={`#user-edit-modal-${u.id}`}
              aria-label="수정"
            >
              <i class="ti ti-edit"></i>
            </button>
            <form
              method="post"
              action={`/admin/users/${u.id}/delete`}
              class="d-inline"
              data-confirm={`사용자 ${u.username}을(를) 삭제하시겠습니까?`}
            >
              <button type="submit" class="btn btn-sm btn-icon text-danger" aria-label="삭제">
                <i class="ti ti-trash"></i>
              </button>
            </form>
          </div>
        )}
      </td>
    </tr>
  )
}

function UserCreateModal() {
  return (
    <div class="modal modal-blur fade" id="user-create-modal" tabindex={-1}>
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">새 사용자 생성</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <form method="post" action="/admin/users">
            <div class="modal-body">
              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label required">아이디</label>
                  <input type="text" name="username" class="form-control" required autocomplete="off" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">이름 (선택)</label>
                  <input type="text" name="display_name" class="form-control" />
                </div>
                <div class="col-md-6">
                  <label class="form-label required">비밀번호 (8자 이상)</label>
                  <input type="password" name="password" class="form-control" required minlength={8} />
                </div>
                <div class="col-md-6">
                  <label class="form-label required">권한</label>
                  <select name="role" class="form-select" required>
                    <option value="operator" selected>
                      operator (그룹사 한정 편집)
                    </option>
                    <option value="admin">admin (전체 권한)</option>
                  </select>
                </div>
                <div class="col-12">
                  <label class="form-label">담당 그룹사 (쉼표 구분)</label>
                  <input
                    type="text"
                    name="groups"
                    class="form-control"
                    placeholder="예: 본사, 자회사A"
                  />
                  <small class="text-muted">operator 는 여기에 적힌 그룹사만 수정 가능합니다. admin 은 모든 그룹사 자동 허용.</small>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-link link-secondary" data-bs-dismiss="modal">
                취소
              </button>
              <button type="submit" class="btn btn-primary">
                <i class="ti ti-user-plus me-1"></i>생성
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function UserEditModal(props: { user: UserWithGroups }) {
  const u = props.user
  if (u.username === '_system_automation') return null
  return (
    <div class="modal modal-blur fade" id={`user-edit-modal-${u.id}`} tabindex={-1}>
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              사용자 수정 — <code>{u.username}</code>
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <form method="post" action={`/admin/users/${u.id}`}>
            <div class="modal-body">
              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label">이름</label>
                  <input
                    type="text"
                    name="display_name"
                    class="form-control"
                    value={u.display_name ?? ''}
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">권한</label>
                  <select name="role" class="form-select">
                    <option value="operator" selected={u.role === 'operator'}>
                      operator
                    </option>
                    <option value="admin" selected={u.role === 'admin'}>
                      admin
                    </option>
                  </select>
                </div>
                <div class="col-md-6">
                  <label class="form-label">상태</label>
                  <select name="is_active" class="form-select">
                    <option value="1" selected={u.is_active === 1}>활성</option>
                    <option value="0" selected={u.is_active === 0}>비활성</option>
                  </select>
                </div>
                <div class="col-md-6">
                  <label class="form-label">새 비밀번호 (선택, 변경 시만)</label>
                  <input
                    type="password"
                    name="new_password"
                    class="form-control"
                    placeholder="비워두면 변경 안함"
                    minlength={8}
                    autocomplete="new-password"
                  />
                </div>
                <div class="col-12">
                  <label class="form-label">담당 그룹사 (쉼표 구분, 전체 교체)</label>
                  <input
                    type="text"
                    name="groups"
                    class="form-control"
                    value={u.groups.join(', ')}
                  />
                </div>
              </div>
              <div class="mt-3 alert alert-warning small mb-0">
                <i class="ti ti-info-circle me-1"></i>
                권한·상태·비밀번호 변경 시 해당 사용자의 모든 기존 세션이 자동으로 만료됩니다.
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-link link-secondary" data-bs-dismiss="modal">
                취소
              </button>
              <button type="submit" class="btn btn-primary">
                저장
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
