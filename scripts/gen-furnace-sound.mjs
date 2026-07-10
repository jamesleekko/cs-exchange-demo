// 程序化合成熔炉开合音效并输出为 16-bit PCM WAV。
// 不依赖任何第三方库，运行： node scripts/gen-furnace-sound.mjs
// 产物：
//   public/sfx/furnace-close.wav 熔炉闭合（液压下沉 + 伺服嗡鸣 + 1.5s 处重金属撞击 + 锁爪扣紧）
//   public/sfx/furnace-beam.wav  熔炉开启（锁爪弹开 + 泄压嘶声 + 光柱升腾扫频 + 1.62s 处爆发轰鸣）
// 时间点须与 src/three/furnace.js 的 CLOSE.contact / BURST.peak 对齐。
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

function fadeEdges(out, headMs = 0, tailMs = 60) {
  const N = out.length
  const head = Math.floor((SR * headMs) / 1000)
  const tail = Math.floor((SR * tailMs) / 1000)
  for (let i = 0; i < head; i++) out[i] *= i / head
  for (let i = 0; i < tail; i++) out[N - 1 - i] *= i / tail
}

// 金属锁扣「哐」：短瞬态 + 非谐金属分音快衰减
function addClank(out, at, amp = 1, bright = 1) {
  const s0 = Math.floor(at * SR)
  let prev = 0
  const trEnd = Math.min(out.length, s0 + Math.floor(0.025 * SR))
  for (let i = s0; i < trEnd; i++) {
    const t = (i - s0) / SR
    const white = Math.random() * 2 - 1
    const hp = white - prev
    prev = white
    out[i] += amp * 0.8 * hp * Math.exp(-t / 0.003)
  }
  for (const [f, dec, a] of [
    [880 * bright, 0.09, 0.5],
    [1620 * bright, 0.055, 0.34],
    [2470 * bright, 0.035, 0.22],
    [452 * bright, 0.13, 0.3],
  ]) {
    const end = Math.min(out.length, s0 + Math.floor(dec * 6 * SR))
    for (let i = s0; i < end; i++) {
      const t = (i - s0) / SR
      out[i] += amp * a * Math.exp(-t / dec) * Math.sin(2 * Math.PI * f * t)
    }
  }
}

// ---------- 熔炉闭合 ----------
// 0–1.5s 液压下沉（伺服嗡鸣音高缓降 + 气压嘶声），1.5s 重撞击，随后锁爪双扣
function makeFurnaceClose() {
  const dur = 2.6
  const N = Math.floor(SR * dur)
  const out = new Float32Array(N)
  const CONTACT = 1.5 // 与 furnace.js CLOSE.contact 对齐

  // 1) 伺服电机嗡鸣：低频锯齿感（基频 110→62Hz 缓降）+ 齿轮颗粒调制
  {
    const s0 = Math.floor(0.06 * SR)
    const s1 = Math.floor(CONTACT * SR)
    let phase = 0
    for (let i = s0; i < s1; i++) {
      const u = (i - s0) / (s1 - s0)
      const t = i / SR
      const f = 110 - 48 * u
      phase += (2 * Math.PI * f) / SR
      const env = Math.sin(Math.PI * Math.min(1, u * 1.12)) * 0.5
      // 锯齿近似：基波 + 衰减谐波
      let s = 0
      for (let h = 1; h <= 5; h++) s += Math.sin(phase * h) / h
      const grind = 0.75 + 0.25 * Math.sin(2 * Math.PI * (26 - 9 * u) * t)
      out[i] += s * 0.34 * env * grind
    }
  }

  // 2) 液压气压嘶声：带通噪声，随下沉略变闷
  {
    let lp = 0
    let prev = 0
    const s0 = Math.floor(0.1 * SR)
    const s1 = Math.floor(CONTACT * SR)
    for (let i = s0; i < s1; i++) {
      const u = (i - s0) / (s1 - s0)
      const white = Math.random() * 2 - 1
      const hp = white - prev
      prev = white
      lp += (0.24 - 0.13 * u) * (hp - lp)
      out[i] += lp * 1.5 * Math.sin(Math.PI * Math.min(1, u * 1.1)) * 0.5
    }
  }

  // 3) 重撞击：低频「哐咚」（音高下滑）+ 接触噪声 + 金属壳体余振
  {
    const s0 = Math.floor(CONTACT * SR)
    const f0 = 68
    for (let i = s0; i < N; i++) {
      const t = (i - s0) / SR
      const drop = 1 + 0.7 * Math.exp(-t / 0.012)
      out[i] += 1.25 * Math.exp(-t / 0.13) * Math.sin(2 * Math.PI * f0 * drop * t)
      out[i] += 0.4 * Math.exp(-t / 0.3) * Math.sin(2 * Math.PI * 46 * t)
    }
    let lp2 = 0
    const trEnd = Math.min(N, s0 + Math.floor(0.05 * SR))
    for (let i = s0; i < trEnd; i++) {
      const t = (i - s0) / SR
      const white = Math.random() * 2 - 1
      lp2 += 0.32 * (white - lp2)
      out[i] += 0.7 * lp2 * Math.exp(-t / 0.012)
    }
    // 壳体金属余振
    for (const [f, dec, a] of [
      [318, 0.22, 0.2],
      [507, 0.15, 0.14],
      [742, 0.1, 0.1],
    ]) {
      const end = Math.min(N, s0 + Math.floor(dec * 6 * SR))
      for (let i = s0; i < end; i++) {
        const t = (i - s0) / SR
        out[i] += a * Math.exp(-t / dec) * Math.sin(2 * Math.PI * f * t)
      }
    }
  }

  // 4) 锁爪扣紧：两声金属锁扣 + 收尾短泄压
  addClank(out, 1.66, 0.5, 1.0)
  addClank(out, 1.8, 0.38, 1.25)
  {
    let lp = 0
    let prev = 0
    const s0 = Math.floor(1.9 * SR)
    const s1 = Math.floor(2.35 * SR)
    for (let i = s0; i < s1; i++) {
      const u = (i - s0) / (s1 - s0)
      const white = Math.random() * 2 - 1
      const hp = white - prev
      prev = white
      lp += 0.3 * (hp - lp)
      out[i] += lp * 1.1 * Math.sin(Math.PI * u) * 0.3
    }
  }

  for (let i = 0; i < N; i++) out[i] = softClip(out[i], 1.1)
  normalize(out, 0.9)
  fadeEdges(out, 4, 90)
  return out
}

// ---------- 熔炉开启 + 光柱爆发 ----------
// 0s 锁爪弹开与泄压 → 0.45–1.6s 光柱升腾（扫频泛音群 + 噪声涌动）→
// 1.62s 爆发轰鸣（高潮，外部在此弹结果）→ 余晖衰减
function makeFurnaceBeam() {
  const dur = 3.4
  const N = Math.floor(SR * dur)
  const out = new Float32Array(N)
  const PEAK = 1.62 // 与 furnace.js BURST.peak 对齐

  // 1) 锁爪弹开 ×2 + 泄压嘶声
  addClank(out, 0.02, 0.9, 1.1)
  addClank(out, 0.14, 0.7, 0.9)
  {
    let lp = 0
    let prev = 0
    const s0 = Math.floor(0.08 * SR)
    const s1 = Math.floor(0.5 * SR)
    for (let i = s0; i < s1; i++) {
      const u = (i - s0) / (s1 - s0)
      const white = Math.random() * 2 - 1
      const hp = white - prev
      prev = white
      lp += 0.28 * (hp - lp)
      out[i] += lp * 1.6 * Math.sin(Math.PI * Math.min(1, u * 1.2)) * 0.5
    }
  }

  // 2) 光柱升腾：扫频泛音群（指数爬升）+ 低频能量涌动，到 PEAK 达满
  {
    const s0 = Math.floor(0.45 * SR)
    const s1 = Math.floor(PEAK * SR)
    const tones = [
      [130, 420, 0.3],
      [260, 840, 0.24],
      [520, 1680, 0.18],
      [1040, 3350, 0.12],
      [1560, 5040, 0.07],
    ]
    for (let i = s0; i < s1; i++) {
      const u = (i - s0) / (s1 - s0)
      const t = i / SR
      const env = Math.pow(u, 1.6)
      let s = 0
      for (const [fa, fb, a] of tones) {
        const f = fa * Math.pow(fb / fa, u)
        const shimmer = 0.7 + 0.3 * Math.sin(2 * Math.PI * (6 + a * 30) * t + fa)
        s += a * Math.sin(2 * Math.PI * f * t) * shimmer
      }
      out[i] += s * env * 0.75
    }
    // 噪声涌动铺底
    let brown = 0
    let lp = 0
    for (let i = s0; i < s1; i++) {
      const u = (i - s0) / (s1 - s0)
      const white = Math.random() * 2 - 1
      brown = (brown + 0.02 * white) / 1.02
      lp += (0.03 + 0.1 * u) * (brown - lp)
      out[i] += lp * 7 * Math.pow(u, 1.7) * 0.9
    }
  }

  // 3) 爆发轰鸣：深沉冲击（音高骤降）+ 白噪爆裂 + 亚低频坠感 + 金属泛音
  {
    const s0 = Math.floor(PEAK * SR)
    const f0 = 74
    for (let i = s0; i < N; i++) {
      const t = (i - s0) / SR
      const drop = 1 + 1.1 * Math.exp(-t / 0.02)
      out[i] += 1.35 * Math.exp(-t / 0.2) * Math.sin(2 * Math.PI * f0 * drop * t)
      out[i] += 0.5 * Math.exp(-t / 0.55) * Math.sin(2 * Math.PI * 38 * t)
    }
    let lp2 = 0
    const trEnd = Math.min(N, s0 + Math.floor(0.14 * SR))
    for (let i = s0; i < trEnd; i++) {
      const t = (i - s0) / SR
      const white = Math.random() * 2 - 1
      lp2 += 0.5 * (white - lp2)
      out[i] += 0.9 * lp2 * Math.exp(-t / 0.045)
    }
    for (const [f, dec, a] of [
      [980, 0.3, 0.16],
      [1470, 0.22, 0.12],
      [2210, 0.16, 0.09],
    ]) {
      const end = Math.min(N, s0 + Math.floor(dec * 6 * SR))
      for (let i = s0; i < end; i++) {
        const t = (i - s0) / SR
        out[i] += a * Math.exp(-t / dec) * Math.sin(2 * Math.PI * f * t)
      }
    }
  }

  // 4) 余晖：闪烁高频「叮」颗粒 + 渐弱噪声光尘
  {
    const glints = 22
    for (let c = 0; c < glints; c++) {
      const at = PEAK + 0.15 + Math.random() * 1.3
      const f = 2600 + Math.random() * 4400
      const a = 0.03 + Math.random() * 0.05
      const dec = 0.02 + Math.random() * 0.05
      const g0 = Math.floor(at * SR)
      const end = Math.min(N, g0 + Math.floor(dec * 6 * SR))
      for (let i = g0; i < end; i++) {
        const t = (i - g0) / SR
        out[i] += a * Math.exp(-t / dec) * Math.sin(2 * Math.PI * f * t)
      }
    }
    let lp = 0
    let prev = 0
    const s0 = Math.floor((PEAK + 0.1) * SR)
    for (let i = s0; i < N; i++) {
      const u = (i - s0) / (N - s0)
      const white = Math.random() * 2 - 1
      const hp = white - prev
      prev = white
      lp += 0.12 * (hp - lp)
      out[i] += lp * 1.4 * (1 - u) * (1 - u) * 0.35
    }
  }

  for (let i = 0; i < N; i++) out[i] = softClip(out[i], 1.05)
  normalize(out, 0.9)
  fadeEdges(out, 4, 160)
  return out
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(resolve(OUT_DIR, 'furnace-close.wav'), encodeWav(makeFurnaceClose()))
writeFileSync(resolve(OUT_DIR, 'furnace-beam.wav'), encodeWav(makeFurnaceBeam()))
console.log('生成完成 →', OUT_DIR)
