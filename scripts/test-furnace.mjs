// 测试完整流程：填料 → 确认 → 熔炉下降/合同抽出 → 盖章 → 自动开启 → 结果。
// 关键节点用可见状态等待，并保留截图供检查 Three.js 动画与模型。
import { chromium } from 'playwright'

const url = process.env.TEST_URL || 'http://localhost:5175/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const pageErrors = []

page.on('pageerror', (error) => pageErrors.push(error.message))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.evaluate(() => {
  window.__CONTRACT_TIMESCALE = 2
  window.__FURNACE_TIMESCALE = 2
})
await page.screenshot({ path: '/tmp/f1-idle.png' })
console.log('f1: 打开待机（builder 页）')

await page.getByRole('button', { name: '自动选择' }).click()
await page.waitForTimeout(500)
await page.getByText('确认物品', { exact: true }).click()
await page.waitForTimeout(200)
await page.locator('button.confirm-btn').click()

await page.waitForSelector('.contract-layer.show', { timeout: 10000 })
await page.waitForTimeout(180)
await page.screenshot({ path: '/tmp/f2-contract-from-bottom.png' })
console.log('f2: 熔炉下降，合同从底部抽出')

await page.waitForTimeout(520)
await page.screenshot({ path: '/tmp/f3-contract-centered.png' })
console.log('f3: 合同展开，熔炉继续下降')

// 等「点击盖章」提示真正进入可点状态（.show 后才有 pointer-events）
await page.waitForSelector('.stamp-hint.show', { timeout: 15000 })
await page.waitForTimeout(300)
await page.locator('.stamp-hint.show').click({ force: true })
console.log('f4: 已盖章')

// 盖章后不再点击熔炉；合同抽离结束会直接触发开启。
await page.waitForTimeout(1500)
await page.screenshot({ path: '/tmp/f4-furnace-auto-opening.png' })
console.log('f4: 熔炉自动开启中')

if (await page.locator('.furnace-hint').count()) {
  throw new Error('不应再渲染点击熔炉提示')
}

await page.waitForTimeout(2700)
await page.screenshot({ path: '/tmp/f5-climax.png' })
console.log('f5: 高潮')

await page.waitForSelector('.result.show', { timeout: 12000 })
await page.waitForTimeout(300)
await page.screenshot({ path: '/tmp/f6-result.png' })
console.log('f6: 结果')

if (pageErrors.length) {
  throw new Error(`页面错误：${pageErrors.join(' | ')}`)
}

await browser.close()
console.log('done')
