// 程序化合成武器箱音效并输出为 16-bit PCM WAV。
// 不依赖任何第三方库，运行： node scripts/gen-case-sound.mjs
// 产物：
//   public/sfx/case-land.wav  武器箱落台（低频闷响 + 金属搭扣轻颤）
//   public/sfx/case-open.wav  武器箱开启（搭扣双击弹开 + 铰链掀盖 + 内部光芒升腾的闪光泛音）
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/sfx')
const SR = 44100

function encodeWav(samples, sampleRate = SR) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2)
  }
  return buf
}

const softClip = (x, drive = 1) => Math.tanh(x * drive)

function normalize(samples, peak = 0.92) {
  let max = 0
  for (const s of samples) max = Math.max(max, Math.abs(s))
  if (max < 1e-6) return
  const g = peak / max
  for (let i = 0; i < samples.length; i++) samples[i] *= g
}

function fadeEdges(out, headMs = 0, tailMs = 50) {
  const N = out.length
  const head = Math.floor((SR * headMs) / 1000)
  const tail = Math.floor((SR * tailMs) / 1000)
  for (let i = 0; i < head; i++) out[i] *= i / head
  for (let i = 0; i < tail; i++) out[N - 1 - i] *= i / tail
}

// 金属搭扣「咔哒」：极短高通噪声瞬态 + 两个非谐金属分音的快衰减
function addLatchClick(out, at, amp = 1) {
  const s0 = Math.floor(at * SR)
  let prev = 0
  const trEnd = Math.min(out.length, s0 + Math.floor(0.02 * SR))
  for (let i = s0; i < trEnd; i++) {
    const t = (i - s0) / SR
    const white = Math.random() * 2 - 1
    const hp = white - prev
    prev = white
    out[i] += amp * 0.7 * hp * Math.exp(-t / 0.0025)
  }
  for (const [f, dec, a] of [
    [2140, 0.05, 0.4],
    [3320, 0.032, 0.28],
    [1245, 0.075, 0.22],
  ]) {
    const end = Math.min(out.length, s0 + Math.floor(dec * 6 * SR))
    for (let i = s0; i < end; i++) {
      const t = (i - s0) / SR
      out[i] += amp * a * Math.exp(-t / dec) * Math.sin(2 * Math.PI * f * t)
    }
  }
}

// ---------- 武器箱落台 ----------
function makeCaseLand() {
  const dur = 0.7
  const N = Math.floor(SR * dur)
  const out = new Float32Array(N)

  // 低频闷响「咚」：箱体+台面的钝重接触，带音高下滑
  const f0 = 92
  for (let i = 0; i < N; i++) {
    const t = i / SR
    const drop = 1 + 0.6 * Math.exp(-t / 0.015)
    out[i] += 1.0 * Math.exp(-t / 0.1) * Math.sin(2 * Math.PI * f0 * drop * t)
  }
  // 中频箱体共振
  for (let i = 0; i < N; i++) {
    const t = i / SR
    out[i] += 0.32 * Math.exp(-t / 0.06) * Math.sin(2 * Math.PI * 205 * t)
  }
  // 接触瞬态噪声
  let lp = 0
  const trEnd = Math.floor(0.04 * SR)
  for (let i = 0; i < trEnd; i++) {
    const t = i / SR
    const white = Math.random() * 2 - 1
    lp += 0.3 * (white - lp)
    out[i] += 0.55 * lp * Math.exp(-t / 0.01)
  }
  // 搭扣受震轻颤（两声极轻的金属咔哒余音）
  addLatchClick(out, 0.045, 0.24)
  addLatchClick(out, 0.11, 0.14)

  for (let i = 0; i < N; i++) out[i] = softClip(out[i], 1.1)
  normalize(out, 0.9)
  fadeEdges(out, 0, 60)
  return out
}

// ---------- 武器箱开启 ----------
function makeCaseOpen() {
  const dur = 2.1
  const N = Math.floor(SR * dur)
  const out = new Float32Array(N)

  // 1) 双搭扣先后弹开：清脆金属咔哒 ×2
  addLatchClick(out, 0.02, 1.0)
  addLatchClick(out, 0.1, 0.85)

  // 2) 铰链掀盖：带通摩擦噪声缓慢上扫（0.28s–0.9s），模拟盖体转动的吱嘎/滑动
  {
    const s0 = Math.floor(0.26 * SR)
    const s1 = Math.floor(0.95 * SR)
    let lp = 0
    let prev = 0
    for (let i = s0; i < s1; i++) {
      const u = (i - s0) / (s1 - s0)
      const env = Math.sin(Math.PI * Math.min(1, u * 1.15)) * 0.5
      const white = Math.random() * 2 - 1
      const hp = white - prev
      prev = white
      // 随开盖进度提高截止频率 → 音色从闷到亮
      lp += (0.08 + 0.2 * u) * (hp - lp)
      // 铰链的周期性微颗粒
      const grain = 0.7 + 0.3 * Math.sin(2 * Math.PI * (40 + u * 30) * (i / SR))
      out[i] += lp * 2.4 * env * grain
    }
  }

  // 3) 内部光芒升腾：闪光泛音群（多个高频正弦爬升 + 闪烁调制），0.5s 起渐入
  {
    const s0 = Math.floor(0.5 * SR)
    const riseDur = 1.15
    const s1 = Math.min(N, s0 + Math.floor(riseDur * SR))
    const tones = [
      [720, 1560, 0.16],
      [1080, 2350, 0.13],
      [1620, 3520, 0.1],
      [2430, 5280, 0.07],
    ]
    for (let i = s0; i < s1; i++) {
      const u = (i - s0) / (s1 - s0)
      const t = i / SR
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.06)), 1.4)
      let s = 0
      for (const [fa, fb, a] of tones) {
        const f = fa * Math.pow(fb / fa, u) // 指数扫频，听感均匀爬升
        const shimmer = 0.65 + 0.35 * Math.sin(2 * Math.PI * (5.5 + a * 20) * t + fa)
        s += a * Math.sin(2 * Math.PI * f * t) * shimmer
      }
      out[i] += s * env
    }
    // 光尘微闪：稀疏的高频「叮」小颗粒
    const glints = 26
    for (let c = 0; c < glints; c++) {
      const at = 0.6 + Math.random() * 1.1
      const f = 2800 + Math.random() * 4200
      const a = 0.03 + Math.random() * 0.06
      const dec = 0.02 + Math.random() * 0.05
      const g0 = Math.floor(at * SR)
      const end = Math.min(N, g0 + Math.floor(dec * 6 * SR))
      for (let i = g0; i < end; i++) {
        const t = (i - g0) / SR
        out[i] += a * Math.exp(-t / dec) * Math.sin(2 * Math.PI * f * t)
      }
    }
  }

  // 4) 低频气流铺底：开盖瞬间被顶开的「呼」，给光效重量感
  {
    let brown = 0
    let lp = 0
    const s0 = Math.floor(0.3 * SR)
    const s1 = Math.floor(1.5 * SR)
    for (let i = s0; i < s1; i++) {
      const u = (i - s0) / (s1 - s0)
      const white = Math.random() * 2 - 1
      brown = (brown + 0.02 * white) / 1.02
      lp += 0.04 * (brown - lp)
      out[i] += lp * 5.5 * Math.sin(Math.PI * Math.min(1, u * 1.2)) * 0.55
    }
  }

  for (let i = 0; i < N; i++) out[i] = softClip(out[i], 1.05)
  normalize(out, 0.88)
  fadeEdges(out, 0, 140)
  return out
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(resolve(OUT_DIR, 'case-land.wav'), encodeWav(makeCaseLand()))
writeFileSync(resolve(OUT_DIR, 'case-open.wav'), encodeWav(makeCaseOpen()))
console.log('生成完成 →', OUT_DIR)
