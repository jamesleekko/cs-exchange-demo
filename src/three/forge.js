import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import {
  UnrealBloomPass,
} from 'three/addons/postprocessing/UnrealBloomPass.js';

// 「熔炉锻造」确认汰换特效：
// 物品逐个飞入炉膛 → 炉火升腾 → 铁锤落下 → 爆发火花/冲击波/泛光 → 产物自光效中降临。
// createForge(canvas) 返回句柄，play(opts) 播放一次完整序列，回调驱动外部（音效、结果视图）。

const FOV = 50
const CORE = new THREE.Vector3(0, 1.4, 0) // 炉膛中心（投料、敲击、产物降临点）

// ---------- 数学小工具 ----------
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (a, b, t) => {
  t = clamp01((t - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const easeOut = (x) => 1 - Math.pow(1 - x, 3)
const easeIn = (x) => x * x * x
function easeOutElastic(x) {
  const c4 = (2 * Math.PI) / 3
  return x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1
}

// ---------- 粒子 shader ----------
const PARTICLE_VERT = /* glsl */ `
  uniform float uScale;
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = max(-mv.z, 0.001);
    gl_PointSize = clamp(aSize * uScale / d, 1.0, 900.0);
    gl_Position = projectionMatrix * mv;
  }
`
const PARTICLE_FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, d);
    soft = pow(soft, 1.35);
    gl_FragColor = vec4(vColor, vAlpha * soft);
  }
`

// 粒子模式
const M_FIRE = 1
const M_SMOKE = 2
const M_SPARK = 3
const M_EMBER = 4

// 圆形径向渐变贴图（用于辉光平面 / 光柱）
function makeGlowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.25, 'rgba(255,240,210,0.85)')
  grd.addColorStop(0.6, 'rgba(255,150,60,0.35)')
  grd.addColorStop(1, 'rgba(255,120,40,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 竖直渐变贴图（光柱上淡下浓）
function makeColumnAlpha() {
  const c = document.createElement('canvas')
  c.width = 8
  c.height = 128
  const g = c.getContext('2d')
  const grd = g.createLinearGradient(0, 128, 0, 0)
  grd.addColorStop(0, 'rgba(255,255,255,0.9)')
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 8, 128)
  return new THREE.CanvasTexture(c)
}

// 背景竖直渐变（冷暗上 → 暖底），避免后处理下透明背景变黑
function makeBackdrop() {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 256
  const g = c.getContext('2d')
  const grd = g.createLinearGradient(0, 0, 0, 256)
  grd.addColorStop(0, '#05060c')
  grd.addColorStop(0.55, '#090a12')
  grd.addColorStop(0.82, '#140a0a')
  grd.addColorStop(1, '#20100a')
  g.fillStyle = grd
  g.fillRect(0, 0, 16, 256)
  const rg = g.createRadialGradient(8, 205, 4, 8, 205, 150)
  rg.addColorStop(0, 'rgba(255,110,40,0.16)')
  rg.addColorStop(1, 'rgba(255,110,40,0)')
  g.fillStyle = rg
  g.fillRect(0, 0, 16, 256)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function createForge(canvas) {
  const disposables = []
  const track = (o) => (disposables.push(o), o)

  const scene = new THREE.Scene()
  scene.background = track(makeBackdrop())
  scene.fog = new THREE.FogExp2(0x0a0710, 0.016)

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100)
  const camBase = new THREE.Vector3(0, 4.6, 12.5)
  camera.position.copy(camBase)
  camera.lookAt(0, 1.05, 0)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.86

  // 环境贴图：让高金属度的炉体/铁锤能反射出形状，而非在暗场景中变全黑
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
  scene.environment = envRT.texture
  if ('environmentIntensity' in scene) scene.environmentIntensity = 0.55

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.46, 0.48, 0.42)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  // ---------- 灯光 ----------
  scene.add(new THREE.AmbientLight(0x2a3450, 0.55))
  const keyLight = new THREE.DirectionalLight(0x8098c8, 0.45)
  keyLight.position.set(-6, 9, 5)
  scene.add(keyLight)
  const rim = new THREE.DirectionalLight(0x5566aa, 0.25)
  rim.position.set(5, 4, -6)
  scene.add(rim)
  const forgeLight = new THREE.PointLight(0xff6a18, 4, 30, 2)
  forgeLight.position.set(0, 1.5, 0)
  scene.add(forgeLight)
  const flashLight = new THREE.PointLight(0xffffff, 0, 40, 2)
  flashLight.position.set(0, 1.7, 0)
  scene.add(flashLight)

  // ---------- 地面 ----------
  const groundMat = track(
    new THREE.MeshStandardMaterial({ color: 0x0b0d15, roughness: 0.75, metalness: 0.35 }),
  )
  const ground = new THREE.Mesh(track(new THREE.CircleGeometry(16, 48)), groundMat)
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)
  // 地面炉火投影辉光
  const glowTex = track(makeGlowTexture())
  const groundGlowMat = track(
    new THREE.MeshBasicMaterial({
      map: glowTex,
      color: 0xff7a2a,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  const groundGlow = new THREE.Mesh(track(new THREE.PlaneGeometry(7, 7)), groundGlowMat)
  groundGlow.rotation.x = -Math.PI / 2
  groundGlow.position.y = 0.02
  scene.add(groundGlow)

  // ---------- 熔炉 ----------
  const furnace = new THREE.Group()
  scene.add(furnace)
  const stoneMat = track(new THREE.MeshStandardMaterial({ color: 0x20222c, roughness: 0.9, metalness: 0.2 }))
  const ironMat = track(new THREE.MeshStandardMaterial({ color: 0x3a3f4c, roughness: 0.5, metalness: 0.7 }))

  const base = new THREE.Mesh(track(new THREE.CylinderGeometry(2.3, 2.6, 1.25, 40)), stoneMat)
  base.position.y = 0.62
  furnace.add(base)
  const rimRing = new THREE.Mesh(track(new THREE.TorusGeometry(1.55, 0.16, 16, 48)), ironMat)
  rimRing.rotation.x = Math.PI / 2
  rimRing.position.y = 1.24
  furnace.add(rimRing)
  // 炉膛熔池（自发光盘）
  const emberMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1a0d06,
      emissive: new THREE.Color(0xff6a12),
      emissiveIntensity: 0.6,
      roughness: 0.6,
      metalness: 0.3,
    }),
  )
  const emberPool = new THREE.Mesh(track(new THREE.CylinderGeometry(1.5, 1.35, 0.35, 40)), emberMat)
  emberPool.position.y = 1.12
  furnace.add(emberPool)
  // 竖向铁肋 + 铆钉带
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const rib = new THREE.Mesh(track(new THREE.BoxGeometry(0.14, 1.15, 0.14)), ironMat)
    rib.position.set(Math.cos(a) * 2.42, 0.62, Math.sin(a) * 2.42)
    rib.lookAt(0, 0.62, 0)
    furnace.add(rib)
  }
  const bandMat = track(new THREE.MeshStandardMaterial({ color: 0x2a2e3a, roughness: 0.4, metalness: 0.9 }))
  const band = new THREE.Mesh(track(new THREE.CylinderGeometry(2.52, 2.52, 0.18, 40, 1, true)), bandMat)
  band.position.y = 1.02
  furnace.add(band)
  // 支脚
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    const leg = new THREE.Mesh(track(new THREE.BoxGeometry(0.22, 0.5, 0.22)), ironMat)
    leg.position.set(Math.cos(a) * 2.1, 0.02, Math.sin(a) * 2.1)
    furnace.add(leg)
  }

  // ---------- 铁锤 ----------
  const hammer = new THREE.Group()
  // 锤体装配在内层 group 中并整体旋转 -90°：击打面朝下、锤柄横向伸出，
  // 落锤时锤柄保持在炉口上方，不会插入炉膛
  const hammerBody = new THREE.Group()
  hammerBody.rotation.z = -Math.PI / 2
  hammer.add(hammerBody)
  const hammerMats = []
  const headMat = new THREE.MeshStandardMaterial({ color: 0x454b57, roughness: 0.42, metalness: 0.82, transparent: true, opacity: 1 })
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a4c2b, roughness: 0.8, metalness: 0.1, transparent: true, opacity: 1 })
  hammerMats.push(headMat, woodMat)
  track(headMat)
  track(woodMat)
  const head = new THREE.Mesh(track(new THREE.BoxGeometry(1.15, 0.72, 0.72)), headMat)
  hammerBody.add(head)
  const face1 = new THREE.Mesh(track(new THREE.CylinderGeometry(0.36, 0.4, 0.16, 20)), ironMat)
  face1.rotation.z = Math.PI / 2
  face1.position.x = 0.62
  hammerBody.add(face1)
  const handle = new THREE.Mesh(track(new THREE.CylinderGeometry(0.1, 0.13, 2.7, 16)), woodMat)
  handle.position.set(-0.2, -1.45, 0)
  handle.rotation.z = 0.13
  hammerBody.add(handle)
  hammer.position.set(0, 6, 0)
  hammer.visible = false
  scene.add(hammer)

  // ---------- 粒子系统 ----------
  const uScaleUniform = { value: 600 }
  function makePool(max, blending) {
    const positions = new Float32Array(max * 3)
    const colors = new Float32Array(max * 3)
    const alphas = new Float32Array(max)
    const sizes = new Float32Array(max)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: uScaleUniform },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    })
    const points = new THREE.Points(geo, mat)
    points.frustumCulled = false
    scene.add(points)
    track(geo)
    track(mat)
    const pool = new Array(max)
    for (let i = 0; i < max; i++) {
      pool[i] = { on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 1, s1: 0, r: 1, g: 1, b: 1, a0: 1, grav: 0, drag: 0, mode: M_FIRE }
    }
    let cursor = 0
    function alloc() {
      for (let n = 0; n < max; n++) {
        const idx = (cursor + n) % max
        if (!pool[idx].on) {
          cursor = (idx + 1) % max
          return pool[idx]
        }
      }
      return null
    }
    return { points, geo, positions, colors, alphas, sizes, pool, alloc, max }
  }

  const fx = makePool(1100, THREE.AdditiveBlending) // 火焰 / 火花 / 余烬
  const smoke = makePool(240, THREE.NormalBlending) // 烟雾

  const COL = {
    fireHot: [1.0, 0.86, 0.42],
    fireMid: [1.0, 0.4, 0.08],
    fireLow: [0.5, 0.08, 0.02],
    sparkHot: [1.0, 0.96, 0.72],
    ember: [1.0, 0.5, 0.16],
  }
  const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

  function updatePool(P, dt) {
    const { pool, positions, colors, alphas, sizes } = P
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i]
      if (!p.on) {
        sizes[i] = 0
        alphas[i] = 0
        continue
      }
      p.life -= dt
      if (p.life <= 0) {
        p.on = false
        sizes[i] = 0
        alphas[i] = 0
        continue
      }
      p.vy += p.grav * dt
      const df = Math.max(0, 1 - p.drag * dt)
      p.vx *= df
      p.vy *= df
      p.vz *= df
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      const k = p.life / p.max // 1 → 0
      const age = 1 - k
      let r, g, b, a, s
      if (p.mode === M_FIRE) {
        const c = k > 0.5 ? lerp3(COL.fireMid, COL.fireHot, (k - 0.5) * 2) : lerp3(COL.fireLow, COL.fireMid, k * 2)
        r = c[0]; g = c[1]; b = c[2]
        a = p.a0 * Math.pow(k, 0.75)
        s = lerp(p.s0, p.s1, age)
      } else if (p.mode === M_SPARK) {
        const c = k > 0.5 ? lerp3(COL.fireMid, COL.sparkHot, (k - 0.5) * 2) : lerp3(COL.fireLow, COL.fireMid, k * 2)
        r = c[0]; g = c[1]; b = c[2]
        a = p.a0 * Math.pow(k, 0.6)
        s = lerp(p.s0, p.s1, age)
      } else if (p.mode === M_EMBER) {
        r = p.r; g = p.g; b = p.b
        a = p.a0 * Math.sin(Math.PI * k) * (0.7 + 0.3 * Math.sin(p.life * 30))
        s = lerp(p.s0, p.s1, age)
      } else {
        // smoke
        r = p.r; g = p.g; b = p.b
        a = p.a0 * Math.sin(Math.PI * age)
        s = lerp(p.s0, p.s1, age)
      }
      const j = i * 3
      positions[j] = p.x; positions[j + 1] = p.y; positions[j + 2] = p.z
      colors[j] = r; colors[j + 1] = g; colors[j + 2] = b
      alphas[i] = a
      sizes[i] = s
    }
    P.geo.attributes.position.needsUpdate = true
    P.geo.attributes.aColor.needsUpdate = true
    P.geo.attributes.aAlpha.needsUpdate = true
    P.geo.attributes.aSize.needsUpdate = true
  }

  // ---------- 冲击波环 ----------
  const rings = []
  for (let i = 0; i < 3; i++) {
    const mat = track(
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    const mesh = new THREE.Mesh(track(new THREE.RingGeometry(0.5, 0.62, 64)), mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.copy(CORE)
    mesh.position.y = 1.28
    mesh.visible = false
    scene.add(mesh)
    rings.push({ mesh, mat, t: 0, dur: 0.6, delay: i * 0.08, color: new THREE.Color(i === 0 ? 0xffffff : 0xff9a3c) })
  }
  function fireRings() {
    rings.forEach((r) => {
      r.t = -r.delay
      r.mesh.visible = true
      r.mat.color.copy(r.color)
    })
  }

  // ---------- 热辉光平面（billboard）----------
  const heatMat = track(
    new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff8a3a, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  const heat = new THREE.Mesh(track(new THREE.PlaneGeometry(2.6, 2.6)), heatMat)
  heat.position.set(0, 1.55, 0)
  scene.add(heat)

  // ---------- 产物 ----------
  const product = new THREE.Group()
  product.position.copy(CORE)
  product.visible = false
  scene.add(product)
  const coreMat = new THREE.MeshStandardMaterial({ color: 0xfff2d8, emissive: new THREE.Color(0xffcf28), emissiveIntensity: 1.6, roughness: 0.18, metalness: 0.5 })
  track(coreMat)
  const coreGeo = track(new THREE.IcosahedronGeometry(0.6, 1))
  const coreMesh = new THREE.Mesh(coreGeo, coreMat)
  product.add(coreMesh)
  const wireMat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })
  track(wireMat)
  const wire = new THREE.LineSegments(track(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(0.82, 1))), wireMat)
  product.add(wire)
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xffcf28, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  track(haloMat)
  const halo = new THREE.Mesh(track(new THREE.TorusGeometry(1.05, 0.035, 12, 64)), haloMat)
  halo.rotation.x = Math.PI / 2.4
  product.add(halo)
  // 光柱
  const colAlpha = track(makeColumnAlpha())
  const columnMat = track(
    new THREE.MeshBasicMaterial({ color: 0xffcf28, alphaMap: colAlpha, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  )
  const column = new THREE.Mesh(track(new THREE.CylinderGeometry(0.1, 0.5, 4, 40, 1, true)), columnMat)
  column.position.set(0, 1.8, 0)
  column.visible = false
  scene.add(column)

  // 投料物品（每次 play 重建）
  const itemMats = []
  let items = []
  function clearItems() {
    items.forEach((it) => {
      scene.remove(it.mesh)
      it.mesh.geometry.dispose()
      it.mesh.material.dispose()
    })
    items = []
  }

  // ---------- 状态 & 时间线 ----------
  let raf = 0
  let running = false
  const clock = new THREE.Clock()
  let t = 0
  let fireAccum = 0
  let emberAccum = 0
  let smokeAccum = 0
  let pulse = 0 // 落料脉冲
  let strikeFlash = 0 // 敲击闪光衰减
  let shake = 0
  let cb = {}
  let T = null
  const fired = {}

  function buildTimeline(count) {
    const di = count > 6 ? 0.15 : 0.26
    const dropStart = 0.55
    const dropDur = 0.55
    const drops = []
    for (let i = 0; i < count; i++) drops.push(dropStart + i * di)
    const lastLand = dropStart + (count - 1) * di + dropDur
    const blazeStart = lastLand + 0.15
    const blazeEnd = blazeStart + 1.15
    const strikeTime = blazeEnd + 0.42
    const raiseStart = blazeStart + 0.3
    const raiseEnd = strikeTime - 0.13
    const reboundEnd = strikeTime + 0.5
    const hammerOut = strikeTime + 1.05
    const revealStart = strikeTime + 0.34
    const revealEnd = revealStart + 1.55
    const doneTime = revealEnd + 0.6
    return { count, di, dropStart, dropDur, drops, lastLand, blazeStart, blazeEnd, strikeTime, raiseStart, raiseEnd, reboundEnd, hammerOut, revealStart, revealEnd, doneTime }
  }

  function computeFire() {
    if (t < T.dropStart) return 0.16
    if (t < T.blazeStart) return 0.24
    if (t < T.blazeEnd) return lerp(0.3, 0.85, smooth(T.blazeStart, T.blazeEnd, t))
    if (t < T.strikeTime) return lerp(0.85, 1.05, smooth(T.blazeEnd, T.strikeTime, t))
    if (t < T.revealStart) return lerp(1.05, 0.6, smooth(T.strikeTime, T.revealStart, t))
    if (t < T.revealEnd) return lerp(0.6, 0.1, smooth(T.revealStart, T.revealEnd, t))
    return 0.12
  }

  function emitFire(level, dt) {
    fireAccum += level * 175 * dt
    while (fireAccum >= 1) {
      fireAccum -= 1
      const p = fx.alloc()
      if (!p) break
      const rad = 1.35 * Math.sqrt(Math.random())
      const a = Math.random() * Math.PI * 2
      p.on = true
      p.x = CORE.x + Math.cos(a) * rad
      p.y = 1.18 + Math.random() * 0.1
      p.z = CORE.z + Math.sin(a) * rad * 0.7
      p.vx = Math.cos(a) * 0.2 + (Math.random() - 0.5) * 0.3
      p.vz = Math.sin(a) * 0.14 + (Math.random() - 0.5) * 0.2
      p.vy = 2.4 + Math.random() * 2.6 * (0.5 + level)
      p.grav = 1.2
      p.drag = 0.55
      p.life = p.max = 0.45 + Math.random() * 0.65
      p.s0 = (0.32 + Math.random() * 0.36) * (0.6 + level * 0.5)
      p.s1 = p.s0 * 0.12
      p.a0 = 0.6
      p.mode = M_FIRE
    }
    // 环境余烬
    emberAccum += (0.6 + level * 3) * dt
    while (emberAccum >= 1) {
      emberAccum -= 1
      const p = fx.alloc()
      if (!p) break
      const a = Math.random() * Math.PI * 2
      const rad = 0.5 + Math.random() * 1.6
      p.on = true
      p.x = CORE.x + Math.cos(a) * rad
      p.y = 1.2 + Math.random() * 0.3
      p.z = CORE.z + Math.sin(a) * rad * 0.7
      p.vx = (Math.random() - 0.5) * 0.5
      p.vz = (Math.random() - 0.5) * 0.4
      p.vy = 0.7 + Math.random() * 1.3
      p.grav = 0.3
      p.drag = 0.2
      p.life = p.max = 1.2 + Math.random() * 1.6
      p.s0 = 0.05 + Math.random() * 0.09
      p.s1 = p.s0 * 0.4
      p.a0 = 0.9
      p.r = COL.ember[0]; p.g = COL.ember[1]; p.b = COL.ember[2]
      p.mode = M_EMBER
    }
    // 烟雾
    if (level > 0.4) {
      smokeAccum += (level - 0.3) * 14 * dt
      while (smokeAccum >= 1) {
        smokeAccum -= 1
        const p = smoke.alloc()
        if (!p) break
        const a = Math.random() * Math.PI * 2
        const rad = Math.random() * 1.1
        p.on = true
        p.x = CORE.x + Math.cos(a) * rad
        p.y = 1.7 + Math.random() * 0.4
        p.z = CORE.z + Math.sin(a) * rad
        p.vx = (Math.random() - 0.5) * 0.4
        p.vz = (Math.random() - 0.5) * 0.4
        p.vy = 0.7 + Math.random() * 0.7
        p.grav = 0.05
        p.drag = 0.3
        p.life = p.max = 1.6 + Math.random() * 1.4
        p.s0 = 0.8 + Math.random() * 0.6
        p.s1 = p.s0 * 3
        p.a0 = 0.16 + Math.random() * 0.12
        const g = 0.06 + Math.random() * 0.04
        p.r = g; p.g = g * 0.95; p.b = g * 0.95
        p.mode = M_SMOKE
      }
    }
  }

  function burstSparks(n) {
    for (let i = 0; i < n; i++) {
      const p = fx.alloc()
      if (!p) break
      const a = Math.random() * Math.PI * 2
      const up = Math.random()
      const sp = 3 + Math.random() * 9
      p.on = true
      p.x = CORE.x + (Math.random() - 0.5) * 0.3
      p.y = 1.4
      p.z = CORE.z + (Math.random() - 0.5) * 0.3
      p.vx = Math.cos(a) * sp * (0.6 + up * 0.6)
      p.vz = Math.sin(a) * sp * (0.6 + up * 0.6)
      p.vy = 2 + up * 11
      p.grav = -13
      p.drag = 0.35
      p.life = p.max = 0.4 + Math.random() * 0.9
      p.s0 = 0.08 + Math.random() * 0.14
      p.s1 = 0.01
      p.a0 = 1
      p.mode = M_SPARK
    }
  }

  function dropSplash(pos) {
    for (let i = 0; i < 22; i++) {
      const p = fx.alloc()
      if (!p) break
      const a = Math.random() * Math.PI * 2
      const sp = 1.5 + Math.random() * 4
      p.on = true
      p.x = pos.x
      p.y = 1.35
      p.z = pos.z
      p.vx = Math.cos(a) * sp
      p.vz = Math.sin(a) * sp
      p.vy = 2 + Math.random() * 5
      p.grav = -11
      p.drag = 0.4
      p.life = p.max = 0.3 + Math.random() * 0.5
      p.s0 = 0.06 + Math.random() * 0.1
      p.s1 = 0.01
      p.a0 = 1
      p.mode = M_SPARK
    }
  }

  function updateHammer() {
    if (t < T.raiseStart || t > T.hammerOut) {
      hammer.visible = false
      return
    }
    hammer.visible = true
    let y, rot, op
    // rot > 0 时锤柄一侧(-X)下沉、锤头上扬;落锤前锤头略高于锤柄,砸下时甩过水平线,更有力道
    if (t < T.raiseEnd) {
      const p = easeOut(smooth(T.raiseStart, T.raiseEnd, t))
      y = lerp(6.2, 3.35, p)
      rot = lerp(0.6, 0.32, p)
      op = clamp01((t - T.raiseStart) / 0.18)
    } else if (t < T.strikeTime) {
      const p = easeIn(smooth(T.raiseEnd, T.strikeTime, t))
      y = lerp(3.35, 2.06, p)
      rot = lerp(0.32, -0.05, p)
      op = 1
    } else if (t < T.reboundEnd) {
      const p = easeOut(smooth(T.strikeTime, T.reboundEnd, t))
      y = lerp(2.06, 3.0, p)
      rot = lerp(-0.05, 0.15, p)
      op = 1
    } else {
      const p = smooth(T.reboundEnd, T.hammerOut, t)
      y = lerp(3.0, 6.2, p)
      rot = 0.15
      op = 1 - p
    }
    hammer.position.set(0.15, y, 0.35)
    hammer.rotation.z = rot
    hammerMats.forEach((m) => (m.opacity = op))
    // 锤头被炉火染色
    const glow = clamp01((3.75 - y) / 2) * (0.4 + computeFire() * 0.4)
    headMat.emissive = headMat.emissive || new THREE.Color()
    headMat.emissive.setRGB(glow * 1.0, glow * 0.4, glow * 0.1)
    headMat.emissiveIntensity = glow * 2
  }

  function updateItems() {
    for (const it of items) {
      const p = clamp01((t - it.dropAt) / T.dropDur)
      if (t < it.dropAt) {
        it.mesh.visible = false
        continue
      }
      if (p >= 1) {
        if (!it.landed) {
          it.landed = true
          dropSplash(it.mesh.position)
          pulse += 0.7
          strikeFlash = Math.max(strikeFlash, 0.12)
        }
        it.mesh.visible = false
        continue
      }
      it.mesh.visible = true
      const ez = easeIn(p)
      it.mesh.position.x = lerp(it.start.x, CORE.x, ez)
      it.mesh.position.z = lerp(it.start.z, CORE.z, ez)
      it.mesh.position.y = lerp(it.start.y, 1.35, p) + Math.sin(Math.PI * p) * 1.3
      const sc = lerp(1, 0.25, p)
      it.mesh.scale.setScalar(sc)
      it.mesh.rotation.x += 0.22
      it.mesh.rotation.y += 0.16
    }
  }

  function updateProduct() {
    if (t < T.revealStart) {
      product.visible = false
      column.visible = false
      return
    }
    product.visible = true
    column.visible = true
    const p = clamp01((t - T.revealStart) / (T.revealEnd - T.revealStart))
    const sc = easeOutElastic(clamp01(p * 1.15))
    product.scale.setScalar(sc)
    product.position.y = lerp(1.4, 2.75, easeOut(p))
    coreMesh.rotation.y += 0.03
    coreMesh.rotation.x += 0.012
    wire.rotation.y -= 0.02
    wire.rotation.z += 0.01
    halo.rotation.z += 0.05
    haloMat.opacity = 0.85 * smooth(0, 0.6, p)
    halo.scale.setScalar(lerp(0.4, 1, easeOut(p)))
    coreMat.emissiveIntensity = 1.0 + Math.sin(t * 6) * 0.3 + p * 0.5
    // 光柱
    const cp = smooth(T.revealStart, T.revealStart + 0.5, t)
    columnMat.opacity = 0.34 * cp * (0.85 + Math.sin(t * 8) * 0.15)
    column.rotation.y += 0.02
    column.scale.set(lerp(0.3, 1, cp), 1, lerp(0.3, 1, cp))
  }

  function stepUpdate(dt) {
    // 阶段回调
    if (!fired.ignite && t >= T.blazeStart) { fired.ignite = true; cb.onIgnite && cb.onIgnite() }
    if (!fired.pDrop && t >= T.dropStart) { fired.pDrop = true; cb.onPhase && cb.onPhase('投料') }
    if (!fired.pBlaze && t >= T.blazeStart) { fired.pBlaze = true; cb.onPhase && cb.onPhase('升火') }
    if (!fired.pForge && t >= T.raiseEnd) { fired.pForge = true; cb.onPhase && cb.onPhase('落锤') }
    if (!fired.strike && t >= T.strikeTime) {
      fired.strike = true
      strikeFlash = 1.1
      shake = 0.45
      burstSparks(240)
      fireRings()
      pulse += 1.4
      cb.onStrike && cb.onStrike()
    }
    if (!fired.reveal && t >= T.revealStart) { fired.reveal = true; cb.onPhase && cb.onPhase('产物'); cb.onReveal && cb.onReveal() }
    if (!fired.done && t >= T.doneTime) { fired.done = true; running = false; cb.onDone && cb.onDone() }

    const fire = computeFire()
    pulse = Math.max(0, pulse - dt * 2.2)
    strikeFlash = Math.max(0, strikeFlash - dt * 7)
    shake = Math.max(0, shake - dt * 2.5)

    emitFire(fire, dt)
    updatePool(fx, dt)
    updatePool(smoke, dt)
    updateItems()
    updateHammer()
    updateProduct()

    // 熔池 / 灯光 / 辉光
    const lit = fire + pulse * 0.8 + strikeFlash * 1.1
    emberMat.emissiveIntensity = 0.45 + lit * 0.8
    forgeLight.intensity = 3 + lit * 12 + strikeFlash * 110
    flashLight.intensity = strikeFlash * 130
    const warm = new THREE.Color(0xff6a18)
    if (strikeFlash > 0.02) warm.lerp(new THREE.Color(0xffffff), Math.min(1, strikeFlash))
    forgeLight.color.copy(warm)
    emberMat.emissive.copy(warm)
    heatMat.opacity = 0.1 + fire * 0.22 + strikeFlash * 0.28
    heat.scale.setScalar(1.1 + fire * 0.7 + strikeFlash * 1.1)
    groundGlowMat.opacity = 0.1 + fire * 0.3 + strikeFlash * 0.3
    bloom.strength = 0.48 + fire * 0.14 + strikeFlash * 0.55 + (product.visible ? 0.22 : 0)

    // 冲击波环
    rings.forEach((r) => {
      if (!r.mesh.visible) return
      r.t += dt
      if (r.t < 0) return
      const p = r.t / r.dur
      if (p >= 1) { r.mesh.visible = false; r.mat.opacity = 0; return }
      const s = lerp(0.4, 9, easeOut(p))
      r.mesh.scale.set(s, s, s)
      r.mat.opacity = (1 - p) * 0.9
    })

    // billboard 朝向相机
    heat.quaternion.copy(camera.quaternion)

    // 相机缓推 + 震动
    const dolly = smooth(0, T.doneTime, t)
    camera.position.set(
      camBase.x + (Math.random() - 0.5) * shake,
      camBase.y + Math.sin(t * 0.4) * 0.12 + (Math.random() - 0.5) * shake,
      lerp(camBase.z, 12, dolly) + (Math.random() - 0.5) * shake * 0.5,
    )
    camera.lookAt(CORE.x, CORE.y - 0.35, CORE.z)
  }

  function tick() {
    // __FORGE_TIMESCALE 仅用于调试（0=冻结，默认 1，不影响正常播放）
    const ts = typeof window !== 'undefined' ? window.__FORGE_TIMESCALE : undefined
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
    fireAccum = emberAccum = smokeAccum = 0
    pulse = strikeFlash = shake = 0
    for (const k in fired) delete fired[k]
    fx.pool.forEach((p) => (p.on = false))
    smoke.pool.forEach((p) => (p.on = false))
    rings.forEach((r) => { r.mesh.visible = false; r.mat.opacity = 0 })
    product.visible = false
    product.scale.setScalar(0)
    column.visible = false
    columnMat.opacity = 0
    hammer.visible = false
    coreMesh.rotation.set(0, 0, 0)
    items.forEach((it) => {
      it.landed = false
      it.mesh.visible = false
    })
  }

  function play(opts = {}) {
    cb = opts
    const count = Math.max(1, Math.min(12, opts.count || 5))
    const colors = opts.colors && opts.colors.length ? opts.colors : ['#ffcf28']
    const resultColor = new THREE.Color(opts.resultColor || 0xffcf28)

    // 产物配色
    coreMat.emissive.copy(resultColor)
    coreMat.color.copy(resultColor).lerp(new THREE.Color(0xffffff), 0.35)
    wireMat.color.copy(resultColor).lerp(new THREE.Color(0xffffff), 0.4)
    haloMat.color.copy(resultColor)
    columnMat.color.copy(resultColor)

    // 重建投料物品
    clearItems()
    T = buildTimeline(count)
    for (let i = 0; i < count; i++) {
      const col = new THREE.Color(colors[i % colors.length])
      // 自发光向白色靠拢并固定亮度：深色品质（隐秘/保密）也和普通级一样有浅色泛光
      const emis = col.clone().lerp(new THREE.Color(0xffffff), 0.6)
      const mat = new THREE.MeshStandardMaterial({ color: col, emissive: emis, emissiveIntensity: 0.32, roughness: 0.4, metalness: 0.6 })
      itemMats.push(mat)
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 0.15), mat)
      const a = i * 2.399
      const side = i % 2 === 0 ? 1 : -1
      const start = { x: side * (2.4 + (i % 3) * 0.5), y: 5 + Math.random() * 0.6, z: -1 + Math.cos(a) * 1.6 }
      mesh.position.set(start.x, start.y, start.z)
      mesh.visible = false
      scene.add(mesh)
      items.push({ mesh, start, dropAt: T.drops[i], landed: false })
    }

    resetState()
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
    clearItems()
    itemMats.forEach((m) => m.dispose())
    disposables.forEach((o) => o.dispose && o.dispose())
    envRT.dispose()
    pmrem.dispose()
    composer.dispose()
    renderer.dispose()
  }

  return { play, stop, resize, dispose }
}
