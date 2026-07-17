// 熔炉完整流程视觉烟测：按语义阶段冻结 Three.js，并保留桌面/移动端截图。
import { chromium } from 'playwright'

const url = process.env.TEST_URL || 'http://localhost:5175/'

const cases = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
].filter(({ name }) => !process.env.TEST_CASE || process.env.TEST_CASE === name)

if (!cases.length) {
  throw new Error(`未知 TEST_CASE: ${process.env.TEST_CASE}`)
}

const browser = await chromium.launch()

async function waitForFrames(page, count = 2) {
  await page.evaluate((frameCount) => new Promise((resolve) => {
    let remaining = frameCount
    const next = () => {
      remaining -= 1
      if (remaining <= 0) resolve()
      else requestAnimationFrame(next)
    }
    requestAnimationFrame(next)
  }), count)
}

async function setFurnaceTimeScale(page, value) {
  await page.evaluate((timeScale) => {
    window.__FURNACE_TIMESCALE = timeScale
  }, value)
}

async function setWhiteoutTime(page, time) {
  return page.evaluate((currentTime) => {
    const element = document.querySelector('.furnace-whiteout')
    const animations = element?.getAnimations({ subtree: true }) || []
    animations.forEach((animation) => {
      animation.currentTime = currentTime
      animation.pause()
    })
    return animations.length
  }, time)
}

async function readCanvasAlpha(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.furnace-layer')
    if (!canvas?.dataset.fxAlphaProbe) return null
    return JSON.parse(canvas.dataset.fxAlphaProbe)
  })
}

async function screenshotStage(page, name, stage, delay = 0) {
  try {
    await page.waitForFunction(
      (expectedStage) => document.querySelector('.furnace-layer')?.dataset.fxStage
        === expectedStage,
      stage,
      { timeout: 15000 },
    )
  } catch (error) {
    const currentStage = await page.locator('.furnace-layer').getAttribute('data-fx-stage')
    throw new Error(`${name}: 等待 ${stage} 超时，当前阶段为 ${currentStage}`, {
      cause: error,
    })
  }
  if (delay) await page.waitForTimeout(delay)
  await setFurnaceTimeScale(page, 0)
  await waitForFrames(page)
  const path = `/tmp/furnace-fx-${name}-${stage}.png`
  await page.screenshot({ path })
  console.log(`${name}: ${stage} -> ${path}`)
}

async function runCase({ name, viewport }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  const pageErrors = []
  const consoleErrors = []
  let whiteoutQualityColor = ''

  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.addInitScript(() => {
    window.__CONTRACT_TIMESCALE = 3
    window.__FURNACE_TIMESCALE = 1
    let state = 0x4f1bbcdc
    Math.random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 0x100000000
    }
  })

  const modelLoaded = page.waitForResponse(
    (response) => response.url().includes('/models/cs2-forge.glb') && response.ok(),
  )
  await page.goto(url, { waitUntil: 'networkidle' })
  await modelLoaded
  await page.waitForTimeout(400)
  await page.screenshot({ path: `/tmp/furnace-fx-${name}-idle.png` })

  await page.getByRole('button', { name: '自动选择' }).click()
  await page.getByText('确认物品', { exact: true }).click()
  await page.locator('button.confirm-btn').click()
  await page.waitForSelector('.contract-layer.show', { timeout: 10000 })
  await page.waitForSelector('.stamp-hint.show', { timeout: 15000 })
  await page.locator('.stamp-hint.show').click({ force: true })
  if (process.env.FX_DEBUG_VIEW) {
    await page.addStyleTag({
      content: '.builder,.stage-head,.top,.toast{display:none!important}.stage{min-height:100vh!important}',
    })
  }

  await screenshotStage(page, name, 'thin', 140)
  await setFurnaceTimeScale(page, 1)
  await screenshotStage(page, name, 'charge', name === 'desktop' ? 1100 : 800)
  await setFurnaceTimeScale(page, 1)
  await page.evaluate(() => {
    window.__FURNACE_ALPHA_PROBE = true
  })
  await screenshotStage(page, name, 'surge', 320)
  const alphaSample = await readCanvasAlpha(page)
  if (alphaSample && (alphaSample.corner[3] > 32 || alphaSample.center[3] === 0)) {
    throw new Error(`${name}: 透明 Bloom alpha 异常 ${JSON.stringify(alphaSample)}`)
  }
  await page.evaluate(() => {
    window.__FURNACE_ALPHA_PROBE = false
  })
  await setFurnaceTimeScale(page, 1)

  await page.waitForSelector('.furnace-whiteout.active', { timeout: 10000 })
  const whiteoutAppearance = await page.locator('.furnace-whiteout').evaluate((element) => ({
    qualityColor: getComputedStyle(element).getPropertyValue('--whiteout-color')
      .trim()
      .toLowerCase(),
    veilColor: getComputedStyle(element, '::after').backgroundColor,
  }))
  whiteoutQualityColor = whiteoutAppearance.qualityColor
  if (
    !/^#[0-9a-f]{6}$/.test(whiteoutQualityColor)
    || whiteoutAppearance.veilColor === 'rgb(255, 255, 255)'
  ) {
    throw new Error(`${name}: 品质白场颜色异常 ${JSON.stringify(whiteoutAppearance)}`)
  }
  await setFurnaceTimeScale(page, 0)
  const whiteoutAnimationCount = await setWhiteoutTime(page, 80)
  if (!whiteoutAnimationCount) throw new Error(`${name}: 未找到白场动画`)
  await page.screenshot({ path: `/tmp/furnace-fx-${name}-burst.png` })
  await setWhiteoutTime(page, 260)
  await page.screenshot({ path: `/tmp/furnace-fx-${name}-whiteout-mid.png` })
  await setWhiteoutTime(page, 520)
  await page.screenshot({ path: `/tmp/furnace-fx-${name}-whiteout.png` })
  await page.evaluate(() => {
    document.querySelector('.furnace-whiteout')
      ?.getAnimations({ subtree: true })
      .forEach((animation) => animation.play())
  })
  await setFurnaceTimeScale(page, 1)

  await page.waitForSelector('.result.show', { timeout: 12000 })
  await page.waitForTimeout(450)
  const resultQualityColor = await page.locator('.result-card').evaluate((element) => (
    getComputedStyle(element).getPropertyValue('--c').trim().toLowerCase()
  ))
  if (resultQualityColor !== whiteoutQualityColor) {
    throw new Error(
      `${name}: 白场颜色 ${whiteoutQualityColor} 与结果颜色 ${resultQualityColor} 不一致`,
    )
  }
  await page.screenshot({ path: `/tmp/furnace-fx-${name}-result.png` })

  if (await page.locator('.furnace-hint').count()) {
    throw new Error(`${name}: 不应再渲染点击熔炉提示`)
  }
  if (pageErrors.length || consoleErrors.length) {
    throw new Error([
      ...pageErrors.map((error) => `page: ${error}`),
      ...consoleErrors.map((error) => `console: ${error}`),
    ].join(' | '))
  }

  await page.close()
}

try {
  for (const testCase of cases) await runCase(testCase)
  console.log('done')
} finally {
  await browser.close()
}
