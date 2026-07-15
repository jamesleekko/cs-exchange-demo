import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const FPS = 24
const FRAME = {
  idle: 1,
  closeStart: 36,
  land: 136,
  closed: 156,
  mechanicalOpen: 240,
  open: 303,
}
const CLOSE = { land: 2.25, done: 2.7 }
const OPEN = {
  spinStart: 2.4,
  columnAt: 2.86,
  glowPeak: 5.25,
  climaxAt: 6.88,
  done: 7.4,
}
const FOV = 42
const MODEL_SCALE = 3
const CAMERA_HEIGHT = 5.05
const CAMERA_TARGET_Y = 3.65
const CAMERA_DOLLY = 2.3
const DEFAULT_GLOW = '#ff7928'
const ARM_GLOW = '#45bfff'
const MOUTH = new THREE.Vector3(0, 1.72, 0)
const SEAM_Y = 1.68
const UPPER_OPEN_OFFSET = 0.62
const UPPER_CLOSED_OFFSET = 0.36

const clamp01 = (value) => Math.min(1, Math.max(0, value))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (a, b, value) => {
  const t = clamp01((value - a) / (b - a))
  return t * t * (3 - 2 * t)
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.24, 'rgba(255,245,225,.82)')
  gradient.addColorStop(0.58, 'rgba(255,150,60,.3)')
  gradient.addColorStop(1, 'rgba(255,120,40,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function makeContactShadowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128)
  gradient.addColorStop(0, 'rgba(0,0,0,.86)')
  gradient.addColorStop(0.34, 'rgba(0,0,0,.68)')
  gradient.addColorStop(0.7, 'rgba(0,0,0,.24)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 256, 256)
  return new THREE.CanvasTexture(canvas)
}

function makeColumnAlpha() {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 256
  const context = canvas.getContext('2d')
  const gradient = context.createLinearGradient(0, 256, 0, 0)
  gradient.addColorStop(0, 'rgba(255,255,255,.96)')
  gradient.addColorStop(0.22, 'rgba(255,255,255,.88)')
  gradient.addColorStop(0.68, 'rgba(255,255,255,.32)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 16, 256)
  return new THREE.CanvasTexture(canvas)
}

function makeMetalTexture(seed, bump = false) {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')
  const image = context.createImageData(size, size)
  let state = seed >>> 0
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  for (let y = 0; y < size; y++) {
    const brushed = Math.sin(y * 0.31) * 5 + Math.sin(y * 1.7) * 2
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4
      const grain = (random() - 0.5) * (bump ? 34 : 24)
      const value = Math.round((bump ? 128 : 218) + grain + brushed)
      image.data[offset] = value
      image.data[offset + 1] = value
      image.data[offset + 2] = value + (bump ? 0 : 3)
      image.data[offset + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  for (let index = 0; index < 75; index++) {
    const y = random() * size
    const length = 8 + random() * 72
    context.fillStyle = bump
      ? 'rgba(220,220,220,.35)'
      : 'rgba(255,255,255,.08)'
    context.fillRect(random() * (size - length), y, length, random() > 0.8 ? 2 : 1)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(2.5, 2.5)
  if (!bump) texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function disposeMaterial(material) {
  if (!material) return
  Object.values(material).forEach((value) => {
    if (value?.isTexture) value.dispose()
  })
  material.dispose()
}

function disposeObjectResources(root) {
  const geometries = new Set()
  const materials = new Set()
  root.traverse((object) => {
    if (!object.isMesh) return
    if (object.geometry) geometries.add(object.geometry)
    const list = Array.isArray(object.material) ? object.material : [object.material]
    list.filter(Boolean).forEach((material) => materials.add(material))
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach(disposeMaterial)
}

export function createFurnace(canvas) {
  const disposables = []
  const track = (resource) => {
    disposables.push(resource)
    return resource
  }
  let disposed = false
  const appRoot = canvas.closest('.app')
  const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')

  function setBackgroundZoom(scale) {
    appRoot?.style.setProperty('--forge-bg-scale', scale.toFixed(4))
  }

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100)
  const cameraBase = new THREE.Vector3(0, CAMERA_HEIGHT, 21)
  const lookY = CAMERA_TARGET_Y
  const cameraTarget = new THREE.Vector3(0, lookY, 0)
  const cameraDollyDirection = new THREE.Vector3()
  camera.position.copy(cameraBase)
  camera.lookAt(cameraTarget)

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.16
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const environment = pmrem.fromScene(room, 0.04)
  room.dispose?.()
  scene.environment = environment.texture
  if ('environmentIntensity' in scene) scene.environmentIntensity = 0.82

  scene.add(new THREE.AmbientLight(0x6f7f9e, 0.32))
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x160a06, 0.5))

  const keyLight = new THREE.DirectionalLight(0xe3edff, 1.65)
  keyLight.position.set(-5.5, 10.5, 7.5)
  keyLight.target.position.set(0, 3.1, 0)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(1024, 1024)
  keyLight.shadow.camera.left = -6.5
  keyLight.shadow.camera.right = 6.5
  keyLight.shadow.camera.top = 11
  keyLight.shadow.camera.bottom = -2
  keyLight.shadow.camera.near = 1
  keyLight.shadow.camera.far = 28
  keyLight.shadow.bias = -0.0004
  keyLight.shadow.normalBias = 0.025
  scene.add(keyLight, keyLight.target)

  const fillLight = new THREE.DirectionalLight(0x789fff, 0.62)
  fillLight.position.set(6, 4, 4)
  scene.add(fillLight)
  const rimLight = new THREE.DirectionalLight(0x5ac8ff, 1.05)
  rimLight.position.set(3, 5, -7)
  scene.add(rimLight)

  const mouthLight = new THREE.PointLight(0xff6a18, 3, 26, 2)
  const columnLight = new THREE.PointLight(0xffcf6a, 0, 34, 2)
  const flashLight = new THREE.PointLight(0xffffff, 0, 48, 2)
  scene.add(mouthLight, columnLight, flashLight)

  const metalTexture = track(makeMetalTexture(0x5f3759df))
  const metalBump = track(makeMetalTexture(0x9e3779b9, true))
  metalTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  metalBump.anisotropy = metalTexture.anisotropy

  const modelMaterials = {
    dark: track(new THREE.MeshStandardMaterial({
      color: 0x252e3b,
      map: metalTexture,
      bumpMap: metalBump,
      bumpScale: 0.012,
      metalness: 0.9,
      roughness: 0.31,
    })),
    steel: track(new THREE.MeshStandardMaterial({
      color: 0x75849a,
      map: metalTexture,
      bumpMap: metalBump,
      bumpScale: 0.009,
      metalness: 0.96,
      roughness: 0.22,
    })),
    panel: track(new THREE.MeshStandardMaterial({
      color: 0x384455,
      map: metalTexture,
      bumpMap: metalBump,
      bumpScale: 0.014,
      metalness: 0.88,
      roughness: 0.29,
    })),
    rubber: track(new THREE.MeshStandardMaterial({
      color: 0x090c11,
      metalness: 0.08,
      roughness: 0.64,
    })),
    letter: track(new THREE.MeshStandardMaterial({
      color: 0xb6c2d0,
      metalness: 0.82,
      roughness: 0.2,
    })),
    glow: track(new THREE.MeshStandardMaterial({
      color: 0x42150a,
      emissive: new THREE.Color(DEFAULT_GLOW),
      emissiveIntensity: 2.4,
      metalness: 0.25,
      roughness: 0.32,
    })),
    armGlow: track(new THREE.MeshStandardMaterial({
      color: 0x0a2842,
      emissive: new THREE.Color(ARM_GLOW),
      emissiveIntensity: 3.2,
      metalness: 0.22,
      roughness: 0.28,
    })),
    hot: track(new THREE.MeshStandardMaterial({
      color: 0x5b1e09,
      emissive: new THREE.Color(0xffa044),
      emissiveIntensity: 4.5,
      metalness: 0.18,
      roughness: 0.26,
    })),
    nozzle: track(new THREE.MeshStandardMaterial({
      color: 0x5b1e09,
      emissive: new THREE.Color(0xffa044),
      emissiveIntensity: 3.8,
      metalness: 0.18,
      roughness: 0.26,
    })),
    beam: track(new THREE.MeshBasicMaterial({
      color: DEFAULT_GLOW,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })),
    beamAura: track(new THREE.MeshBasicMaterial({
      color: DEFAULT_GLOW,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })),
    beamRibbon: track(new THREE.MeshBasicMaterial({
      color: 0xffe2b8,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })),
    beamRing: track(new THREE.MeshBasicMaterial({
      color: DEFAULT_GLOW,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })),
    beamShock: track(new THREE.MeshBasicMaterial({
      color: DEFAULT_GLOW,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })),
    beamCore: track(new THREE.MeshBasicMaterial({
      color: 0xfff7e8,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })),
  }

  function materialFor(source, objectName) {
    const name = source?.name || ''
    if (objectName === 'Plaque_Logo' && source?.map) {
      const logoMap = source.map
      source.map = null
      logoMap.colorSpace = THREE.SRGBColorSpace
      return track(new THREE.MeshStandardMaterial({
        map: logoMap,
        color: 0xdce5ef,
        transparent: true,
        alphaTest: 0.12,
        depthWrite: true,
        metalness: 0.68,
        roughness: 0.22,
        side: THREE.DoubleSide,
      }))
    }
    if (objectName.startsWith('Energy_Beam_Core')) return modelMaterials.beamCore
    if (objectName.startsWith('Energy_Beam_Shock')) return modelMaterials.beamShock
    if (objectName.startsWith('Energy_Beam_Ring')) return modelMaterials.beamRing
    if (objectName.startsWith('Energy_Beam_Ribbon')) return modelMaterials.beamRibbon
    if (objectName.startsWith('Energy_Beam_Aura')) return modelMaterials.beamAura
    if (objectName.startsWith('Energy_Beam')) return modelMaterials.beam
    if (
      objectName.startsWith('Arm_')
      && (objectName.includes('GlowRing') || objectName.includes('LinkGlow'))
    ) return modelMaterials.armGlow
    if (name.startsWith('M_ArmBlueGlow')) return modelMaterials.armGlow
    if (name.startsWith('M_DarkSteel')) return modelMaterials.dark
    if (name.startsWith('M_BrushedSteel')) return modelMaterials.steel
    if (name.startsWith('M_ArmorPanel')) return modelMaterials.panel
    if (name.startsWith('M_GripRubber')) return modelMaterials.rubber
    if (name.startsWith('M_PlaqueLetter')) return modelMaterials.letter
    if (name.startsWith('M_OrangeGlow')) return modelMaterials.glow
    if (name.startsWith('M_OrangeHot')) {
      return objectName.includes('Nozzle')
        ? modelMaterials.nozzle
        : modelMaterials.hot
    }
    return modelMaterials.panel
  }

  const modelRoot = new THREE.Group()
  modelRoot.scale.setScalar(MODEL_SCALE)
  scene.add(modelRoot)

  const fallbackRoot = new THREE.Group()
  fallbackRoot.visible = false
  modelRoot.add(fallbackRoot)
  const fallbackBase = new THREE.Group()
  const fallbackUpper = new THREE.Group()
  fallbackRoot.add(fallbackBase, fallbackUpper)
  const fallbackBaseMesh = new THREE.Mesh(
    track(new THREE.CylinderGeometry(1.18, 1.24, 0.48, 20)),
    modelMaterials.dark,
  )
  fallbackBaseMesh.position.y = 0.24
  fallbackBase.add(fallbackBaseMesh)
  const fallbackWell = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.38, 0.46, 0.08, 32)),
    modelMaterials.hot,
  )
  fallbackWell.position.y = 0.54
  fallbackBase.add(fallbackWell)
  const fallbackBody = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.48, 0.82, 2.05, 16)),
    modelMaterials.panel,
  )
  fallbackBody.position.y = 2.1
  fallbackUpper.add(fallbackBody)

  let modelMixer = null
  let modelAction = null
  let modelUpper = null
  let modelUpperAppliedOffset = 0
  let nozzleAnchor = null
  let modelBeam = null
  let modelBeamCore = null
  const modelBeamBaseScale = new THREE.Vector2(1, 1)
  const modelBeamCoreBaseScale = new THREE.Vector2(1, 1)
  let modelReady = false
  let loadFailed = false
  let pickRoots = [fallbackBase, fallbackUpper]
  const importedGeometries = new Set()

  const glowTexture = track(makeGlowTexture())
  const mouthGlowMaterial = track(new THREE.MeshBasicMaterial({
    map: glowTexture,
    color: DEFAULT_GLOW,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }))
  const mouthGlow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(4.2, 4.2)),
    mouthGlowMaterial,
  )
  scene.add(mouthGlow)

  const columnAlpha = track(makeColumnAlpha())
  const outerColumnMaterial = track(new THREE.MeshBasicMaterial({
    color: 0xffcf28,
    alphaMap: columnAlpha,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }))
  const coreColumnMaterial = track(new THREE.MeshBasicMaterial({
    color: 0xfff4dc,
    alphaMap: columnAlpha,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  }))
  const auraColumnMaterial = track(new THREE.MeshBasicMaterial({
    color: 0xff9f48,
    alphaMap: columnAlpha,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }))
  const ringMaterial = track(new THREE.MeshBasicMaterial({
    color: 0xffcf28,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }))
  const columnGroup = new THREE.Group()
  const outerColumn = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.34, 1.02, 6.8, 40, 1, true)),
    outerColumnMaterial,
  )
  outerColumn.position.y = 3.4
  const coreColumn = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.025, 0.05, 6.8, 20, 1, true)),
    coreColumnMaterial,
  )
  coreColumn.position.y = 3.4
  const auraColumn = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.72, 1.58, 7.3, 40, 1, true)),
    auraColumnMaterial,
  )
  auraColumn.position.y = 3.65
  const burstRing = new THREE.Mesh(
    track(new THREE.TorusGeometry(1.08, 0.075, 12, 64)),
    ringMaterial,
  )
  burstRing.rotation.x = Math.PI / 2
  burstRing.position.y = 0.08
  columnGroup.add(auraColumn, outerColumn, coreColumn, burstRing)
  columnGroup.visible = false
  scene.add(columnGroup)

  const groundGlowMaterial = track(new THREE.MeshBasicMaterial({
    map: glowTexture,
    color: DEFAULT_GLOW,
    transparent: true,
    opacity: 0.2,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }))
  const groundGlow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(7.2, 7.2)),
    groundGlowMaterial,
  )
  groundGlow.rotation.x = -Math.PI / 2
  scene.add(groundGlow)

  const nozzleGlowMaterial = track(new THREE.MeshBasicMaterial({
    map: glowTexture,
    color: DEFAULT_GLOW,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }))
  const nozzleGlow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(3.2, 3.2)),
    nozzleGlowMaterial,
  )
  scene.add(nozzleGlow)

  const contactShadowMaterial = track(new THREE.MeshBasicMaterial({
    map: track(makeContactShadowTexture()),
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    blending: THREE.NormalBlending,
  }))
  const contactShadow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(6.7, 4.2)),
    contactShadowMaterial,
  )
  contactShadow.rotation.x = -Math.PI / 2
  contactShadow.renderOrder = -2
  scene.add(contactShadow)

  function positionEffects() {
    mouthLight.position.copy(MOUTH)
    flashLight.position.copy(MOUTH)
    columnLight.position.copy(MOUTH)
    columnLight.position.y += 2.5
    mouthGlow.position.copy(MOUTH)
    mouthGlow.position.y += 0.12
    columnGroup.position.copy(MOUTH)
    nozzleGlow.position.copy(MOUTH)
    groundGlow.position.set(MOUTH.x, 0.055, MOUTH.z)
    contactShadow.position.set(MOUTH.x, 0.018, MOUTH.z + 0.16)
  }
  positionEffects()

  const MAX_PARTICLES = 1100
  const positions = new Float32Array(MAX_PARTICLES * 3)
  const colors = new Float32Array(MAX_PARTICLES * 3)
  const alphas = new Float32Array(MAX_PARTICLES)
  const sizes = new Float32Array(MAX_PARTICLES)
  const particleGeometry = track(new THREE.BufferGeometry())
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  particleGeometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  particleGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))
  particleGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  const pointScale = { value: 600 }
  const rarityParticleColor = new THREE.Color(0xffcf28)
  const warmParticleColor = new THREE.Color(DEFAULT_GLOW)
  const particleMaterial = track(new THREE.ShaderMaterial({
    uniforms: { uScale: pointScale },
    vertexShader: 'uniform float uScale; attribute float aSize; attribute float aAlpha; attribute vec3 aColor; varying float vAlpha; varying vec3 vColor; void main(){ vAlpha=aAlpha; vColor=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0); float d=max(-mv.z,0.001); gl_PointSize=clamp(aSize*uScale/d,1.0,800.0); gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'varying float vAlpha; varying vec3 vColor; void main(){ vec2 uv=gl_PointCoord-0.5; float d=length(uv); if(d>0.5) discard; float core=smoothstep(0.22,0.0,d); float soft=pow(smoothstep(0.5,0.0,d),1.35); gl_FragColor=vec4(vColor*(1.0+core*.8),vAlpha*soft); }',
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  }))
  const particlePoints = new THREE.Points(particleGeometry, particleMaterial)
  particlePoints.frustumCulled = false
  particlePoints.renderOrder = 10
  scene.add(particlePoints)

  const pool = Array.from({ length: MAX_PARTICLES }, () => ({
    on: false,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    max: 1,
    size: 0.1,
    alpha: 1,
    gravity: 0,
    drag: 0,
    kind: 0,
    angle: 0,
    radius: 0,
    radialVelocity: 0,
    spin: 0,
    depthScale: 1,
    r: 1,
    g: 1,
    b: 1,
  }))
  let particleCursor = 0

  function prepareParticle(p) {
    p.on = true
    p.vx = 0
    p.vy = 0
    p.vz = 0
    p.gravity = 0
    p.drag = 0
    p.kind = 0
    p.angle = 0
    p.radius = 0
    p.radialVelocity = 0
    p.spin = 0
    p.depthScale = 1
    return p
  }

  function colorParticle(p, color, whiteMix = 0) {
    p.r = lerp(color.r, 1, whiteMix)
    p.g = lerp(color.g, 1, whiteMix)
    p.b = lerp(color.b, 1, whiteMix)
  }

  function allocate() {
    for (let offset = 0; offset < MAX_PARTICLES; offset++) {
      const index = (particleCursor + offset) % MAX_PARTICLES
      if (!pool[index].on) {
        particleCursor = (index + 1) % MAX_PARTICLES
        return prepareParticle(pool[index])
      }
    }
    return null
  }

  function burstMotes(count, speed = 1) {
    for (let index = 0; index < count; index++) {
      const p = allocate()
      if (!p) return
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() * 1.45
      p.x = MOUTH.x + Math.cos(angle) * radius
      p.y = MOUTH.y + 0.08 + Math.random() * 0.24
      p.z = MOUTH.z + Math.sin(angle) * radius * 0.72
      p.vx = Math.cos(angle) * (0.2 + Math.random() * 0.5) * speed
      p.vz = Math.sin(angle) * (0.15 + Math.random() * 0.35) * speed
      p.vy = (1.2 + Math.random() * 2.4) * speed
      p.life = p.max = 0.9 + Math.random() * 1.5
      const sizeBoost = Math.random() < 0.14 ? 1.75 : 1
      p.size = (0.075 + Math.random() * 0.15) * sizeBoost
      p.alpha = 0.64 + Math.random() * 0.36
      p.gravity = -0.4
      p.drag = 0.1
      colorParticle(
        p,
        Math.random() < 0.28 ? warmParticleColor : rarityParticleColor,
        Math.random() * 0.18,
      )
    }
  }

  function burstSparks(count, ring = false) {
    for (let index = 0; index < count; index++) {
      const p = allocate()
      if (!p) return
      const angle = Math.random() * Math.PI * 2
      const speed = ring ? 2.5 + Math.random() * 4.5 : 3 + Math.random() * 8
      const radius = ring ? 2.48 : Math.random() * 0.2
      p.x = MOUTH.x + Math.cos(angle) * radius
      p.y = ring ? SEAM_Y + (Math.random() - 0.5) * 0.15 : MOUTH.y
      p.z = MOUTH.z + Math.sin(angle) * radius
      p.vx = Math.cos(angle) * speed
      p.vz = Math.sin(angle) * speed
      p.vy = ring ? 0.4 + Math.random() * 1.4 : 3 + Math.random() * 11
      p.life = p.max = ring
        ? 0.3 + Math.random() * 0.45
        : 0.4 + Math.random() * 0.8
      p.size = 0.065 + Math.random() * 0.12
      p.alpha = 1
      p.gravity = ring ? -9 : -13
      p.drag = 0.28
      colorParticle(p, warmParticleColor, 0.42 + Math.random() * 0.48)
    }
  }

  function spawnFall(count, sourceY) {
    for (let index = 0; index < count; index++) {
      const p = allocate()
      if (!p) return
      p.x = MOUTH.x + (Math.random() - 0.5) * 0.34
      p.y = sourceY - Math.random() * 0.18
      p.z = MOUTH.z + (Math.random() - 0.5) * 0.34
      p.vx = (Math.random() - 0.5) * 0.5
      p.vz = (Math.random() - 0.5) * 0.5
      p.vy = -(0.6 + Math.random() * 1.2)
      p.life = p.max = 0.5 + Math.random() * 0.6
      p.size = 0.055 + Math.random() * 0.11
      p.alpha = 0.7 + Math.random() * 0.3
      p.gravity = -4.5
      p.drag = 0.06
      colorParticle(p, warmParticleColor, 0.08 + Math.random() * 0.22)
    }
  }

  function spawnCoreStream(count, heightSpread = 0.28) {
    for (let index = 0; index < count; index++) {
      const p = allocate()
      if (!p) return
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() * 0.34
      p.x = MOUTH.x + Math.cos(angle) * radius
      p.y = MOUTH.y + Math.random() * heightSpread
      p.z = MOUTH.z + Math.sin(angle) * radius * 0.72
      p.vx = Math.cos(angle) * (Math.random() - 0.2) * 0.35
      p.vz = Math.sin(angle) * (Math.random() - 0.2) * 0.28
      p.vy = 4.8 + Math.random() * 5.4
      p.life = p.max = 0.38 + Math.random() * 0.58
      p.size = 0.045 + Math.random() * 0.095
      p.alpha = 0.75 + Math.random() * 0.25
      p.gravity = -0.2
      p.drag = 0.08
      colorParticle(p, rarityParticleColor, 0.7 + Math.random() * 0.28)
    }
  }

  function spawnSpiralMotes(count, heightSpread = 0.34) {
    for (let index = 0; index < count; index++) {
      const p = allocate()
      if (!p) return
      p.kind = 1
      p.angle = Math.random() * Math.PI * 2
      p.radius = 0.45 + Math.random() * 1.55
      p.radialVelocity = -0.08 + Math.random() * 0.18
      p.spin = (Math.random() < 0.5 ? -1 : 1) * (1.9 + Math.random() * 2.8)
      p.depthScale = 0.62 + Math.random() * 0.22
      p.x = MOUTH.x + Math.cos(p.angle) * p.radius
      p.y = MOUTH.y + 0.08 + Math.random() * heightSpread
      p.z = MOUTH.z + Math.sin(p.angle) * p.radius * p.depthScale
      p.vy = 1.4 + Math.random() * 2.7
      p.life = p.max = 1.15 + Math.random() * 1.45
      p.size = 0.06 + Math.random() * 0.13
      p.alpha = 0.58 + Math.random() * 0.4
      p.gravity = -0.08
      colorParticle(p, rarityParticleColor, 0.08 + Math.random() * 0.28)
    }
  }

  function burstShockwave(count) {
    for (let index = 0; index < count; index++) {
      const p = allocate()
      if (!p) return
      const angle = (index / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.035
      const speed = 4.8 + Math.random() * 5.8
      const radius = 0.18 + Math.random() * 0.2
      p.x = MOUTH.x + Math.cos(angle) * radius
      p.y = MOUTH.y + 0.06 + Math.random() * 0.14
      p.z = MOUTH.z + Math.sin(angle) * radius
      p.vx = Math.cos(angle) * speed
      p.vz = Math.sin(angle) * speed
      p.vy = 0.35 + Math.random() * 1.8
      p.life = p.max = 0.38 + Math.random() * 0.38
      p.size = 0.065 + Math.random() * 0.12
      p.alpha = 0.9 + Math.random() * 0.1
      p.gravity = -3.2
      p.drag = 0.42
      colorParticle(p, rarityParticleColor, 0.38 + Math.random() * 0.5)
    }
  }

  function updateParticles(dt) {
    pool.forEach((p, index) => {
      if (!p.on) {
        alphas[index] = 0
        sizes[index] = 0
        return
      }
      p.life -= dt
      if (p.life <= 0 || (p.vy < 0 && p.y < MOUTH.y - 0.12)) {
        p.on = false
        alphas[index] = 0
        sizes[index] = 0
        return
      }
      p.vy += p.gravity * dt
      if (p.kind === 1) {
        p.angle += p.spin * dt
        p.radius = Math.max(0.05, p.radius + p.radialVelocity * dt)
        p.y += p.vy * dt
        p.x = MOUTH.x + Math.cos(p.angle) * p.radius
        p.z = MOUTH.z + Math.sin(p.angle) * p.radius * p.depthScale
      } else {
        const drag = Math.exp(-p.drag * dt)
        p.vx *= drag
        p.vz *= drag
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.z += p.vz * dt
      }
      const ratio = p.life / p.max
      const offset = index * 3
      positions[offset] = p.x
      positions[offset + 1] = p.y
      positions[offset + 2] = p.z
      colors[offset] = p.r
      colors[offset + 1] = p.g
      colors[offset + 2] = p.b
      alphas[index] = p.alpha * Math.pow(ratio, 0.8)
      sizes[index] = p.size * (0.5 + ratio * 0.5)
    })
    particleGeometry.attributes.position.needsUpdate = true
    particleGeometry.attributes.aColor.needsUpdate = true
    particleGeometry.attributes.aAlpha.needsUpdate = true
    particleGeometry.attributes.aSize.needsUpdate = true
  }

  let raf = 0
  let running = false
  let phase = 'idle'
  let phaseTime = 0
  let elapsed = 0
  let callbacks = {}
  let openRequested = false
  let press = 0
  let shake = 0
  let flash = 0
  let tremble = 0
  let moteAccumulator = 0
  let fallAccumulator = 0
  let coreAccumulator = 0
  let spiralAccumulator = 0
  const fired = {}
  const clock = new THREE.Clock()
  const nozzlePosition = new THREE.Vector3()

  function setRarity(color) {
    const rarity = new THREE.Color(color)
    const forgeOrange = new THREE.Color(DEFAULT_GLOW)
    const warm = forgeOrange.clone().lerp(rarity, 0.12)
    const accent = forgeOrange.clone().lerp(rarity, 0.24)
    modelMaterials.hot.emissive.copy(warm)
    modelMaterials.glow.emissive.copy(warm)
    modelMaterials.nozzle.emissive.copy(warm)
    mouthLight.color.copy(warm)
    columnLight.color.copy(accent)
    mouthGlowMaterial.color.copy(warm)
    outerColumnMaterial.color.copy(accent)
    auraColumnMaterial.color.copy(warm)
    coreColumnMaterial.color.copy(warm).lerp(new THREE.Color(0xffffff), 0.72)
    ringMaterial.color.copy(accent)
    groundGlowMaterial.color.copy(warm)
    nozzleGlowMaterial.color.copy(warm)
    modelMaterials.beam.color.copy(accent).lerp(new THREE.Color(0xffffff), 0.12)
    modelMaterials.beamAura.color.copy(warm)
    modelMaterials.beamRibbon.color.copy(warm).lerp(new THREE.Color(0xffffff), 0.34)
    modelMaterials.beamRing.color.copy(accent).lerp(new THREE.Color(0xffffff), 0.16)
    modelMaterials.beamShock.color.copy(warm)
    modelMaterials.beamCore.color.copy(warm).lerp(new THREE.Color(0xffffff), 0.68)
    rarityParticleColor.copy(accent)
    warmParticleColor.copy(warm)
  }

  function sampleFrame(frame) {
    if (!modelMixer || !modelAction) return
    modelAction.enabled = true
    modelAction.paused = false
    modelAction.play()
    modelMixer.setTime(frame / FPS)
  }

  function upperOffsetForPose() {
    if (phase === 'closing') {
      return lerp(
        UPPER_OPEN_OFFSET,
        UPPER_CLOSED_OFFSET,
        smooth(0, CLOSE.land, phaseTime),
      )
    }
    if (phase === 'closed') return UPPER_CLOSED_OFFSET
    if (phase === 'opening') {
      return lerp(
        UPPER_CLOSED_OFFSET,
        UPPER_OPEN_OFFSET,
        smooth(0, OPEN.spinStart, phaseTime),
      )
    }
    return UPPER_OPEN_OFFSET
  }

  function applyPose() {
    let frame = FRAME.idle
    if (phase === 'closing') {
      frame = lerp(FRAME.closeStart, FRAME.closed, clamp01(phaseTime / CLOSE.done))
    } else if (phase === 'closed') {
      frame = FRAME.closed
    } else if (phase === 'opening') {
      frame = phaseTime <= OPEN.spinStart
        ? lerp(FRAME.closed, FRAME.mechanicalOpen, clamp01(phaseTime / OPEN.spinStart))
        : lerp(
            FRAME.mechanicalOpen,
            FRAME.open,
            clamp01((phaseTime - OPEN.spinStart) / (OPEN.done - OPEN.spinStart)),
          )
    } else if (phase === 'done') {
      frame = FRAME.open
    }
    if (modelReady) {
      if (modelUpper) modelUpper.position.y -= modelUpperAppliedOffset
      sampleFrame(frame)
      if (modelUpper) {
        modelUpperAppliedOffset = upperOffsetForPose() + Math.sin(elapsed * 20) * tremble
        modelUpper.position.y += modelUpperAppliedOffset
      }
    } else if (loadFailed) {
      fallbackUpper.position.y = 0.42 - 0.92 * press
        + upperOffsetForPose()
        + Math.sin(elapsed * 20) * tremble
    }
    modelRoot.updateMatrixWorld(true)
  }

  function updateModelBeam(intensity) {
    const visible = phase === 'opening' && intensity > 0.002
    if (modelBeam) modelBeam.visible = visible
    if (modelBeamCore) modelBeamCore.visible = visible
    if (!visible) {
      modelMaterials.beam.opacity = 0
      modelMaterials.beamAura.opacity = 0
      modelMaterials.beamRibbon.opacity = 0
      modelMaterials.beamRing.opacity = 0
      modelMaterials.beamShock.opacity = 0
      modelMaterials.beamCore.opacity = 0
      return
    }
    const outerPulse = 0.86 + Math.sin(elapsed * 13.5) * 0.14
    const corePulse = 0.94 + Math.sin(elapsed * 21 + 0.8) * 0.06
    if (modelBeam) {
      const radialPulse = 0.96 + outerPulse * 0.06
      modelBeam.scale.x = modelBeamBaseScale.x * radialPulse
      modelBeam.scale.z = modelBeamBaseScale.y * radialPulse
    }
    if (modelBeamCore) {
      const coreScale = 0.98 + corePulse * 0.03
      modelBeamCore.scale.x = modelBeamCoreBaseScale.x * coreScale
      modelBeamCore.scale.z = modelBeamCoreBaseScale.y * coreScale
    }
    modelMaterials.beam.opacity = Math.min(0.3, intensity * 0.3 * outerPulse)
    modelMaterials.beamAura.opacity = Math.min(0.11, intensity * 0.11)
    modelMaterials.beamRibbon.opacity = Math.min(0.4, intensity * 0.4 * corePulse)
    modelMaterials.beamRing.opacity = Math.min(0.38, intensity * 0.38 * outerPulse)
    modelMaterials.beamShock.opacity = Math.min(0.2, intensity * 0.2)
    modelMaterials.beamCore.opacity = Math.min(0.82, intensity * 0.82 * corePulse)
  }

  function nozzleY() {
    if (!nozzleAnchor) return 3.18
    nozzleAnchor.getWorldPosition(nozzlePosition)
    return nozzlePosition.y
  }

  function syncColumnHeight() {
    const top = Math.max(MOUTH.y + 0.3, nozzleY())
    const height = top - MOUTH.y
    outerColumn.position.y = height * 0.5
    outerColumn.scale.y = height / 6.8
    coreColumn.position.y = height * 0.5
    coreColumn.scale.y = height / 6.8
    auraColumn.position.y = height * 0.5
    auraColumn.scale.y = height / 7.3
    nozzleGlow.position.set(MOUTH.x, top, MOUTH.z)
    return height
  }

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  function pickFurnace(event) {
    if (!modelReady && !loadFailed) return false
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    return raycaster.intersectObjects(pickRoots, true).length > 0
  }

  function beginOpening() {
    if (phase !== 'closed') return false
    openRequested = false
    phase = 'opening'
    phaseTime = 0
    canvas.style.cursor = 'default'
    Object.keys(fired).forEach((key) => delete fired[key])
    callbacks.onOpen?.()
    ensureLoop()
    return true
  }

  function onPointerDown(event) {
    if (phase !== 'closed' || !running || !pickFurnace(event)) return
    beginOpening()
  }

  function onPointerMove(event) {
    if (phase !== 'closed' || !running) {
      canvas.style.cursor = 'default'
      return
    }
    canvas.style.cursor = pickFurnace(event) ? 'pointer' : 'default'
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)

  function updateIdle(dt) {
    press = 0
    tremble = 0
    const breath = 0.5 + Math.sin(elapsed * 1.5) * 0.5
    mouthLight.intensity = 2.1 + breath * 0.65
    modelMaterials.hot.emissiveIntensity = 3.8 + breath * 0.8
    modelMaterials.glow.emissiveIntensity = 2 + breath * 0.4
    modelMaterials.nozzle.emissiveIntensity = 3.2 + breath * 0.7
    mouthGlowMaterial.opacity = 0.22 + breath * 0.05
    mouthGlow.scale.setScalar(1)
    groundGlowMaterial.opacity = 0.14 + breath * 0.04
    syncColumnHeight()
    columnGroup.visible = true
    outerColumn.scale.x = outerColumn.scale.z = 0.1 + breath * 0.015
    auraColumn.scale.x = auraColumn.scale.z = 0.14 + breath * 0.02
    coreColumn.scale.x = coreColumn.scale.z = 0.92 + breath * 0.08
    outerColumnMaterial.opacity = 0.022 + breath * 0.008
    auraColumnMaterial.opacity = 0.008 + breath * 0.004
    coreColumnMaterial.opacity = 0.17 + breath * 0.06
    ringMaterial.opacity = 0
    nozzleGlow.scale.setScalar(0.58 + breath * 0.06)
    nozzleGlowMaterial.opacity = 0.09 + breath * 0.035
    columnLight.intensity = 0.35 + breath * 0.18
    moteAccumulator += 2.4 * dt
    fallAccumulator += 3.5 * dt
    while (moteAccumulator >= 1) {
      moteAccumulator -= 1
      burstMotes(1, 0.7)
    }
    while (fallAccumulator >= 1) {
      fallAccumulator -= 1
      spawnFall(1, nozzleY())
    }
  }

  function updateClosing() {
    press = clamp01(phaseTime / CLOSE.done)
    tremble = 0
    const dim = smooth(0.35, CLOSE.land, phaseTime)
    mouthLight.intensity = lerp(2.4, 0.35, dim)
    modelMaterials.hot.emissiveIntensity = lerp(4.2, 0.65, dim)
    modelMaterials.glow.emissiveIntensity = lerp(2.4, 0.55, dim)
    modelMaterials.nozzle.emissiveIntensity = lerp(3.5, 0.55, dim)
    mouthGlowMaterial.opacity = lerp(0.25, 0.055, dim)
    groundGlowMaterial.opacity = lerp(0.18, 0.07, dim)
    columnGroup.visible = false
    nozzleGlowMaterial.opacity = 0
    columnLight.intensity = 0
    if (!fired.land && phaseTime >= CLOSE.land) {
      fired.land = true
      shake = 0.28
      flash = 0.22
      burstSparks(76, true)
      callbacks.onClose?.()
    }
    if (phaseTime >= CLOSE.done) {
      phase = 'closed'
      phaseTime = 0
      callbacks.onClosed?.()
      if (openRequested) beginOpening()
    }
  }

  function updateClosed() {
    press = 1
    tremble = 0
    shake = 0
    const pulse = 0.5 + Math.sin(elapsed * 2.4) * 0.5
    mouthLight.intensity = 0.3 + pulse * 0.55
    modelMaterials.hot.emissiveIntensity = 0.55 + pulse * 0.75
    modelMaterials.glow.emissiveIntensity = 0.45 + pulse * 0.7
    modelMaterials.nozzle.emissiveIntensity = 0.4 + pulse * 0.6
    mouthGlow.position.y = SEAM_Y
    mouthGlow.scale.set(1.28, 0.24, 1)
    mouthGlowMaterial.opacity = 0.055 + pulse * 0.06
    groundGlowMaterial.opacity = 0.055 + pulse * 0.025
    columnGroup.visible = false
    nozzleGlowMaterial.opacity = 0
    columnLight.intensity = 0
  }

  function revealEnvelope(time) {
    const rise = smooth(OPEN.columnAt - 0.08, OPEN.glowPeak, time)
    const release = lerp(1, 0.24, smooth(OPEN.climaxAt + 0.16, OPEN.done, time))
    return rise * release
  }

  function beamEnvelope(time) {
    const rise = smooth(OPEN.columnAt - 0.34, OPEN.glowPeak - 0.08, time)
    const release = lerp(1, 0.28, smooth(OPEN.climaxAt + 0.18, OPEN.done, time))
    return rise * release
  }

  function updateOpening(dt) {
    press = 1 - clamp01(phaseTime / OPEN.spinStart)
    tremble = phaseTime < 0.22 ? 0.0014 : 0
    const opened = smooth(0, OPEN.spinStart, phaseTime)
    const leak = smooth(0, 0.22, phaseTime)
    const glow = revealEnvelope(phaseTime)
    const beam = beamEnvelope(phaseTime)
    const columnStrength = Math.max(leak * 0.12, beam)
    mouthGlow.position.y = lerp(SEAM_Y, MOUTH.y + 0.12, opened)
    const glowScale = 0.75 + glow * 0.95 + flash * 0.45
    mouthGlow.scale.set(
      lerp(1.28, glowScale, opened),
      lerp(0.24, glowScale, opened),
      1,
    )
    mouthLight.intensity = 0.55 + leak * 0.9 + glow * 12 + flash * 32
    modelMaterials.hot.emissiveIntensity = 0.75 + glow * 7.5
    modelMaterials.glow.emissiveIntensity = 0.7 + glow * 6.2
    modelMaterials.nozzle.emissiveIntensity = 0.7 + glow * 7.8
    mouthGlowMaterial.opacity = 0.08 + leak * 0.08 + glow * 0.62
    groundGlowMaterial.opacity = 0.08 + glow * 0.42
    syncColumnHeight()
    columnGroup.visible = columnStrength > 0.008
    outerColumnMaterial.opacity = 0.2 * columnStrength
      * (0.88 + Math.sin(elapsed * 10) * 0.12)
    auraColumnMaterial.opacity = 0.064 * columnStrength
      * (0.82 + Math.sin(elapsed * 5.6 + 1.4) * 0.18)
    coreColumnMaterial.opacity = (0.16 + beam * 0.68)
      * (0.92 + Math.sin(elapsed * 18) * 0.08)
    columnGroup.rotation.y += dt * (0.5 + glow * 1.4)
    const scale = lerp(0.14, 0.72, beam)
    outerColumn.scale.x = scale * (0.94 + Math.sin(elapsed * 11) * 0.06)
    outerColumn.scale.z = scale * (0.94 + Math.cos(elapsed * 9.4) * 0.06)
    auraColumn.scale.x = scale * 1.25 * (0.88 + Math.sin(elapsed * 5.2) * 0.12)
    auraColumn.scale.z = scale * 1.25 * (0.88 + Math.cos(elapsed * 4.7) * 0.12)
    coreColumn.scale.x = 0.94 + beam * 0.38 + Math.sin(elapsed * 21) * 0.04
    coreColumn.scale.z = 0.94 + beam * 0.38 + Math.cos(elapsed * 19) * 0.04
    burstRing.scale.setScalar(0.8 + glow * 2.1)
    ringMaterial.opacity = Math.max(0, 1 - Math.abs(phaseTime - OPEN.columnAt) / 0.38) * 0.72
    nozzleGlow.scale.setScalar(0.72 + glow * 1.12 + flash * 0.35)
    nozzleGlowMaterial.opacity = 0.12 + beam * 0.5 + flash * 0.2
    columnLight.intensity = glow * 14 + flash * 45

    if (!fired.rumble && phaseTime >= OPEN.spinStart) {
      fired.rumble = true
      callbacks.onRumbleStart?.()
    }

    if (!fired.column && phaseTime >= OPEN.columnAt) {
      fired.column = true
      spawnCoreStream(36, 0.9)
      spawnSpiralMotes(28, 1.4)
      burstMotes(38, 1.15)
      burstSparks(24)
      callbacks.onColumn?.()
    }
    if (phaseTime >= OPEN.columnAt) {
      fallAccumulator += (12 + glow * 48) * dt
      coreAccumulator += (34 + glow * 148) * dt
      spiralAccumulator += (11 + glow * 46) * dt
      while (fallAccumulator >= 1) {
        fallAccumulator -= 1
        spawnFall(1, nozzleY())
      }
      while (coreAccumulator >= 1) {
        coreAccumulator -= 1
        spawnCoreStream(1)
      }
      while (spiralAccumulator >= 1) {
        spiralAccumulator -= 1
        spawnSpiralMotes(1)
      }
    }
    if (!fired.climax && phaseTime >= OPEN.climaxAt) {
      fired.climax = true
      flash = 1
      shake = 0.36
      burstShockwave(180)
      burstSparks(160)
      spawnCoreStream(90, 1.4)
      spawnSpiralMotes(60, 2.4)
      burstMotes(80, 2.6)
      callbacks.onClimax?.()
    }
    if (!fired.done && phaseTime >= OPEN.done) {
      fired.done = true
      phase = 'done'
      running = false
      callbacks.onRumbleEnd?.()
      resetRevealFx()
      callbacks.onDone?.()
    }
  }

  function step(dt) {
    elapsed += dt
    shake = Math.max(0, shake - dt * 2.4)
    flash = Math.max(0, flash - dt * 2.55)
    if (phase === 'idle') updateIdle(dt)
    else if (phase === 'closing') updateClosing()
    else if (phase === 'closed') updateClosed()
    else if (phase === 'opening') updateOpening(dt)
    applyPose()
    if (phase === 'opening') {
      const glow = revealEnvelope(phaseTime)
      updateModelBeam(beamEnvelope(phaseTime))
      moteAccumulator += glow * 135 * dt
      while (moteAccumulator >= 1) {
        moteAccumulator -= 1
        burstMotes(1, 1.2)
      }
    } else {
      updateModelBeam(0)
    }
    updateParticles(dt)
    flashLight.intensity = flash * 70
    mouthGlow.quaternion.copy(camera.quaternion)
    nozzleGlow.quaternion.copy(camera.quaternion)
    updateCameraPose()
  }

  function updateCameraPose() {
    const reduceMotion = reducedMotionQuery?.matches ?? false
    const dolly = phase === 'opening' || phase === 'done'
      ? (reduceMotion ? 0 : smooth(0, OPEN.done, phaseTime))
      : 0
    const dollyDistance = CAMERA_DOLLY * dolly
    const baseDistance = cameraBase.distanceTo(cameraTarget)
    setBackgroundZoom(baseDistance / (baseDistance - dollyDistance))
    const cameraDrift = !reduceMotion && (phase === 'closing' || phase === 'opening') ? 1 : 0
    const cameraShake = reduceMotion ? 0 : shake
    const continuousRumble = !reduceMotion && phase === 'opening'
      ? smooth(OPEN.spinStart, OPEN.spinStart + 0.45, phaseTime) * 0.045
      : 0
    cameraDollyDirection.subVectors(cameraTarget, cameraBase).normalize()
    camera.position.copy(cameraBase).addScaledVector(cameraDollyDirection, dollyDistance)
    camera.position.x += Math.sin(elapsed * 0.3) * 0.08 * cameraDrift
      + Math.sin(elapsed * 52) * continuousRumble
      + (Math.random() - 0.5) * cameraShake
    camera.position.y += Math.sin(elapsed * 0.48) * 0.05 * cameraDrift
      + Math.sin(elapsed * 47 + 0.8) * continuousRumble * 0.72
      + (Math.random() - 0.5) * cameraShake
    camera.position.z += (Math.random() - 0.5) * cameraShake * 0.4
    camera.lookAt(cameraTarget)
  }

  function tick() {
    const requestedScale = typeof window !== 'undefined'
      ? window.__FURNACE_TIMESCALE
      : undefined
    const timeScale = requestedScale == null ? 1 : requestedScale
    const dt = Math.min(clock.getDelta(), 0.05) * timeScale
    phaseTime += dt
    step(dt)
    renderer.render(scene, camera)
    if (running) raf = requestAnimationFrame(tick)
  }

  function ensureLoop() {
    if (running) return
    running = true
    clock.getDelta()
    raf = requestAnimationFrame(tick)
  }

  function resize() {
    const width = canvas.clientWidth || 1
    const height = canvas.clientHeight || 1
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    cameraBase.z = camera.aspect < 0.72
      ? lerp(23.2, 21, clamp01((camera.aspect - 0.42) / 0.3))
      : 21
    pointScale.value = (height * renderer.getPixelRatio())
      / (2 * Math.tan((FOV * Math.PI) / 360))
    updateCameraPose()
    renderer.render(scene, camera)
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)
  resize()

  function attachModel(gltf) {
    if (disposed) {
      disposeObjectResources(gltf.scene)
      return false
    }
    const sourceMaterials = new Set()
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return
      importedGeometries.add(object.geometry)
      const list = Array.isArray(object.material) ? object.material : [object.material]
      list.filter(Boolean).forEach((material) => sourceMaterials.add(material))
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => materialFor(material, object.name))
        : materialFor(object.material, object.name)
      const emissive = object.name.includes('Glow')
        || object.name.includes('LightSlit')
        || object.name.includes('Emitter')
        || object.name.startsWith('Energy_Beam')
      object.castShadow = !emissive
      object.receiveShadow = !emissive
      if (object.name === 'Plaque_Logo') object.renderOrder = 4
    })
    sourceMaterials.forEach(disposeMaterial)
    modelBeam = gltf.scene.getObjectByName('Energy_Beam')
    modelBeamCore = gltf.scene.getObjectByName('Energy_Beam_Core')
    if (modelBeam) {
      modelBeam.visible = false
      modelBeam.renderOrder = 9
    }
    if (modelBeamCore) {
      modelBeamCore.visible = false
      modelBeamCore.renderOrder = 9
    }

    const base = gltf.scene.getObjectByName('Base_Root')
    const docking = gltf.scene.getObjectByName('CTRL_Furnace_Docking')
    modelUpper = gltf.scene.getObjectByName('Furnace_Root')
    modelUpperAppliedOffset = 0
    nozzleAnchor = gltf.scene.getObjectByName('Nozzle_InnerGlow')
    const fxAnchor = gltf.scene.getObjectByName('FX_Mouth')
    if (!base || !docking || !modelUpper) {
      throw new Error('GLB is missing the required forge hierarchy')
    }

    modelRoot.add(gltf.scene)
    modelMixer = new THREE.AnimationMixer(gltf.scene)
    if (gltf.animations[0]) {
      modelAction = modelMixer.clipAction(gltf.animations[0])
      modelAction.setLoop(THREE.LoopOnce, 1)
      modelAction.clampWhenFinished = true
      modelAction.play()
    }
    fallbackRoot.visible = false
    pickRoots = [base, docking]
    modelReady = true
    sampleFrame(FRAME.idle)
    if (modelBeam) modelBeamBaseScale.set(modelBeam.scale.x, modelBeam.scale.z)
    if (modelBeamCore) modelBeamCoreBaseScale.set(modelBeamCore.scale.x, modelBeamCore.scale.z)
    modelRoot.updateMatrixWorld(true)
    if (fxAnchor) {
      fxAnchor.getWorldPosition(MOUTH)
      positionEffects()
    }
    applyPose()
    renderer.render(scene, camera)
    return true
  }

  function useFallback(error) {
    if (disposed) return false
    console.warn('Unable to load the Blender furnace model; using fallback.', error)
    loadFailed = true
    fallbackRoot.visible = true
    pickRoots = [fallbackBase, fallbackUpper]
    applyPose()
    renderer.render(scene, camera)
    return false
  }

  const modelUrl = import.meta.env.BASE_URL + 'models/cs2-forge.glb'
  const ready = new GLTFLoader().loadAsync(modelUrl).then(attachModel).catch(useFallback)

  function resetRevealFx() {
    moteAccumulator = 0
    fallAccumulator = 0
    coreAccumulator = 0
    spiralAccumulator = 0
    particleCursor = 0
    pool.forEach((particle) => {
      particle.on = false
    })
    positions.fill(0)
    colors.fill(0)
    alphas.fill(0)
    sizes.fill(0)
    particleGeometry.attributes.position.needsUpdate = true
    particleGeometry.attributes.aColor.needsUpdate = true
    particleGeometry.attributes.aAlpha.needsUpdate = true
    particleGeometry.attributes.aSize.needsUpdate = true
    columnGroup.visible = false
    columnGroup.rotation.set(0, 0, 0)
    outerColumn.scale.set(1, 1, 1)
    coreColumn.scale.set(1, 1, 1)
    auraColumn.scale.set(1, 1, 1)
    burstRing.scale.setScalar(1)
    outerColumnMaterial.opacity = 0
    coreColumnMaterial.opacity = 0
    auraColumnMaterial.opacity = 0
    ringMaterial.opacity = 0
    nozzleGlowMaterial.opacity = 0
    columnLight.intensity = 0
    flashLight.intensity = 0
    flash = 0
    shake = 0
    updateModelBeam(0)
  }

  function showOpen() {
    openRequested = false
    phase = 'idle'
    phaseTime = 0
    press = 0
    tremble = 0
    callbacks = {}
    resetRevealFx()
    setRarity(DEFAULT_GLOW)
    Object.keys(fired).forEach((key) => delete fired[key])
    canvas.style.cursor = 'default'
    setBackgroundZoom(1)
    updateCameraPose()
    applyPose()
    ensureLoop()
  }

  function close(options = {}) {
    openRequested = false
    resetRevealFx()
    callbacks = { ...options }
    phase = 'closing'
    phaseTime = 0
    Object.keys(fired).forEach((key) => delete fired[key])
    setBackgroundZoom(1)
    updateCameraPose()
    callbacks.onCloseStart?.()
    ensureLoop()
  }

  function armReveal(options = {}) {
    callbacks = { ...callbacks, ...options }
    if (options.color) setRarity(options.color)
    if (phase !== 'closed') {
      phase = 'closed'
      phaseTime = 0
    }
    ensureLoop()
  }

  function open() {
    if (phase === 'closing') {
      openRequested = true
      return true
    }
    return beginOpening()
  }

  function stop() {
    running = false
    cancelAnimationFrame(raf)
    raf = 0
    canvas.style.cursor = 'default'
  }

  function dispose() {
    if (disposed) return
    disposed = true
    appRoot?.style.removeProperty('--forge-bg-scale')
    stop()
    resizeObserver.disconnect()
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    modelMixer?.stopAllAction()
    importedGeometries.forEach((geometry) => geometry.dispose())
    disposables.forEach((resource) => resource.dispose?.())
    environment.dispose()
    pmrem.dispose()
    renderer.renderLists.dispose()
    renderer.dispose()
  }

  return {
    ready,
    showOpen,
    close,
    armReveal,
    open,
    setRarity,
    stop,
    resize,
    dispose,
  }
}
