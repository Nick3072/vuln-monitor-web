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
  }
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

          /* ── Reduced-motion ─────────────────────────────────── */
          @media (prefers-reduced-motion: reduce) {
            .vm-card,
            .vm-table tbody tr {
              transition: none;
            }
          }
        `}</style>
      </head>
      <body>
        <div class="page">
          <Navbar currentPath={props.currentPath} currentUser={props.currentUser} />
          <div class="page-wrapper">{props.children}</div>
        </div>
        <script
          defer
          src={`https://cdn.jsdelivr.net/npm/@tabler/core@${TABLER_VERSION}/dist/js/tabler.min.js`}
        ></script>
      </body>
    </html>
  )
}

function Navbar(props: {
  currentPath: string
  currentUser?: LayoutProps['currentUser']
}) {
  const items = [
    { href: '/', label: '대시보드', icon: 'dashboard' },
    { href: '/solutions', label: '솔루션 관리', icon: 'server-2' },
  ]
  const isAdmin = props.currentUser?.role === 'admin'
  if (isAdmin) {
    items.push({ href: '/admin/users', label: '사용자 관리', icon: 'users' })
  }
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
          <div class="nav-item me-3">
            <span class="badge bg-green-lt">production</span>
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
  const roleBadgeCls = u.role === 'admin' ? 'bg-red-lt' : 'bg-blue-lt'
  return (
    <div class="nav-item d-flex align-items-center">
      <div class="me-2 text-end d-none d-md-block">
        <div class="small fw-bold">{u.username}</div>
        <div class="text-muted" style="font-size: .75rem">
          <span class={`badge ${roleBadgeCls} me-1`}>{u.role}</span>
          {groupLabel}
        </div>
      </div>
      <form method="post" action="/logout" class="d-inline">
        <button
          type="submit"
          class="btn btn-sm btn-outline-secondary d-inline-flex align-items-center"
          title="세션 로그아웃"
        >
          <i class="ti ti-logout me-1"></i>로그아웃
        </button>
      </form>
    </div>
  )
}
