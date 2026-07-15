// Generate the layered furnace reveal sounds as deterministic 48 kHz stereo WAV files.
// Run: node scripts/gen-furnace-reveal-sfx.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/sfx')
const SR = 48000
const TAU = Math.PI * 2

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const random = seededRandom(0x5f3759df)
const clamp01 = (value) => Math.min(1, Math.max(0, value))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (a, b, value) => {
  const t = clamp01((value - a) / (b - a))
  return t * t * (3 - 2 * t)
}

function createStereo(duration) {
  const length = Math.round(duration * SR)
  return [new Float32Array(length), new Float32Array(length)]
}

function addPanned(left, right, index, value, pan = 0) {
  const angle = (clamp01((pan + 1) * 0.5) * Math.PI) / 2
  left[index] += value * Math.cos(angle)
  right[index] += value * Math.sin(angle)
}

function addMetalTick(left, right, start, amplitude, pan = 0) {
  const startIndex = Math.floor(start * SR)
  const duration = 0.12
  const modes = [620, 1037, 1711, 2460]
  for (let index = startIndex; index < Math.min(left.length, startIndex + duration * SR); index++) {
    const t = (index - startIndex) / SR
    let sample = 0
    for (let mode = 0; mode < modes.length; mode++) {
      sample += Math.sin(TAU * modes[mode] * t) * Math.exp(-t / (0.022 + mode * 0.012))
        * (0.42 / (mode + 1))
    }
    if (t < 0.012) sample += (random() * 2 - 1) * Math.exp(-t / 0.003) * 0.34
    addPanned(left, right, index, sample * amplitude, pan)
  }
}

function finishStereo(stereo, peak, headMs = 6, tailMs = 90) {
  const [left, right] = stereo
  const head = Math.floor((headMs / 1000) * SR)
  const tail = Math.floor((tailMs / 1000) * SR)
  let meanLeft = 0
  let meanRight = 0
  for (let index = 0; index < left.length; index++) {
    meanLeft += left[index]
    meanRight += right[index]
  }
  meanLeft /= left.length
  meanRight /= right.length
  let max = 0
  for (let index = 0; index < left.length; index++) {
    left[index] -= meanLeft
    right[index] -= meanRight
    if (index < head) {
      const gain = index / Math.max(1, head)
      left[index] *= gain
      right[index] *= gain
    }
    if (index >= left.length - tail) {
      const gain = (left.length - 1 - index) / Math.max(1, tail)
      left[index] *= gain
      right[index] *= gain
    }
    left[index] = Math.tanh(left[index] * 1.08)
    right[index] = Math.tanh(right[index] * 1.08)
    max = Math.max(max, Math.abs(left[index]), Math.abs(right[index]))
  }
  const gain = max > 1e-8 ? peak / max : 1
  for (let index = 0; index < left.length; index++) {
    left[index] *= gain
    right[index] *= gain
  }
  return stereo
}

function encodeWav([left, right]) {
  const dataSize = left.length * 4
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(2, 22)
  buffer.writeUInt32LE(SR, 24)
  buffer.writeUInt32LE(SR * 4, 28)
  buffer.writeUInt16LE(4, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let index = 0; index < left.length; index++) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[index])) * 32767), 44 + index * 4)
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[index])) * 32767), 46 + index * 4)
  }
  return buffer
}

function makeFurnaceSpin() {
  const duration = 5
  const stereo = createStereo(duration)
  const [left, right] = stereo
  let motorPhase = 0
  let rotorPhase = 0
  let gearPhase = 0
  let bearingPhase = 0
  let noiseLowLeft = 0
  let noiseLowRight = 0
  let noiseMidLeft = 0
  let noiseMidRight = 0
  for (let index = 0; index < left.length; index++) {
    const t = index / SR
    const progress = t / duration
    const envelope = smooth(0, 0.18, t) * (1 - smooth(4.76, duration, t))
    const acceleration = progress ** 1.35
    const motorFrequency = lerp(42, 88, acceleration)
    const rotorFrequency = lerp(2.1, 11.2, acceleration)
    motorPhase += TAU * motorFrequency / SR
    rotorPhase += TAU * rotorFrequency / SR
    gearPhase += TAU * lerp(180, 520, acceleration) / SR
    bearingPhase += TAU * lerp(410, 930, acceleration ** 1.2) / SR
    const load = 0.72 + Math.sin(rotorPhase) * 0.18 + Math.sin(rotorPhase * 0.5) * 0.08
    const motor = Math.sin(motorPhase) * 0.62
      + Math.sin(motorPhase * 2.02) * 0.2
      + Math.sin(motorPhase * 3.97) * 0.08
    const noiseLeft = random() * 2 - 1
    const noiseRight = random() * 2 - 1
    noiseLowLeft += 0.035 * (noiseLeft - noiseLowLeft)
    noiseLowRight += 0.035 * (noiseRight - noiseLowRight)
    noiseMidLeft += 0.075 * ((noiseLeft - noiseLowLeft) - noiseMidLeft)
    noiseMidRight += 0.075 * ((noiseRight - noiseLowRight) - noiseMidRight)
    const bearing = lerp(0.045, 0.13, acceleration)
    const gear = Math.sin(gearPhase) * 0.09 * load + Math.sin(bearingPhase) * bearing
    left[index] += (motor * load * 0.29 + gear + noiseMidLeft * 0.12) * envelope
    right[index] += (motor * (0.98 - load * 0.02) * 0.29 + gear * 0.97 + noiseMidRight * 0.12) * envelope
  }
  const ticks = [0.62, 1.3, 1.9, 2.43, 2.91, 3.34, 3.73, 4.09, 4.42, 4.69]
  ticks.forEach((time, index) => addMetalTick(left, right, time, 0.13 + index * 0.004, index % 2 ? 0.35 : -0.35))
  return finishStereo(stereo, 0.28, 12, 110)
}

function makeFurnaceRumble() {
  const duration = 5
  const stereo = createStereo(duration)
  const [left, right] = stereo
  let brownLeft = 0
  let brownRight = 0
  let phaseA = 0
  let phaseB = 0
  for (let index = 0; index < left.length; index++) {
    const t = index / SR
    const envelope = smooth(0, 0.22, t) * (1 - smooth(4.7, duration, t))
    const movement = 0.82 + 0.12 * Math.sin(TAU * 0.7 * t) + 0.06 * Math.sin(TAU * 1.7 * t)
    phaseA += TAU * (38 + Math.sin(TAU * 0.18 * t) * 1.8) / SR
    phaseB += TAU * 63 / SR
    brownLeft = (brownLeft + (random() * 2 - 1) * 0.025) / 1.025
    brownRight = (brownRight + (random() * 2 - 1) * 0.025) / 1.025
    const sub = Math.sin(phaseA) * 0.42 + Math.sin(phaseB) * 0.17
    left[index] += (sub + brownLeft * 0.32) * envelope * movement
    right[index] += (sub * 0.98 + brownRight * 0.32) * envelope * movement
  }
  return finishStereo(stereo, 0.21, 18, 150)
}

function makeEnergyIgnite() {
  const duration = 0.9
  const stereo = createStereo(duration)
  const [left, right] = stereo
  let chirpPhase = 0
  let noiseLowLeft = 0
  let noiseLowRight = 0
  for (let index = 0; index < left.length; index++) {
    const t = index / SR
    const chirpProgress = clamp01(t / 0.5)
    const frequency = 90 * (18 ** chirpProgress)
    chirpPhase += TAU * frequency / SR
    const chirpEnvelope = smooth(0, 0.018, t) * Math.exp(-t / 0.42)
    const whiteLeft = random() * 2 - 1
    const whiteRight = random() * 2 - 1
    noiseLowLeft += 0.09 * (whiteLeft - noiseLowLeft)
    noiseLowRight += 0.09 * (whiteRight - noiseLowRight)
    const surge = Math.sin(chirpPhase) * chirpEnvelope * 0.54
    const airEnvelope = smooth(0.02, 0.18, t) * (1 - smooth(0.5, duration, t))
    left[index] += surge + (whiteLeft - noiseLowLeft) * airEnvelope * 0.19
    right[index] += surge * 0.98 + (whiteRight - noiseLowRight) * airEnvelope * 0.19
  }
  for (const [time, pan, amplitude] of [[0.008, -0.5, 0.32], [0.048, 0.42, 0.24], [0.105, -0.1, 0.18]]) {
    const start = Math.floor(time * SR)
    for (let index = start; index < Math.min(left.length, start + 0.055 * SR); index++) {
      const t = (index - start) / SR
      const spark = (random() * 2 - 1) * Math.exp(-t / 0.007) + Math.sin(TAU * 2300 * t) * Math.exp(-t / 0.018) * 0.3
      addPanned(left, right, index, spark * amplitude, pan)
    }
  }
  return finishStereo(stereo, 0.54, 0, 95)
}

function makeEnergyCharge() {
  const duration = 4.54
  const stereo = createStereo(duration)
  const [left, right] = stereo
  let corePhase = 0
  let shimmerPhase = 0
  let airLeft = 0
  let airRight = 0
  for (let index = 0; index < left.length; index++) {
    const t = index / SR
    const progress = t / duration
    const growth = 0.18 + smooth(0, 4.05, t) * 0.82
    const envelope = smooth(0, 0.08, t) * (1 - smooth(4.32, duration, t))
    const coreFrequency = lerp(74, 152, progress ** 1.25) + Math.sin(TAU * 0.9 * t) * 2.2
    const shimmerFrequency = lerp(310, 1120, progress ** 1.7)
    corePhase += TAU * coreFrequency / SR
    shimmerPhase += TAU * shimmerFrequency / SR
    const pulse = 0.72 + 0.18 * Math.sin(TAU * lerp(2.2, 7.5, progress) * t)
    const core = (Math.sin(corePhase) * 0.32 + Math.sin(corePhase * 2.01) * 0.11) * pulse
    const shimmer = Math.sin(shimmerPhase) * 0.075 * growth
    const whiteLeft = random() * 2 - 1
    const whiteRight = random() * 2 - 1
    airLeft += 0.055 * (whiteLeft - airLeft)
    airRight += 0.055 * (whiteRight - airRight)
    const airAmount = lerp(0.015, 0.1, progress ** 1.5)
    const pan = Math.sin(TAU * 0.32 * t) * 0.65
    addPanned(left, right, index, (core + shimmer) * envelope * growth, pan)
    left[index] += (whiteLeft - airLeft) * airAmount * envelope
    right[index] += (whiteRight - airRight) * airAmount * envelope
  }
  for (let spark = 0; spark < 180; spark++) {
    const biased = 1 - Math.sqrt(1 - random())
    const startTime = 0.18 + biased * 4.12
    const start = Math.floor(startTime * SR)
    const decay = 0.006 + random() * 0.024
    const amplitude = (0.025 + random() * 0.075) * lerp(0.45, 1, startTime / duration)
    const pan = random() * 1.8 - 0.9
    for (let index = start; index < Math.min(left.length, start + decay * 5 * SR); index++) {
      const t = (index - start) / SR
      const sample = ((random() * 2 - 1) * 0.75 + Math.sin(TAU * (1300 + random() * 2500) * t) * 0.25)
        * Math.exp(-t / decay) * amplitude
      addPanned(left, right, index, sample, pan)
    }
  }
  return finishStereo(stereo, 0.36, 18, 130)
}

function makeEnergyClimax() {
  const duration = 1.15
  const stereo = createStereo(duration)
  const [left, right] = stereo
  let impactPhase = 0
  let noiseLowLeft = 0
  let noiseLowRight = 0
  const modes = [[177, 0.36, 0.32], [413, 0.28, 0.22], [971, 0.22, 0.15], [1867, 0.16, 0.1]]
  for (let index = 0; index < left.length; index++) {
    const t = index / SR
    const impactFrequency = lerp(86, 42, smooth(0, 0.24, t))
    impactPhase += TAU * impactFrequency / SR
    const sub = Math.sin(impactPhase) * Math.exp(-t / 0.24) * 0.92
    const whiteLeft = random() * 2 - 1
    const whiteRight = random() * 2 - 1
    noiseLowLeft += 0.18 * (whiteLeft - noiseLowLeft)
    noiseLowRight += 0.18 * (whiteRight - noiseLowRight)
    const shockEnvelope = Math.exp(-t / 0.11)
    let metal = 0
    for (const [frequency, decay, amplitude] of modes) {
      metal += Math.sin(TAU * frequency * t) * Math.exp(-t / decay) * amplitude
    }
    left[index] += sub + (whiteLeft - noiseLowLeft) * shockEnvelope * 0.58 + metal
    right[index] += sub * 0.98 + (whiteRight - noiseLowRight) * shockEnvelope * 0.58 + metal * 1.02
  }
  for (let spark = 0; spark < 70; spark++) {
    const startTime = 0.04 + random() * 0.58
    const start = Math.floor(startTime * SR)
    const decay = 0.004 + random() * 0.015
    const pan = random() * 2 - 1
    for (let index = start; index < Math.min(left.length, start + decay * 5 * SR); index++) {
      const t = (index - start) / SR
      addPanned(left, right, index, (random() * 2 - 1) * Math.exp(-t / decay) * 0.11, pan)
    }
  }
  return finishStereo(stereo, 0.76, 0, 130)
}

function makeResultReveal() {
  const duration = 1.05
  const stereo = createStereo(duration)
  const [left, right] = stereo
  const modes = [
    [392, 0.45, 0.28],
    [617, 0.52, 0.24],
    [1031, 0.62, 0.2],
    [1693, 0.46, 0.13],
    [2579, 0.34, 0.065],
    [4211, 0.22, 0.035],
  ]
  let risePhase = 0
  for (let index = 0; index < left.length; index++) {
    const t = index / SR
    let metal = 0
    for (const [frequency, decay, amplitude] of modes) {
      metal += Math.sin(TAU * frequency * t) * Math.exp(-t / decay) * amplitude
    }
    const riseStart = Math.max(0, t - 0.08)
    const riseProgress = clamp01(riseStart / 0.58)
    risePhase += TAU * lerp(240, 860, riseProgress ** 1.4) / SR
    const riseEnvelope = smooth(0.08, 0.18, t) * (1 - smooth(0.62, 0.95, t))
    const rise = Math.sin(risePhase) * riseEnvelope * 0.16
    const shimmer = (random() * 2 - 1) * Math.exp(-Math.max(0, t - 0.18) / 0.48)
      * smooth(0.12, 0.25, t) * 0.035
    left[index] += metal + rise + shimmer
    right[index] += metal * 0.98 + rise * 1.02 - shimmer
  }
  addMetalTick(left, right, 0, 0.34, 0)
  return finishStereo(stereo, 0.5, 0, 100)
}

const sounds = {
  'furnace-spin.wav': makeFurnaceSpin(),
  'furnace-rumble.wav': makeFurnaceRumble(),
  'energy-ignite.wav': makeEnergyIgnite(),
  'energy-charge.wav': makeEnergyCharge(),
  'energy-climax.wav': makeEnergyClimax(),
  'result-reveal.wav': makeResultReveal(),
}

mkdirSync(OUT_DIR, { recursive: true })
for (const [filename, samples] of Object.entries(sounds)) {
  writeFileSync(resolve(OUT_DIR, filename), encodeWav(samples))
  console.log(`${filename}: ${(samples[0].length / SR).toFixed(2)}s`)
}
