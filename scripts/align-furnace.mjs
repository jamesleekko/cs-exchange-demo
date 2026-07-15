// 熔炉对齐调试：隐藏构建 UI，让熔炉直接呈现（idle 打开态），叠在背景图上截图
// 用于对比背景图里熔炉的位置/大小
import { chromium } from 'playwright'

const url = 'http://localhost:5175/'
const out = process.argv[2] || '/tmp/align.png'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (err) => console.log('[pageerror]', err.message))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// 隐藏构建 UI + 顶栏 + 舞台的网格/渐变遮罩，露出背景图与熔炉
await page.addStyleTag({
  content: `
    .builder { display: none !important; }
    .stage-head { opacity: 0.15 !important; }
    .stage:before, .stage:after { display: none !important; }
  `,
})
await page.waitForTimeout(500)
await page.screenshot({ path: out })
await browser.close()
console.log('saved', out)
