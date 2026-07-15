// 测试完整流程：填料 → 确认 → 合同 → 盖章 → 熔炉合上 → 点击开启 → 结果
// 每个关键节点截图。关键节点用条件等待（提示元素 .show）而非固定延时，避免时序抖动。
import { chromium } from 'playwright'

const url = 'http://localhost:5175/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

page.on('pageerror', (err) => console.log('[pageerror]', err.message))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: '/tmp/f1-idle.png' })
console.log('f1: 打开待机（builder 页）')

await page.click('button:has-text("一键添加")')
await page.waitForTimeout(500)
await page.click('text=确认汰换物品')
await page.waitForTimeout(200)
await page.click('button.confirm-btn')

// 等「点击盖章」提示真正进入可点状态（.show 后才有 pointer-events）
await page.waitForSelector('.stamp-hint.show', { timeout: 15000 })
await page.waitForTimeout(300)
const box = await (await page.$('.stamp-hint')).boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
console.log('f2: 已盖章')

// 等合同飞出 + 熔炉合上完成（以 .furnace-hint.show 出现为准）
await page.waitForSelector('.furnace-hint.show', { timeout: 20000 })
await page.waitForTimeout(600)
await page.screenshot({ path: '/tmp/f2-furnace-closed.png' })
console.log('f2: 熔炉合上等待点击')

// 点击熔炉中心开启
await page.mouse.click(720, 480)
await page.waitForTimeout(900)
await page.screenshot({ path: '/tmp/f3-furnace-opening.png' })
console.log('f3: 熔炉开启中')

await page.waitForTimeout(1000)
await page.screenshot({ path: '/tmp/f4-climax.png' })
console.log('f4: 高潮')

await page.waitForTimeout(1200)
await page.screenshot({ path: '/tmp/f5-result.png' })
console.log('f5: 结果')

await browser.close()
console.log('done')
