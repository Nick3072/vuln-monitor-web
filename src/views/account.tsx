// v3.7 내 계정 페이지 — 프로필 확인 + 본인 비밀번호 변경.
//        비번 입력은 C3/C4 공용 UX 규약(표시 토글 + Caps Lock 경고) 마크업을 따른다.
import { Layout } from './layout'
import { AUTH_FORM_SCRIPT } from './auth-enhance'
import { PASSWORD_POLICY_HINT } from '../lib/password-policy'

interface AccountPageProps {
  currentUser: {
    username: string
    role: 'admin' | 'operator' | 'system'
    groups: string[]
  }
  lastLogin?: string | null
  flash?: string | null
  error?: string | null
  activeGroup?: string | null
}

export function AccountPage(props: AccountPageProps) {
  const u = props.currentUser
  const roleBadgeCls =
    u.role === 'admin' ? 'bg-red-lt' : u.role === 'system' ? 'bg-purple-lt' : 'bg-blue-lt'

  return (
    <Layout title="내 계정" currentPath="/account" currentUser={u} activeGroup={props.activeGroup}>
      <div class="page-header d-print-none">
        <div class="container-xl">
          <div class="row g-2 align-items-center">
            <div class="col">
              <h2 class="page-title">
                <i class="ti ti-user-circle me-2"></i>내 계정
              </h2>
              <div class="text-muted">내 프로필을 확인하고 비밀번호를 변경합니다.</div>
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
              <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="닫기"></button>
            </div>
          ) : null}
          {props.error ? (
            <div class="alert alert-danger alert-dismissible mb-3" role="alert">
              <i class="ti ti-alert-circle me-2"></i>
              {props.error}
              <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="닫기"></button>
            </div>
          ) : null}

          <div class="row g-3">
            {/* ── 프로필 카드 ───────────────────────────────── */}
            <div class="col-12 col-lg-5">
              <div class="card h-100">
                <div class="card-header">
                  <h3 class="card-title">
                    <i class="ti ti-id-badge-2 me-2"></i>프로필
                  </h3>
                </div>
                <div class="card-body">
                  <dl class="row mb-0">
                    <dt class="col-4 text-muted">아이디</dt>
                    <dd class="col-8">
                      <code>{u.username}</code>
                    </dd>

                    <dt class="col-4 text-muted">역할</dt>
                    <dd class="col-8">
                      <span class={`badge ${roleBadgeCls}`}>{u.role}</span>
                    </dd>

                    <dt class="col-4 text-muted">담당 그룹사</dt>
                    <dd class="col-8">
                      {u.groups.length === 0 ? (
                        <span class="text-muted">(소속 없음)</span>
                      ) : (
                        u.groups.map((g) => <span class="badge bg-purple-lt me-1 mb-1">{g}</span>)
                      )}
                    </dd>

                    <dt class="col-4 text-muted">마지막 로그인</dt>
                    <dd class="col-8 text-muted">{props.lastLogin ?? '—'}</dd>
                  </dl>
                </div>
              </div>
            </div>

            {/* ── 비밀번호 변경 카드 ─────────────────────────── */}
            <div class="col-12 col-lg-7">
              <div class="card h-100">
                <div class="card-header">
                  <h3 class="card-title">
                    <i class="ti ti-lock me-2"></i>비밀번호 변경
                  </h3>
                </div>
                <form method="post" action="/account/password" autocomplete="off">
                  <div class="card-body">
                    <div class="mb-3">
                      <label class="form-label required" for="account-current-password">
                        현재 비밀번호
                      </label>
                      <div class="input-group input-group-flat">
                        <input
                          type="password"
                          id="account-current-password"
                          name="current_password"
                          class="form-control"
                          autocomplete="current-password"
                          required
                        />
                        <span class="input-group-text">
                          <a
                            href="#"
                            class="link-secondary js-pw-toggle"
                            data-target="#account-current-password"
                            title="비밀번호 표시"
                            aria-label="비밀번호 표시"
                          >
                            <i class="ti ti-eye"></i>
                          </a>
                        </span>
                      </div>
                      <small class="form-hint text-warning d-none js-capslock">
                        <i class="ti ti-alert-triangle me-1"></i>Caps Lock이 켜져 있습니다.
                      </small>
                    </div>

                    <div class="mb-3">
                      <label class="form-label required" for="account-new-password">
                        새 비밀번호
                      </label>
                      <div class="input-group input-group-flat">
                        <input
                          type="password"
                          id="account-new-password"
                          name="new_password"
                          class="form-control"
                          autocomplete="new-password"
                          required
                        />
                        <span class="input-group-text">
                          <a
                            href="#"
                            class="link-secondary js-pw-toggle"
                            data-target="#account-new-password"
                            title="비밀번호 표시"
                            aria-label="비밀번호 표시"
                          >
                            <i class="ti ti-eye"></i>
                          </a>
                        </span>
                      </div>
                      <small class="form-hint text-warning d-none js-capslock">
                        <i class="ti ti-alert-triangle me-1"></i>Caps Lock이 켜져 있습니다.
                      </small>
                      <small class="form-hint text-muted">{PASSWORD_POLICY_HINT}</small>
                    </div>

                    <div class="mb-0">
                      <label class="form-label required" for="account-confirm-password">
                        새 비밀번호 확인
                      </label>
                      <div class="input-group input-group-flat">
                        <input
                          type="password"
                          id="account-confirm-password"
                          name="confirm_password"
                          class="form-control"
                          autocomplete="new-password"
                          required
                        />
                        <span class="input-group-text">
                          <a
                            href="#"
                            class="link-secondary js-pw-toggle"
                            data-target="#account-confirm-password"
                            title="비밀번호 표시"
                            aria-label="비밀번호 표시"
                          >
                            <i class="ti ti-eye"></i>
                          </a>
                        </span>
                      </div>
                      <small class="form-hint text-warning d-none js-capslock">
                        <i class="ti ti-alert-triangle me-1"></i>Caps Lock이 켜져 있습니다.
                      </small>
                    </div>
                  </div>
                  <div class="card-footer text-end">
                    <button type="submit" class="btn btn-primary">
                      <i class="ti ti-device-floppy me-1"></i>비밀번호 변경
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          <div class="mt-3 text-muted small">
            <i class="ti ti-info-circle me-1"></i>
            비밀번호를 변경하면 기존에 로그인된 모든 세션이 자동으로 만료됩니다.
          </div>
        </div>
      </div>

      {/* C3/C4 공용 인증 폼 스크립트(표시 토글 + Caps Lock 경고) 1회 주입 */}
      <script dangerouslySetInnerHTML={{ __html: AUTH_FORM_SCRIPT }} />
    </Layout>
  )
}
