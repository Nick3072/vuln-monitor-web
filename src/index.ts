import { Hono } from 'hono'
import type { Bindings } from './types'
import { sessionOrBearerAuth } from './middleware/auth'
import { cleanupOldAttempts } from './lib/login-attempts'
import auth from './routes/auth'
import groups from './routes/groups'
import admin from './routes/admin'
import account from './routes/account'
import solutions from './routes/solutions'
import bulk from './routes/bulk'
import widgets from './routes/widgets'
import vulns from './routes/vulns'
import web from './routes/web'
import cpe from './routes/cpe'
import match from './routes/match'

const app = new Hono<{ Bindings: Bindings }>()

// === 공개 라우트 (인증 불필요) ===
// 헬스체크는 monitoring/uptime probe 용. 인증 가하지 않음.
app.get('/api/health', (c) =>
  c.json({
    success: true,
    data: {
      status: 'ok',
      environment: c.env.ENVIRONMENT ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  }),
)

// /login (GET/POST), /logout (POST 전용) — 운영자 인증 자체를 위한 라우트라 인증 미들웨어 적용 불가
app.route('/', auth)

// === 인증 보호 라우트 ===
// 운영자 세션 쿠키 OR 외부 자동화 Bearer 토큰 둘 중 하나라도 통과해야 함.
const protectedApp = new Hono<{ Bindings: Bindings }>()
protectedApp.use('*', sessionOrBearerAuth)

// v3.6 그룹사 선택/생성/삭제 — web 보다 먼저 마운트.
//   /select-group, /groups* 는 자체 라우트로 처리되며 그룹 스코프 게이트 대상이 아니다.
protectedApp.route('/', groups)

// HTML 페이지 + 폼 POST (web.tsx)
//   대시보드 GET '/' 와 GET '/solutions' 는 핸들러 내부에서 resolveEffectiveGroup 으로
//   활성 그룹을 강제·검증하고 미선택/무권한 시 /select-group 으로 리다이렉트한다(자체 게이트).
protectedApp.route('/', web)

// v3.0 관리자 (사용자 CRUD + 부트스트랩) — sessionOrBearerAuth 통과 후 admin 내부 requireAdmin 으로 추가 보호
protectedApp.route('/admin', admin)

// v3.0 대시보드 위젯 CRUD — 로그인 사용자는 모두 추가 가능
protectedApp.route('/dashboard/widgets', widgets)

// v3.x 내 계정 (비밀번호 변경 등) — 인증 보호 영역, 로그인 사용자 본인만 접근
protectedApp.route('/account', account)

// JSON API
const api = new Hono<{ Bindings: Bindings }>()
// 라우트 등록 순서: 더 구체적인 prefix 먼저 (/solutions/bulk → /solutions)
api.route('/solutions/bulk', bulk)
api.route('/solutions', solutions)
api.route('/vulns', vulns)
api.route('/cpe', cpe)
api.route('/match', match)
protectedApp.route('/api', api)

app.route('/', protectedApp)

app.notFound((c) => c.json({ success: false, error: 'Route not found' }, 404))

app.onError((err, c) => {
  const message = err instanceof Error ? err.message : 'Internal server error'
  return c.json({ success: false, error: message }, 500)
})

// v3.5 Worker 엔트리 — fetch(HTTP) + scheduled(Cron).
// scheduled: login_attempts 보존기간 초과분을 일일 정리. 로그인 성공 경로에만
// 의존하지 않도록 독립 실행(cleanupOldAttempts 는 절대 throw 하지 않음).
const handler: ExportedHandler<Bindings> = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(cleanupOldAttempts(env.DB))
  },
}

export default handler
