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

async function assertFurnaceViewportLock(page, name, viewport) {
  const geometry = await page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    const app = document.querySelector('.app')
    const canvas = document.querySelector('.furnace-layer')
    const materialConsole = document.querySelector('.material-console')
    const rect = canvas?.getBoundingClientRect()
    const background = app ? getComputedStyle(app, '::before') : null
    return {
      scrollY,
      canvas: rect && {
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      backgroundHeight: background ? Number.parseFloat(background.height) : 0,
      materialConsoleAnimations: materialConsole
        ? materialConsole.getAnimations().map((animation) => animation.animationName)
        : [],
    }
  })
  await page.evaluate(() => window.scrollTo(0, 0))
  await waitForFrames(page)

  const tolerance = 2
  if (
    (name === 'mobile' && geometry.scrollY < 1)
    || !geometry.canvas
    || Math.abs(geometry.canvas.top) > tolerance
    || Math.abs(geometry.canvas.bottom - viewport.height) > tolerance
    || Math.abs(geometry.canvas.width - viewport.width) > tolerance
    || Math.abs(geometry.canvas.height - viewport.height) > tolerance
    || Math.abs(geometry.backgroundHeight - viewport.height) > tolerance
    || !geometry.materialConsoleAnimations.includes('furnaceRumble')
  ) {
    throw new Error(`${name}: 熔炉层未锁定视口 ${JSON.stringify(geometry)}`)
  }
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
  await page.waitForSelector(
    '.furnace-layer[data-arm-back-glow-count="6"]',
    { timeout: 5000 },
  )
  await page.waitForTimeout(400)
  await page.screenshot({ path: `/tmp/furnace-fx-${name}-idle.png` })

  const consoleToggle = page.getByRole('checkbox', { name: '开启控制台' })
  if (!(await consoleToggle.isChecked())) {
    throw new Error(`${name}: 开启控制台应默认勾选`)
  }
  await page.getByText('开启控制台', { exact: true }).click()
  if (await consoleToggle.isChecked()) throw new Error(`${name}: 控制台选项无法关闭`)
  await page.getByText('开启控制台', { exact: true }).click()

  await page.locator('.inv-item').first().click()
  const clickSelectedCount = await page.locator('.contract-item:not(.empty)').count()
  if (clickSelectedCount !== 1) {
    throw new Error(`${name}: 点击库存材料后选中 ${clickSelectedCount} 件，预期 1 件`)
  }
  await page.getByRole('button', { name: '重置合同' }).click()

  await page.getByRole('button', { name: '自动选择' }).click()
  await page.getByText('确认物品', { exact: true }).click()
  await page.locator('button.confirm-btn').click()
  await page.waitForSelector('.contract-layer.show', { timeout: 10000 })

  const cancelContractButton = page.getByRole('button', { name: '取消合同' })
  const cancelContractCount = await cancelContractButton.count()
  if (cancelContractCount !== 1 || !(await cancelContractButton.isVisible())) {
    throw new Error(`${name}: 3D 合同右上角未显示取消按钮`)
  }
  const cancelContractBox = await cancelContractButton.boundingBox()
  if (
    !cancelContractBox
    || cancelContractBox.x < viewport.width - 100
    || cancelContractBox.y < 60
    || cancelContractBox.y + cancelContractBox.height > viewport.height / 2
  ) {
    throw new Error(`${name}: 取消按钮没有位于 3D 合同右上区域`)
  }
  await page.screenshot({ path: `/tmp/furnace-fx-${name}-contract.png` })
  await cancelContractButton.click()
  await page.waitForFunction(
    () => !document.querySelector('.contract-layer')?.classList.contains('show'),
    null,
    { timeout: 2000 },
  )
  const confirmToggle = page.getByRole('checkbox', { name: '确认物品' })
  if (await confirmToggle.isChecked()) {
    throw new Error(`${name}: 取消合同后确认物品仍处于勾选状态`)
  }
  if (!(await page.locator('.inv-panel').isVisible())) {
    throw new Error(`${name}: 取消合同后未回到材料选择界面`)
  }

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
  await assertFurnaceViewportLock(page, name, viewport)
  await setFurnaceTimeScale(page, 1)
  await screenshotStage(page, name, 'charge', name === 'desktop' ? 1100 : 800)
  await setFurnaceTimeScale(page, 1)
  await page.evaluate(() => {
    window.__FURNACE_ALPHA_PROBE = true
  })
  await screenshotStage(page, name, 'surge', 320)
  await page.waitForSelector('.cs2-console', { state: 'visible', timeout: 2000 })
  if (await page.locator('.furnace-whiteout.active').count()) {
    throw new Error(`${name}: 控制台未在粒子白场前弹出`)
  }
  await page.screenshot({ path: `/tmp/furnace-fx-${name}-console.png` })
  const alphaSample = await readCanvasAlpha(page)
  if (alphaSample && (alphaSample.corner[3] > 32 || alphaSample.center[3] === 0)) {
    throw new Error(`${name}: 透明 Bloom alpha 异常 ${JSON.stringify(alphaSample)}`)
  }
  await page.evaluate(() => {
    window.__FURNACE_ALPHA_PROBE = false
  })
  await setFurnaceTimeScale(page, 1)

  await page.waitForSelector('.furnace-whiteout.active', { timeout: 10000 })
  if (!(await page.locator('.cs2-console').isVisible())) {
    throw new Error(`${name}: 粒子爆发时控制台不应自动关闭`)
  }
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
  await page.waitForTimeout(700)
  const resultCoverage = await page.evaluate(() => {
    const panel = document.querySelector('.cs2-console')
    const result = document.querySelector('.stage > .result.show')
    if (!panel || !result) return null
    const panelRect = panel.getBoundingClientRect()
    const resultRect = result.getBoundingClientRect()
    const left = Math.max(0, panelRect.left, resultRect.left)
    const top = Math.max(0, panelRect.top, resultRect.top)
    const right = Math.min(innerWidth, panelRect.right, resultRect.right)
    const bottom = Math.min(innerHeight, panelRect.bottom, resultRect.bottom)
    if (right <= left || bottom <= top) return { area: 0, onTop: false }
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
    const secretSelectors = [
      '.prize-name',
      '.result-side h2',
      '.profit-text',
      '.result-meta',
    ]
    const visibleSecrets = secretSelectors
      .map((selector) => document.querySelector(selector)?.getBoundingClientRect())
      .filter((rect) => (
        rect
        && rect.width > 0
        && rect.height > 0
        && rect.right > 0
        && rect.left < innerWidth
        && rect.bottom > 0
        && rect.top < innerHeight
      ))
    const concealedSecrets = visibleSecrets.every((rect) => {
      const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2
      const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2
      return !!document.elementFromPoint(x, y)?.closest('.cs2-console')
    })
    return {
      area: (right - left) * (bottom - top),
      onTop: !!hit?.closest('.cs2-console'),
      secretCount: visibleSecrets.length,
      concealedSecrets,
      coversVisibleResult: (
        panelRect.left <= Math.max(0, resultRect.left) + 2
        && panelRect.top <= Math.max(0, resultRect.top) + 2
        && panelRect.right >= Math.min(innerWidth, resultRect.right) - 2
        && panelRect.bottom >= Math.min(innerHeight, resultRect.bottom) - 2
      ),
    }
  })
  if (
    !resultCoverage?.area
    || !resultCoverage.onTop
    || resultCoverage.secretCount !== 4
    || !resultCoverage.concealedSecrets
    || !resultCoverage.coversVisibleResult
  ) {
    throw new Error(`${name}: 控制台未实际遮挡结果 ${JSON.stringify(resultCoverage)}`)
  }
  const resultQualityColor = await page.locator('.stage > .result.show').evaluate((element) => (
    getComputedStyle(element).getPropertyValue('--rarity-color').trim().toLowerCase()
  ))
  if (resultQualityColor !== whiteoutQualityColor) {
    throw new Error(
      `${name}: 白场颜色 ${whiteoutQualityColor} 与结果颜色 ${resultQualityColor} 不一致`,
    )
  }
  await page.screenshot({ path: `/tmp/furnace-fx-${name}-result-covered.png` })

  const consolePanel = page.locator('.cs2-console')
  const consoleTitlebar = page.locator('.cs2-console-titlebar')
  const resizeHandle = page.locator('.cs2-console-resize-handle.resize-se')
  const consoleBeforeResize = await consolePanel.boundingBox()
  const resizeHandleBox = await resizeHandle.boundingBox()
  if (!consoleBeforeResize || !resizeHandleBox) {
    throw new Error(`${name}: 无法测量控制台缩放边框`)
  }
  await page.mouse.move(
    resizeHandleBox.x + resizeHandleBox.width / 2,
    resizeHandleBox.y + resizeHandleBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    resizeHandleBox.x + resizeHandleBox.width / 2 - 68,
    resizeHandleBox.y + resizeHandleBox.height / 2 - 56,
    { steps: 10 },
  )
  await page.mouse.up()
  await waitForFrames(page)

  const consoleAfterResize = await consolePanel.boundingBox()
  if (
    !consoleAfterResize
    || consoleAfterResize.width > consoleBeforeResize.width - 35
    || consoleAfterResize.height > consoleBeforeResize.height - 30
    || Math.abs(consoleAfterResize.x - consoleBeforeResize.x) > 3
    || Math.abs(consoleAfterResize.y - consoleBeforeResize.y) > 3
  ) {
    throw new Error(
      `${name}: 拖动右下边框后尺寸或锚点异常 ${JSON.stringify({
        before: consoleBeforeResize,
        after: consoleAfterResize,
      })}`,
    )
  }

  const consoleBefore = consoleAfterResize
  const titlebarBox = await consoleTitlebar.boundingBox()
  if (!consoleBefore || !titlebarBox) throw new Error(`${name}: 无法测量控制台位置`)
  const dragStartX = titlebarBox.x + titlebarBox.width * 0.5
  const dragStartY = titlebarBox.y + titlebarBox.height * 0.5
  await page.mouse.move(dragStartX, dragStartY)
  await page.mouse.down()
  await page.mouse.move(12, dragStartY, { steps: 12 })
  await page.mouse.up()
  await waitForFrames(page)

  const consoleAfter = await consolePanel.boundingBox()
  const closeButton = page.getByRole('button', { name: '关闭控制台' })
  const closeButtonBox = await closeButton.boundingBox()
  if (!consoleAfter || Math.abs(consoleAfter.x - consoleBefore.x) < 20) {
    throw new Error(`${name}: 拖动标题栏后控制台未移动`)
  }
  const visibleWidth = Math.min(viewport.width, consoleAfter.x + consoleAfter.width)
    - Math.max(0, consoleAfter.x)
  if (visibleWidth < 90 || !closeButtonBox) {
    throw new Error(`${name}: 拖动后未保留可找回的标题栏`)
  }
  if (
    closeButtonBox.x < 0
    || closeButtonBox.y < 0
    || closeButtonBox.x + closeButtonBox.width > viewport.width
    || closeButtonBox.y + closeButtonBox.height > viewport.height
  ) {
    throw new Error(`${name}: 拖动后关闭按钮越出视口`)
  }
  await page.screenshot({ path: `/tmp/furnace-fx-${name}-result-peek.png` })

  await closeButton.click()
  await page.waitForSelector('.cs2-console', { state: 'detached', timeout: 2000 })
  const revealedResult = await page.evaluate(() => {
    const result = document.querySelector('.stage > .result.show')
    if (!result) return false
    const rect = result.getBoundingClientRect()
    const left = Math.max(0, rect.left)
    const top = Math.max(0, rect.top)
    const right = Math.min(innerWidth, rect.right)
    const bottom = Math.min(innerHeight, rect.bottom)
    if (right <= left || bottom <= top) return false
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
    return !!hit?.closest('.result.show')
  })
  if (!revealedResult || !(await page.locator('.result.show').isVisible())) {
    throw new Error(`${name}: 关闭控制台后结果未保持可见`)
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
