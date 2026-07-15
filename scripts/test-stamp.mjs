// 自动化测试合同流程：填充材料 → 开始汰换 → 等待盖章提示出现 → 截图
import { chromium } from 'playwright'

const url = 'http://localhost:5175/'
const out = '/tmp/shot-stamp-hint.png'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

// 捕获控制台报错
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    console.log(`[${msg.type()}]`, msg.text())
  }
})
page.on('pageerror', (err) => {
  console.log('[pageerror]', err.message)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// 直接点「一键添加」会自动选择第一个有足够材料的品质
await page.click('button:has-text("一键添加")')
await page.waitForTimeout(500)

// 勾选「确认汰换物品」
await page.click('text=确认汰换物品')
await page.waitForTimeout(200)

// 点击「确认汰换」
await page.click('button.confirm-btn')
await page.waitForTimeout(2600) // 等合同飞入并到达盖章位置（冻结）

// 截图
await page.screenshot({ path: out })
await browser.close()
console.log('saved', out)
