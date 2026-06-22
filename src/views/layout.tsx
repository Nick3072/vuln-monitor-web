import type { Child } from 'hono/jsx'

interface LayoutProps {
  title: string
  currentPath: string
  children?: Child
  // v3.0 — 현재 사용자 정보 (로그인 후에는 항상 존재)
  currentUser?: {
    username: string
    role: 'admin' | 'operator' | 'system'
    groups: string[]
    id?: number
  }
  // v3.6 — 현재 활성 그룹사(없으면 admin '전체' / operator '(미선택)'). 네비 칩 + '그룹사 변경' 링크.
  activeGroup?: string | null
}

const TABLER_VERSION = '1.0.0-beta20'

export function Layout(props: LayoutProps) {
  return (
    <html lang="ko">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} — Vuln Monitor</title>
        <link
          rel="stylesheet"
          href={`https://cdn.jsdelivr.net/npm/@tabler/core@${TABLER_VERSION}/dist/css/tabler.min.css`}
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css"
        />
        <style>{`
          body { font-feature-settings: "cv11", "ss01"; }
          .status-dot-animated { animation: pulse 2s ease-in-out infinite; }
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }

          /* =====================================================
             VM DESIGN SYSTEM — solution-card layer
             Extends Tabler CSS; uses --tblr-* where available.
             All vm-* classes are scoped to this namespace.
             ===================================================== */

          /* ── Design tokens ─────────────────────────────────── */
          :root {
            --vm-radius: .5rem;
            --vm-gap: 1rem;

            /* vuln = 자동취약 — Tabler red */
            --vm-vuln-fg:     #c92a2a;
            --vm-vuln-bg:     #fff5f5;
            --vm-vuln-border: #f1b8b8;
            --vm-vuln-tint:   rgba(201, 42, 42, .045);

            /* manual = 수동취약 — amber/orange (distinct hue from red) */
            --vm-manual-fg:     #d9730d;
            --vm-manual-bg:     #fff8ee;
            --vm-manual-border: #f9cc8f;
            --vm-manual-tint:   rgba(217, 115, 13, .05);

            /* resolved = 조치완료 — teal */
            --vm-resolved-fg:     #0b9268;
            --vm-resolved-bg:     #e6f7f2;
            --vm-resolved-border: #7ecfb6;
            --vm-resolved-tint:   rgba(11, 146, 104, .04);

            /* ok = 정상 — green */
            --vm-ok-fg:     #2a9d3b;
            --vm-ok-bg:     #eaf7ed;
            --vm-ok-border: #92d49d;
            --vm-ok-tint:   rgba(42, 157, 59, .04);

            /* shared surface tokens */
            --vm-text-muted:   #667085;
            --vm-th-bg:        #f6f8fb;
            --vm-row-hover-bg: rgba(20, 40, 90, .035);
            --vm-card-shadow:  0 6px 24px -8px rgba(20, 30, 60, .18);
          }

          /* ── Status pills ───────────────────────────────────── */
          /*   .vm-pill wraps a .vm-dot + label text              */
          .vm-pill {
            display: inline-flex;
            align-items: center;
            gap: .35rem;
            white-space: nowrap;
            padding: .18rem .55rem;
            border-radius: 999px;
            font-size: .8125rem;
            font-weight: 600;
            line-height: 1.25;
            border: 1px solid transparent;
          }
          .vm-pill .vm-dot {
            width: .5rem;
            height: .5rem;
            border-radius: 50%;
            background: currentColor;
            flex: 0 0 auto;
          }
          /* CVE id label inside a vuln pill — truncate long ids within the fixed status column */
          .vm-pill__cve {
            display: inline-block;
            max-width: 8.5rem;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            vertical-align: bottom;
          }

          /* vuln — red */
          .vm-pill--vuln {
            color:            var(--vm-vuln-fg);
            background-color: var(--vm-vuln-bg);
            border-color:     var(--vm-vuln-border);
          }
          /* manual — amber/orange (clearly different hue from vuln) */
          .vm-pill--manual {
            color:            var(--vm-manual-fg);
            background-color: var(--vm-manual-bg);
            border-color:     var(--vm-manual-border);
          }
          /* resolved — teal */
          .vm-pill--resolved {
            color:            var(--vm-resolved-fg);
            background-color: var(--vm-resolved-bg);
            border-color:     var(--vm-resolved-border);
          }
          /* ok — green */
          .vm-pill--ok {
            color:            var(--vm-ok-fg);
            background-color: var(--vm-ok-bg);
            border-color:     var(--vm-ok-border);
          }

          /* ── Supplementary note line below a cell value ─────── */
          .vm-note {
            display: block;
            font-size: .72rem;
            color: var(--vm-text-muted);
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            margin-top: .15rem;
          }

          /* ── Parent asset card ──────────────────────────────── */
          .vm-card {
            border-radius: var(--vm-radius);
            overflow: hidden;
            transition: box-shadow .18s ease, transform .18s ease;
            /* left accent border — color set by modifier */
            border-left: 3px solid transparent;
          }
          .vm-card:hover {
            box-shadow: var(--vm-card-shadow);
          }
          /* accent colour on cards that have at least one vuln component */
          .vm-card.is-vuln {
            border-left-color: var(--vm-vuln-fg);
          }
          .vm-card.is-manual {
            border-left-color: var(--vm-manual-fg);
          }
          .vm-card.is-resolved {
            border-left-color: var(--vm-resolved-fg);
          }

          /* card header layout: asset name + rollup pills + actions */
          .vm-card__head {
            display: flex;
            align-items: flex-start;
            gap: .75rem;
            flex-wrap: wrap;
          }

          /* ── Header rollup pill (slightly larger than inline pill) */
          .vm-rollup {
            display: inline-flex;
            align-items: center;
            gap: .4rem;
            white-space: nowrap;
            padding: .25rem .65rem;
            border-radius: 999px;
            font-size: .875rem;
            font-weight: 700;
            line-height: 1.2;
            border: 1px solid transparent;
          }
          .vm-rollup .vm-dot {
            width: .55rem;
            height: .55rem;
            border-radius: 50%;
            background: currentColor;
            flex: 0 0 auto;
          }
          /* rollup uses same semantic colour modifiers as .vm-pill */
          .vm-rollup--vuln     { color: var(--vm-vuln-fg);     background-color: var(--vm-vuln-bg);     border-color: var(--vm-vuln-border); }
          .vm-rollup--manual   { color: var(--vm-manual-fg);   background-color: var(--vm-manual-bg);   border-color: var(--vm-manual-border); }
          .vm-rollup--resolved { color: var(--vm-resolved-fg); background-color: var(--vm-resolved-bg); border-color: var(--vm-resolved-border); }
          .vm-rollup--ok       { color: var(--vm-ok-fg);       background-color: var(--vm-ok-bg);       border-color: var(--vm-ok-border); }

          /* ── Component table ────────────────────────────────── */
          /*   fixed layout so columns align across ALL cards      */
          .vm-table {
            table-layout: fixed;
            width: 100%;
            border-collapse: collapse;
          }
          .vm-table thead th {
            font-size: .7rem;
            text-transform: uppercase;
            letter-spacing: .03em;
            color: var(--vm-text-muted);
            font-weight: 600;
            background: var(--vm-th-bg);
            padding: .45rem .6rem;
            border-bottom: 1px solid var(--tblr-border-color, #e6e7e9);
          }
          .vm-table td,
          .vm-table th {
            vertical-align: middle;
            padding: .45rem .6rem;
          }
          .vm-table tbody tr {
            transition: background-color .12s ease;
            border-bottom: 1px solid var(--tblr-border-color, #e6e7e9);
          }
          .vm-table tbody tr:last-child {
            border-bottom: none;
          }
          .vm-table tbody tr:hover {
            background: var(--vm-row-hover-bg);
          }

          /* vendor·product cell — truncate long strings */
          .vm-cell-vp {
            display: block;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          /* category badge — clamp to its (fixed-width) cell so a long Korean
             label can never spill into the neighbouring column (no overlap). */
          .vm-cat {
            display: inline-block;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            vertical-align: middle;
          }

          /* status cell wrapper — keep pill + note within the column width */
          .vm-status {
            max-width: 100%;
            overflow: hidden;
          }
          .vm-status .vm-pill {
            max-width: 100%;
          }

          /* version chip — monospace, subtle background */
          .vm-ver,
          code.vm-ver {
            font-family: ui-monospace, "SFMono-Regular", "Consolas", monospace;
            font-size: .78rem;
            background: var(--tblr-bg-surface-secondary, #f0f2f5);
            border: 1px solid var(--tblr-border-color, #e6e7e9);
            border-radius: .25rem;
            padding: .05rem .35rem;
            color: inherit;
          }

          /* ── Row status tints ───────────────────────────────── */
          .vm-row--vuln {
            background-color: var(--vm-vuln-tint);
          }
          .vm-row--vuln:hover {
            background-color: rgba(201, 42, 42, .08);
          }
          .vm-row--manual {
            background-color: var(--vm-manual-tint);
          }
          .vm-row--manual:hover {
            background-color: rgba(217, 115, 13, .09);
          }
          .vm-row--resolved {
            background-color: var(--vm-resolved-tint);
          }
          .vm-row--resolved:hover {
            background-color: rgba(11, 146, 104, .07);
          }

          /* ── Korean text — break at word boundaries, never char-by-char ──
             한글은 기본 글자 단위 줄바꿈이라 좁은 폭에서 세로로 깨진다.
             전역 word-break:keep-all → 모든 한글 텍스트를 단어(공백) 단위로만 줄바꿈해
             세로 글자 깨짐을 근절한다. (truncate 가 필요한 .vm-cat/.vm-cell-vp 는
             white-space:nowrap+ellipsis 를 따로 쓰므로 영향 없음.)
             ※ overflow-wrap:anywhere 는 flex 최소폭을 1글자로 만들어 오히려 깨짐을 유발 → 금지. */
          body {
            word-break: keep-all;
          }

          /* ── Responsive tweaks ──────────────────────────────── */
          @media (max-width: 767.98px) {
            .vm-card__head {
              gap: .5rem;
            }
            /* table already wrapped by Tabler .table-responsive;
               ensure pills don't overflow on narrow screens */
            .vm-rollup {
              font-size: .8rem;
              padding: .2rem .5rem;
            }
          }

          /* 좁은 화면: 페이지 헤더 툴바(뷰토글/등록 버튼)를 제목 아래 줄로 내려
             제목이 짓눌려 세로로 깨지는 현상 방지. */
          @media (max-width: 700px) {
            .page-header .row.align-items-center > .col-auto.ms-auto {
              flex: 0 0 100%;
              max-width: 100%;
              margin-left: 0 !important;
              margin-top: .5rem;
            }
            .page-header .btn-list {
              flex-wrap: wrap;
            }
          }

          /* ═════════════════════════════════════════════════════
             v3.4 PREMIUM POLISH — security-ops console
             방향: 차분한 깊이 + 블루 액센트 + 일관된 컨트롤.
             ═════════════════════════════════════════════════════ */

          /* ── Atmosphere: 평면 배경 대신 미세 그라데이션 ───────── */
          body {
            background:
              radial-gradient(1200px 600px at 100% -10%, rgba(32,107,196,.06), transparent 60%),
              linear-gradient(180deg, #f7f9fc 0%, #eef1f6 100%);
            min-height: 100vh;
            color: #1f2733;
          }

          /* ── Navbar: 유리질 + 경계선 ───────────────────────── */
          /* backdrop-filter 는 새 stacking context 를 만든다. z-index 가 없으면 DOM 상
             뒤에 오는 page-body 카드들이 네비 아래로 흘러내린 드롭다운(계정 메뉴) 위에
             덮여 로그아웃 클릭이 막힌다. 네비 레이어를 페이지 콘텐츠 위로 올린다. */
          .navbar {
            position: relative;
            z-index: 1030;
            background: rgba(255,255,255,.82);
            backdrop-filter: saturate(140%) blur(10px);
            -webkit-backdrop-filter: saturate(140%) blur(10px);
            border-bottom: 1px solid rgba(20,30,60,.08);
            box-shadow: 0 1px 2px rgba(20,30,60,.04);
          }
          .navbar .nav-link { font-weight: 500; }
          /* 계정 드롭다운은 네비 컨텍스트 안에서도 최상단으로(다른 네비 요소/콘텐츠 위). */
          .navbar .dropdown-menu { z-index: 1031; }

          /* ── Surfaces: 카드 일관 라운드/보더/그림자 ───────────── */
          .card {
            border: 1px solid rgba(20,30,60,.08);
            border-radius: .65rem;
            box-shadow: 0 1px 2px rgba(20,30,60,.03);
          }
          .card .card-header { border-top-left-radius: .65rem; border-top-right-radius: .65rem; }

          /* ── 통계 카드 hover lift ───────────────────────────── */
          .row-cards .card.card-sm { transition: transform .15s ease, box-shadow .15s ease; }
          .row-cards a.card.card-sm:hover {
            transform: translateY(-2px);
            box-shadow: var(--vm-card-shadow);
            border-color: rgba(32,107,196,.35);
          }

          /* ── #3 일관된 액션 버튼 (행 + 카드) ──────────────────
             수정/삭제/취약점/펼치기 등 모든 상세 액션 버튼을 동일 높이(2rem)로
             통일하고, 아이콘 버튼은 정사각으로 맞춘다. */
          .vm-table td .btn,
          .vm-card .card-actions .btn,
          .vm-widget-actions .btn,
          .vm-act-col .btn,
          .vm-act {
            height: 2rem;
            min-height: 2rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: .3rem;
            font-size: .8125rem;
            line-height: 1;
            border-radius: .45rem;
          }
          .vm-table td .btn.btn-icon,
          .vm-card .card-actions .btn.btn-icon,
          .vm-widget-actions .btn.btn-icon,
          .vm-act-col .btn.btn-icon,
          .vm-act.btn-icon {
            width: 2rem;
            padding: 0;
          }
          .vm-card .card-actions .btn:not(.btn-icon) { padding: 0 .7rem; }
          .vm-table td .btn-list,
          .vm-card .card-actions,
          .vm-widget-actions { gap: .3rem; }
          .vm-table td .btn-list { flex-wrap: nowrap; justify-content: flex-end; }
          .vm-act-col { white-space: nowrap; text-align: end; }

          /* ── 페이지 헤더 툴바 버튼도 동일 높이로 정렬 ─────────── */
          .page-header .btn-list .btn { height: 2.25rem; display: inline-flex; align-items: center; }

          /* ── #2 정렬 가능한 컬럼 헤더 ───────────────────────── */
          .vm-th-sort { cursor: pointer; user-select: none; transition: color .12s ease; }
          .vm-th-sort:hover { color: var(--tblr-primary, #206bc4); }
          .vm-th-sort.is-sorted { color: var(--tblr-primary, #206bc4); }
          .vm-sort-ind { font-size: .72rem; font-weight: 700; }

          /* ── #4 계정 메뉴: 일관된 칩 + 드롭다운 ───────────────── */
          .vm-usermenu .nav-link {
            border: 1px solid rgba(20,30,60,.10);
            border-radius: 999px;
            padding: .25rem .5rem !important;
            background: #fff;
            transition: border-color .12s ease, box-shadow .12s ease;
          }
          .vm-usermenu .nav-link:hover {
            border-color: rgba(32,107,196,.45);
            box-shadow: 0 2px 8px -4px rgba(20,30,60,.25);
          }
          .vm-usermenu .avatar {
            background: linear-gradient(135deg, #206bc4, #4263eb);
            color: #fff;
            font-weight: 700;
          }
          .vm-env-badge {
            border-radius: 999px;
            font-weight: 600;
            letter-spacing: .02em;
          }

          /* ── v3.6 활성 그룹사 칩 (그룹사 변경 링크) ─────────────── */
          .vm-groupchip {
            border: 1px solid rgba(20,30,60,.10);
            border-radius: 999px;
            padding: .25rem .6rem !important;
            background: #fff;
            color: inherit;
            text-decoration: none;
            transition: border-color .12s ease, box-shadow .12s ease;
          }
          .vm-groupchip:hover {
            border-color: rgba(32,107,196,.45);
            box-shadow: 0 2px 8px -4px rgba(20,30,60,.25);
          }

          /* ── Reduced-motion ─────────────────────────────────── */
          @media (prefers-reduced-motion: reduce) {
            .vm-card,
            .vm-table tbody tr,
            .row-cards .card.card-sm,
            .vm-usermenu .nav-link {
              transition: none;
            }
            .row-cards a.card.card-sm:hover { transform: none; }
          }
        `}</style>
      </head>
      <body>
        <div class="page">
          <Navbar
            currentPath={props.currentPath}
            currentUser={props.currentUser}
            activeGroup={props.activeGroup}
          />
          <div class="page-wrapper">{props.children}</div>
        </div>
        <script
          defer
          src={`https://cdn.jsdelivr.net/npm/@tabler/core@${TABLER_VERSION}/dist/js/tabler.min.js`}
        ></script>
        {/* v3.6 ApexCharts (MIT) — 대시보드 차트. 로드 실패 시 init 가드로 무차트 폴백 */}
        <script defer src="https://cdn.jsdelivr.net/npm/apexcharts@5"></script>
      </body>
    </html>
  )
}

function Navbar(props: {
  currentPath: string
  currentUser?: LayoutProps['currentUser']
  activeGroup?: string | null
}) {
  const items = [
    { href: '/', label: '대시보드', icon: 'dashboard' },
    { href: '/solutions', label: '솔루션 관리', icon: 'server-2' },
    { href: '/history', label: '조치 이력', icon: 'history' },
  ]
  const isAdmin = props.currentUser?.role === 'admin'
  if (isAdmin) {
    items.push({ href: '/admin/users', label: '사용자 관리', icon: 'users' })
  }
  // v3.6 활성 그룹 라벨 — 값 있으면 그룹명, 없으면 admin '전체' / operator '(미선택)'.
  const groupLabel = props.activeGroup
    ? props.activeGroup
    : isAdmin
      ? '전체'
      : '(미선택)'
  return (
    <header class="navbar navbar-expand-md d-print-none">
      <div class="container-xl">
        <h1 class="navbar-brand navbar-brand-autodark d-none-navbar-horizontal pe-0 pe-md-3">
          <a href="/" class="d-flex align-items-center text-decoration-none">
            <i class="ti ti-shield-check text-primary me-2" style="font-size:1.5rem"></i>
            <span class="fw-bold">Vuln Monitor</span>
          </a>
        </h1>
        <div class="navbar-nav flex-row order-md-last align-items-center">
          {props.currentUser ? (
            <div class="nav-item me-2">
              <a href="/select-group" class="nav-link vm-groupchip" title="그룹사 변경">
                <i class="ti ti-building me-1"></i>
                <span class="fw-bold small">{groupLabel}</span>
                <i class="ti ti-switch-horizontal ms-2 text-secondary"></i>
              </a>
            </div>
          ) : null}
          <div class="nav-item me-3 d-none d-sm-block">
            <span class="badge bg-green-lt vm-env-badge">
              <span class="status-dot status-dot-animated bg-green me-1"></span>production
            </span>
          </div>
          {props.currentUser ? (
            <UserMenu user={props.currentUser} />
          ) : null}
        </div>
        <div class="collapse navbar-collapse">
          <ul class="navbar-nav">
            {items.map((item) => (
              <li class={`nav-item ${props.currentPath === item.href ? 'active' : ''}`}>
                <a class="nav-link" href={item.href}>
                  <span class="nav-link-icon">
                    <i class={`ti ti-${item.icon}`}></i>
                  </span>
                  <span class="nav-link-title">{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </header>
  )
}

function UserMenu(props: { user: NonNullable<LayoutProps['currentUser']> }) {
  const u = props.user
  const groupLabel = u.groups.length === 0 ? '(소속 없음)' : u.groups.join(', ')
  const roleBadgeCls =
    u.role === 'admin' ? 'bg-red-lt' : u.role === 'system' ? 'bg-purple-lt' : 'bg-blue-lt'
  const initials = u.username.slice(0, 2).toUpperCase()
  return (
    <div class="nav-item dropdown vm-usermenu">
      <a
        href="#"
        class="nav-link d-flex align-items-center"
        data-bs-toggle="dropdown"
        aria-label="계정 메뉴"
        aria-expanded="false"
      >
        <span class="avatar avatar-sm">{initials}</span>
        <div class="d-none d-md-block ps-2 text-start lh-1">
          <div class="fw-bold small">{u.username}</div>
          <div class="text-secondary" style="font-size:.7rem;margin-top:.15rem">{u.role}</div>
        </div>
        <i class="ti ti-chevron-down ms-2 text-secondary"></i>
      </a>
      <div class="dropdown-menu dropdown-menu-end">
        <div class="dropdown-header">
          <div class="fw-bold">{u.username}</div>
          <div class="mt-1">
            <span class={`badge ${roleBadgeCls} me-1`}>{u.role}</span>
            <span class="text-secondary small">{groupLabel}</span>
          </div>
        </div>
        <div class="dropdown-divider"></div>
        <a href="/account" class="dropdown-item"><i class="ti ti-key me-2"></i>비밀번호 변경</a>
        <div class="dropdown-divider"></div>
        <form method="post" action="/logout">
          <button type="submit" class="dropdown-item text-danger">
            <i class="ti ti-logout me-2"></i>로그아웃
          </button>
        </form>
      </div>
    </div>
  )
}
