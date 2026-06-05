/**
 * QA screenshot helper — Agent-C
 * Takes desktop (1440×900) and mobile (390×844) screenshots of preview.html
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const previewPath = resolve(__dirname, 'preview.html')

if (!existsSync(previewPath)) {
  console.error('preview.html not found — run vitest first')
  process.exit(1)
}

const fileUrl = 'file:///' + previewPath.replace(/\\/g, '/')

const browser = await chromium.launch()

// Desktop 1440×900
const page1 = await browser.newPage()
await page1.setViewportSize({ width: 1440, height: 900 })
await page1.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
// Brief wait for any CSS transitions
await page1.waitForTimeout(500)
await page1.screenshot({ path: resolve(__dirname, 'desktop-1440.png'), fullPage: true })
console.log('Saved: verify/desktop-1440.png')

// Mobile 390×844
const page2 = await browser.newPage()
await page2.setViewportSize({ width: 390, height: 844 })
await page2.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
await page2.waitForTimeout(500)
await page2.screenshot({ path: resolve(__dirname, 'mobile-390.png'), fullPage: true })
console.log('Saved: verify/mobile-390.png')

await browser.close()
console.log('Screenshot complete.')
