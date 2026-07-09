// 程序化合成锻造音效并输出为 16-bit PCM WAV。
// 不依赖任何第三方库，运行： node scripts/gen-anvil-sound.mjs
// 产物：
//   public/sfx/anvil-strike.wav  铁锤敲砧（冲击瞬态 + 低频重击 + 非谐金属泛音余韵）
//   public/sfx/forge-ignite.wav  炉火升腾（低频轰鸣 whoosh + 火焰噼啪）
//   public/sfx/pen-check.wav     签字笔打勾（笔尖划纸沙沙 + 收尾顿笔）
//   public/sfx/paper-rustle.wav  合同纸张（落定/抽离的翻动摩擦声）
//   public/sfx/stamp-impact.wav  印章落下（低频木质冲击 + 墨垫压扁瞬态）
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

// ---------- 签字笔打勾 ----------
// 两笔利落勾画：短撇 + 转角微停 + 长挑；以带通摩擦噪声为主，避免正弦「电子音」。
function makePenCheck() {
  const dur = 0.5
  const N = Math.floor(SR * dur)
  const out = new Float32Array(N)

  // 一笔划纸：带通沙沙声 + 笔尖颗粒调制，attack 极快、release 干脆
  function stroke(t0, len, press) {
    const s0 = Math.floor(t0 * SR)
    const s1 = Math.min(N, Math.floor((t0 + len) * SR))
    let lp = 0
    let hp = 0
    let prev = 0
    for (let i = s0; i < s1; i++) {
      const u = (i - s0) / Math.max(1, s1 - s0)
      const sec = i / SR
      // 快起快收，中间饱满——更像真实划纸而非拖泥带水
      const env = u < 0.06 ? u / 0.06 : u > 0.88 ? (1 - u) / 0.12 : 1
      const grain = 0.62 + 0.38 * Math.sin(2 * Math.PI * 95 * sec) * (0.35 + 0.65 * Math.random())
      const white = Math.random() * 2 - 1
      // 高通去直流 + 低通压暗刺耳高频 → 2–5 kHz 沙沙摩擦带
      hp = white - prev
      prev = white
      lp += 0.22 * (hp - lp)
      const scratch = lp * 2.8 * grain
      // 极轻纸纤维碎响（随机脉冲，非周期音）
      const fiber = Math.random() < 0.09 ? (Math.random() * 2 - 1) * 0.35 : 0
      out[i] += (scratch + fiber) * env * press
    }
  }

  // 第一笔：短促下行小撇
  stroke(0.012, 0.085, 0.62)
  // 转角微停后第二笔：主挑，更快更重
  stroke(0.118, 0.24, 1.0)

  // 收笔：摩擦骤停 + 极短纸面回弹（噪声脉冲，非正弦）
  const liftAt = Math.floor(0.355 * SR)
  let liftLp = 0
  for (let i = liftAt; i < Math.min(N, liftAt + Math.floor(0.04 * SR)); i++) {
    const t = (i - liftAt) / SR
    const white = Math.random() * 2 - 1
    liftLp += 0.35 * (white - liftLp)
    out[i] += 0.42 * liftLp * Math.exp(-t / 0.011)
  }

  for (let i = 0; i < N; i++) out[i] = softClip(out[i], 1.05)
  normalize(out, 0.8)
  fadeEdges(out, 2, 55)
  return out
}

// ---------- 合同纸张 ----------
// 纸张翻动/抽离：宽带摩擦噪声，经缓慢起落的包络与若干随机「哗啦」小爆点，
// 整体偏干、短促，模拟一张纸被展开又抽走的窸窣声。
function makePaperRustle() {
  const dur = 0.9
  const N = Math.floor(SR * dur)
  const out = new Float32Array(N)

  // 底层持续摩擦噪声：带通白噪声，包络两头轻中间略强
  let hp = 0
  let prev = 0
  for (let i = 0; i < N; i++) {
    const u = i / N
    const env = Math.sin(Math.PI * u) * 0.6
    const white = Math.random() * 2 - 1
    hp = white - prev
    prev = white
    out[i] += hp * env * 0.5
  }

  // 随机「哗啦」小爆点：纸面折痕受力的瞬间摩擦
  const bursts = 14
  for (let b = 0; b < bursts; b++) {
    const start = Math.random() * (dur - 0.08)
    const amp = 0.12 + Math.random() * 0.22
    const dec = 0.01 + Math.random() * 0.035
    const s0 = Math.floor(start * SR)
    const end = Math.min(N, s0 + Math.floor(dec * 5 * SR))
    let lp = 0
    for (let i = s0; i < end; i++) {
      const t = (i - s0) / SR
      const white = Math.random() * 2 - 1
      lp += 0.4 * (white - lp)
      out[i] += amp * lp * Math.exp(-t / dec)
    }
  }

  for (let i = 0; i < N; i++) out[i] = softClip(out[i], 1.0)
  normalize(out, 0.6)
  fadeEdges(out, 20, 90)
  return out
}

// ---------- 印章落下 ----------
// 盖章「咚」的一瞬：短促的低频木质冲击 + 轻微的墨垫压扁噪声，
// 干脆利落、极快衰减，用于在印章落定的那一刻触发。
function makeStampImpact() {
  const dur = 0.45
  const N = Math.floor(SR * dur)
  const out = new Float32Array(N)

  // 低频木质「咚」：起始有轻微音高下滑，快速衰减
  const f0 = 118
  const dec = 0.09
  for (let i = 0; i < N; i++) {
    const t = i / SR
    const drop = 1 + 0.5 * Math.exp(-t / 0.012)
    out[i] += 0.95 * Math.exp(-t / dec) * Math.sin(2 * Math.PI * f0 * drop * t)
  }

  // 接触瞬态：极短的宽带噪声，模拟墨垫/纸面被压扁的「噗」
  let lp = 0
  const trDec = 0.012
  const trEnd = Math.floor(0.05 * SR)
  for (let i = 0; i < trEnd; i++) {
    const t = i / SR
    const white = Math.random() * 2 - 1
    lp += 0.25 * (white - lp) // 压暗，避免发尖
    out[i] += 0.5 * lp * Math.exp(-t / trDec)
  }

  // 一点中频「实心感」，让冲击不空洞
  const dec2 = 0.05
  for (let i = 0; i < N; i++) {
    const t = i / SR
    out[i] += 0.3 * Math.exp(-t / dec2) * Math.sin(2 * Math.PI * 240 * t)
  }

  for (let i = 0; i < N; i++) out[i] = softClip(out[i], 1.1)
  normalize(out, 0.88)
  fadeEdges(out, 0, 50)
  return out
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(resolve(OUT_DIR, 'anvil-strike.wav'), encodeWav(makeAnvilStrike()))
writeFileSync(resolve(OUT_DIR, 'forge-ignite.wav'), encodeWav(makeForgeIgnite()))
writeFileSync(resolve(OUT_DIR, 'pen-check.wav'), encodeWav(makePenCheck()))
writeFileSync(resolve(OUT_DIR, 'paper-rustle.wav'), encodeWav(makePaperRustle()))
writeFileSync(resolve(OUT_DIR, 'stamp-impact.wav'), encodeWav(makeStampImpact()))
console.log('生成完成 →', OUT_DIR)
