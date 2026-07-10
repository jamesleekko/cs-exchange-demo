import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import {
  UnrealBloomPass,
} from 'three/addons/postprocessing/UnrealBloomPass.js';

// 常驻背景「熔炉」场景：
// 厂房背景图（public/bg/forge-hall.jpg，原图中央熔炉已抠除）作为远景平面绘制在
// 场景内，前景是一座 3D 建模的工业熔炉——下部为多层金属基座与熔池，上部为可
// 整体升降的白色炉体（红色饰环 + 元游猫涂装 + 顶部管阵），四根液压撑杆与四只
// 锁爪随升降联动，构成机械开合动画。
//
// createFurnace(canvas) 返回 { close, reset, resize, dispose }：
//   - 初始/复位为「敞开」怠速态：炉体升起，熔池微光，无光柱；
//   - close(opts) 播放闭合序列（下压 → 撞击锁定 → 密封充能），随后进入等待态，
//     用户点击熔炉触发开启爆发：锁爪松开 → 炉体升起 → 炉口光柱升腾 → 光柱
//     爆发达到高潮（onPeak，外部弹结果）→ 光柱消退回怠速态（onDone）。
//   回调：onSlam(撞击) / onSealed(密封完成，可点击) / onOpen(点击开启) /
//         onPeak(光柱高潮) / onDone(序列结束)。
// 点击由内部 Raycaster 命中炉体判定；等待态外层需允许 canvas 接收 pointer 事件。

const FOV = 40
const CAM_POS = new THREE.Vector3(0, 3.2, 13.2)
const LOOK_AT = new THREE.Vector3(0, 3.05, 0)
const BG_Z = -26          // 背景图平面深度
const BG_ASPECT = 1672 / 941

const Y_OPEN = 4.95       // 炉体（上部）敞开时的悬停高度（组原点=法兰底面）
const Y_CLOSED = 2.62     // 闭合时法兰底面落在熔池沿上
const BOWL_TOP = 2.62     // 熔池沿顶面高度
const CLAMP_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]
const PISTON_ANGLES = [0.65, Math.PI - 0.65, Math.PI + 0.65, -0.65]

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

// 圆形径向渐变贴图（辉光 billboard）
function makeGlowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.28, 'rgba(255,235,200,0.8)')
  grd.addColorStop(0.62, 'rgba(255,160,70,0.3)')
  grd.addColorStop(1, 'rgba(255,130,50,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 光柱竖直渐变（上下淡、中间浓，贴合「炉口悬浮光柱」观感）
function makeColumnAlpha() {
  const c = document.createElement('canvas')
  c.width = 8
  c.height = 128
  const g = c.getContext('2d')
  const grd = g.createLinearGradient(0, 128, 0, 0)
  grd.addColorStop(0, 'rgba(255,255,255,0.85)')
  grd.addColorStop(0.45, 'rgba(255,255,255,0.55)')
  grd.addColorStop(1, 'rgba(255,255,255,0.05)')
  g.fillStyle = grd
  g.fillRect(0, 0, 8, 128)
  return new THREE.CanvasTexture(c)
}

// 炉体正面「元游猫」涂装带：金属底 + 双圆护目镜徽标 + 中英文名（前后各一份，
// 保证任意朝向都有一面可读）
function makeBrandTexture() {
  const W = 1024
  const H = 256
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  const bg = g.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#d4d9e2')
  bg.addColorStop(0.5, '#c2c8d4')
  bg.addColorStop(1, '#aab1c0')
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)
  // 上下红色细饰线
  g.fillStyle = '#8f1f24'
  g.fillRect(0, 10, W, 7)
  g.fillRect(0, H - 17, W, 7)
  // 做旧污渍
  for (let i = 0; i < 46; i++) {
    g.fillStyle = `rgba(40,46,60,${0.03 + Math.random() * 0.05})`
    const w = 12 + Math.random() * 70
    g.fillRect(Math.random() * W, Math.random() * H, w, 2 + Math.random() * 9)
  }
  const drawLogo = (cx) => {
    const cy = H / 2 - 26
    g.strokeStyle = '#1a1d26'
    g.lineWidth = 9
    // 双圆护目镜
    for (const dx of [-26, 26]) {
      g.beginPath()
      g.arc(cx + dx, cy, 24, 0, Math.PI * 2)
      g.stroke()
    }
    g.fillStyle = '#1a1d26'
    for (const dx of [-26, 26]) {
      g.beginPath()
      g.arc(cx + dx, cy, 9, 0, Math.PI * 2)
      g.fill()
    }
    // 耳角
    g.beginPath()
    g.moveTo(cx - 50, cy - 12)
    g.lineTo(cx - 62, cy - 34)
    g.lineTo(cx - 40, cy - 24)
    g.closePath()
    g.fill()
    g.beginPath()
    g.moveTo(cx + 50, cy - 12)
    g.lineTo(cx + 62, cy - 34)
    g.lineTo(cx + 40, cy - 24)
    g.closePath()
    g.fill()
    g.textAlign = 'center'
    g.fillStyle = '#171a22'
    g.font = '900 56px "PingFang SC","Microsoft YaHei",sans-serif'
    g.fillText('元游猫', cx, cy + 84)
    g.fillStyle = 'rgba(23,26,34,0.66)'
    g.font = '700 17px "Arial Black",sans-serif'
    g.fillText('YUANYOUMAO', cx, cy + 110)
  }
  // 圆柱 UV 展开：u=0.25 / 0.75 各画一份，正面必有一份完整徽标
  drawLogo(W * 0.25)
  drawLogo(W * 0.75)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

export function createFurnace(canvas) {
  const disposables = []
  const track = (o) => (disposables.push(o), o)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 120)
  camera.position.copy(CAM_POS)
  camera.lookAt(LOOK_AT)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.9

  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
  scene.environment = envRT.texture
  if ('environmentIntensity' in scene) scene.environmentIntensity = 0.5

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  // threshold 较高：只让熔池/光柱/蓝色灯带泛光，避免整幅背景图被冲淡
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.5, 0.72)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  // ---------- 背景图平面（cover 适配，见 fitBackground）----------
  const bgMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false }))
  const bgMesh = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), bgMat)
  bgMesh.position.set(0, 0, BG_Z)
  scene.add(bgMesh)
  const texLoader = new THREE.TextureLoader()
  texLoader.load('/bg/forge-hall.jpg', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    bgMat.map = track(tex)
    bgMat.needsUpdate = true
    fitBackground()
  })
  function fitBackground() {
    const dist = CAM_POS.z - BG_Z
    const viewH = 2 * dist * Math.tan((FOV * Math.PI) / 360)
    const viewW = viewH * camera.aspect
    // cover：短边贴满、长边溢出，与 CSS background-size:cover 等价
    let w = viewW
    let h = w / BG_ASPECT
    if (h < viewH) {
      h = viewH
      w = h * BG_ASPECT
    }
    bgMesh.scale.set(w, h, 1)
    // 平面中心对准该深度处的视线中心
    const dir = LOOK_AT.clone().sub(CAM_POS)
    const k = dist / -dir.z
    bgMesh.position.y = CAM_POS.y + dir.y * k
  }

  // ---------- 灯光 ----------
  scene.add(new THREE.AmbientLight(0x46536e, 0.85))
  const key = new THREE.DirectionalLight(0xaebfe4, 0.85)
  key.position.set(-7, 10, 8)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x3a66ff, 0.6)
  rim.position.set(7, 5, -6)
  scene.add(rim)
  // 熔池火光（怠速微光 / 充能增强 / 爆发拉满）
  const fireLight = new THREE.PointLight(0xff7a20, 3, 26, 2)
  fireLight.position.set(0, 2.9, 0)
  scene.add(fireLight)
  const flashLight = new THREE.PointLight(0xffffff, 0, 40, 2)
  flashLight.position.set(0, 4.2, 0)
  scene.add(flashLight)

  // ---------- 材质 ----------
  const shellMat = track(new THREE.MeshStandardMaterial({ color: 0xccd2da, roughness: 0.34, metalness: 0.78 }))
  const darkMat = track(new THREE.MeshStandardMaterial({ color: 0x1d222d, roughness: 0.52, metalness: 0.72 }))
  const steelMat = track(new THREE.MeshStandardMaterial({ color: 0x3c4352, roughness: 0.4, metalness: 0.85 }))
  const redMat = track(new THREE.MeshStandardMaterial({ color: 0x8f1f24, roughness: 0.42, metalness: 0.55 }))
  const blueGlowMat = track(new THREE.MeshStandardMaterial({ color: 0x0a1020, emissive: new THREE.Color(0x2e7bff), emissiveIntensity: 1.6, roughness: 0.5, metalness: 0.2 }))
  const lavaMat = track(new THREE.MeshStandardMaterial({ color: 0x2a1006, emissive: new THREE.Color(0xff6a14), emissiveIntensity: 1.1, roughness: 0.6, metalness: 0.2 }))
  const seamMat = track(new THREE.MeshStandardMaterial({ color: 0x140b06, emissive: new THREE.Color(0xff7a20), emissiveIntensity: 0, roughness: 0.5, metalness: 0.3 }))

  const furnaceRoot = new THREE.Group()
  scene.add(furnaceRoot)

  // ---------- 下部：基座 + 熔池（静止）----------
  const baseGroup = new THREE.Group()
  furnaceRoot.add(baseGroup)
  const tier1 = new THREE.Mesh(track(new THREE.CylinderGeometry(3.15, 3.4, 0.5, 48)), darkMat)
  tier1.position.y = 0.25
  baseGroup.add(tier1)
  const tier2 = new THREE.Mesh(track(new THREE.CylinderGeometry(2.75, 2.95, 0.55, 48)), steelMat)
  tier2.position.y = 0.78
  baseGroup.add(tier2)
  // 蓝色灯带（呼应背景图地面的蓝色环形灯）
  const blueBand = new THREE.Mesh(track(new THREE.CylinderGeometry(2.79, 2.79, 0.07, 48, 1, true)), blueGlowMat)
  blueBand.position.y = 0.99
  baseGroup.add(blueBand)
  const tier3 = new THREE.Mesh(track(new THREE.CylinderGeometry(2.35, 2.55, 0.6, 48)), darkMat)
  tier3.position.y = 1.35
  baseGroup.add(tier3)
  // 基座铆钉
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const bolt = new THREE.Mesh(track(new THREE.BoxGeometry(0.14, 0.22, 0.1)), steelMat)
    bolt.position.set(Math.cos(a) * 2.42, 1.35, Math.sin(a) * 2.42)
    bolt.lookAt(0, 1.35, 0)
    baseGroup.add(bolt)
  }
  // 熔池碗
  const bowl = new THREE.Mesh(track(new THREE.CylinderGeometry(1.92, 1.45, 1.05, 48)), steelMat)
  bowl.position.y = 2.1
  baseGroup.add(bowl)
  const bowlRim = new THREE.Mesh(track(new THREE.TorusGeometry(1.9, 0.13, 18, 56)), darkMat)
  bowlRim.rotation.x = Math.PI / 2
  bowlRim.position.y = BOWL_TOP
  baseGroup.add(bowlRim)
  // 熔池（自发光熔浆面）
  const lava = new THREE.Mesh(track(new THREE.CylinderGeometry(1.66, 1.5, 0.16, 48)), lavaMat)
  lava.position.y = 2.42
  baseGroup.add(lava)

  // ---------- 上部：可升降炉体 ----------
  const topGroup = new THREE.Group()
  topGroup.position.y = Y_OPEN
  furnaceRoot.add(topGroup)
  // 法兰（底面即组原点）
  const flange = new THREE.Mesh(track(new THREE.CylinderGeometry(2.08, 2.14, 0.34, 48)), steelMat)
  flange.position.y = 0.17
  topGroup.add(flange)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const bolt = new THREE.Mesh(track(new THREE.BoxGeometry(0.16, 0.2, 0.12)), darkMat)
    bolt.position.set(Math.cos(a) * 2.05, 0.17, Math.sin(a) * 2.05)
    bolt.lookAt(0, 0.17, 0)
    topGroup.add(bolt)
  }
  // 密封发光缝（闭合充能时脉冲）
  const seam = new THREE.Mesh(track(new THREE.TorusGeometry(1.96, 0.055, 12, 56)), seamMat)
  seam.rotation.x = Math.PI / 2
  seam.position.y = 0.02
  topGroup.add(seam)
  // 红色饰环（贴近原图炉体的红色箍带）
  const redBand = new THREE.Mesh(track(new THREE.CylinderGeometry(1.84, 1.84, 0.18, 48, 1, true)), redMat)
  redBand.position.y = 0.52
  topGroup.add(redBand)
  // 白色主炉体
  const shell = new THREE.Mesh(track(new THREE.CylinderGeometry(1.8, 1.8, 2.2, 48)), shellMat)
  shell.position.y = 1.55
  topGroup.add(shell)
  // 元游猫涂装带
  const brandTex = track(makeBrandTexture())
  const brandMat = track(new THREE.MeshStandardMaterial({ map: brandTex, roughness: 0.38, metalness: 0.6 }))
  const brand = new THREE.Mesh(track(new THREE.CylinderGeometry(1.815, 1.815, 0.86, 48, 1, true)), brandMat)
  brand.position.y = 1.62
  topGroup.add(brand)
  // 炉体竖肋
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    const ribTop = new THREE.Mesh(track(new THREE.BoxGeometry(0.1, 0.62, 0.08)), steelMat)
    ribTop.position.set(Math.cos(a) * 1.83, 2.42, Math.sin(a) * 1.83)
    ribTop.lookAt(0, 2.42, 0)
    topGroup.add(ribTop)
  }
  // 顶部结构：暗色环 + 收口锥 + 中央烟管 + 侧管阵
  const capRing = new THREE.Mesh(track(new THREE.CylinderGeometry(1.87, 1.87, 0.32, 48)), darkMat)
  capRing.position.y = 2.8
  topGroup.add(capRing)
  const dome = new THREE.Mesh(track(new THREE.CylinderGeometry(1.3, 1.82, 0.55, 48)), steelMat)
  dome.position.y = 3.22
  topGroup.add(dome)
  const stack = new THREE.Mesh(track(new THREE.CylinderGeometry(0.62, 0.72, 1.7, 32)), darkMat)
  stack.position.y = 4.3
  topGroup.add(stack)
  const stackRing = new THREE.Mesh(track(new THREE.CylinderGeometry(0.66, 0.66, 0.12, 32)), redMat)
  stackRing.position.y = 4.72
  topGroup.add(stackRing)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    const pipe = new THREE.Mesh(track(new THREE.CylinderGeometry(0.15, 0.15, 1.05, 16)), steelMat)
    pipe.position.set(Math.cos(a) * 1.05, 3.9, Math.sin(a) * 1.05)
    topGroup.add(pipe)
    const elbow = new THREE.Mesh(track(new THREE.SphereGeometry(0.17, 14, 12)), steelMat)
    elbow.position.set(Math.cos(a) * 1.05, 4.45, Math.sin(a) * 1.05)
    topGroup.add(elbow)
  }

  // 锁爪 ×4：闭合后向内扣紧熔池沿
  const clamps = []
  for (const a of CLAMP_ANGLES) {
    const pivot = new THREE.Group()
    pivot.position.set(Math.cos(a) * 2.0, 0.08, Math.sin(a) * 2.0)
    pivot.rotation.y = -a
    topGroup.add(pivot)
    const arm = new THREE.Mesh(track(new THREE.BoxGeometry(0.3, 0.72, 0.24)), steelMat)
    arm.position.set(0.06, -0.32, 0)
    pivot.add(arm)
    const jaw = new THREE.Mesh(track(new THREE.BoxGeometry(0.34, 0.2, 0.3)), darkMat)
    jaw.position.set(-0.06, -0.7, 0)
    pivot.add(jaw)
    clamps.push(pivot)
  }
  const CLAMP_OPEN = 0.52
  const CLAMP_LOCKED = -0.06

  // ---------- 液压撑杆 ×4：外筒固定于基座，杆体随炉体升降伸缩 ----------
  const pistons = []
  const attachHelper = new THREE.Vector3()
  for (const a of PISTON_ANGLES) {
    const anchor = new THREE.Vector3(Math.cos(a) * 2.6, 1.5, Math.sin(a) * 2.6)
    const grp = new THREE.Group()
    grp.position.copy(anchor)
    furnaceRoot.add(grp)
    const barrelGeo = track(new THREE.CylinderGeometry(0.14, 0.16, 1.3, 18))
    barrelGeo.rotateX(Math.PI / 2)
    const barrel = new THREE.Mesh(barrelGeo, darkMat)
    barrel.position.z = 0.65
    grp.add(barrel)
    const rodGeo = track(new THREE.CylinderGeometry(0.075, 0.075, 1, 14))
    rodGeo.rotateX(Math.PI / 2)
    const rod = new THREE.Mesh(rodGeo, track(new THREE.MeshStandardMaterial({ color: 0xb8c2d2, roughness: 0.2, metalness: 1.0 })))
    grp.add(rod)
    const footBall = new THREE.Mesh(track(new THREE.SphereGeometry(0.2, 16, 12)), steelMat)
    grp.add(footBall)
    const headBall = new THREE.Mesh(track(new THREE.SphereGeometry(0.17, 16, 12)), steelMat)
    grp.add(headBall)
    // 基座上的铰座
    const seat = new THREE.Mesh(track(new THREE.CylinderGeometry(0.24, 0.3, 0.3, 14)), darkMat)
    seat.position.copy(anchor).y -= 0.2
    furnaceRoot.add(seat)
    pistons.push({ grp, rod, headBall, anchor, angle: a })
  }
  function updatePistons() {
    for (const p of pistons) {
      // 附着点：法兰外缘（世界坐标随 topGroup.y 变化）
      attachHelper.set(Math.cos(p.angle) * 1.98, topGroup.position.y + 0.2, Math.sin(p.angle) * 1.98)
      p.grp.lookAt(attachHelper)
      const dist = p.anchor.distanceTo(attachHelper)
      p.rod.scale.z = Math.max(0.2, dist - 1.25)
      p.rod.position.z = 1.25 + p.rod.scale.z / 2
      p.headBall.position.z = dist
    }
  }

  // ---------- 光柱（炉口 → 上炉体口之间，同原背景图）----------
  const colAlpha = track(makeColumnAlpha())
  // 外层暖橙 + 内芯亮白，贴近原图熔浆光柱
  const beamOuterMat = track(new THREE.MeshBasicMaterial({ color: 0xff9a3c, alphaMap: colAlpha, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  const beamOuterGeo = track(new THREE.CylinderGeometry(0.72, 1.05, 1, 40, 1, true))
  beamOuterGeo.translate(0, 0.5, 0) // 原点移到柱底，便于自下而上生长
  const beamOuter = new THREE.Mesh(beamOuterGeo, beamOuterMat)
  beamOuter.position.y = 2.5
  beamOuter.visible = false
  scene.add(beamOuter)
  const beamCoreMat = track(new THREE.MeshBasicMaterial({ color: 0xfff3da, alphaMap: colAlpha, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  const beamCoreGeo = track(new THREE.CylinderGeometry(0.3, 0.5, 1, 32, 1, true))
  beamCoreGeo.translate(0, 0.5, 0)
  const beamCore = new THREE.Mesh(beamCoreGeo, beamCoreMat)
  beamCore.position.y = 2.5
  beamCore.visible = false
  scene.add(beamCore)

  // 炉口辉光 billboard + 地面光晕
  const glowTex = track(makeGlowTexture())
  const mouthGlowMat = track(new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffa050, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
  const mouthGlow = new THREE.Mesh(track(new THREE.PlaneGeometry(5.4, 5.4)), mouthGlowMat)
  mouthGlow.position.set(0, 3.4, 0)
  scene.add(mouthGlow)
  const groundGlowMat = track(new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff8a3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
  const groundGlow = new THREE.Mesh(track(new THREE.PlaneGeometry(8, 8)), groundGlowMat)
  groundGlow.rotation.x = -Math.PI / 2
  groundGlow.position.y = 0.06
  scene.add(groundGlow)

  // ---------- 火星/光尘粒子 ----------
  const MAX_P = 360
  const pPos = new Float32Array(MAX_P * 3)
  const pAlpha = new Float32Array(MAX_P)
  const pSize = new Float32Array(MAX_P)
  const pGeo = track(new THREE.BufferGeometry())
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
  pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1))
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1))
  const uScaleUniform = { value: 600 }
  const pMat = track(
    new THREE.ShaderMaterial({
      uniforms: { uScale: uScaleUniform, uColor: { value: new THREE.Color(0xffa04a) } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = max(-mv.z, 0.001);
          gl_PointSize = clamp(aSize * uScale / d, 1.0, 600.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float soft = pow(smoothstep(0.5, 0.0, d), 1.4);
          gl_FragColor = vec4(uColor, vAlpha * soft);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const points = new THREE.Points(pGeo, pMat)
  points.frustumCulled = false
  scene.add(points)
  const pool = new Array(MAX_P)
  for (let i = 0; i < MAX_P; i++) pool[i] = { on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 0.1, a0: 1, grav: 0 }
  let pCursor = 0
  function allocP() {
    for (let n = 0; n < MAX_P; n++) {
      const idx = (pCursor + n) % MAX_P
      if (!pool[idx].on) {
        pCursor = (idx + 1) % MAX_P
        return pool[idx]
      }
    }
    return null
  }
  // 熔池升腾余烬
  function emitEmber(speed = 1) {
    const p = allocP()
    if (!p) return
    const a = Math.random() * Math.PI * 2
    const r = Math.random() * 1.4
    p.on = true
    p.x = Math.cos(a) * r
    p.y = 2.5 + Math.random() * 0.15
    p.z = Math.sin(a) * r * 0.8
    p.vx = (Math.random() - 0.5) * 0.35
    p.vz = (Math.random() - 0.5) * 0.3
    p.vy = (0.8 + Math.random() * 1.6) * speed
    p.grav = -0.15
    p.life = p.max = 0.9 + Math.random() * 1.5
    p.s0 = 0.045 + Math.random() * 0.09
    p.a0 = 0.55 + Math.random() * 0.4
  }
  // 密封撞击火星：沿密封缝向外喷溅
  function burstSeamSparks(n) {
    for (let i = 0; i < n; i++) {
      const p = allocP()
      if (!p) break
      const a = Math.random() * Math.PI * 2
      const sp = 2.2 + Math.random() * 4.5
      p.on = true
      p.x = Math.cos(a) * 1.95
      p.y = BOWL_TOP + 0.05
      p.z = Math.sin(a) * 1.95
      p.vx = Math.cos(a) * sp
      p.vz = Math.sin(a) * sp
      p.vy = 0.4 + Math.random() * 2.2
      p.grav = -8
      p.life = p.max = 0.35 + Math.random() * 0.55
      p.s0 = 0.05 + Math.random() * 0.1
      p.a0 = 1
    }
  }
  // 光柱爆发光尘
  function burstBeamMotes(n, speed) {
    for (let i = 0; i < n; i++) {
      const p = allocP()
      if (!p) break
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * 0.9
      p.on = true
      p.x = Math.cos(a) * r
      p.y = 2.6 + Math.random() * 0.4
      p.z = Math.sin(a) * r
      p.vx = Math.cos(a) * (0.3 + Math.random() * 0.8) * speed
      p.vz = Math.sin(a) * (0.25 + Math.random() * 0.6) * speed
      p.vy = (1.6 + Math.random() * 3.2) * speed
      p.grav = -0.4
      p.life = p.max = 0.7 + Math.random() * 1.3
      p.s0 = 0.05 + Math.random() * 0.12
      p.a0 = 0.6 + Math.random() * 0.4
    }
  }
  function updateMotes(dt) {
    for (let i = 0; i < MAX_P; i++) {
      const p = pool[i]
      if (!p.on) {
        pAlpha[i] = 0
        pSize[i] = 0
        continue
      }
      p.life -= dt
      if (p.life <= 0) {
        p.on = false
        pAlpha[i] = 0
        pSize[i] = 0
        continue
      }
      p.vy += p.grav * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      const k = p.life / p.max
      const j = i * 3
      pPos[j] = p.x
      pPos[j + 1] = p.y
      pPos[j + 2] = p.z
      pAlpha[i] = p.a0 * Math.pow(k, 0.85)
      pSize[i] = p.s0 * (0.5 + k * 0.5)
    }
    pGeo.attributes.position.needsUpdate = true
    pGeo.attributes.aAlpha.needsUpdate = true
    pGeo.attributes.aSize.needsUpdate = true
  }

  // ---------- 状态机 ----------
  // mode: 'idle'(敞开怠速) → close() → 'closing' → 'sealed'(等待点击)
  //        → 点击 → 'burst'(开启+光柱爆发) → 回 'idle'
  let mode = 'idle'
  let t = 0
  let cb = {}
  const fired = {}
  let shake = 0
  let flash = 0
  let emberAccum = 0
  let moteAccum = 0
  let raf = 0
  let disposed = false
  const clock = new THREE.Clock()

  // 闭合时间线
  const CLOSE = { sink: 0.2, contact: 1.5, lockEnd: 1.85, sealed: 2.05 }
  // 爆发时间线
  const BURST = {
    unlock: 0.22,
    riseStart: 0.26,
    riseEnd: 1.0,
    beamStart: 0.45,
    beamFull: 1.35,
    peak: 1.62,   // 高潮：白闪 + onPeak（外部在此弹结果）
    fadeStart: 2.45,
    fadeEnd: 3.25,
    done: 3.4,
  }

  function clearFired() {
    for (const k in fired) delete fired[k]
  }

  function setBeam(strength, coreBoost = 1) {
    const on = strength > 0.015
    beamOuter.visible = on
    beamCore.visible = on
    if (!on) return
    const gapTop = topGroup.position.y + 0.4
    const h = Math.max(0.5, gapTop - 2.5)
    beamOuter.scale.set(lerp(0.35, 1, strength), h, lerp(0.35, 1, strength))
    beamCore.scale.set(lerp(0.3, 1, strength) * coreBoost, h * 0.96, lerp(0.3, 1, strength) * coreBoost)
    const flick = 0.86 + Math.sin(t * 11) * 0.08 + Math.sin(t * 23.7) * 0.06
    beamOuterMat.opacity = 0.62 * strength * flick
    beamCoreMat.opacity = 0.78 * strength * flick
    beamOuter.rotation.y += 0.02
    beamCore.rotation.y -= 0.03
  }

  // ---------- 点击交互（sealed 态命中炉体触发开启）----------
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  function pickFurnace(e) {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    return raycaster.intersectObject(furnaceRoot, true).length > 0
  }
  function onPointerDown(e) {
    if (mode !== 'sealed') return
    if (!pickFurnace(e)) return
    mode = 'burst'
    t = 0
    clearFired()
    canvas.style.cursor = 'default'
    cb.onOpen && cb.onOpen()
  }
  function onPointerMove(e) {
    if (mode !== 'sealed') {
      canvas.style.cursor = 'default'
      return
    }
    canvas.style.cursor = pickFurnace(e) ? 'pointer' : 'default'
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)

  // ---------- 各状态更新 ----------
  function updateIdle(dt) {
    // 敞开怠速：炉体轻微悬浮呼吸，熔池微光，无光柱
    topGroup.position.y = Y_OPEN + Math.sin(t * 0.9) * 0.05
    clamps.forEach((c) => (c.rotation.z = CLAMP_OPEN))
    const flick = 0.85 + Math.sin(t * 7.3) * 0.1 + Math.sin(t * 13.7) * 0.05
    fireLight.intensity = 2.6 * flick
    lavaMat.emissiveIntensity = 1.0 * flick
    seamMat.emissiveIntensity = 0
    mouthGlowMat.opacity = 0.12 * flick
    mouthGlow.position.y = 3.1
    groundGlowMat.opacity = 0.08 * flick
    setBeam(0)
    emberAccum += 9 * dt
    while (emberAccum >= 1) {
      emberAccum -= 1
      emitEmber(1)
    }
  }

  function updateClosing(dt) {
    // 下压：先轻微上提蓄力，再匀重下沉，撞击后锁爪扣紧
    if (t < CLOSE.sink) {
      const p = smooth(0, CLOSE.sink, t)
      topGroup.position.y = Y_OPEN + p * 0.12
    } else if (t < CLOSE.contact) {
      const p = easeInOut(smooth(CLOSE.sink, CLOSE.contact, t))
      // 机械步进感：主行程叠加微小顿挫
      const judder = Math.sin(p * Math.PI * 7) * 0.02 * (1 - p)
      topGroup.position.y = lerp(Y_OPEN + 0.12, Y_CLOSED, p) + judder
      // 火光被逐渐压缩、从缝隙外泄
      const squeeze = 1 + p * 1.6
      fireLight.intensity = 2.6 * squeeze
      lavaMat.emissiveIntensity = 1.0 * squeeze
      mouthGlowMat.opacity = 0.14 * (1 - p * 0.75)
    } else {
      topGroup.position.y = Y_CLOSED
      if (!fired.slam) {
        fired.slam = true
        shake = 0.5
        flash = 0.25
        burstSeamSparks(90)
        cb.onSlam && cb.onSlam()
      }
      // 锁爪扣紧
      const lp = easeOut(smooth(CLOSE.contact, CLOSE.lockEnd, t))
      clamps.forEach((c) => (c.rotation.z = lerp(CLAMP_OPEN, CLAMP_LOCKED, lp)))
      if (t >= CLOSE.sealed && !fired.sealed) {
        fired.sealed = true
        mode = 'sealed'
        t = 0
        clearFired()
        cb.onSealed && cb.onSealed()
      }
    }
    if (t < CLOSE.contact) clamps.forEach((c) => (c.rotation.z = CLAMP_OPEN))
    setBeam(0)
    mouthGlow.position.y = lerp(3.1, 2.75, smooth(CLOSE.sink, CLOSE.contact, t))
  }

  function updateSealed() {
    // 密封充能：缝隙橙光脉冲 + 内部闷响般的光强呼吸，等待点击
    topGroup.position.y = Y_CLOSED
    clamps.forEach((c) => (c.rotation.z = CLAMP_LOCKED))
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2)
    seamMat.emissiveIntensity = 1.2 + pulse * 2.2
    fireLight.intensity = 3.5 + pulse * 2.5
    lavaMat.emissiveIntensity = 1.6 + pulse * 0.8
    mouthGlowMat.opacity = 0
    groundGlowMat.opacity = 0.1 + pulse * 0.08
    setBeam(0)
  }

  function updateBurst(dt) {
    // 锁爪松开
    const ul = easeOut(smooth(0, BURST.unlock, t))
    clamps.forEach((c) => (c.rotation.z = lerp(CLAMP_LOCKED, CLAMP_OPEN, ul)))
    // 炉体快速升起（轻微过冲）
    if (t < BURST.riseEnd) {
      const p = easeOut(smooth(BURST.riseStart, BURST.riseEnd, t))
      topGroup.position.y = lerp(Y_CLOSED, Y_OPEN + 0.25, p)
    } else {
      const settle = smooth(BURST.riseEnd, BURST.riseEnd + 0.5, t)
      topGroup.position.y = lerp(Y_OPEN + 0.25, Y_OPEN, settle)
    }
    // 光柱：升起即涌出 → 全量 → 高潮白闪 → 消退
    let strength
    if (t < BURST.fadeStart) strength = smooth(BURST.beamStart, BURST.beamFull, t)
    else strength = 1 - smooth(BURST.fadeStart, BURST.fadeEnd, t)
    const peakBoost = 1 + flash * 0.9
    setBeam(strength, peakBoost)
    seamMat.emissiveIntensity = Math.max(0, 3.4 * (1 - t * 1.2))
    fireLight.intensity = 3 + strength * 14 + flash * 90
    flashLight.intensity = flash * 160
    lavaMat.emissiveIntensity = 1.2 + strength * 2.4
    mouthGlow.position.y = 3.6
    mouthGlowMat.opacity = strength * 0.55 + flash * 0.4
    mouthGlow.scale.setScalar(0.7 + strength * 0.8 + flash * 0.8)
    groundGlowMat.opacity = 0.08 + strength * 0.3
    // 持续光尘
    moteAccum += strength * 90 * dt
    while (moteAccum >= 1) {
      moteAccum -= 1
      burstBeamMotes(1, 1)
    }
    if (!fired.beam && t >= BURST.beamStart) {
      fired.beam = true
      burstBeamMotes(50, 1.4)
      cb.onBeam && cb.onBeam()
    }
    if (!fired.peak && t >= BURST.peak) {
      fired.peak = true
      flash = 1
      shake = 0.35
      burstBeamMotes(110, 2.4)
      cb.onPeak && cb.onPeak()
    }
    if (!fired.done && t >= BURST.done) {
      fired.done = true
      mode = 'idle'
      t = 0
      clearFired()
      cb.onDone && cb.onDone()
    }
  }

  function stepUpdate(dt) {
    shake = Math.max(0, shake - dt * 2.2)
    flash = Math.max(0, flash - dt * 2.4)

    if (mode === 'idle') updateIdle(dt)
    else if (mode === 'closing') updateClosing(dt)
    else if (mode === 'sealed') updateSealed()
    else updateBurst(dt)

    updatePistons()
    updateMotes(dt)
    mouthGlow.quaternion.copy(camera.quaternion)

    bloom.strength = 0.42 + flash * 0.85 + (mode === 'burst' ? beamOuterMat.opacity * 0.6 : 0)

    // 相机：极缓慢呼吸 + 撞击震动
    camera.position.set(
      CAM_POS.x + Math.sin(clock.elapsedTime * 0.23) * 0.06 + (Math.random() - 0.5) * shake,
      CAM_POS.y + Math.sin(clock.elapsedTime * 0.31) * 0.05 + (Math.random() - 0.5) * shake,
      CAM_POS.z + (Math.random() - 0.5) * shake * 0.4,
    )
    camera.lookAt(LOOK_AT)
  }

  function tick() {
    if (disposed) return
    const ts = typeof window !== 'undefined' ? window.__FURNACE_TIMESCALE : undefined
    const scale = ts == null ? 1 : ts
    const dt = Math.min(clock.getDelta(), 0.05) * scale
    t += dt
    stepUpdate(dt)
    composer.render()
    raf = requestAnimationFrame(tick)
  }

  function resize() {
    const w = canvas.clientWidth || 1
    const h = canvas.clientHeight || 1
    renderer.setSize(w, h, false)
    composer.setSize(w, h)
    bloom.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    const pr = renderer.getPixelRatio()
    uScaleUniform.value = (h * pr) / (2 * Math.tan((FOV * Math.PI) / 180 / 2))
    fitBackground()
  }

  const ro = new ResizeObserver(resize)
  ro.observe(canvas)
  resize()

  // 播放闭合序列；后续点击开启直至 onDone，全程使用这份回调
  function close(opts = {}) {
    cb = opts
    mode = 'closing'
    t = 0
    clearFired()
  }

  // 强制回到敞开怠速态（重新演示 / 中断时用）
  function reset() {
    mode = 'idle'
    t = 0
    cb = {}
    clearFired()
    shake = 0
    flash = 0
    topGroup.position.y = Y_OPEN
    clamps.forEach((c) => (c.rotation.z = CLAMP_OPEN))
    seamMat.emissiveIntensity = 0
    flashLight.intensity = 0
    setBeam(0)
    pool.forEach((p) => (p.on = false))
    canvas.style.cursor = 'default'
  }

  reset()
  raf = requestAnimationFrame(tick)

  function dispose() {
    disposed = true
    cancelAnimationFrame(raf)
    ro.disconnect()
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    disposables.forEach((o) => o.dispose && o.dispose())
    envRT.dispose()
    pmrem.dispose()
    composer.dispose()
    renderer.dispose()
  }

  return { close, reset, resize, dispose }
}
