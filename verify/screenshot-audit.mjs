// 시각 감사 — 주요 화면을 desktop(1440) + mobile(390) 으로 촬영 (Edge 헤드리스).
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pages = [
  'preview-login',
  'preview-select-group-admin',
  'preview-dashboard', // admin 대시보드
  'preview-dashboard-operator',
  'preview', // 솔루션 목록(grouped)
  'preview-admin', // 사용자 관리
  'preview-account',
]
const viewports = [
  { name: 'd', w: 1440, h: 900 },
  { name: 'm', w: 390, h: 844 },
]

const browser = await chromium.launch({ channel: 'msedge' })
for (const name of pages) {
  const htmlPath = resolve(__dirname, `${name}.html`)
  if (!existsSync(htmlPath)) {
    console.log(`skip (missing): ${name}.html`)
    continue
  }
  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/')
  for (const vp of viewports) {
    const page = await browser.newPage()
    await page.setViewportSize({ width: vp.w, height: vp.h })
    await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: resolve(__dirname, `audit-${name}-${vp.name}.png`), fullPage: true })
    await page.close()
  }
  console.log(`shot: ${name} (d+m)`)
}
await browser.close()
console.log('done')
