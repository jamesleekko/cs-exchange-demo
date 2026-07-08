import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

// 「合同签订」确认汰换特效：
// 一份汰换合同自上方飞入并展开 → 逐条列出选中材料（名称用对应品质色）→
// 右下角一支黑色签字笔画出一个「勾」→ 合同盖章并向上抽离 → onDone 切结果。
// createContract(canvas) 返回句柄，play(opts) 播放一次完整序列，回调驱动外部（音效、结果视图）。
//
// 合同纸面用 2D canvas 逐帧绘制后作为纹理贴到三维平面上——这样中文文本与逐项
// 品质配色都能自由排版，而「打勾」则通过逐帧推进笔迹描边进度重绘纹理来实现。

const FOV = 42
// 合同纸面像素尺寸（纹理分辨率）与三维平面尺寸（保持同一纵横比 √2 : 1 近似 A4）
const PAGE_W = 900
const PAGE_H = 1180
const PLANE_W = 6.4
const PLANE_H = (PAGE_H / PAGE_W) * PLANE_W

// ---------- 数学小工具 ----------
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (a, b, t) => {
  t = clamp01((t - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const easeOut = (x) => 1 - Math.pow(1 - x, 3)
const easeIn = (x) => x * x * x
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

// ---------- 合同纸面绘制 ----------
// 用一个离屏 canvas 绘制整张合同，signProgress ∈ [0,1] 控制右下角「勾」的描边进度、
// stampProgress ∈ [0,1] 控制「已签署」印章的浮现。返回 { canvas, redraw }。
function makePaper(items, resultTag) {
  const cv = document.createElement('canvas')
  cv.width = PAGE_W
  cv.height = PAGE_H
  const g = cv.getContext('2d')

  // 勾的两段折线控制点（纸面像素坐标，位于右下签名区）
  const CHECK = {
    p0: { x: PAGE_W - 250, y: PAGE_H - 150 },
    p1: { x: PAGE_W - 205, y: PAGE_H - 105 },
    p2: { x: PAGE_W - 120, y: PAGE_H - 210 },
  }

  function roundRect(x, y, w, h, r) {
    g.beginPath()
    g.moveTo(x + r, y)
    g.arcTo(x + w, y, x + w, y + h, r)
    g.arcTo(x + w, y + h, x, y + h, r)
    g.arcTo(x, y + h, x, y, r)
    g.arcTo(x, y, x + w, y, r)
    g.closePath()
  }

  function redraw(signProgress, stampProgress) {
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
    g.fillText('立约人自愿将下列同品质物品提交熔铸，', 90, 268)
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
    g.strokeStyle = 'rgba(90,74,40,0.6)'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(200, signY + 6)
    g.lineTo(430, signY + 6)
    g.stroke()
    g.fillStyle = '#8a7748'
    g.font = '400 18px "PingFang SC","Microsoft YaHei",sans-serif'
    g.fillText('日期：本日', 90, signY + 42)

    // 右下角「勾」——黑色签字笔迹，随 signProgress 逐段显现
    if (signProgress > 0) {
      drawCheck(signProgress)
    }

    // 「已签署」印章
    if (stampProgress > 0) {
      drawStamp(stampProgress)
    }
  }

  // 沿 p0→p1→p2 折线按进度绘制勾，带轻微墨迹起伏
  function drawCheck(prog) {
    const { p0, p1, p2 } = CHECK
    const len1 = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    const len2 = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const total = len1 + len2
    const drawn = prog * total

    g.strokeStyle = '#15110a'
    g.lineJoin = 'round'
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(p0.x, p0.y)
    if (drawn <= len1) {
      const t = drawn / len1
      g.lineWidth = lerp(10, 13, t)
      g.lineTo(lerp(p0.x, p1.x, t), lerp(p0.y, p1.y, t))
    } else {
      g.lineWidth = 13
      g.lineTo(p1.x, p1.y)
      const t = clamp01((drawn - len1) / len2)
      // 主笔收尾略微提笔变细
      g.lineTo(lerp(p1.x, p2.x, t), lerp(p1.y, p2.y, t))
    }
    g.stroke()
    // 二次描边模拟墨迹渗透
    g.globalAlpha = 0.35
    g.lineWidth = 4
    g.stroke()
    g.globalAlpha = 1
  }

  // 红色「已签署」印章：圆环 + 文字，带旋转与缩放浮现
  function drawStamp(prog) {
    const cx = PAGE_W - 200
    const cy = PAGE_H - 260
    const R = 92
    g.save()
    g.globalAlpha = clamp01(prog)
    g.translate(cx, cy)
    g.rotate(-0.22)
    g.scale(lerp(1.35, 1, easeOut(prog)), lerp(1.35, 1, easeOut(prog)))
    g.strokeStyle = 'rgba(190,40,32,0.9)'
    g.lineWidth = 6
    g.beginPath()
    g.arc(0, 0, R, 0, Math.PI * 2)
    g.stroke()
    g.lineWidth = 3
    g.beginPath()
    g.arc(0, 0, R - 14, 0, Math.PI * 2)
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

  return { canvas: cv, redraw, CHECK }
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
  // 高 threshold：只让真正的高光（辉光/印章边）泛光，避免整张亮纸被冲淡文字对比
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
  // 暖色台灯感聚光，让签字时纸面右下更亮
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
  let paper = null // { canvas, redraw, CHECK }
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

  // 纸面背光辉光（签字定格时轻微增强）
  const glowMat = track(
    new THREE.MeshBasicMaterial({ color: 0xffcf28, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  )
  const glow = new THREE.Mesh(track(new THREE.PlaneGeometry(PLANE_W * 1.25, PLANE_H * 1.2)), glowMat)
  glow.position.z = -0.15
  paperGroup.add(glow)

  // ---------- 签字笔 ----------
  const pen = new THREE.Group()
  const penMats = []
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.35, metalness: 0.6 })
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.7, metalness: 0.2 })
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c8, roughness: 0.25, metalness: 0.95 })
  const capMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.9 })
  penMats.push(barrelMat, gripMat, tipMat, capMat)
  penMats.forEach(track)
  // 笔杆（沿 -y 向下收细到笔尖），组的原点即笔尖位置，便于对准纸面
  const barrel = new THREE.Mesh(track(new THREE.CylinderGeometry(0.14, 0.17, 2.2, 24)), barrelMat)
  barrel.position.y = 1.5
  pen.add(barrel)
  const grip = new THREE.Mesh(track(new THREE.CylinderGeometry(0.17, 0.15, 0.5, 24)), gripMat)
  grip.position.y = 0.55
  pen.add(grip)
  const cone = new THREE.Mesh(track(new THREE.ConeGeometry(0.15, 0.42, 24)), gripMat)
  cone.position.y = 0.2
  pen.add(cone)
  const tip = new THREE.Mesh(track(new THREE.ConeGeometry(0.035, 0.16, 16)), tipMat)
  tip.position.y = 0.04
  pen.add(tip)
  const clip = new THREE.Mesh(track(new THREE.BoxGeometry(0.05, 0.6, 0.12)), capMat)
  clip.position.set(0.17, 2.1, 0)
  pen.add(clip)
  const cap = new THREE.Mesh(track(new THREE.CylinderGeometry(0.175, 0.175, 0.3, 24)), capMat)
  cap.position.y = 2.65
  pen.add(cap)
  pen.visible = false
  scene.add(pen)

  // 笔尖火花/墨点粒子（画勾时溅出的细小亮点）
  const inkGeo = track(new THREE.BufferGeometry())
  const INK_MAX = 120
  const inkPos = new Float32Array(INK_MAX * 3)
  const inkAlpha = new Float32Array(INK_MAX)
  inkGeo.setAttribute('position', new THREE.BufferAttribute(inkPos, 3))
  inkGeo.setAttribute('aAlpha', new THREE.BufferAttribute(inkAlpha, 1))
  const inkMat = track(
    new THREE.PointsMaterial({ color: 0xffcf28, size: 0.08, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
  )
  const inkPoints = new THREE.Points(inkGeo, inkMat)
  inkPoints.frustumCulled = false
  scene.add(inkPoints)
  const inkPool = new Array(INK_MAX)
  for (let i = 0; i < INK_MAX; i++) inkPool[i] = { on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1 }
  let inkCursor = 0
  function emitInk(x, y) {
    for (let n = 0; n < 3; n++) {
      const p = inkPool[inkCursor]
      inkCursor = (inkCursor + 1) % INK_MAX
      p.on = true
      p.x = x
      p.y = y
      p.z = 0.1
      const a = Math.random() * Math.PI * 2
      const sp = 0.4 + Math.random() * 1.1
      p.vx = Math.cos(a) * sp
      p.vy = Math.sin(a) * sp + 0.6
      p.vz = Math.random() * 0.5
      p.life = p.max = 0.25 + Math.random() * 0.35
    }
  }
  function updateInk(dt) {
    for (let i = 0; i < INK_MAX; i++) {
      const p = inkPool[i]
      const j = i * 3
      if (!p.on) {
        inkAlpha[i] = 0
        continue
      }
      p.life -= dt
      if (p.life <= 0) {
        p.on = false
        inkAlpha[i] = 0
        continue
      }
      p.vy -= 2.5 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      inkPos[j] = p.x
      inkPos[j + 1] = p.y
      inkPos[j + 2] = p.z
      inkAlpha[i] = clamp01(p.life / p.max)
    }
    inkGeo.attributes.position.needsUpdate = true
    inkGeo.attributes.aAlpha.needsUpdate = true
    // 用整体不透明度近似（PointsMaterial 无逐点 alpha），取存活比例
    let alive = 0
    for (let i = 0; i < INK_MAX; i++) if (inkPool[i].on) alive++
    inkMat.opacity = alive > 0 ? 0.9 : 0
  }

  // 把纸面像素坐标（PAGE_W×PAGE_H，原点左上）映射到 paperGroup 局部三维坐标
  function pageToLocal(px, py) {
    return {
      x: (px / PAGE_W - 0.5) * PLANE_W,
      y: (0.5 - py / PAGE_H) * PLANE_H,
    }
  }

  // ---------- 状态 & 时间线 ----------
  let raf = 0
  let running = false
  const clock = new THREE.Clock()
  let t = 0
  let cb = {}
  let T = null
  const fired = {}
  let signProg = 0
  let stampProg = 0
  let lastTexUpdate = -1

  function buildTimeline() {
    const flyIn = 0        // 合同飞入开始
    const flyEnd = 0.9     // 飞入定格
    const readEnd = 1.7    // 停留展示材料清单
    const penIn = readEnd  // 笔飞入
    const penDown = penIn + 0.55 // 笔尖落到起笔点
    const signStart = penDown
    const signEnd = signStart + 0.85 // 画勾结束
    const stampStart = signEnd + 0.12
    const stampEnd = stampStart + 0.4
    const penOut = stampEnd + 0.15
    const flyOutStart = penOut + 0.35 // 合同抽离
    const flyOutEnd = flyOutStart + 0.8
    const doneTime = flyOutEnd + 0.15
    return { flyIn, flyEnd, readEnd, penIn, penDown, signStart, signEnd, stampStart, stampEnd, penOut, flyOutStart, flyOutEnd, doneTime }
  }

  // 合同飞入 → 定格 → 抽离 的位姿
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
    // 签字定格时纸面辉光渐起，抽离时退去
    const glowOn = smooth(T.signStart, T.signEnd, t) * (t < T.flyOutStart ? 1 : clamp01(1 - smooth(T.flyOutStart, T.flyOutEnd, t)))
    glowMat.opacity = 0.28 * glowOn
  }

  // 签字笔飞入 → 沿勾的折线运笔 → 抬笔飞出
  function updatePen() {
    if (t < T.penIn || t > T.penOut) {
      pen.visible = false
      return
    }
    pen.visible = true
    const check = paper.CHECK
    const start = pageToLocal(check.p0.x, check.p0.y)
    const mid = pageToLocal(check.p1.x, check.p1.y)
    const end = pageToLocal(check.p2.x, check.p2.y)

    let tipX, tipY, tipZ, tilt = 0.5, op = 1
    if (t < T.penDown) {
      // 笔从右上方俯冲到起笔点，笔尖逐渐贴近纸面
      const p = easeOut(smooth(T.penIn, T.penDown, t))
      tipX = lerp(start.x + 3, start.x, p)
      tipY = lerp(start.y + 4, start.y, p)
      tipZ = lerp(3, 0.18, p)
      op = clamp01(p * 2)
    } else if (t < T.signEnd) {
      // 运笔：沿 start→mid→end 折线，速度分配与描边一致
      const len1 = Math.hypot(mid.x - start.x, mid.y - start.y)
      const len2 = Math.hypot(end.x - mid.x, end.y - mid.y)
      const total = len1 + len2
      const prog = smooth(T.signStart, T.signEnd, t)
      const drawn = prog * total
      let cx, cy
      if (drawn <= len1) {
        const s = drawn / len1
        cx = lerp(start.x, mid.x, s)
        cy = lerp(start.y, mid.y, s)
      } else {
        const s = clamp01((drawn - len1) / len2)
        cx = lerp(mid.x, end.x, s)
        cy = lerp(mid.y, end.y, s)
      }
      tipX = cx
      tipY = cy
      tipZ = 0.14 + Math.sin(prog * Math.PI) * 0.02
      tilt = 0.5 + Math.sin(t * 30) * 0.03 // 运笔轻微抖动
    } else {
      // 抬笔飞出（右上）
      const p = easeIn(smooth(T.signEnd, T.penOut, t))
      tipX = lerp(end.x, end.x + 3.5, p)
      tipY = lerp(end.y, end.y + 4.5, p)
      tipZ = lerp(0.14, 4, p)
      op = 1 - p
    }
    pen.position.set(tipX, tipY, tipZ)
    pen.rotation.set(-0.32, 0, tilt)
    penMats.forEach((m) => {
      m.transparent = op < 1
      m.opacity = op
    })
  }

  function stepUpdate(dt) {
    // 阶段回调
    if (!fired.pIn && t >= T.flyIn) { fired.pIn = true; cb.onPhase && cb.onPhase('呈递合同'); cb.onPaper && cb.onPaper() }
    if (!fired.pRead && t >= T.flyEnd) { fired.pRead = true; cb.onPhase && cb.onPhase('核对材料') }
    if (!fired.pSign && t >= T.signStart) { fired.pSign = true; cb.onPhase && cb.onPhase('签字'); cb.onSign && cb.onSign() }
    if (!fired.pStamp && t >= T.stampStart) { fired.pStamp = true; cb.onPhase && cb.onPhase('盖章'); cb.onStamp && cb.onStamp() }
    if (!fired.pOut && t >= T.flyOutStart) { fired.pOut = true; cb.onPhase && cb.onPhase('生效'); cb.onPaper && cb.onPaper() }
    if (!fired.done && t >= T.doneTime) { fired.done = true; running = false; cb.onDone && cb.onDone() }

    // 描边 / 印章进度
    const newSign = clamp01(smooth(T.signStart, T.signEnd, t))
    const newStamp = clamp01(smooth(T.stampStart, T.stampEnd, t))
    // 运笔时从笔尖溅出墨点
    if (newSign > signProg && t >= T.signStart && t < T.signEnd) {
      emitInk(pen.position.x, pen.position.y)
    }
    signProg = newSign
    stampProg = newStamp

    // 仅在进度变化时重绘纹理（避免每帧无谓重绘）
    const key = Math.round(signProg * 120) + Math.round(stampProg * 60) * 1000
    if (key !== lastTexUpdate) {
      lastTexUpdate = key
      paper.redraw(signProg, stampProg)
      paperTex.needsUpdate = true
    }

    // 台灯在签字阶段点亮
    deskLight.intensity = 1.4 * smooth(T.penIn, T.signStart, t) * (t < T.penOut ? 1 : clamp01(1 - smooth(T.penOut, T.flyOutEnd, t)))

    updatePaper()
    updatePen()
    updateInk(dt)

    // bloom 在签字定格时略增（基准低，避免冲淡纸面文字）
    bloom.strength = 0.24 + 0.12 * glowMat.opacity / 0.28

    // 相机极缓慢推进 + 签字时轻微俯视
    const dolly = smooth(0, T.doneTime, t)
    camera.position.set(camBase.x, camBase.y + Math.sin(t * 0.5) * 0.05, lerp(camBase.z, 12.4, dolly))
    camera.lookAt(0, -0.1, 0)
  }

  function tick() {
    const ts = typeof window !== 'undefined' ? window.__CONTRACT_TIMESCALE : undefined
    const scale = ts == null ? 1 : ts
    const dt = Math.min(clock.getDelta(), 0.05) * scale
    t += dt
    stepUpdate(dt)
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
    signProg = 0
    stampProg = 0
    lastTexUpdate = -1
    inkPool.forEach((p) => (p.on = false))
    pen.visible = false
    deskLight.intensity = 0
    glowMat.opacity = 0
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
    paper.redraw(0, 0)
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
  }

  function dispose() {
    stop()
    ro.disconnect()
    if (paperTex) paperTex.dispose()
    penMats.forEach((m) => m.dispose())
    disposables.forEach((o) => o.dispose && o.dispose())
    envRT.dispose()
    pmrem.dispose()
    composer.dispose()
    renderer.dispose()
  }

  return { play, stop, resize, dispose }
}



