// 检测熔炉 canvas 是否透明：用亮品红背景 + 隐藏背景图/UI，
// 若熔炉画面有黑底，会在品红上露出黑色矩形
import { chromium } from 'playwright'

const url = 'http://localhost:5175/'
const out = process.argv[2] || '/tmp/alpha-check.png'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (err) => console.log('[pageerror]', err.message))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

await page.addStyleTag({
  content: `
    .app { background: #ff00ff !important; }
    .builder { display: none !important; }
    .stage-head { display: none !important; }
    .top { display: none !important; }
  `,
})
await page.waitForTimeout(500)
await page.screenshot({ path: out })
await browser.close()
console.log('saved', out)
