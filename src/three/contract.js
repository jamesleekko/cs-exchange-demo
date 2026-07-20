import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// 「合同签订」确认汰换特效：
// 一份汰换合同自下方抽出并展开 → 逐条列出选中材料（名称用对应品质色）→
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
const FLY_IN_START_Z = -6
const FLY_IN_START_ROT_X = 1.1
const FLY_IN_START_ROT_Z = 0.5
const FLY_IN_START_SCALE = 0.6
const FLY_IN_EDGE_MARGIN = 8
const CONTRACT_SIGNER_NAME = 'XXX'
const STAMP = {
  x: PAGE_W - 200,
  y: PAGE_H - 260,
  radius: 92,
}

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
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
// 勾的两笔：第一笔快速落、转角极短停、第二笔利落甩出
const signStrokeEase = (u, cornerRatio, pause = 0.07) => {
  if (u < cornerRatio) return easeOut(u / cornerRatio) * cornerRatio
  if (u < cornerRatio + pause) return cornerRatio
  const v = (u - cornerRatio - pause) / (1 - cornerRatio - pause)
  return cornerRatio + easeOut(v) * (1 - cornerRatio)
}

// ---------- 合同纸面绘制 ----------
// 用一个离屏 canvas 绘制整张合同，signProgress ∈ [0,1] 控制右下角「勾」的描边进度、
// stampProgress ∈ [0,1] 控制「已签署」印章的浮现。返回 { canvas, redraw }。
function makePaper(items, resultTag) {
  const cv = document.createElement('canvas')
  cv.width = PAGE_W
  cv.height = PAGE_H
  const g = cv.getContext('2d')
  const signedDate = formatContractDate()

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
    const cx = STAMP.x
    const cy = STAMP.y
    const R = STAMP.radius
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

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100)
  const camBase = new THREE.Vector3(0, 0.2, 13.2)
  camera.position.copy(camBase)
  camera.lookAt(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.92

  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
  scene.environment = envRT.texture
  if ('environmentIntensity' in scene) scene.environmentIntensity = 0.5

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
    paperGeo.computeBoundingBox()
  }
  const paperMesh = new THREE.Mesh(paperGeo, paperMat)
  paperGroup.add(paperMesh)

  // 入场首帧使用纸张包围盒计算屏幕底边外的起点，避免窄屏下纸张先在画面内淡入。
  const flyInBounds = paperGeo.boundingBox
  const flyInCorners = []
  for (const x of [flyInBounds.min.x, flyInBounds.max.x]) {
    for (const y of [flyInBounds.min.y, flyInBounds.max.y]) {
      for (const z of [flyInBounds.min.z, flyInBounds.max.z]) {
        flyInCorners.push(new THREE.Vector3(x, y, z))
      }
    }
  }
  const flyInMatrix = new THREE.Matrix4()
  const flyInPoint = new THREE.Vector3()
  const flyInPosition = new THREE.Vector3()
  const flyInRotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(FLY_IN_START_ROT_X, 0, FLY_IN_START_ROT_Z),
  )
  const flyInScale = new THREE.Vector3(
    FLY_IN_START_SCALE,
    FLY_IN_START_SCALE,
    FLY_IN_START_SCALE,
  )
  let flyInStartY = -9

  // ---------- 签字笔 ----------
  const pen = new THREE.Group()
  const penMats = []
  const penMatOpts = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.35, metalness: 0.6, ...penMatOpts })
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.7, metalness: 0.2, ...penMatOpts })
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c8, roughness: 0.25, metalness: 0.95, ...penMatOpts })
  const capMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.9, ...penMatOpts })
  penMats.push(barrelMat, gripMat, tipMat, capMat)
  penMats.forEach(track)
  // 组原点 = 落笔点（笔尖最底端），所有几何都在 y≥0，避免旋转时插入纸面。
  // 两个锥体默认尖端朝 +y，需绕 X 翻转 180° 让尖端朝下（-y，对着纸面）。
  const tip = new THREE.Mesh(track(new THREE.ConeGeometry(0.04, 0.16, 16)), tipMat)
  tip.rotation.x = Math.PI // 尖端朝下
  tip.position.y = 0.08     // 尖端落在 y=0（纸面），底在 0.16
  pen.add(tip)
  const cone = new THREE.Mesh(track(new THREE.ConeGeometry(0.16, 0.5, 24)), gripMat)
  cone.rotation.x = Math.PI // 由粗到细向下收，衔接笔尖
  cone.position.y = 0.41    // 细端 0.16，粗端 0.66
  pen.add(cone)
  const grip = new THREE.Mesh(track(new THREE.CylinderGeometry(0.17, 0.15, 0.5, 24)), gripMat)
  grip.position.y = 0.79
  pen.add(grip)
  const barrel = new THREE.Mesh(track(new THREE.CylinderGeometry(0.14, 0.17, 2.2, 24)), barrelMat)
  barrel.position.y = 1.74
  pen.add(barrel)
  const clip = new THREE.Mesh(track(new THREE.BoxGeometry(0.05, 0.6, 0.12)), capMat)
  clip.position.set(0.17, 2.34, 0)
  pen.add(clip)
  const cap = new THREE.Mesh(track(new THREE.CylinderGeometry(0.175, 0.175, 0.3, 24)), capMat)
  cap.position.y = 2.89
  pen.add(cap)
  pen.visible = false
  pen.renderOrder = 12
  pen.traverse((o) => { if (o.isMesh) o.renderOrder = 12 })
  paperGroup.add(pen)

  // 签字阶段不做笔尖粒子，保持黑色勾线干净清晰。
  function updateInk() {}

  // 把纸面像素坐标（PAGE_W×PAGE_H，原点左上）映射到 paperGroup 局部三维坐标
  function pageToLocal(px, py) {
    return {
      x: (px / PAGE_W - 0.5) * PLANE_W,
      y: (0.5 - py / PAGE_H) * PLANE_H,
    }
  }

  // 勾折线两段长度比，用于运笔进度与转角停顿
  function checkMetrics() {
    const { p0, p1, p2 } = paper.CHECK
    const s = pageToLocal(p0.x, p0.y)
    const m = pageToLocal(p1.x, p1.y)
    const e = pageToLocal(p2.x, p2.y)
    const len1 = Math.hypot(m.x - s.x, m.y - s.y)
    const len2 = Math.hypot(e.x - m.x, e.y - m.y)
    const total = len1 + len2
    return { start: s, mid: m, end: e, len1, len2, total, cornerRatio: len1 / total }
  }

  // 纸面在局部 (x,y) 处的表面高度 z——必须与 paperGeo 顶点起伏公式一致，
  // 用于让笔尖始终贴着纸面而不穿透。签字时纸处于静止态（无缩放/旋转），
  // 局部 z 即可近似作为世界 z 使用。
  function paperSurfaceZ(x, y) {
    return Math.sin((x / PLANE_W) * Math.PI) * 0.12 - Math.abs(y / PLANE_H) * 0.08
  }

  // ---------- 状态 & 时间线 ----------
  let raf = 0
  let running = false
  const clock = new THREE.Clock()
  let t = 0
  let cb = {}
  let T = null
  const fired = {}
  let signProg = 0 // 保留字段（不再画勾，恒为 0）
  let stampProg = 0
  let lastTexUpdate = -1
  // 等待用户点击盖章：到达 waitForStamp 时置为 true 并冻结 t，点击后置回 false
  let awaitingStamp = false
  let stampArmed = false // 是否已经进入过等待态（避免重复触发提示回调）

  // 时间线为绝对时间。在 waitForStamp 处冻结 t，等用户点击盖章提示后解冻，
  // 之后 stamp/flyOut 阶段继续按绝对时间推进（不再有签字笔画勾环节）。
  function buildTimeline() {
    const flyIn = 0        // 合同飞入开始
    const flyEnd = 0.9     // 飞入定格
    const readEnd = 1.7    // 停留展示材料清单
    const waitForStamp = readEnd + 0.2 // 到此冻结，显示「点击盖章」提示
    const stampStart = waitForStamp    // 点击后开始盖章
    const stampEnd = stampStart + 0.4  // 盖章完全落定
    const stampHit = stampStart + 0.06 // 盖章接触瞬间：音效/闪光
    const flyOutStart = stampEnd + 0.35 // 合同抽离
    const flyOutEnd = flyOutStart + 0.8
    const doneTime = flyOutEnd + 0.15
    return { flyIn, flyEnd, readEnd, waitForStamp, stampStart, stampEnd, stampHit, flyOutStart, flyOutEnd, doneTime }
  }

  // 合同飞入 → 定格 → 抽离 的位姿
  function updatePaper() {
    let px = 0, py = 0, pz = 0, rotX = 0, rotZ = 0, scale = 1, op = 1
    if (t < T.flyEnd) {
      // 自下方偏转抽出
      const p = easeOut(smooth(T.flyIn, T.flyEnd, t))
      py = lerp(flyInStartY, 0, p)
      pz = lerp(FLY_IN_START_Z, 0, p)
      rotX = lerp(FLY_IN_START_ROT_X, 0, p)
      rotZ = lerp(FLY_IN_START_ROT_Z, 0, p)
      scale = lerp(FLY_IN_START_SCALE, 1, p)
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
  }

  // 新流程取消签字笔环节：笔始终隐藏。
  function updatePen() {
    pen.visible = false
  }

  function stepUpdate(dt) {
    // 到达等待点：冻结时间线，抛出「等待盖章」回调（外层显示点击提示）
    if (!stampArmed && t >= T.waitForStamp) {
      stampArmed = true
      awaitingStamp = true
      cb.onAwaitStamp && cb.onAwaitStamp()
    }

    // 阶段回调
    if (!fired.pIn && t >= T.flyIn) { fired.pIn = true; cb.onPhase && cb.onPhase('呈递合同'); cb.onPaper && cb.onPaper() }
    if (!fired.pRead && t >= T.flyEnd) { fired.pRead = true; cb.onPhase && cb.onPhase('核对材料') }
    // 盖章相关回调只在解冻后（越过等待点）触发
    if (!fired.pStamp && t >= T.stampStart && !awaitingStamp) { fired.pStamp = true; cb.onPhase && cb.onPhase('盖章') }
    if (!fired.stampHit && t >= T.stampHit && !awaitingStamp) { fired.stampHit = true; cb.onStamp && cb.onStamp() }
    if (!fired.pOut && t >= T.flyOutStart) { fired.pOut = true; cb.onPhase && cb.onPhase('生效'); cb.onPaper && cb.onPaper() }
    if (!fired.done && t >= T.doneTime) { fired.done = true; running = false; cb.onDone && cb.onDone() }

    // 印章进度（不再画勾，signProg 恒为 0）
    const newStamp = awaitingStamp ? 0 : clamp01(smooth(T.stampStart, T.stampEnd, t))
    signProg = 0
    stampProg = newStamp

    // 仅在进度变化时重绘纹理（避免每帧无谓重绘）
    const key = Math.round(stampProg * 60) * 1000
    if (key !== lastTexUpdate) {
      lastTexUpdate = key
      paper.redraw(signProg, stampProg)
      paperTex.needsUpdate = true
    }

    // 台灯在盖章阶段点亮
    deskLight.intensity = 1.4 * smooth(T.readEnd, T.stampStart, t) * (t < T.flyOutStart ? 1 : clamp01(1 - smooth(T.flyOutStart, T.flyOutEnd, t)))

    updatePaper()
    updatePen()
    updateInk(dt)

    // 相机极缓慢推进
    const dolly = smooth(0, T.doneTime, t)
    camera.position.set(
      camBase.x,
      camBase.y + Math.sin(t * 0.5) * 0.05,
      lerp(camBase.z, camBase.z - 0.8, dolly),
    )
    camera.lookAt(0, -0.1, 0)
  }

  function tick() {
    const ts = typeof window !== 'undefined' ? window.__CONTRACT_TIMESCALE : undefined
    const scale = ts == null ? 1 : ts
    const dt = Math.min(clock.getDelta(), 0.05) * scale
    // 等待用户点击盖章时冻结时间线（仍持续渲染，保持呼吸浮动等）
    if (!awaitingStamp) t += dt
    stepUpdate(dt)
    renderer.render(scene, camera)
    if (running) raf = requestAnimationFrame(tick)
  }

  // 用户点击「盖章」提示后调用：解冻时间线，进入盖章 → 抽离 → 完成
  function triggerStamp() {
    if (!awaitingStamp) return
    awaitingStamp = false
  }

  function resize() {
    const w = canvas.clientWidth || 1
    const h = canvas.clientHeight || 1
    renderer.setSize(w, h, false)

    // canvas 铺满视口供合同从真实屏幕边缘进出；原 inset 作为虚拟取景框，
    // 让合同定格后的大小、位置及印章提示坐标与改动前完全一致。
    const styles = getComputedStyle(canvas)
    const readInset = (name) => Math.max(0, Number.parseFloat(styles.getPropertyValue(name)) || 0)
    const frameTop = readInset('--contract-frame-top')
    const frameRight = readInset('--contract-frame-right')
    const frameBottom = readInset('--contract-frame-bottom')
    const frameLeft = readInset('--contract-frame-left')
    const frameWidth = Math.max(1, w - frameLeft - frameRight)
    const frameHeight = Math.max(1, h - frameTop - frameBottom)
    camera.aspect = frameWidth / frameHeight
    const halfFovTangent = Math.tan((FOV * Math.PI) / 360)
    // 保留约 6% 的画面安全边距，其余空间尽量交给合同纸张。
    const fitHeightZ = (PLANE_H * 0.53) / halfFovTangent
    const fitWidthZ = (PLANE_W * 0.53) / (halfFovTangent * camera.aspect)
    camBase.z = Math.max(11.8, fitHeightZ, fitWidthZ)
    camera.setViewOffset(
      frameWidth,
      frameHeight,
      -frameLeft,
      -frameTop,
      w,
      h,
    )

    // 将纸张初始姿态的最上沿放到屏幕底边之外 8px；二分求解可兼顾透视、旋转和各视口比例。
    camera.position.copy(camBase)
    camera.lookAt(0, -0.1, 0)
    camera.updateMatrixWorld()
    const targetTop = -1 - (FLY_IN_EDGE_MARGIN * 2) / h
    const projectedTopAt = (y) => {
      flyInPosition.set(0, y, FLY_IN_START_Z)
      flyInMatrix.compose(flyInPosition, flyInRotation, flyInScale)
      let top = -Infinity
      for (const corner of flyInCorners) {
        flyInPoint.copy(corner).applyMatrix4(flyInMatrix).project(camera)
        top = Math.max(top, flyInPoint.y)
      }
      return top
    }
    let below = -9
    while (projectedTopAt(below) > targetTop && below > -80) below -= 4
    let above = 0
    for (let i = 0; i < 24; i++) {
      const mid = (below + above) / 2
      if (projectedTopAt(mid) <= targetTop) below = mid
      else above = mid
    }
    flyInStartY = below
  }

  // 将纸面上的真实印章位置投影到 canvas CSS 像素坐标，供 DOM 提示圈精确对齐。
  function getStampScreenPosition() {
    paperGroup.updateWorldMatrix(true, false)
    camera.updateMatrixWorld()

    const center = pageToLocal(STAMP.x, STAMP.y)
    const edge = pageToLocal(STAMP.x + STAMP.radius, STAMP.y)
    const centerPoint = new THREE.Vector3(center.x, center.y, paperSurfaceZ(center.x, center.y))
    const edgePoint = new THREE.Vector3(edge.x, edge.y, paperSurfaceZ(edge.x, edge.y))
    paperGroup.localToWorld(centerPoint)
    paperGroup.localToWorld(edgePoint)
    centerPoint.project(camera)
    edgePoint.project(camera)

    const width = canvas.clientWidth || 1
    const height = canvas.clientHeight || 1
    return {
      x: (centerPoint.x * 0.5 + 0.5) * width,
      y: (-centerPoint.y * 0.5 + 0.5) * height,
      diameter: Math.max(72, Math.abs(edgePoint.x - centerPoint.x) * width),
    }
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
    awaitingStamp = false
    stampArmed = false
    pen.visible = false
    deskLight.intensity = 0
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
    renderer.dispose()
  }

  return { play, stop, resize, dispose, triggerStamp, getStampScreenPosition }
}
