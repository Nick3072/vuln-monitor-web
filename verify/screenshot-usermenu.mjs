// 계정 드롭다운(로그아웃) 겹침 회귀 검증 — 메뉴를 열고 로그아웃이 콘텐츠 위에 보이는지 확인.
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const target = resolve(__dirname, 'preview-dashboard.html') // admin 대시보드(콘텐츠 많음)
const fileUrl = 'file:///' + target.replace(/\\/g, '/')

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()
await page.setViewportSize({ width: 1200, height: 800 })
await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 20000 })
await page.waitForTimeout(800)

// 계정 칩 클릭 → 드롭다운 열기
await page.click('.vm-usermenu .nav-link')
await page.waitForTimeout(500)

// 로그아웃 버튼이 보이고 클릭 가능한지(맨 위 레이어인지) 확인
const logout = page.locator('.vm-usermenu .dropdown-menu button:has-text("로그아웃")')
const visible = await logout.isVisible().catch(() => false)
let clickable = false
try {
  const box = await logout.boundingBox()
  if (box) {
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    // 해당 좌표의 최상단 요소가 로그아웃 버튼 내부인지 검사(겹침이면 다른 요소가 잡힘)
    clickable = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y)
        return !!el && !!el.closest('form[action="/logout"]')
      },
      [cx, cy],
    )
  }
} catch {}

console.log(`logout visible=${visible} topmost-at-center=${clickable}`)
await page.screenshot({ path: resolve(__dirname, 'usermenu-open.png'), fullPage: false })
console.log('Saved: verify/usermenu-open.png')
await browser.close()
