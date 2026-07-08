// 程序化合成锻造音效并输出为 16-bit PCM WAV。
// 不依赖任何第三方库，运行： node scripts/gen-anvil-sound.mjs
// 产物：
//   public/sfx/anvil-strike.wav  铁锤敲砧（冲击瞬态 + 低频重击 + 非谐金属泛音余韵）
//   public/sfx/forge-ignite.wav  炉火升腾（低频轰鸣 whoosh + 火焰噼啪）
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

// 尾部淡出，避免末尾爆音
function fadeEdges(out, headMs = 0, tailMs = 50) {
  const N = out.length
  const head = Math.floor((SR * headMs) / 1000)
  const tail = Math.floor((SR * tailMs) / 1000)
  for (let i = 0; i < head; i++) out[i] *= i / head
  for (let i = 0; i < tail; i++) out[N - 1 - i] *= i / tail
}

// ---------- 铁锤敲砧 ----------
function makeAnvilStrike() {
  const dur = 1.75
  const N = Math.floor(SR * dur)
  const out = new Float32Array(N)

  // 铁砧的非谐模态部分音： [频率Hz, 衰减时间s, 振幅]
  // 刻意选择非整数倍关系，得到金属特有的"叮——"而非乐音
  const partials = [
    [524, 1.05, 0.55],
    [812, 0.72, 0.34],
    [1237, 1.4, 0.62], // 主铃，衰减最慢，形成清脆余韵
    [1560, 0.6, 0.26],
    [1908, 0.85, 0.4],
    [2764, 0.95, 0.34], // 次铃
    [3560, 0.42, 0.24],
    [4530, 0.3, 0.18],
    [5300, 0.24, 0.15],
    [7120, 0.16, 0.11],
  ]

  for (let i = 0; i < N; i++) {
    const t = i / SR
    let s = 0
    for (const [f, dec, amp] of partials) {
      // 极缓慢的振幅拍频，让金属余韵更"活"
      const beat = 1 + 0.06 * Math.sin(2 * Math.PI * (f * 0.0018) * t)
      s += amp * Math.exp(-t / dec) * Math.sin(2 * Math.PI * f * t) * beat
    }
    out[i] = s
  }

  // 低频重击 thud：给出"砸下去"的重量感，起始有轻微的音高下滑
  const thF = 150
  const thDec = 0.085
  for (let i = 0; i < N; i++) {
    const t = i / SR
    const drop = 1 + 0.55 * Math.exp(-t / 0.018)
    out[i] += 0.95 * Math.exp(-t / thDec) * Math.sin(2 * Math.PI * thF * drop * t)
  }

  // 冲击瞬态：宽带噪声经一阶高通差分变脆，极快衰减（金属接触的"铛"头）
  let prev = 0
  const trDec = 0.0038
  const trEnd = Math.floor(0.03 * SR)
  for (let i = 0; i < trEnd; i++) {
    const t = i / SR
    const white = Math.random() * 2 - 1
    const hp = white - prev
    prev = white
    out[i] += 0.75 * hp * Math.exp(-t / trDec)
  }

  // 回弹微触：锤头反弹后极轻的二次接触
  const t2 = 0.05
  const s2 = Math.floor(t2 * SR)
  for (const [f, dec, amp] of partials.slice(0, 5)) {
    for (let i = s2; i < N; i++) {
      const t = (i - s2) / SR
      out[i] += amp * 0.22 * Math.exp(-t / (dec * 0.5)) * Math.sin(2 * Math.PI * f * 1.012 * t)
    }
  }

  for (let i = 0; i < N; i++) out[i] = softClip(out[i], 1.1)
  normalize(out, 0.94)
  fadeEdges(out, 0, 60)
  return out
}

// ---------- 炉火升腾 ----------
function makeForgeIgnite() {
  const dur = 1.5
  const N = Math.floor(SR * dur)
  const out = new Float32Array(N)

  // 布朗噪声低通 → 低频轰鸣 whoosh，音量先升后落
  let brown = 0
  let lp = 0
  for (let i = 0; i < N; i++) {
    const t = i / SR
    const white = Math.random() * 2 - 1
    brown = (brown + 0.02 * white) / 1.02
    lp += 0.05 * (brown - lp) // 再低通一层
    const env = Math.sin(Math.min(Math.PI, (t / dur) * Math.PI)) // 0→1→0
    out[i] += lp * 7.5 * env
  }

  // 火焰噼啪：随机小爆破点
  const crackles = 70
  for (let c = 0; c < crackles; c++) {
    const start = Math.random() * (dur - 0.05)
    const amp = 0.04 + Math.random() * 0.14
    const dec = 0.005 + Math.random() * 0.02
    const s0 = Math.floor(start * SR)
    const end = Math.min(N, s0 + Math.floor(dec * 5 * SR))
    for (let i = s0; i < end; i++) {
      const t = (i - s0) / SR
      out[i] += amp * (Math.random() * 2 - 1) * Math.exp(-t / dec)
    }
  }

  for (let i = 0; i < N; i++) out[i] = softClip(out[i], 1.0)
  normalize(out, 0.82)
  fadeEdges(out, 80, 120)
  return out
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(resolve(OUT_DIR, 'anvil-strike.wav'), encodeWav(makeAnvilStrike()))
writeFileSync(resolve(OUT_DIR, 'forge-ignite.wav'), encodeWav(makeForgeIgnite()))
console.log('生成完成 →', OUT_DIR)
