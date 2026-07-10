import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import {
  UnrealBloomPass,
} from 'three/addons/postprocessing/UnrealBloomPass.js';

// 「武器箱开启」特效（接在合同签订之后）：
// 一只 CS2 风格武器箱自上方落到台面 → 悬停等待点击 → 点击后箱扣弹开、
// 箱盖掀起，箱内涌出对应品质颜色的光柱与光尘 → 白闪定格 → onDone 切结果。
// createCase(canvas) 返回句柄 { play, stop, resize, dispose }，与 forge/contract 一致。
//
// 箱体风格参考 CS2 武器箱：深色金属箱身、金色包边与双搭扣、盖顶艺术贴面、
// 箱缝一圈品质色发光条。点击交互由本模块内部用 Raycaster 处理，
// 外层需在武器箱阶段允许 canvas 接收 pointer 事件。

const FOV = 46
const CASE_Y = 1.62 // 箱体中心悬浮高度
const BODY_W = 3.6
const BODY_H = 1.15
const BODY_D = 2.3
const LID_H = 0.52

// ---------- 数学小工具 ----------
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (a, b, t) => {
  t = clamp01((t - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const easeOut = (x) => 1 - Math.pow(1 - x, 3)
const easeIn = (x) => x * x * x
// 开盖用：轻微过冲再回落，像被内部气流顶开
const easeOutBack = (x) => {
  const c1 = 1.20158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

// 圆形径向渐变贴图（辉光 billboard 用）
function makeGlowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.3, 'rgba(255,255,255,0.7)')
  grd.addColorStop(0.65, 'rgba(255,255,255,0.22)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 竖直渐变（光柱上淡下浓）
function makeColumnAlpha() {
  const c = document.createElement('canvas')
  c.width = 8
  c.height = 128
  const g = c.getContext('2d')
  const grd = g.createLinearGradient(0, 128, 0, 0)
  grd.addColorStop(0, 'rgba(255,255,255,0.9)')
  grd.addColorStop(0.5, 'rgba(255,255,255,0.4)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 8, 128)
  return new THREE.CanvasTexture(c)
}

// 背景竖直渐变（深蓝紫，与合同特效同氛围，衔接自然）
function makeBackdrop() {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 256
  const g = c.getContext('2d')
  const grd = g.createLinearGradient(0, 0, 0, 256)
  grd.addColorStop(0, '#0a0d1a')
  grd.addColorStop(0.55, '#0b0a16')
  grd.addColorStop(1, '#120a1a')
  g.fillStyle = grd
  g.fillRect(0, 0, 16, 256)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 盖顶艺术贴面：仿 CS2 武器箱顶部图案——深色底 + 品质色斜纹与徽标环 + 中英文名。
// 品质色由 play(opts) 决定，因此每次播放时重绘。
function makeLidArt(colorHex) {
  const W = 512
  const H = 336
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')

  // 深色金属底 + 轻微上下渐变
  const bg = g.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#232733')
  bg.addColorStop(0.5, '#1a1e29')
  bg.addColorStop(1, '#141824')
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)

  // 品质色斜纹（左右两角，模拟箱面涂装）
  g.save()
  g.globalAlpha = 0.8
  g.fillStyle = colorHex
  for (let i = 0; i < 4; i++) {
    const off = i * 34
    g.beginPath()
    g.moveTo(0, 60 + off)
    g.lineTo(96 - off * 0.4, 0)
    g.lineTo(120 - off * 0.4, 0)
    g.lineTo(0, 88 + off)
    g.closePath()
    g.globalAlpha = 0.5 - i * 0.11
    g.fill()
    g.beginPath()
    g.moveTo(W, H - 60 - off)
    g.lineTo(W - 96 + off * 0.4, H)
    g.lineTo(W - 120 + off * 0.4, H)
    g.lineTo(W, H - 88 - off)
    g.closePath()
    g.fill()
  }
  g.restore()

  // 金色描边框
  g.strokeStyle = 'rgba(212,175,55,0.85)'
  g.lineWidth = 5
  g.strokeRect(14, 14, W - 28, H - 28)
  g.strokeStyle = 'rgba(212,175,55,0.35)'
  g.lineWidth = 2
  g.strokeRect(26, 26, W - 52, H - 52)

  // 中央徽标环：双圆环 + 品质色内辉
  const cx = W / 2
  const cy = H / 2 - 18
  const rg = g.createRadialGradient(cx, cy, 6, cx, cy, 74)
  rg.addColorStop(0, colorHex)
  rg.addColorStop(0.55, colorHex + '55')
  rg.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = rg
  g.beginPath()
  g.arc(cx, cy, 74, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(212,175,55,0.95)'
  g.lineWidth = 4
  g.beginPath()
  g.arc(cx, cy, 62, 0, Math.PI * 2)
  g.stroke()
  g.lineWidth = 2
  g.beginPath()
  g.arc(cx, cy, 52, 0, Math.PI * 2)
  g.stroke()
  // 徽标中心：交叉短枪剪影感的简化菱形
  g.fillStyle = '#f2e6c0'
  g.save()
  g.translate(cx, cy)
  g.rotate(Math.PI / 4)
  g.fillRect(-17, -17, 34, 34)
  g.restore()
  g.fillStyle = '#151a26'
  g.save()
  g.translate(cx, cy)
  g.rotate(Math.PI / 4)
  g.fillRect(-9, -9, 18, 18)
  g.restore()

  // 名称
  g.textAlign = 'center'
  g.fillStyle = '#f2e6c0'
  g.font = '900 40px "PingFang SC","Microsoft YaHei",sans-serif'
  g.fillText('元游猫武器箱', cx, H - 66)
  g.fillStyle = 'rgba(212,175,55,0.8)'
  g.font = '700 17px "PingFang SC",sans-serif'
  g.fillText('YUANYOUMAO WEAPON CASE', cx, H - 38)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

export function createCase(canvas) {
  const disposables = []
  const track = (o) => (disposables.push(o), o)

  const scene = new THREE.Scene()
  scene.background = track(makeBackdrop())
  scene.fog = new THREE.FogExp2(0x07060f, 0.02)

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100)
  const camBase = new THREE.Vector3(0, 3.1, 9.6)
  camera.position.copy(camBase)
  camera.lookAt(0, CASE_Y, 0)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.95

  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
  scene.environment = envRT.texture
  if ('environmentIntensity' in scene) scene.environmentIntensity = 0.6

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.55, 0.5)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  // ---------- 灯光 ----------
  scene.add(new THREE.AmbientLight(0x8a94b8, 0.55))
  const key = new THREE.DirectionalLight(0xfff0dd, 1.0)
  key.position.set(-5, 8, 6)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x7088ff, 0.55)
  rim.position.set(6, 3, -5)
  scene.add(rim)
  // 箱内品质色光：开盖时点亮
  const innerLight = new THREE.PointLight(0xffffff, 0, 26, 2)
  innerLight.position.set(0, CASE_Y + 0.4, 0)
  scene.add(innerLight)

  // ---------- 台面 ----------
  const groundMat = track(new THREE.MeshStandardMaterial({ color: 0x0b0d17, roughness: 0.7, metalness: 0.4 }))
  const ground = new THREE.Mesh(track(new THREE.CircleGeometry(15, 48)), groundMat)
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)
  const glowTex = track(makeGlowTexture())
  const groundGlowMat = track(
    new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  const groundGlow = new THREE.Mesh(track(new THREE.PlaneGeometry(8, 8)), groundGlowMat)
  groundGlow.rotation.x = -Math.PI / 2
  groundGlow.position.y = 0.02
  scene.add(groundGlow)

  // ---------- 武器箱 ----------
  // caseRoot：整体位移/晃动；lidPivot：盖后沿铰链，开盖绕它旋转
  const caseRoot = new THREE.Group()
  scene.add(caseRoot)

  const bodyMat = track(new THREE.MeshStandardMaterial({ color: 0x272c3a, roughness: 0.38, metalness: 0.75 }))
  const darkMat = track(new THREE.MeshStandardMaterial({ color: 0x171b26, roughness: 0.55, metalness: 0.6 }))
  const goldMat = track(new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.24, metalness: 1.0 }))
  // 箱缝发光条 / 内衬：品质色在 play() 时写入
  const seamMat = track(new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(0xffcf28), emissiveIntensity: 0.7, roughness: 0.5, metalness: 0.2 }))
  const innerMat = track(new THREE.MeshStandardMaterial({ color: 0x11141d, emissive: new THREE.Color(0xffcf28), emissiveIntensity: 0.0, roughness: 0.8, metalness: 0.1, side: THREE.BackSide }))

  // 箱身
  const body = new THREE.Mesh(track(new RoundedBoxGeometry(BODY_W, BODY_H, BODY_D, 4, 0.1)), bodyMat)
  body.position.y = BODY_H / 2 - (BODY_H + LID_H) / 2
  caseRoot.add(body)
  // 箱身内腔（BackSide，开盖后可见的品质色内衬）
  const cavity = new THREE.Mesh(track(new THREE.BoxGeometry(BODY_W - 0.28, BODY_H - 0.1, BODY_D - 0.28)), innerMat)
  cavity.position.copy(body.position)
  cavity.position.y += 0.06
  caseRoot.add(cavity)

  // 箱缝发光条：箱身顶面一圈薄框
  const seamY = body.position.y + BODY_H / 2 + 0.005
  const seamShape = new THREE.Shape()
  const hw = BODY_W / 2 - 0.06
  const hd = BODY_D / 2 - 0.06
  seamShape.moveTo(-hw, -hd)
  seamShape.lineTo(hw, -hd)
  seamShape.lineTo(hw, hd)
  seamShape.lineTo(-hw, hd)
  seamShape.closePath()
  const hole = new THREE.Path()
  const iw = hw - 0.12
  const id = hd - 0.12
  hole.moveTo(-iw, -id)
  hole.lineTo(iw, -id)
  hole.lineTo(iw, id)
  hole.lineTo(-iw, id)
  hole.closePath()
  seamShape.holes.push(hole)
  const seam = new THREE.Mesh(track(new THREE.ShapeGeometry(seamShape)), seamMat)
  seam.rotation.x = -Math.PI / 2
  seam.position.y = seamY
  caseRoot.add(seam)

  // 金色包边：箱身四条竖角柱 + 底沿
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const corner = new THREE.Mesh(track(new THREE.BoxGeometry(0.16, BODY_H + 0.04, 0.16)), goldMat)
      corner.position.set(sx * (BODY_W / 2 - 0.06), body.position.y, sz * (BODY_D / 2 - 0.06))
      caseRoot.add(corner)
    }
  }
  const baseTrim = new THREE.Mesh(track(new RoundedBoxGeometry(BODY_W + 0.06, 0.14, BODY_D + 0.06, 2, 0.05)), goldMat)
  baseTrim.position.y = body.position.y - BODY_H / 2 + 0.05
  caseRoot.add(baseTrim)

  // 箱盖（铰链在后沿）
  const lidPivot = new THREE.Group()
  lidPivot.position.set(0, seamY, -BODY_D / 2 + 0.08)
  caseRoot.add(lidPivot)
  const lid = new THREE.Group()
  lidPivot.add(lid)
  const lidShell = new THREE.Mesh(track(new RoundedBoxGeometry(BODY_W, LID_H, BODY_D, 4, 0.1)), bodyMat)
  lidShell.position.set(0, LID_H / 2, BODY_D / 2 - 0.08)
  lid.add(lidShell)
  // 盖内衬（开盖后朝向观众的一面，品质色微光）
  const lidInner = new THREE.Mesh(track(new THREE.PlaneGeometry(BODY_W - 0.3, BODY_D - 0.3)), innerMat)
  lidInner.rotation.x = Math.PI / 2
  lidInner.position.set(0, 0.06, BODY_D / 2 - 0.08)
  lid.add(lidInner)
  // 盖顶艺术贴面
  const artMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.3 }))
  const art = new THREE.Mesh(track(new THREE.PlaneGeometry(BODY_W - 0.5, BODY_D - 0.42)), artMat)
  art.rotation.x = -Math.PI / 2
  art.position.set(0, LID_H + 0.005, BODY_D / 2 - 0.08)
  lid.add(art)
  // 盖沿金色饰条
  const lidTrim = new THREE.Mesh(track(new RoundedBoxGeometry(BODY_W + 0.05, 0.12, BODY_D + 0.05, 2, 0.05)), goldMat)
  lidTrim.position.set(0, 0.05, BODY_D / 2 - 0.08)
  lid.add(lidTrim)

  // 双搭扣（前脸金色，开箱时向上弹开）
  const latches = []
  for (const sx of [-0.95, 0.95]) {
    const latchPivot = new THREE.Group()
    // 铰点挂在盖沿前侧
    latchPivot.position.set(sx, 0.02, BODY_D - 0.08 + 0.02)
    lid.add(latchPivot)
    const plate = new THREE.Mesh(track(new RoundedBoxGeometry(0.34, 0.42, 0.08, 2, 0.03)), goldMat)
    plate.position.set(0, -0.2, 0.03)
    latchPivot.add(plate)
    const knob = new THREE.Mesh(track(new THREE.BoxGeometry(0.18, 0.1, 0.06)), darkMat)
    knob.position.set(0, -0.3, 0.08)
    latchPivot.add(knob)
    latches.push(latchPivot)
  }
  // 前脸锁牌（搭扣扣住的底座）
  for (const sx of [-0.95, 0.95]) {
    const seat = new THREE.Mesh(track(new RoundedBoxGeometry(0.42, 0.3, 0.06, 2, 0.02)), darkMat)
    seat.position.set(sx, body.position.y + 0.32, BODY_D / 2 - 0.0)
    caseRoot.add(seat)
  }

  // ---------- 开箱光效 ----------
  // 箱口辉光 billboard
  const mouthGlowMat = track(
    new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  const mouthGlow = new THREE.Mesh(track(new THREE.PlaneGeometry(4.6, 4.6)), mouthGlowMat)
  mouthGlow.position.set(0, CASE_Y + 0.5, 0)
  scene.add(mouthGlow)
  // 品质色光柱
  const colAlpha = track(makeColumnAlpha())
  const columnMat = track(
    new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: colAlpha, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  )
  const column = new THREE.Mesh(track(new THREE.CylinderGeometry(0.35, 1.1, 5.2, 40, 1, true)), columnMat)
  column.position.set(0, CASE_Y + 2.4, 0)
  column.visible = false
  scene.add(column)

  // 光尘粒子（品质色，自箱口升腾）
  const MAX_P = 420
  const pPos = new Float32Array(MAX_P * 3)
  const pAlpha = new Float32Array(MAX_P)
  const pSize = new Float32Array(MAX_P)
  const pGeo = new THREE.BufferGeometry()
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
  pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1))
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1))
  track(pGeo)
  const uScaleUniform = { value: 600 }
  const uColorUniform = { value: new THREE.Color(0xffcf28) }
  const pMat = track(
    new THREE.ShaderMaterial({
      uniforms: { uScale: uScaleUniform, uColor: uColorUniform },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = max(-mv.z, 0.001);
          gl_PointSize = clamp(aSize * uScale / d, 1.0, 700.0);
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
  for (let i = 0; i < MAX_P; i++) pool[i] = { on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 0.1, a0: 1 }
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
  function burstMotes(n, speed) {
    for (let i = 0; i < n; i++) {
      const p = allocP()
      if (!p) break
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * (BODY_W / 2 - 0.4)
      p.on = true
      p.x = Math.cos(a) * r
      p.y = CASE_Y + 0.35 + Math.random() * 0.2
      p.z = Math.sin(a) * r * 0.6
      p.vx = Math.cos(a) * (0.2 + Math.random() * 0.6) * speed
      p.vz = Math.sin(a) * (0.15 + Math.random() * 0.4) * speed
      p.vy = (1.2 + Math.random() * 2.6) * speed
      p.life = p.max = 0.8 + Math.random() * 1.4
      p.s0 = 0.05 + Math.random() * 0.12
      p.a0 = 0.5 + Math.random() * 0.5
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
      p.vy -= 0.5 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      const k = p.life / p.max
      const j = i * 3
      pPos[j] = p.x
      pPos[j + 1] = p.y
      pPos[j + 2] = p.z
      pAlpha[i] = p.a0 * Math.pow(k, 0.8)
      pSize[i] = p.s0 * (0.5 + k * 0.5)
    }
    pGeo.attributes.position.needsUpdate = true
    pGeo.attributes.aAlpha.needsUpdate = true
    pGeo.attributes.aSize.needsUpdate = true
  }

  // ---------- 状态机 & 时间线 ----------
  // phase: 'drop' 落箱 → 'wait' 等待点击 → 'open' 开盖光效 → 完成
  let raf = 0
  let running = false
  const clock = new THREE.Clock()
  let t = 0 // 当前阶段内的时间
  let phase = 'drop'
  let cb = {}
  const fired = {}
  let shake = 0
  let flash = 0 // 开盖白闪
  let moteAccum = 0
  let rarity = new THREE.Color(0xffcf28)
  let artTex = null

  const DROP = { start: 0.1, land: 0.85, settle: 1.25 } // 落箱时间线
  const OPEN = {
    latch: 0.22, // 搭扣弹开
    lidStart: 0.3,
    lidEnd: 1.15, // 盖完全掀开
    glowPeak: 1.3,
    flashAt: 1.42, // 白闪：结果即将弹出
    done: 1.95,
  }
  const LID_OPEN_ANGLE = -1.92 // ≈110°

  function setRarity(hex) {
    rarity = new THREE.Color(hex)
    seamMat.emissive.copy(rarity)
    innerMat.emissive.copy(rarity)
    innerLight.color.copy(rarity)
    mouthGlowMat.color.copy(rarity).lerp(new THREE.Color(0xffffff), 0.25)
    columnMat.color.copy(rarity)
    groundGlowMat.color.copy(rarity)
    uColorUniform.value.copy(rarity)
    if (artTex) artTex.dispose()
    artTex = makeLidArt('#' + rarity.getHexString())
    artMat.map = artTex
    artMat.needsUpdate = true
  }

  // ---------- 点击交互 ----------
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  function pickCase(e) {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    return raycaster.intersectObject(caseRoot, true).length > 0
  }
  function onPointerDown(e) {
    if (phase !== 'wait' || !running) return
    if (!pickCase(e)) return
    phase = 'open'
    t = 0
    canvas.style.cursor = 'default'
    cb.onOpen && cb.onOpen()
    cb.onPhase && cb.onPhase('')
  }
  function onPointerMove(e) {
    if (phase !== 'wait' || !running) {
      canvas.style.cursor = 'default'
      return
    }
    canvas.style.cursor = pickCase(e) ? 'pointer' : 'default'
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)

  // ---------- 各阶段更新 ----------
  function updateDrop() {
    if (t < DROP.land) {
      // 自上方旋转落下
      const p = easeIn(smooth(DROP.start, DROP.land, t))
      caseRoot.position.y = lerp(7.5, CASE_Y, p)
      caseRoot.rotation.set(lerp(-0.4, 0, p), lerp(0.7, 0, p), lerp(0.2, 0, p))
      caseRoot.visible = t >= DROP.start
    } else {
      caseRoot.position.y = CASE_Y
      caseRoot.rotation.set(0, 0, 0)
      if (!fired.land) {
        fired.land = true
        shake = 0.3
        burstMotes(30, 0.7)
        cb.onLand && cb.onLand()
        cb.onPhase && cb.onPhase('点击武器箱开启')
      }
      if (t >= DROP.settle) {
        phase = 'wait'
        t = 0
      }
    }
  }

  function updateWait() {
    // 悬浮呼吸 + 缓慢自转展示 + 箱缝脉冲
    caseRoot.position.y = CASE_Y + Math.sin(t * 1.6) * 0.06
    caseRoot.rotation.y = Math.sin(t * 0.45) * 0.16
    const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2.4))
    seamMat.emissiveIntensity = 0.5 + pulse * 0.9
    innerLight.intensity = 0.4 * pulse
    groundGlowMat.opacity = 0.06 + pulse * 0.07
  }

  function updateOpen() {
    caseRoot.position.y = CASE_Y
    caseRoot.rotation.y *= Math.max(0, 1 - t * 4) // 回正

    // 搭扣弹开
    const lp = easeOut(smooth(0, OPEN.latch, t))
    latches.forEach((l) => (l.rotation.x = lp * 1.5))
    if (!fired.latch && t >= OPEN.latch) {
      fired.latch = true
      shake = Math.max(shake, 0.12)
    }

    // 掀盖
    const op = smooth(OPEN.lidStart, OPEN.lidEnd, t)
    lidPivot.rotation.x = LID_OPEN_ANGLE * easeOutBack(op)

    // 内部光涌出：随盖角增大而增强，到 glowPeak 达峰
    const glow = smooth(OPEN.lidStart + 0.1, OPEN.glowPeak, t)
    innerLight.intensity = glow * 16 + flash * 60
    innerLight.position.set(0, CASE_Y + 0.3 + glow * 0.5, 0)
    seamMat.emissiveIntensity = 1.2 + glow * 1.6
    innerMat.emissiveIntensity = glow * 2.2
    mouthGlowMat.opacity = glow * 0.6 + flash * 0.35
    mouthGlow.scale.setScalar(0.6 + glow * 0.9 + flash * 0.6)
    groundGlowMat.opacity = 0.08 + glow * 0.3
    column.visible = glow > 0.02
    columnMat.opacity = 0.4 * glow * (0.85 + Math.sin(t * 9) * 0.15)
    column.rotation.y += 0.025
    column.scale.set(lerp(0.25, 1, glow), 1, lerp(0.25, 1, glow))

    if (!fired.glow && t >= OPEN.lidStart + 0.12) {
      fired.glow = true
      burstMotes(120, 1.6)
      cb.onGlow && cb.onGlow()
    }
    if (!fired.flash && t >= OPEN.flashAt) {
      fired.flash = true
      flash = 1
      burstMotes(90, 2.4)
      cb.onReveal && cb.onReveal()
    }
    if (!fired.done && t >= OPEN.done) {
      fired.done = true
      running = false
      cb.onDone && cb.onDone()
    }
  }

  function stepUpdate(dt) {
    shake = Math.max(0, shake - dt * 2.4)
    flash = Math.max(0, flash - dt * 2.6)

    if (phase === 'drop') updateDrop()
    else if (phase === 'wait') updateWait()
    else updateOpen()

    // 开盖阶段持续发射光尘
    if (phase === 'open') {
      const glow = smooth(OPEN.lidStart + 0.1, OPEN.glowPeak, t)
      moteAccum += glow * 110 * dt
      while (moteAccum >= 1) {
        moteAccum -= 1
        burstMotes(1, 1)
      }
    }
    updateMotes(dt)

    bloom.strength = 0.38 + (phase === 'open' ? smooth(OPEN.lidStart, OPEN.glowPeak, t) * 0.5 : 0) + flash * 0.9
    mouthGlow.quaternion.copy(camera.quaternion)

    // 相机：等待时轻微环绕，开盖时缓推
    const dolly = phase === 'open' ? smooth(0, OPEN.done, t) : 0
    camera.position.set(
      camBase.x + Math.sin(clock.elapsedTime * 0.3) * 0.15 + (Math.random() - 0.5) * shake,
      camBase.y + Math.sin(clock.elapsedTime * 0.5) * 0.08 + (Math.random() - 0.5) * shake,
      lerp(camBase.z, 8.6, dolly) + (Math.random() - 0.5) * shake * 0.4,
    )
    camera.lookAt(0, CASE_Y + dolly * 0.5, 0)
  }

  function tick() {
    // __CASE_TIMESCALE 仅用于调试（0=冻结，默认 1）
    const ts = typeof window !== 'undefined' ? window.__CASE_TIMESCALE : undefined
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
    const pr = renderer.getPixelRatio()
    uScaleUniform.value = (h * pr) / (2 * Math.tan((FOV * Math.PI) / 180 / 2))
  }

  const ro = new ResizeObserver(resize)
  ro.observe(canvas)
  resize()

  function resetState() {
    t = 0
    phase = 'drop'
    for (const k in fired) delete fired[k]
    shake = 0
    flash = 0
    moteAccum = 0
    pool.forEach((p) => (p.on = false))
    caseRoot.visible = false
    caseRoot.position.set(0, 7.5, 0)
    caseRoot.rotation.set(0, 0, 0)
    lidPivot.rotation.x = 0
    latches.forEach((l) => (l.rotation.x = 0))
    innerLight.intensity = 0
    innerMat.emissiveIntensity = 0
    seamMat.emissiveIntensity = 0.7
    mouthGlowMat.opacity = 0
    groundGlowMat.opacity = 0
    column.visible = false
    columnMat.opacity = 0
    canvas.style.cursor = 'default'
  }

  function play(opts = {}) {
    cb = opts
    setRarity(opts.color || '#ffcf28')
    resetState()
    cb.onPhase && cb.onPhase('')
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
    if (artTex) artTex.dispose()
    disposables.forEach((o) => o.dispose && o.dispose())
    envRT.dispose()
    pmrem.dispose()
    composer.dispose()
    renderer.dispose()
  }

  return { play, stop, resize, dispose }
}
