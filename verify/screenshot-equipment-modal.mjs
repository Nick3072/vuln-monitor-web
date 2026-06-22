// 장비 등록 모달을 열어 그룹사 입력 제거 + 배지/안내를 시각 확인 (Edge 헤드리스).
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cases = [
  { file: 'preview-equipment-operator', label: 'operator(활성=본사)' },
  { file: 'preview-equipment-admin-all', label: 'admin(전체)' },
]

const browser = await chromium.launch({ channel: 'msedge' })
for (const { file, label } of cases) {
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1100, height: 900 })
  const fileUrl = 'file:///' + resolve(__dirname, `${file}.html`).replace(/\\/g, '/')
  await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 20000 })
  await page.waitForTimeout(700)
  await page.click('[data-bs-target="#asset-modal"]')
  await page.waitForTimeout(600)
  const submitDisabled = await page
    .locator('#asset-submit-btn')
    .isDisabled()
    .catch(() => null)
  console.log(`${label}: 장비등록 버튼 disabled=${submitDisabled}`)
  await page.screenshot({ path: resolve(__dirname, `${file}.png`), fullPage: false })
  console.log(`Saved: verify/${file}.png`)
  await page.close()
}
await browser.close()
