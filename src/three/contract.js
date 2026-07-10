import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import {
  UnrealBloomPass,
} from 'three/addons/postprocessing/UnrealBloomPass.js';

// 「合同签订」确认汰换特效：
// 一份汰换合同自上方飞入并展开 → 逐条列出选中材料（名称用对应品质色）→
// 在盖章处显示脉冲提示，等待用户点击 → 点击后「已签署」印章砸下（onStamp）→
// 合同向上抽离 → onDone 交回外部（外部衔接熔炉闭合）。
// createContract(canvas) 返回句柄，play(opts) 播放一次完整序列，回调驱动外部。
//
// 合同纸面用 2D canvas 逐帧绘制后作为纹理贴到三维平面上——中文文本与逐项
// 品质配色都能自由排版；盖章交互由内部 Raycaster 命中纸面并换算 UV → 纸面
// 像素坐标判定，等待盖章期间外层需允许 canvas 接收 pointer 事件。

const FOV = 42
// 合同纸面像素尺寸（纹理分辨率）与三维平面尺寸（保持同一纵横比 √2 : 1 近似 A4）
const PAGE_W = 900
const PAGE_H = 1180
const PLANE_W = 6.4
const PLANE_H = (PAGE_H / PAGE_W) * PLANE_W
const CONTRACT_SIGNER_NAME = 'XXX'
// 印章中心（纸面像素坐标）与点击判定半径
const STAMP_CX = PAGE_W - 200
const STAMP_CY = PAGE_H - 260
const STAMP_R = 92
const STAMP_HIT_R = 150

function formatContractDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// ---------- 数学小工具 ----------
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (a, b, t) => {
  t = clamp01((t - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const easeOut = (x) => 1 - Math.pow(1 - x, 3)
const easeIn = (x) => x * x * x

// ---------- 合同纸面绘制 ----------
// 用一个离屏 canvas 绘制整张合同：
// stampProgress ∈ [0,1] 控制「已签署」印章的下压浮现；
// hintAlpha ∈ [0,1] / hintPulse ∈ [0,1] 控制盖章处的点击提示（脉冲虚线圈）。
// 返回 { canvas, redraw }。
function makePaper(items, resultTag) {
  const cv = document.createElement('canvas')
  cv.width = PAGE_W
  cv.height = PAGE_H
  const g = cv.getContext('2d')
  const signedDate = formatContractDate()

  function roundRect(x, y, w, h, r) {
    g.beginPath()
    g.moveTo(x + r, y)
    g.arcTo(x + w, y, x + w, y + h, r)
    g.arcTo(x + w, y + h, x, y + h, r)
    g.arcTo(x, y + h, x, y, r)
    g.arcTo(x, y, x + w, y, r)
    g.closePath()
  }

  function redraw(stampProgress, hintAlpha, hintPulse) {
    // 纸张底色：米黄羊皮纸质感 + 轻微渐变
    const bg = g.createLinearGradient(0, 0, 0, PAGE_H)
    bg.addColorStop(0, '#f7f1e0')
    bg.addColorStop(0.5, '#f2ead3')
    bg.addColorStop(1, '#eadfc2')
    g.fillStyle = bg
    g.fillRect(0, 0, PAGE_W, PAGE_H)

    // 边框
    g.strokeStyle = 'rgba(60,46,20,0.55)'
    g.lineWidth = 3
    g.strokeRect(34, 34, PAGE_W - 68, PAGE_H - 68)
    g.strokeStyle = 'rgba(120,95,45,0.4)'
    g.lineWidth = 1
    g.strokeRect(46, 46, PAGE_W - 92, PAGE_H - 92)

    // 标题
    g.fillStyle = '#2a2113'
    g.textAlign = 'center'
    g.font = '900 62px "PingFang SC","Microsoft YaHei",sans-serif'
    g.fillText('汰 换 合 同', PAGE_W / 2, 150)
    g.font = '600 24px "PingFang SC","Microsoft YaHei",sans-serif'
    g.fillStyle = '#7a6a44'
    g.fillText('TRADE-UP CONTRACT · 元游猫', PAGE_W / 2, 190)

    // 分隔线
    g.strokeStyle = 'rgba(120,95,45,0.5)'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(90, 220)
    g.lineTo(PAGE_W - 90, 220)
    g.stroke()

    // 序文
    g.textAlign = 'left'
    g.fillStyle = '#241a0c'
    g.font = '500 23px "PingFang SC","Microsoft YaHei",sans-serif'
    g.fillText('立约人自愿将下列同品质物品提交汰换，', 90, 268)
    g.fillText('并同意依 CS2 汰换规则随机产出高一档物品，盈亏自负。', 90, 302)

    // 材料清单标题
    g.fillStyle = '#2a2113'
    g.font = '800 26px "PingFang SC","Microsoft YaHei",sans-serif'
    g.fillText('汰换材料清单', 90, 366)
    g.fillStyle = '#7a6a44'
    g.font = '600 20px "PingFang SC","Microsoft YaHei",sans-serif'
    g.textAlign = 'right'
    g.fillText(`共 ${items.length} 件`, PAGE_W - 90, 366)
    g.textAlign = 'left'

    // 逐条材料：编号 + 名称（名称用品质色）
    const listTop = 398
    const rowH = 46
    items.forEach((it, i) => {
      const y = listTop + i * rowH
      if (i % 2 === 0) {
        g.fillStyle = 'rgba(120,95,45,0.06)'
        roundRect(84, y - 30, PAGE_W - 168, rowH - 8, 8)
        g.fill()
      }
      // 编号
      g.fillStyle = '#8a7748'
      g.font = '700 22px "PingFang SC",monospace'
      g.textAlign = 'left'
      g.fillText(String(i + 1).padStart(2, '0'), 100, y)
      // 品质小色块
      g.fillStyle = it.color
      roundRect(150, y - 18, 16, 16, 3)
      g.fill()
      // 名称（品质色，深色描边保证在浅纸上可读）
      g.font = '700 25px "PingFang SC","Microsoft YaHei",sans-serif'
      g.textAlign = 'left'
      g.lineWidth = 3
      g.strokeStyle = 'rgba(20,14,4,0.35)'
      g.strokeText(it.name, 182, y)
      g.fillStyle = it.color
      g.fillText(it.name, 182, y)
    })

    // 底部条款 + 产物预期
    const footY = listTop + items.length * rowH + 42
    g.strokeStyle = 'rgba(120,95,45,0.45)'
    g.lineWidth = 1.5
    g.beginPath()
    g.moveTo(90, footY - 28)
    g.lineTo(PAGE_W - 90, footY - 28)
    g.stroke()
    g.fillStyle = '#241a0c'
    g.font = '500 21px "PingFang SC","Microsoft YaHei",sans-serif'
    g.textAlign = 'left'
    g.fillText(`预期产出品质：高一档（${resultTag || '随机'}）`, 90, footY + 4)
    g.fillText('产出物品及其磨损、估值以熔铸结果为准，一经签署不可撤销。', 90, footY + 36)

    // 签名区
    const signY = PAGE_H - 120
    g.fillStyle = '#5a4a28'
    g.font = '600 22px "PingFang SC","Microsoft YaHei",sans-serif'
    g.fillText('签署人：', 90, signY)
    g.fillStyle = '#2a2113'
    g.font = '700 24px "PingFang SC","Microsoft YaHei",sans-serif'
    g.fillText(CONTRACT_SIGNER_NAME, 205, signY)
    g.strokeStyle = 'rgba(90,74,40,0.6)'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(200, signY + 6)
    g.lineTo(430, signY + 6)
    g.stroke()
    g.fillStyle = '#8a7748'
    g.font = '400 18px "PingFang SC","Microsoft YaHei",sans-serif'
    g.fillText(`日期：${signedDate}`, 90, signY + 42)

    // 盖章点击提示（等待盖章期间脉冲显示，开始盖章后淡出）
    if (hintAlpha > 0.01) {
      drawHint(hintAlpha, hintPulse)
    }

    // 「已签署」印章
    if (stampProgress > 0) {
      drawStamp(stampProgress)
    }
  }

  // 盖章提示：印章位置的脉冲虚线圈 + 「点击盖章」文字
  function drawHint(alpha, pulse) {
    const breath = 0.75 + 0.25 * Math.sin(pulse * Math.PI * 2)
    g.save()
    g.globalAlpha = alpha * breath
    g.translate(STAMP_CX, STAMP_CY)
    // 外圈旋转虚线
    g.strokeStyle = 'rgba(190,40,32,0.9)'
    g.lineWidth = 4
    g.setLineDash([16, 12])
    g.lineDashOffset = -pulse * 56
    g.beginPath()
    g.arc(0, 0, STAMP_R + 18 + (1 - breath) * 14, 0, Math.PI * 2)
    g.stroke()
    g.setLineDash([])
    // 内圈淡红底
    g.fillStyle = 'rgba(190,40,32,0.08)'
    g.beginPath()
    g.arc(0, 0, STAMP_R + 4, 0, Math.PI * 2)
    g.fill()
    // 文案
    g.fillStyle = 'rgba(190,40,32,0.95)'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = '900 34px "PingFang SC","Microsoft YaHei",sans-serif'
    g.fillText('点击盖章', 0, -12)
    g.font = '700 16px "PingFang SC",sans-serif'
    g.fillText('CLICK TO STAMP', 0, 24)
    g.textBaseline = 'alphabetic'
    g.restore()
  }

  // 红色「已签署」印章：圆环 + 文字，带旋转与缩放下压
  function drawStamp(prog) {
    g.save()
    g.globalAlpha = clamp01(prog)
    g.translate(STAMP_CX, STAMP_CY)
    g.rotate(-0.22)
    g.scale(lerp(1.35, 1, easeOut(prog)), lerp(1.35, 1, easeOut(prog)))
    g.strokeStyle = 'rgba(190,40,32,0.9)'
    g.lineWidth = 6
    g.beginPath()
    g.arc(0, 0, STAMP_R, 0, Math.PI * 2)
    g.stroke()
    g.lineWidth = 3
    g.beginPath()
    g.arc(0, 0, STAMP_R - 14, 0, Math.PI * 2)
    g.stroke()
    g.fillStyle = 'rgba(190,40,32,0.92)'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = '900 40px "PingFang SC","Microsoft YaHei",sans-serif'
    g.fillText('已签署', 0, -10)
    g.font = '700 18px "PingFang SC",sans-serif'
    g.fillText('SIGNED', 0, 26)
    g.textBaseline = 'alphabetic'
    g.restore()
  }

  return { canvas: cv, redraw }
}

export function createContract(canvas) {
  const disposables = []
  const track = (o) => (disposables.push(o), o)

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x05060c, 0.02)

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100)
  const camBase = new THREE.Vector3(0, 0.2, 13.2)
  camera.position.copy(camBase)
  camera.lookAt(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.92

  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
  scene.environment = envRT.texture
  if ('environmentIntensity' in scene) scene.environmentIntensity = 0.5

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  // 高 threshold：只让真正的高光泛光，避免整张亮纸被冲淡文字对比
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.26, 0.5, 0.9)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  // 背景竖直渐变（深蓝紫，呼应原型氛围光）
  const bgCanvas = document.createElement('canvas')
  bgCanvas.width = 16
  bgCanvas.height = 256
  {
    const bg = bgCanvas.getContext('2d')
    const grd = bg.createLinearGradient(0, 0, 0, 256)
    grd.addColorStop(0, '#0a0d1a')
    grd.addColorStop(0.55, '#0b0a16')
    grd.addColorStop(1, '#120a1a')
    bg.fillStyle = grd
    bg.fillRect(0, 0, 16, 256)
  }
  const bgTex = track(new THREE.CanvasTexture(bgCanvas))
  bgTex.colorSpace = THREE.SRGBColorSpace
  scene.background = bgTex

  // ---------- 灯光 ----------
  scene.add(new THREE.AmbientLight(0x9099b0, 0.85))
  const key = new THREE.DirectionalLight(0xfff2e0, 1.05)
  key.position.set(-4, 6, 8)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x7088ff, 0.5)
  rim.position.set(6, 2, -4)
  scene.add(rim)
  // 暖色台灯感聚光：等待盖章时照亮纸面右下的印章区
  const deskLight = new THREE.SpotLight(0xffe6b0, 0, 30, Math.PI / 5, 0.5, 1.5)
  deskLight.position.set(3.5, 4, 7)
  scene.add(deskLight)
  const deskTarget = new THREE.Object3D()
  deskTarget.position.set(2, -2.4, 0)
  scene.add(deskTarget)
  deskLight.target = deskTarget

  // ---------- 合同纸面 ----------
  const paperGroup = new THREE.Group()
  scene.add(paperGroup)
  let paper = null // { canvas, redraw }
  let paperTex = null
  const paperMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
  })
  track(paperMat)
  // 微弯的纸：用略微分段的平面 + 顶点轻微起伏，避免纯平面的呆板
  const paperGeo = track(new THREE.PlaneGeometry(PLANE_W, PLANE_H, 24, 32))
  {
    const pos = paperGeo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = Math.sin((x / PLANE_W) * Math.PI) * 0.12 - Math.abs(y / PLANE_H) * 0.08
      pos.setZ(i, z)
    }
    paperGeo.computeVertexNormals()
  }
  const paperMesh = new THREE.Mesh(paperGeo, paperMat)
  paperGroup.add(paperMesh)

  // 纸面背光辉光（盖章瞬间轻微增强）
  const glowMat = track(
    new THREE.MeshBasicMaterial({ color: 0xffcf28, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  )
  const glow = new THREE.Mesh(track(new THREE.PlaneGeometry(PLANE_W * 1.25, PLANE_H * 1.2)), glowMat)
  glow.position.z = -0.15
  paperGroup.add(glow)

  // ---------- 状态 & 时间线 ----------
  // 时间线里 stampAt 在点击前为 Infinity：飞入展示后停在「等待盖章」，
  // confirmStamp()（点击命中印章区）把 stampAt 设为当前时刻，序列继续。
  let raf = 0
  let running = false
  const clock = new THREE.Clock()
  let t = 0
  let cb = {}
  let T = null
  const fired = {}
  let stampProg = 0
  let hintAlpha = 0
  let lastTexUpdate = -1

  function buildTimeline() {
    return {
      flyIn: 0,        // 合同飞入开始
      flyEnd: 0.9,     // 飞入定格
      readEnd: 1.6,    // 材料清单展示完毕，提示出现、开始等待点击
      stampAt: Infinity,     // 点击时刻（点击后写入）
      stampEnd: Infinity,    // 印章落定
      stampHit: Infinity,    // 印章接触瞬间（音效/闪光）
      flyOutStart: Infinity, // 合同抽离
      flyOutEnd: Infinity,
      doneTime: Infinity,
    }
  }

  const waitingStamp = () => running && T && !isFinite(T.stampAt) && t >= T.readEnd

  function confirmStamp() {
    T.stampAt = t + 0.04
    T.stampEnd = T.stampAt + 0.4
    // 音效抢在落定前一点触发，听感更跟手
    T.stampHit = T.stampEnd - 0.36
    T.flyOutStart = T.stampEnd + 0.55
    T.flyOutEnd = T.flyOutStart + 0.8
    T.doneTime = T.flyOutEnd + 0.15
    canvas.style.cursor = 'default'
  }

  // ---------- 盖章点击交互 ----------
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  function pickStamp(e) {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObject(paperMesh)[0]
    if (!hit || !hit.uv) return false
    const px = hit.uv.x * PAGE_W
    const py = (1 - hit.uv.y) * PAGE_H
    return Math.hypot(px - STAMP_CX, py - STAMP_CY) <= STAMP_HIT_R
  }
  function onPointerDown(e) {
    if (!waitingStamp()) return
    if (!pickStamp(e)) return
    confirmStamp()
  }
  function onPointerMove(e) {
    if (!waitingStamp()) {
      canvas.style.cursor = 'default'
      return
    }
    canvas.style.cursor = pickStamp(e) ? 'pointer' : 'default'
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)

  // 合同飞入 → 定格（等待盖章）→ 抽离 的位姿
  function updatePaper() {
    let px = 0, py = 0, pz = 0, rotX = 0, rotZ = 0, scale = 1, op = 1
    if (t < T.flyEnd) {
      // 自上方偏转飞入
      const p = easeOut(smooth(T.flyIn, T.flyEnd, t))
      py = lerp(9, 0, p)
      pz = lerp(-6, 0, p)
      rotX = lerp(-1.1, 0, p)
      rotZ = lerp(0.5, 0, p)
      scale = lerp(0.6, 1, p)
      op = clamp01(p * 2)
    } else if (t < T.flyOutStart) {
      // 定格：极缓慢的呼吸浮动
      const b = Math.sin(t * 1.2) * 0.02
      py = b
      rotX = Math.sin(t * 0.8) * 0.015
    } else {
      // 向上抽离并翻转淡出
      const p = easeIn(smooth(T.flyOutStart, T.flyOutEnd, t))
      py = lerp(0, 8, p)
      pz = lerp(0, 3, p)
      rotX = lerp(0, 1.0, p)
      rotZ = lerp(0, -0.35, p)
      scale = lerp(1, 0.7, p)
      op = 1 - clamp01((t - T.flyOutStart) / (T.flyOutEnd - T.flyOutStart) * 1.15)
    }
    paperGroup.position.set(px, py, pz)
    paperGroup.rotation.set(rotX, 0, rotZ)
    paperGroup.scale.setScalar(scale)
    paperMat.opacity = op
    paperMat.transparent = op < 1
    // 盖章落定时纸面辉光轻微亮起，抽离时退去
    const glowOn = isFinite(T.stampAt)
      ? smooth(T.stampAt, T.stampEnd, t) * (t < T.flyOutStart ? 1 : clamp01(1 - smooth(T.flyOutStart, T.flyOutEnd, t)))
      : 0
    glowMat.opacity = 0.12 * glowOn
  }

  function stepUpdate() {
    // 阶段回调
    if (!fired.pIn && t >= T.flyIn) { fired.pIn = true; cb.onPhase && cb.onPhase('呈递合同'); cb.onPaper && cb.onPaper() }
    if (!fired.pRead && t >= T.flyEnd) { fired.pRead = true; cb.onPhase && cb.onPhase('核对材料') }
    if (!fired.pWait && t >= T.readEnd) { fired.pWait = true; cb.onPhase && cb.onPhase('点击合同右下角盖章'); cb.onAwaitStamp && cb.onAwaitStamp() }
    if (!fired.pStamp && t >= T.stampAt) { fired.pStamp = true; cb.onPhase && cb.onPhase('盖章') }
    if (!fired.stampHit && t >= T.stampHit) { fired.stampHit = true; cb.onStamp && cb.onStamp() }
    if (!fired.pOut && t >= T.flyOutStart) { fired.pOut = true; cb.onPhase && cb.onPhase('生效'); cb.onPaper && cb.onPaper() }
    if (!fired.done && t >= T.doneTime) { fired.done = true; running = false; cb.onDone && cb.onDone() }

    // 印章进度 / 提示透明度
    stampProg = isFinite(T.stampAt) ? clamp01(smooth(T.stampAt, T.stampEnd, t)) : 0
    const hintIn = smooth(T.readEnd, T.readEnd + 0.4, t)
    const hintOut = isFinite(T.stampAt) ? 1 - clamp01((t - T.stampAt) / 0.18) : 1
    hintAlpha = hintIn * hintOut
    const hintPulse = (t % 1.4) / 1.4

    // 仅在画面内容变化时重绘纹理（印章/提示均量化，避免每帧无谓重绘）
    const key =
      Math.round(stampProg * 60) * 100000 +
      Math.round(hintAlpha * 24) * 1000 +
      (hintAlpha > 0.01 ? Math.round(hintPulse * 48) : 0)
    if (key !== lastTexUpdate) {
      lastTexUpdate = key
      paper.redraw(stampProg, hintAlpha, hintPulse)
      paperTex.needsUpdate = true
    }

    // 台灯在等待盖章时点亮，照向印章区
    const lightOff = isFinite(T.flyOutStart) ? clamp01(1 - smooth(T.flyOutStart, T.flyOutEnd, t)) : 1
    deskLight.intensity = 1.4 * smooth(T.flyEnd, T.readEnd, t) * lightOff

    updatePaper()

    // bloom 在盖章定格时略增（基准低，避免冲淡纸面文字）
    bloom.strength = 0.24 + 0.12 * glowMat.opacity / 0.28

    // 相机极缓慢推进 + 轻微呼吸
    const dolly = smooth(0, 6, Math.min(t, 6))
    camera.position.set(camBase.x, camBase.y + Math.sin(t * 0.5) * 0.05, lerp(camBase.z, 12.4, dolly))
    camera.lookAt(0, -0.1, 0)
  }

  function tick() {
    const ts = typeof window !== 'undefined' ? window.__CONTRACT_TIMESCALE : undefined
    const scale = ts == null ? 1 : ts
    const dt = Math.min(clock.getDelta(), 0.05) * scale
    t += dt
    stepUpdate()
    composer.render()
    if (running) raf = requestAnimationFrame(tick)
  }

  function resize() {
    const w = canvas.clientWidth || 1
    const h = canvas.clientHeight || 1
    renderer.setSize(w, h, false)
    composer.setSize(w, h)
    bloom.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  const ro = new ResizeObserver(resize)
  ro.observe(canvas)
  resize()

  function resetState() {
    t = 0
    for (const k in fired) delete fired[k]
    stampProg = 0
    hintAlpha = 0
    lastTexUpdate = -1
    deskLight.intensity = 0
    glowMat.opacity = 0
    canvas.style.cursor = 'default'
  }

  function play(opts = {}) {
    cb = opts
    const items = (opts.items && opts.items.length ? opts.items : [{ name: '未知物品', color: '#b0c3d9' }])
    const resultTag = opts.resultTag || ''

    // 重建纸面纹理
    if (paperTex) paperTex.dispose()
    paper = makePaper(items, resultTag)
    paperTex = new THREE.CanvasTexture(paper.canvas)
    paperTex.colorSpace = THREE.SRGBColorSpace
    paperTex.anisotropy = renderer.capabilities.getMaxAnisotropy()
    paperMat.map = paperTex
    paperMat.needsUpdate = true

    T = buildTimeline()
    resetState()
    paper.redraw(0, 0, 0)
    paperTex.needsUpdate = true

    if (!running) {
      running = true
      clock.getDelta()
      raf = requestAnimationFrame(tick)
    }
  }

  function stop() {
    running = false
    cancelAnimationFrame(raf)
    canvas.style.cursor = 'default'
  }

  function dispose() {
    stop()
    ro.disconnect()
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    if (paperTex) paperTex.dispose()
    disposables.forEach((o) => o.dispose && o.dispose())
    envRT.dispose()
    pmrem.dispose()
    composer.dispose()
    renderer.dispose()
  }

  return { play, stop, resize, dispose }
}
