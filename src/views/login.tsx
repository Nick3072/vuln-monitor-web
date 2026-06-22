// v2.7 운영자 로그인 페이지. 기존 Layout 미사용 — Tabler `page page-center` 풀-페이지 센터 레이아웃.
// v2.8 비밀번호 표시 토글 + Caps Lock 경고, 시스템 소개/관리자 문의 동적화.
import { AUTH_FORM_SCRIPT } from './auth-enhance'

interface LoginPageProps {
  error?: string | null
  next?: string | null
  flash?: string | null // 예: 'session-expired', 'logged-out'
  adminContact?: string | null
  helpUrl?: string | null
}

const TABLER_VERSION = '1.0.0-beta20'

export function LoginPage(props: LoginPageProps) {
  const flashMessage = formatFlash(props.flash)
  // v2.8 helpUrl 은 env 신뢰값이나 방어적으로 http/https 스킴만 허용(javascript: 등 차단).
  const safeHelpUrl =
    props.helpUrl && /^https?:\/\//i.test(props.helpUrl) ? props.helpUrl : null
  return (
    <html lang="ko">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>로그인 — Vuln Monitor</title>
        <link
          rel="stylesheet"
          href={`https://cdn.jsdelivr.net/npm/@tabler/core@${TABLER_VERSION}/dist/css/tabler.min.css`}
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css"
        />
        <style>{`body { font-feature-settings: "cv11", "ss01"; word-break: keep-all; }`}</style>
      </head>
      <body>
        <div class="page page-center">
          <div class="container-tight py-4">
            <div class="text-center mb-4">
              <a href="/" class="navbar-brand navbar-brand-autodark text-decoration-none">
                <i class="ti ti-shield-check text-primary me-2" style="font-size:2rem"></i>
                <span class="fw-bold fs-3">Vuln Monitor</span>
              </a>
            </div>
            <div class="card card-md">
              <div class="card-body">
                <h2 class="h2 text-center mb-1">운영자 로그인</h2>
                <p class="text-muted text-center mb-1 small">
                  취약점 모니터링 시스템 — 등록된 운영자만 접근할 수 있습니다.
                </p>
                <p class="text-muted text-center mb-3 small">
                  관리자가 설정한 비밀번호를 입력하세요.
                  {safeHelpUrl ? (
                    <>
                      {' '}
                      <a href={safeHelpUrl} target="_blank" rel="noopener">
                        사용 안내
                      </a>
                    </>
                  ) : null}
                </p>

                {props.error ? (
                  <div class="alert alert-danger alert-dismissible mb-3" role="alert">
                    <div class="d-flex">
                      <div>
                        <i class="ti ti-alert-circle me-2"></i>
                      </div>
                      <div>{props.error}</div>
                    </div>
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="닫기"></button>
                  </div>
                ) : null}

                {flashMessage ? (
                  <div class="alert alert-info alert-dismissible mb-3" role="alert">
                    <div class="d-flex">
                      <div>
                        <i class="ti ti-info-circle me-2"></i>
                      </div>
                      <div>{flashMessage}</div>
                    </div>
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="닫기"></button>
                  </div>
                ) : null}

                <form method="post" action="/login">
                  <div class="mb-3">
                    <label class="form-label required">아이디</label>
                    <input
                      type="text"
                      name="username"
                      class="form-control"
                      placeholder="아이디 입력"
                      autocomplete="username"
                      autofocus
                      required
                    />
                  </div>
                  <div class="mb-3">
                    <label class="form-label required">비밀번호</label>
                    <div class="input-group input-group-flat">
                      <input
                        type="password"
                        id="login-password"
                        name="password"
                        class="form-control"
                        placeholder="비밀번호 입력"
                        autocomplete="current-password"
                        required
                      />
                      <span class="input-group-text">
                        <a
                          href="#"
                          class="link-secondary js-pw-toggle"
                          data-target="#login-password"
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
                  <input type="hidden" name="next" value={props.next ?? '/'} />
                  <div class="form-footer">
                    <button type="submit" class="btn btn-primary w-100">
                      <i class="ti ti-login-2 me-2"></i>로그인
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <div class="text-center text-muted mt-3 small">
              <i class="ti ti-help-circle me-1"></i>
              {renderAdminContact(props.adminContact)}
            </div>
          </div>
        </div>
        <script
          defer
          src={`https://cdn.jsdelivr.net/npm/@tabler/core@${TABLER_VERSION}/dist/js/tabler.min.js`}
        ></script>
        <script dangerouslySetInnerHTML={{ __html: AUTH_FORM_SCRIPT }} />
      </body>
    </html>
  )
}

function formatFlash(flash: string | null | undefined): string | null {
  if (!flash) return null
  if (flash === 'session-expired') return '세션이 만료되었습니다. 다시 로그인해주세요.'
  if (flash === 'logged-out') return '로그아웃되었습니다.'
  return null
}

// v2.8 관리자 문의 동적화: '@' 포함 → mailto:, 'http' 시작 → 외부 링크, 그 외 → 텍스트. 없으면 폴백.
function renderAdminContact(adminContact: string | null | undefined) {
  const contact = adminContact?.trim()
  if (!contact) {
    return <>비밀번호를 모르시면 시스템 관리자에게 문의하세요.</>
  }
  if (contact.includes('@')) {
    return (
      <>
        비밀번호를 모르시면 <a href={`mailto:${contact}`}>{contact}</a> 로 문의하세요.
      </>
    )
  }
  if (contact.startsWith('http')) {
    return (
      <>
        비밀번호를 모르시면{' '}
        <a href={contact} target="_blank" rel="noopener">
          시스템 관리자
        </a>
        에게 문의하세요.
      </>
    )
  }
  return <>비밀번호를 모르시면 {contact} 에게 문의하세요.</>
}
