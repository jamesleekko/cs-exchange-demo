import * as THREE from 'three'

// 舞台背景：使用 three.js 渲染一层缓慢漂浮的粒子星尘，
// 与原型的黄色/紫色氛围光呼应。返回带 dispose 的句柄以便卸载时清理。
export function createStarField(canvas) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.z = 12

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const COUNT = 900
  const positions = new Float32Array(COUNT * 3)
  const colors = new Float32Array(COUNT * 3)
  const palette = [new THREE.Color('#ffcf28'), new THREE.Color('#8847ff'), new THREE.Color('#4b69ff')]

  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 30
    positions[i * 3 + 1] = (Math.random() - 0.5) * 20
    positions[i * 3 + 2] = (Math.random() - 0.5) * 20
    const c = palette[(Math.random() * palette.length) | 0]
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    size: 0.08,
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geometry, material)
  scene.add(points)

  function resize() {
    const w = canvas.clientWidth || 1
    const h = canvas.clientHeight || 1
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()

  const ro = new ResizeObserver(resize)
  ro.observe(canvas)

  let raf = 0
  const clock = new THREE.Clock()
  function tick() {
    const t = clock.getElapsedTime()
    points.rotation.y = t * 0.03
    points.rotation.x = Math.sin(t * 0.12) * 0.06
    renderer.render(scene, camera)
    raf = requestAnimationFrame(tick)
  }
  tick()

  return {
    dispose() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}
