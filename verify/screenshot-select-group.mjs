// v3.6 시각검증 — 그룹사 선택/스코프 대시보드 스크린샷 (Edge 헤드리스).
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const targets = [
  'preview-select-group-admin',
  'preview-select-group-operator',
  'preview-select-group-empty',
  'preview-dashboard-operator',
]

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()
await page.setViewportSize({ width: 1440, height: 900 })

for (const name of targets) {
  const htmlPath = resolve(__dirname, `${name}.html`)
  if (!existsSync(htmlPath)) {
    console.error(`missing ${name}.html — run vitest first`)
    continue
  }
  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/')
  await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 20000 })
  await page.waitForTimeout(700)
  await page.screenshot({ path: resolve(__dirname, `${name}.png`), fullPage: true })
  console.log(`Saved: verify/${name}.png`)
}

await browser.close()
console.log('Screenshot complete.')
