// 程序化合成多种「签字打勾」音效变体，输出到 public/temp/ 供试听挑选。
// 不依赖任何第三方库，运行： node scripts/gen-pen-check-variants.mjs
//
// 一个「勾」= 短促下撇 + 上挑主笔（+ 可选收尾顿笔）。不同变体通过拉开
// 笔类型/力度/亮度/颗粒/湿润度/收尾等参数，做出听感差异明显的效果。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/temp')
const SR = 44100

function encodeWav(samples, sampleRate = SR) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
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

function normalize(samples, peak = 0.9) {
  let max = 0
  for (const s of samples) max = Math.max(max, Math.abs(s))
  if (max < 1e-6) return
  const g = peak / max
  for (let i = 0; i < samples.length; i++) samples[i] *= g
}

function fadeEdges(out, headMs = 4, tailMs = 60) {
  const N = out.length
  const head = Math.floor((SR * headMs) / 1000)
  const tail = Math.floor((SR * tailMs) / 1000)
  for (let i = 0; i < head; i++) out[i] *= i / head
  for (let i = 0; i < tail; i++) out[N - 1 - i] *= i / tail
}

// 参数化打勾合成器。可调参数（都有合理默认值）：
//   dur        总时长（秒）
//   strokes    每笔 [起始t, 时长, 力度]；默认两笔（下撇 + 主笔）
//   lpA/lpB    两级低通系数（越大越亮/越尖，越小越闷）
//   hp         高通差分强度 0~1（>0 增加「沙沙/毛刺」的高频摩擦感）
//   grainHz    颗粒摩擦调制频率（低=粗糙木感，高=细密纸感）
//   grainAmt   颗粒调制深度 0~1
//   bodyHz/bodyAmt  中低频「肉感」body 的频率与强度
//   scratchAmt 附加的随机撕裂噪声强度（大=粗粝的马克笔/蜡笔感）
//   tap        收尾顿笔 [幅度, 频率Hz, 衰减s]；null=无
//   drive      软削波驱动（>1 更硬更冲）
//   peak       归一化峰值
function synthPenCheck(opts = {}) {
  const {
    dur = 0.72,
    strokes = [[0.02, 0.12, 0.5], [0.2, 0.34, 1.0]],
    lpA = 0.10,
    lpB = 0.16,
    hp = 0,
    grainHz = 42,
    grainAmt = 0.45,
    bodyHz = 150,
    bodyAmt = 0.18,
    scratchAmt = 0,
    tap = [0.24, 140, 0.06],
    drive = 1.05,
    peak = 0.82,
    headMs = 4,
    tailMs = 70,
  } = opts

  const N = Math.floor(SR * dur)
  const out = new Float32Array(N)

  for (const [t0, len, press] of strokes) {
    const s0 = Math.floor(t0 * SR)
    const s1 = Math.min(N, Math.floor((t0 + len) * SR))
    let lp1 = 0
    let lp2 = 0
    let prev = 0
    for (let i = s0; i < s1; i++) {
      const u = (i - s0) / (s1 - s0) // 0→1
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 0.8)
      const tt = i / SR
      const grain = (1 - grainAmt) + grainAmt * Math.sin(2 * Math.PI * grainHz * tt) * (Math.random() * 0.7 + 0.3)
      const white = Math.random() * 2 - 1
      // 高通差分：增加高频毛刺（尖）
      const hpv = white - prev
      prev = white
      const src = white + hp * hpv * 2
      // 两级低通级联
      lp1 += lpA * (src - lp1)
      lp2 += lpB * (lp1 - lp2)
      // 中低频 body
      const body = bodyAmt * Math.sin(2 * Math.PI * bodyHz * tt) * (0.5 + 0.5 * Math.random())
      // 粗粝撕裂噪声（马克笔/蜡笔）
      const scratch = scratchAmt * (Math.random() * 2 - 1) * (0.4 + 0.6 * Math.abs(Math.sin(2 * Math.PI * grainHz * 0.5 * tt)))
      out[i] += (lp2 * 3.2 * grain + body + scratch) * env * press
    }
  }

  if (tap) {
    const [tAmp, tHz, tDec] = tap
    // 顿笔落在最后一笔的末端附近
    const last = strokes[strokes.length - 1]
    const tapAt = last[0] + last[1] * 0.92
    const ts = Math.floor(tapAt * SR)
    for (let i = ts; i < N; i++) {
      const t = (i - ts) / SR
      out[i] += tAmp * Math.exp(-t / tDec) * Math.sin(2 * Math.PI * tHz * t)
    }
  }

  for (let i = 0; i < N; i++) out[i] = softClip(out[i], drive)
  normalize(out, peak)
  fadeEdges(out, headMs, tailMs)
  return out
}

// ---------- 10 种听感差异明显的变体 ----------
const VARIANTS = {
  // 01 柔和圆珠笔：低频沙沙，闷而温暖（接近当前正式版）
  'pen-01-soft-ballpoint': {
    lpA: 0.09, lpB: 0.14, hp: 0, grainHz: 40, grainAmt: 0.45,
    bodyHz: 150, bodyAmt: 0.18, tap: [0.22, 135, 0.06], peak: 0.78,
  },
  // 02 尖锐钢笔：高频毛刺明显，划纸「沙——」带亮边
  'pen-02-sharp-fountain': {
    lpA: 0.22, lpB: 0.30, hp: 0.7, grainHz: 120, grainAmt: 0.4,
    bodyHz: 220, bodyAmt: 0.08, tap: [0.18, 190, 0.045], drive: 1.1, peak: 0.8,
  },
  // 03 粗粝马克笔：大量撕裂噪声，干涩粗重
  'pen-03-rough-marker': {
    dur: 0.8, strokes: [[0.02, 0.14, 0.6], [0.22, 0.4, 1.0]],
    lpA: 0.14, lpB: 0.2, hp: 0.15, grainHz: 55, grainAmt: 0.55,
    bodyHz: 110, bodyAmt: 0.22, scratchAmt: 0.5, tap: [0.2, 120, 0.07], peak: 0.82,
  },
  // 04 快速轻签：又快又轻，两笔紧凑、几乎无顿笔
  'pen-04-quick-flick': {
    dur: 0.5, strokes: [[0.01, 0.08, 0.45], [0.13, 0.22, 0.85]],
    lpA: 0.13, lpB: 0.18, hp: 0.25, grainHz: 90, grainAmt: 0.4,
    bodyHz: 180, bodyAmt: 0.1, tap: null, peak: 0.72, tailMs: 45,
  },
  // 05 沉稳重签：慢而用力，低频 body 厚，收尾顿笔明显
  'pen-05-firm-deliberate': {
    dur: 0.95, strokes: [[0.03, 0.18, 0.65], [0.28, 0.5, 1.0]],
    lpA: 0.08, lpB: 0.12, hp: 0.05, grainHz: 34, grainAmt: 0.5,
    bodyHz: 120, bodyAmt: 0.28, tap: [0.34, 110, 0.09], drive: 1.0, peak: 0.85,
  },
  // 06 铅笔素描：细密高频颗粒，干脆偏脆
  'pen-06-pencil-scratch': {
    dur: 0.6, strokes: [[0.02, 0.1, 0.5], [0.18, 0.3, 0.9]],
    lpA: 0.28, lpB: 0.34, hp: 0.5, grainHz: 160, grainAmt: 0.55,
    bodyHz: 260, bodyAmt: 0.06, scratchAmt: 0.2, tap: [0.14, 220, 0.04], peak: 0.76,
  },
  // 07 毛笔蘸墨：湿润、极闷，几乎无高频，body 很重
  'pen-07-wet-brush': {
    dur: 0.85, strokes: [[0.03, 0.16, 0.55], [0.26, 0.44, 1.0]],
    lpA: 0.06, lpB: 0.09, hp: 0, grainHz: 26, grainAmt: 0.35,
    bodyHz: 95, bodyAmt: 0.32, tap: [0.26, 90, 0.1], drive: 0.95, peak: 0.83,
  },
  // 08 三笔花签：三段笔画，节奏感强（花体签名感）
  'pen-08-triple-flourish': {
    dur: 0.9, strokes: [[0.02, 0.1, 0.5], [0.16, 0.14, 0.8], [0.36, 0.36, 1.0]],
    lpA: 0.16, lpB: 0.22, hp: 0.3, grainHz: 100, grainAmt: 0.45,
    bodyHz: 170, bodyAmt: 0.14, tap: [0.2, 150, 0.05], peak: 0.8,
  },
  // 09 玻璃/中性笔顿挫：颗粒粗、抖动强，带轻微「咯吱」
  'pen-09-gritty-gel': {
    dur: 0.75, strokes: [[0.02, 0.12, 0.55], [0.2, 0.36, 1.0]],
    lpA: 0.18, lpB: 0.24, hp: 0.35, grainHz: 70, grainAmt: 0.6,
    bodyHz: 140, bodyAmt: 0.16, scratchAmt: 0.35, tap: [0.24, 160, 0.055], drive: 1.15, peak: 0.82,
  },
  // 10 极简一笔：只有一道上挑主笔 + 清脆收尾，干净利落
  'pen-10-single-stroke': {
    dur: 0.55, strokes: [[0.03, 0.32, 1.0]],
    lpA: 0.15, lpB: 0.2, hp: 0.2, grainHz: 85, grainAmt: 0.42,
    bodyHz: 175, bodyAmt: 0.12, tap: [0.28, 175, 0.05], peak: 0.8, tailMs: 55,
  },
}

mkdirSync(OUT_DIR, { recursive: true })
for (const [name, opts] of Object.entries(VARIANTS)) {
  writeFileSync(resolve(OUT_DIR, `${name}.wav`), encodeWav(synthPenCheck(opts)))
}
console.log(`生成 ${Object.keys(VARIANTS).length} 种签字打勾变体 →`, OUT_DIR)

