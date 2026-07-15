// 简易截图脚本：node scripts/shot.mjs [url] [out.png] [waitMs]
import { chromium } from 'playwright'

const url = process.argv[2] || 'http://localhost:5175/'
const out = process.argv[3] || '/tmp/shot.png'
const waitMs = Number(process.argv[4] || 1200)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(waitMs)
await page.screenshot({ path: out })
await browser.close()
console.log('saved', out)
