import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'

import { TransparentUnrealBloomPass } from './transparent-bloom.js'

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
  thinDone: 3.16,
  chargePeak: 5.8,
  climaxAt: 6.88,
  done: 7.4,
}
const PRE_CLIMAX_LEAD_SECONDS = 1
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

const FURNACE_SURFACES = {
  aged: {
    texture: 'furnace-aged-metal',
    repeat: 2.5,
    dark: { color: 0x8d98a6, metalness: 0.9, roughness: 0.72, bumpScale: 0.018 },
    steel: { color: 0xc2ccd6, metalness: 0.96, roughness: 0.58, bumpScale: 0.013 },
    panel: { color: 0xa4aeba, metalness: 0.88, roughness: 0.78, bumpScale: 0.021 },
    plaque: { color: 0x7b8592, metalness: 0.86, roughness: 0.72, bumpScale: 0.018 },
  },
  blued: {
    texture: 'furnace-heat-blued',
    repeat: 2,
    dark: { color: 0x8790a4, metalness: 0.94, roughness: 0.62, bumpScale: 0.014 },
    steel: { color: 0xc3c9d6, metalness: 0.98, roughness: 0.46, bumpScale: 0.009 },
    panel: { color: 0xa3acbe, metalness: 0.92, roughness: 0.68, bumpScale: 0.017 },
    plaque: { color: 0x747f93, metalness: 0.9, roughness: 0.64, bumpScale: 0.014 },
  },
  olive: {
    texture: 'furnace-olive-paint',
    repeat: 2.8,
    dark: { color: 0x8b907c, metalness: 0.22, roughness: 0.9, bumpScale: 0.023 },
    steel: { color: 0xc0c4ad, metalness: 0.32, roughness: 0.8, bumpScale: 0.017 },
    panel: { color: 0xa7ac95, metalness: 0.12, roughness: 0.96, bumpScale: 0.029 },
    plaque: { color: 0x545b49, metalness: 0.25, roughness: 0.9, bumpScale: 0.023 },
  },
  ceramic: {
    texture: 'furnace-white-ceramic',
    repeat: 2.2,
    dark: { color: 0x687072, metalness: 0.16, roughness: 0.88, bumpScale: 0.03 },
    steel: { color: 0xd9d8d0, metalness: 0.06, roughness: 0.7, bumpScale: 0.021 },
    panel: { color: 0xbfc1bb, metalness: 0.04, roughness: 0.86, bumpScale: 0.036 },
    plaque: { color: 0x394147, metalness: 0.5, roughness: 0.76, bumpScale: 0.022 },
  },
}

const clamp01 = (value) => Math.min(1, Math.max(0, value))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (a, b, value) => {
  const t = clamp01((value - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const smoother = (a, b, value) => {
  const t = clamp01((value - a) / (b - a))
  return t * t * t * (t * (t * 6 - 15) + 10)
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

function makeEnergyNoiseTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')
  const image = context.createImageData(size, size)
  const scales = [4, 8, 16, 32]

  const hash = (x, y, seed) => {
    let value = Math.imul(x + seed, 374761393) + Math.imul(y - seed, 668265263)
    value = Math.imul(value ^ (value >>> 13), 1274126177)
    return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff
  }
  const periodicNoise = (x, y, cellSize, seed) => {
    const period = size / cellSize
    const gridX = Math.floor(x / cellSize)
    const gridY = Math.floor(y / cellSize)
    const tx = (x % cellSize) / cellSize
    const ty = (y % cellSize) / cellSize
    const sx = tx * tx * (3 - 2 * tx)
    const sy = ty * ty * (3 - 2 * ty)
    const wrap = (value) => (value + period) % period
    const a = hash(wrap(gridX), wrap(gridY), seed)
    const b = hash(wrap(gridX + 1), wrap(gridY), seed)
    const c = hash(wrap(gridX), wrap(gridY + 1), seed)
    const d = hash(wrap(gridX + 1), wrap(gridY + 1), seed)
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sy)
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4
      scales.forEach((scale, channel) => {
        image.data[offset + channel] = Math.round(
          periodicNoise(x, y, scale, 19 + channel * 37) * 255,
        )
      })
    }
  }
  context.putImageData(image, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.NoColorSpace
  return texture
}

const ENERGY_COLUMN_VERTEX = `
  uniform float uTime;
  uniform float uFlow;
  uniform float uFrequency;
  uniform float uDistortion;

  varying vec2 vUv;
  varying float vFacing;

  void main() {
    vUv = uv;
    vec3 transformed = position;
    float ripple = sin(position.y * uFrequency + uTime * uFlow * 5.0);
    ripple += sin(position.y * uFrequency * 2.17 - uTime * uFlow * 7.0) * 0.42;
    transformed.xz *= 1.0 + ripple * uDistortion * (0.35 + uv.y * 0.65);

    vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
    vec3 viewNormal = normalize(normalMatrix * normal);
    vFacing = abs(dot(viewNormal, normalize(-viewPosition.xyz)));
    gl_Position = projectionMatrix * viewPosition;
  }
`

const ENERGY_COLUMN_FRAGMENT = `
  uniform sampler2D uNoise;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uFlow;
  uniform float uFrequency;
  uniform float uOpacity;
  uniform float uReveal;
  uniform float uCharge;
  uniform float uBrightness;
  uniform float uNoiseAmount;

  varying vec2 vUv;
  varying float vFacing;

  void main() {
    vec2 flowUv = vec2(
      vUv.x * uFrequency,
      vUv.y * uFrequency * 0.72 - uTime * uFlow
    );
    float coarse = texture2D(uNoise, flowUv).g;
    float detail = texture2D(
      uNoise,
      flowUv * vec2(1.73, 2.11) + vec2(0.31, uTime * uFlow * 0.37)
    ).r;
    float turbulence = clamp(coarse * 0.72 + detail * 0.42, 0.0, 1.0);
    float revealFeather = mix(0.16, 0.035, smoothstep(0.0, 0.72, uReveal));
    float revealMask = 1.0 - smoothstep(
      uReveal,
      min(1.12, uReveal + revealFeather),
      vUv.y
    );
    float endFade = 0.84 + smoothstep(0.0, 0.16, vUv.y) * 0.16;
    float facing = 0.34 + pow(max(vFacing, 0.0), 0.42) * 0.66;
    float noiseMask = mix(1.0, smoothstep(0.12, 0.82, turbulence), uNoiseAmount);
    float pulse = 0.92 + sin(uTime * (9.0 + uCharge * 16.0) + vUv.y * 24.0) * 0.08;
    float alpha = uOpacity * revealMask * endFade * facing * noiseMask;
    vec3 hotColor = mix(uColor, vec3(1.0), clamp(uCharge * 0.28, 0.0, 0.72));
    float energy = uBrightness * (0.84 + turbulence * 0.34 + uCharge * 0.52);
    gl_FragColor = vec4(hotColor * energy * pulse, alpha);
  }
`

function makeEnergyColumnMaterial(noiseTexture, options) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uNoise: { value: noiseTexture },
      uColor: { value: new THREE.Color(options.color) },
      uTime: { value: 0 },
      uFlow: { value: options.flow },
      uFrequency: { value: options.frequency },
      uDistortion: { value: options.distortion },
      uOpacity: { value: 0 },
      uReveal: { value: 0 },
      uCharge: { value: 0 },
      uBrightness: { value: options.brightness },
      uNoiseAmount: { value: options.noiseAmount },
    },
    vertexShader: ENERGY_COLUMN_VERTEX,
    fragmentShader: ENERGY_COLUMN_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}

function updateEnergyColumnMaterial(material, state) {
  const { uniforms } = material
  uniforms.uTime.value = state.time
  uniforms.uOpacity.value = state.opacity
  uniforms.uReveal.value = state.reveal
  uniforms.uCharge.value = state.charge
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

function loadMetalTexture(path, fallback, { colorSpace, repeat = 2.5 } = {}) {
  const texture = fallback
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeat, repeat)
  if (colorSpace) texture.colorSpace = colorSpace
  new THREE.TextureLoader().load(
    path,
    (loaded) => {
      texture.image = loaded.image
      texture.needsUpdate = true
      loaded.dispose()
    },
  )
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
  const requestedSurface = new URLSearchParams(window.location.search)
    .get('furnaceStyle')
  const surfaceName = Object.hasOwn(FURNACE_SURFACES, requestedSurface)
    ? requestedSurface
    : 'blued'
  const surface = FURNACE_SURFACES[surfaceName]
  if (appRoot) appRoot.dataset.furnaceStyle = surfaceName

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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6))
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.16
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const supportsBloom = renderer.capabilities.isWebGL2
    && renderer.extensions.has('EXT_color_buffer_float')
    && !reducedMotionQuery?.matches
  let compactRendering = window.innerWidth <= 900
  const renderPass = supportsBloom
    ? new RenderPass(scene, camera, null, 0x000000, 0)
    : null
  const bloomPass = supportsBloom
    ? new TransparentUnrealBloomPass(new THREE.Vector2(1, 1), 0.34, 0.48, 0.72)
    : null
  const outputPass = supportsBloom ? new OutputPass() : null
  const composer = supportsBloom ? new EffectComposer(renderer) : null
  if (composer) {
    composer.addPass(renderPass)
    composer.addPass(bloomPass)
    composer.addPass(outputPass)
  }

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

  const textureRoot = `${import.meta.env.BASE_URL}textures/`
  const metalTexture = track(loadMetalTexture(
    `${textureRoot}${surface.texture}-albedo.webp`,
    makeMetalTexture(0x5f3759df),
    { colorSpace: THREE.SRGBColorSpace, repeat: surface.repeat },
  ))
  const metalRoughness = track(loadMetalTexture(
    `${textureRoot}${surface.texture}-roughness.webp`,
    makeMetalTexture(0x7f4a7c15, true),
    { repeat: surface.repeat },
  ))
  const metalBump = track(loadMetalTexture(
    `${textureRoot}${surface.texture}-bump.webp`,
    makeMetalTexture(0x9e3779b9, true),
    { repeat: surface.repeat },
  ))
  metalTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  metalRoughness.anisotropy = metalTexture.anisotropy
  metalBump.anisotropy = metalTexture.anisotropy

  const makeSurfaceMaterial = (name) => {
    const config = surface[name]
    return new THREE.MeshStandardMaterial({
      color: config.color,
      map: metalTexture,
      roughnessMap: metalRoughness,
      bumpMap: metalBump,
      bumpScale: config.bumpScale,
      metalness: config.metalness,
      roughness: config.roughness,
    })
  }

  const modelMaterials = {
    dark: track(makeSurfaceMaterial('dark')),
    steel: track(makeSurfaceMaterial('steel')),
    panel: track(makeSurfaceMaterial('panel')),
    plaque: track(makeSurfaceMaterial('plaque')),
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
    if (objectName === 'Front_Plaque') return modelMaterials.plaque
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

  const energyNoiseTexture = track(makeEnergyNoiseTexture())
  const outerColumnMaterial = track(makeEnergyColumnMaterial(energyNoiseTexture, {
    color: 0xffcf28,
    flow: 0.82,
    frequency: 2.1,
    distortion: 0.075,
    brightness: 2.1,
    noiseAmount: 0.48,
  }))
  const coreColumnMaterial = track(makeEnergyColumnMaterial(energyNoiseTexture, {
    color: 0xfff4dc,
    flow: 1.68,
    frequency: 2.8,
    distortion: 0.028,
    brightness: 4.2,
    noiseAmount: 0.14,
  }))
  const auraColumnMaterial = track(makeEnergyColumnMaterial(energyNoiseTexture, {
    color: 0xff9f48,
    flow: 0.36,
    frequency: 1.45,
    distortion: 0.11,
    brightness: 1.15,
    noiseAmount: 0.72,
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
    track(new THREE.CylinderGeometry(0.035, 0.07, 6.8, 20, 1, true)),
    coreColumnMaterial,
  )
  coreColumn.position.y = 3.4
  const auraColumn = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.72, 1.58, 7.3, 40, 1, true)),
    auraColumnMaterial,
  )
  auraColumn.position.y = 3.65
  auraColumn.renderOrder = 6
  outerColumn.renderOrder = 7
  coreColumn.renderOrder = 8
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
  Object.values(particleGeometry.attributes).forEach((attribute) => {
    attribute.setUsage(THREE.DynamicDrawUsage)
  })
  const pointScale = { value: 600 }
  const gl = renderer.getContext()
  const pointSizeRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)
  const maxPointSize = { value: Math.min(256, pointSizeRange[1]) }
  const rarityParticleColor = new THREE.Color(0xffcf28)
  const warmParticleColor = new THREE.Color(DEFAULT_GLOW)
  const particleMaterial = track(new THREE.ShaderMaterial({
    uniforms: {
      uScale: pointScale,
      uMaxPointSize: maxPointSize,
    },
    vertexShader: `
      uniform float uScale;
      uniform float uMaxPointSize;
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3 aColor;
      varying float vAlpha;
      varying vec3 vColor;

      void main() {
        vAlpha = aAlpha;
        vColor = aColor;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        float depth = max(-viewPosition.z, 0.001);
        gl_PointSize = clamp(aSize * uScale / depth, 1.0, uMaxPointSize);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      varying vec3 vColor;

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float distanceToCenter = length(uv);
        if (distanceToCenter > 0.5) discard;
        float core = smoothstep(0.23, 0.0, distanceToCenter);
        float soft = pow(smoothstep(0.5, 0.0, distanceToCenter), 1.42);
        vec3 hotColor = mix(vColor * 1.35, vec3(1.0) * 3.2, core * 0.72);
        gl_FragColor = vec4(hotColor, vAlpha * soft);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
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
    fadeIn: 0.04,
    baseY: 0,
    bob: 0,
    bobSpeed: 0,
    orbitPhase: 0,
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
    p.fadeIn = 0.04
    p.baseY = 0
    p.bob = 0
    p.bobSpeed = 0
    p.orbitPhase = 0
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

  function spawnOrbitMotes(count, charge = 0, structured = false) {
    const columnHeight = Math.max(0.8, nozzleY() - MOUTH.y)
    for (let index = 0; index < count; index++) {
      const p = allocate()
      if (!p) return
      const ring = structured ? index % 2 : Math.random() < 0.48 ? 0 : 1
      const ringCount = Math.max(1, Math.ceil(count / 2))
      const angle = structured
        ? (Math.floor(index / 2) / ringCount) * Math.PI * 2
        : Math.random() * Math.PI * 2
      p.kind = 2
      p.angle = angle + (Math.random() - 0.5) * 0.1
      p.radius = (ring === 0 ? 0.72 : 1.24) + (Math.random() - 0.5) * 0.16
      p.radialVelocity = -0.015 - charge * (0.07 + Math.random() * 0.09)
      p.spin = (ring === 0 ? 1 : -1) * (1.25 + Math.random() * 0.48)
      p.depthScale = 1
      p.baseY = MOUTH.y + columnHeight * (ring === 0 ? 0.3 : 0.68)
        + (Math.random() - 0.5) * 0.12
      p.bob = 0.035 + Math.random() * 0.055
      p.bobSpeed = 1.7 + Math.random() * 1.2
      p.orbitPhase = Math.random() * Math.PI * 2
      p.x = MOUTH.x + Math.cos(p.angle) * p.radius
      p.y = p.baseY
      p.z = MOUTH.z + Math.sin(p.angle) * p.radius * p.depthScale
      p.life = p.max = 1.45 + Math.random() * 1.15
      p.size = 0.065 + Math.random() * 0.115
      p.alpha = 0.54 + Math.random() * 0.38
      p.fadeIn = 0.16 + Math.random() * 0.08
      colorParticle(p, rarityParticleColor, 0.18 + Math.random() * 0.34)
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
      if (p.kind === 2) {
        p.angle += p.spin * dt * (0.72 + particleCharge * 1.45)
        p.radius = Math.max(0.22, p.radius + p.radialVelocity * dt)
        p.y = p.baseY + Math.sin(
          p.angle * p.bobSpeed + p.orbitPhase + elapsed * 1.8,
        ) * p.bob
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
      const age = p.max - p.life
      const fadeIn = smooth(0, p.fadeIn, age)
      const fadeOut = smooth(0, Math.min(0.36, p.max * 0.45), p.life)
      const offset = index * 3
      positions[offset] = p.x
      positions[offset + 1] = p.y
      positions[offset + 2] = p.z
      colors[offset] = p.r
      colors[offset + 1] = p.g
      colors[offset + 2] = p.b
      alphas[index] = p.alpha * fadeIn * fadeOut * Math.pow(ratio, 0.36)
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
  let orbitAccumulator = 0
  let particleCharge = 0
  const fired = {}
  const clock = new THREE.Clock()
  const nozzlePosition = new THREE.Vector3()
  let fxStage = ''

  function setFxStage(nextStage) {
    if (fxStage === nextStage) return
    fxStage = nextStage
    canvas.dataset.fxStage = nextStage
  }

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
    outerColumnMaterial.uniforms.uColor.value.copy(accent)
    auraColumnMaterial.uniforms.uColor.value.copy(warm)
    coreColumnMaterial.uniforms.uColor.value
      .copy(warm)
      .lerp(new THREE.Color(0xffffff), 0.72)
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
    modelMaterials.beam.opacity = Math.min(0.14, intensity * 0.14 * outerPulse)
    modelMaterials.beamAura.opacity = Math.min(0.045, intensity * 0.045)
    modelMaterials.beamRibbon.opacity = Math.min(0.24, intensity * 0.24 * corePulse)
    modelMaterials.beamRing.opacity = Math.min(0.22, intensity * 0.22 * outerPulse)
    modelMaterials.beamShock.opacity = Math.min(0.1, intensity * 0.1)
    modelMaterials.beamCore.opacity = Math.min(0.32, intensity * 0.32 * corePulse)
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
    setFxStage('mechanical')
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
    particleCharge = 0
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
    columnGroup.scale.y = 1
    outerColumn.scale.x = outerColumn.scale.z = 0.1 + breath * 0.015
    auraColumn.scale.x = auraColumn.scale.z = 0.14 + breath * 0.02
    coreColumn.scale.x = coreColumn.scale.z = 0.92 + breath * 0.08
    updateEnergyColumnMaterial(outerColumnMaterial, {
      time: elapsed,
      opacity: 0.008 + breath * 0.003,
      reveal: 1,
      charge: 0.02,
    })
    updateEnergyColumnMaterial(auraColumnMaterial, {
      time: elapsed,
      opacity: 0.0025 + breath * 0.0015,
      reveal: 1,
      charge: 0.02,
    })
    updateEnergyColumnMaterial(coreColumnMaterial, {
      time: elapsed,
      opacity: 0.042 + breath * 0.012,
      reveal: 1,
      charge: 0.03,
    })
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
    particleCharge = 0
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
      setFxStage('closed')
      callbacks.onClosed?.()
      if (openRequested) beginOpening()
    }
  }

  function updateClosed() {
    press = 1
    tremble = 0
    shake = 0
    particleCharge = 0
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

  const appearEnvelope = (time) => smoother(OPEN.columnAt, OPEN.thinDone, time)
  const chargeEnvelope = (time) => smoother(OPEN.thinDone, OPEN.chargePeak, time)
  const tensionEnvelope = (time) => {
    const tension = smoother(OPEN.chargePeak, OPEN.climaxAt, time)
    return tension * tension * tension
  }
  const whiteoutEnvelope = (time) => smoother(OPEN.climaxAt, OPEN.done, time)

  function revealEnvelope(time) {
    const appear = appearEnvelope(time)
    const charge = chargeEnvelope(time)
    const tension = tensionEnvelope(time)
    return appear * (0.14 + charge * 0.68 + tension * 0.18)
  }

  function beamEnvelope(time) {
    const appear = appearEnvelope(time)
    const charge = chargeEnvelope(time)
    return appear * smooth(0.08, 0.68, charge) * (0.12 + charge * 0.38)
  }

  function openingStage(time) {
    if (time < OPEN.columnAt) return 'mechanical'
    if (time < OPEN.thinDone) return 'thin'
    if (time < OPEN.chargePeak) return 'charge'
    if (time < OPEN.climaxAt) return 'surge'
    if (time < OPEN.done) return 'whiteout'
    return 'done'
  }

  function updateOpening(dt) {
    press = 1 - clamp01(phaseTime / OPEN.spinStart)
    tremble = phaseTime < 0.22 ? 0.0014 : 0
    const opened = smooth(0, OPEN.spinStart, phaseTime)
    const leak = smooth(0, 0.22, phaseTime)
    const appear = appearEnvelope(phaseTime)
    const charge = chargeEnvelope(phaseTime)
    const tension = tensionEnvelope(phaseTime)
    const whiteout = whiteoutEnvelope(phaseTime)
    const glow = revealEnvelope(phaseTime)
    const beam = beamEnvelope(phaseTime)
    particleCharge = charge * 0.72 + tension * 0.68
    setFxStage(openingStage(phaseTime))

    if (!fired.rumble && phaseTime >= OPEN.spinStart) {
      fired.rumble = true
      callbacks.onRumbleStart?.()
    }

    if (!fired.column && phaseTime >= OPEN.columnAt) {
      fired.column = true
      spawnCoreStream(12, 0.5)
      burstMotes(8, 0.72)
      burstSparks(6)
      callbacks.onColumn?.()
    }

    if (!fired.orbit && phaseTime >= OPEN.thinDone) {
      fired.orbit = true
      spawnOrbitMotes(56, 0.08, true)
    }

    if (
      !fired.preClimax
      && phaseTime >= OPEN.climaxAt - PRE_CLIMAX_LEAD_SECONDS
    ) {
      fired.preClimax = true
      callbacks.onPreClimax?.()
    }

    if (!fired.climax && phaseTime >= OPEN.climaxAt) {
      fired.climax = true
      flash = 1
      shake = 0.36
      burstShockwave(180)
      burstSparks(160)
      spawnCoreStream(90, 1.4)
      spawnOrbitMotes(72, 1, true)
      burstMotes(80, 2.6)
      callbacks.onClimax?.()
    }

    const energy = charge + tension * 0.9 + flash * 1.45
    const pulseSpeed = 11 + tension * 24
    const pulse = Math.sin(elapsed * pulseSpeed)
    mouthGlow.position.y = lerp(SEAM_Y, MOUTH.y + 0.12, opened)
    const glowScale = 0.72 + glow * 1.08 + tension * 0.34 + flash * 0.52
    mouthGlow.scale.set(
      lerp(1.28, glowScale, opened),
      lerp(0.24, glowScale, opened),
      1,
    )
    mouthLight.intensity = 0.55 + leak * 0.9 + glow * 15 + tension * 8 + flash * 38
    modelMaterials.hot.emissiveIntensity = 0.75 + glow * 8.5 + tension * 3.2
    modelMaterials.glow.emissiveIntensity = 0.7 + glow * 7.1 + tension * 2.4
    modelMaterials.nozzle.emissiveIntensity = 0.7 + glow * 8.8 + tension * 3.6
    mouthGlowMaterial.opacity = 0.08 + leak * 0.08 + glow * 0.66 + flash * 0.12
    groundGlowMaterial.opacity = 0.08 + glow * 0.44 + tension * 0.12
    syncColumnHeight()
    columnGroup.visible = appear > 0.002
    columnGroup.scale.y = 0.06 + appear * 0.94
    updateEnergyColumnMaterial(coreColumnMaterial, {
      time: elapsed,
      opacity: appear * (0.62 + charge * 0.1 + tension * 0.16) + flash * 0.28,
      reveal: appear,
      charge: energy,
    })
    updateEnergyColumnMaterial(outerColumnMaterial, {
      time: elapsed,
      opacity: appear * smooth(0.03, 0.62, charge)
        * (0.1 + charge * 0.14 + tension * 0.07) + flash * 0.1,
      reveal: appear,
      charge: energy,
    })
    updateEnergyColumnMaterial(auraColumnMaterial, {
      time: elapsed,
      opacity: appear * smooth(0.18, 0.82, charge)
        * (0.02 + charge * 0.04 + tension * 0.03) + flash * 0.045,
      reveal: appear,
      charge: energy,
    })
    columnGroup.rotation.y += dt * (0.42 + charge * 0.8 + tension * 1.9)
    const outerScale = Math.max(0.06, 0.1 + charge * 0.48 - tension * 0.08 + flash * 0.18)
    const auraScale = Math.max(0.08, 0.08 + charge * 0.58 - tension * 0.09 + flash * 0.22)
    const coreScale = 1.04 + charge * 0.34 + tension * 0.3 + flash * 0.5
    outerColumn.scale.x = outerScale * (1 + pulse * 0.055)
    outerColumn.scale.z = outerScale * (1 - pulse * 0.045)
    auraColumn.scale.x = auraScale * (1 + Math.sin(elapsed * 6.1) * 0.09)
    auraColumn.scale.z = auraScale * (1 + Math.cos(elapsed * 5.4) * 0.08)
    coreColumn.scale.x = coreScale * (1 + pulse * 0.025)
    coreColumn.scale.z = coreScale * (1 - pulse * 0.02)
    const ignitionRing = Math.max(
      0,
      1 - Math.abs(phaseTime - (OPEN.columnAt + 0.11)) / 0.31,
    )
    burstRing.scale.setScalar(0.7 + ignitionRing * 1.2 + flash * 2.8)
    ringMaterial.opacity = ignitionRing * 0.18 + flash * 0.74
    nozzleGlow.scale.setScalar(0.68 + glow * 1.18 + tension * 0.26 + flash * 0.42)
    nozzleGlowMaterial.opacity = 0.08 + beam * 0.48 + tension * 0.16 + flash * 0.24
    columnLight.intensity = glow * 17 + tension * 9 + flash * 52

    if (phaseTime >= OPEN.columnAt) {
      fallAccumulator += (6 + charge * 30 + tension * 20) * dt
      coreAccumulator += (12 + charge * 90 + tension * 80) * dt
      moteAccumulator += (8 + charge * 42 + tension * 65) * dt
      if (phaseTime >= OPEN.thinDone) {
        orbitAccumulator += (0.55 + charge * 0.72 + tension * 0.92) * dt
      }
      while (fallAccumulator >= 1) {
        fallAccumulator -= 1
        spawnFall(1, nozzleY())
      }
      while (coreAccumulator >= 1) {
        coreAccumulator -= 1
        spawnCoreStream(1)
      }
      while (orbitAccumulator >= 1) {
        orbitAccumulator -= 1
        spawnOrbitMotes(28, charge + tension, true)
      }
      while (moteAccumulator >= 1) {
        moteAccumulator -= 1
        burstMotes(1, 0.8 + charge * 0.6 + tension * 0.8)
      }
    }

    if (whiteout > 0.4) ringMaterial.opacity *= 1 - whiteout
    if (!fired.done && phaseTime >= OPEN.done) {
      fired.done = true
      phase = 'done'
      running = false
      setFxStage('done')
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
      updateModelBeam(beamEnvelope(phaseTime))
    } else {
      particleCharge = 0
      updateModelBeam(0)
    }
    updateParticles(dt)
    flashLight.intensity = flash * 70
    const charge = phase === 'opening' ? chargeEnvelope(phaseTime) : 0
    const tension = phase === 'opening' ? tensionEnvelope(phaseTime) : 0
    if (bloomPass) {
      const qualityScale = compactRendering ? 0.76 : 1
      bloomPass.strength = (0.28 + charge * 0.68 + tension * 0.58 + flash * 1.18)
        * qualityScale
      bloomPass.radius = 0.4 + charge * 0.08 + tension * 0.09
    }
    renderer.toneMappingExposure = 1.16 + charge * 0.08 + tension * 0.14 + flash * 0.2
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

  function renderFrame(dt = 0) {
    const useBloom = composer
      && phase === 'opening'
      && phaseTime >= OPEN.columnAt
      && phaseTime < OPEN.done
    if (useBloom) composer.render(dt)
    else renderer.render(scene, camera)
    if (window.__FURNACE_ALPHA_PROBE) {
      const read = (x, y) => {
        const pixel = new Uint8Array(4)
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
        return [...pixel]
      }
      canvas.dataset.fxAlphaProbe = JSON.stringify({
        corner: read(0, 0),
        center: read(
          Math.floor(gl.drawingBufferWidth / 2),
          Math.floor(gl.drawingBufferHeight / 2),
        ),
      })
    }
  }

  function tick() {
    const requestedScale = typeof window !== 'undefined'
      ? window.__FURNACE_TIMESCALE
      : undefined
    const timeScale = requestedScale == null ? 1 : requestedScale
    const dt = Math.min(clock.getDelta(), 0.05) * timeScale
    phaseTime += dt
    step(dt)
    renderFrame(dt)
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
    compactRendering = width <= 900
    const pixelRatio = Math.min(
      window.devicePixelRatio,
      compactRendering ? 1.25 : 1.6,
    )
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
    if (composer) {
      composer.setPixelRatio(pixelRatio)
      composer.setSize(width, height)
    }
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    cameraBase.z = camera.aspect < 0.72
      ? lerp(23.2, 21, clamp01((camera.aspect - 0.42) / 0.3))
      : 21
    pointScale.value = (height * renderer.getPixelRatio())
      / (2 * Math.tan((FOV * Math.PI) / 360))
    updateCameraPose()
    renderFrame()
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
    const frontArmGlowRings = []
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
      if (/^Arm_[LR]_.*_GlowRing$/.test(object.name)) {
        frontArmGlowRings.push(object)
      }
    })
    frontArmGlowRings.forEach((frontRing) => {
      const backRing = frontRing.clone(false)
      backRing.name = `${frontRing.name}_Back`
      backRing.position.z = -Math.abs(frontRing.position.z)
      frontRing.parent.add(backRing)
    })
    canvas.dataset.armBackGlowCount = String(frontArmGlowRings.length)
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
    renderFrame()
    return true
  }

  function useFallback(error) {
    if (disposed) return false
    console.warn('Unable to load the Blender furnace model; using fallback.', error)
    loadFailed = true
    fallbackRoot.visible = true
    pickRoots = [fallbackBase, fallbackUpper]
    applyPose()
    renderFrame()
    return false
  }

  const modelUrl = import.meta.env.BASE_URL + 'models/cs2-forge.glb'
  const ready = new GLTFLoader().loadAsync(modelUrl).then(attachModel).catch(useFallback)

  function resetRevealFx() {
    moteAccumulator = 0
    fallAccumulator = 0
    coreAccumulator = 0
    orbitAccumulator = 0
    particleCharge = 0
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
    columnGroup.scale.set(1, 1, 1)
    outerColumn.scale.set(1, 1, 1)
    coreColumn.scale.set(1, 1, 1)
    auraColumn.scale.set(1, 1, 1)
    burstRing.scale.setScalar(1)
    updateEnergyColumnMaterial(outerColumnMaterial, {
      time: elapsed,
      opacity: 0,
      reveal: 0,
      charge: 0,
    })
    updateEnergyColumnMaterial(coreColumnMaterial, {
      time: elapsed,
      opacity: 0,
      reveal: 0,
      charge: 0,
    })
    updateEnergyColumnMaterial(auraColumnMaterial, {
      time: elapsed,
      opacity: 0,
      reveal: 0,
      charge: 0,
    })
    ringMaterial.opacity = 0
    nozzleGlowMaterial.opacity = 0
    columnLight.intensity = 0
    flashLight.intensity = 0
    flash = 0
    shake = 0
    renderer.toneMappingExposure = 1.16
    if (bloomPass) bloomPass.strength = 0.28
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
    setFxStage('idle')
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
    setFxStage('closing')
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
    setFxStage('closed')
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
    canvas.removeAttribute('data-fx-stage')
    canvas.removeAttribute('data-fx-alpha-probe')
    canvas.removeAttribute('data-arm-back-glow-count')
    stop()
    resizeObserver.disconnect()
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    modelMixer?.stopAllAction()
    bloomPass?.dispose()
    outputPass?.dispose()
    composer?.dispose()
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
