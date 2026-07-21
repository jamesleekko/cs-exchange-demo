// Generate deterministic 16-bit PCM console UI sounds with Node.js only.
// Run: node scripts/gen-console-sfx.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/sfx')
const SR = 44100
const TAU = Math.PI * 2

function encodeWav(samples, sampleRate = SR) {
  const buffer = Buffer.alloc(44 + samples.length * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples.length * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2)
  }
  return buffer
}

function makeRng(seed) {
  let state = seed >>> 0
  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function smoothstep(value) {
  const x = Math.max(0, Math.min(1, value))
  return x * x * (3 - 2 * x)
}

function normalize(samples, peak) {
  let maximum = 0
  for (const sample of samples) maximum = Math.max(maximum, Math.abs(sample))
  if (maximum < 1e-8) return
  const gain = peak / maximum
  for (let i = 0; i < samples.length; i++) samples[i] *= gain
}

function fadeEdges(samples, headMs, tailMs) {
  const head = Math.floor(SR * headMs / 1000)
  const tail = Math.floor(SR * tailMs / 1000)
  for (let i = 0; i < head; i++) samples[i] *= smoothstep(i / head)
  for (let i = 0; i < tail; i++) samples[samples.length - 1 - i] *= smoothstep(i / tail)
}

function addSweep(samples, start, duration, fromHz, toHz, amplitude) {
  const offset = Math.floor(start * SR)
  const length = Math.floor(duration * SR)
  let phase = 0
  for (let i = 0; i < length && offset + i < samples.length; i++) {
    const progress = i / Math.max(1, length - 1)
    const curve = smoothstep(progress)
    const frequency = fromHz * (toHz / fromHz) ** curve
    const envelope = Math.sin(Math.PI * progress) ** 0.62
    phase += TAU * frequency / SR
    const magneticTone = Math.sin(phase) + 0.22 * Math.sin(phase * 2.015)
    samples[offset + i] += magneticTone * envelope * amplitude
  }
}

function addMetalModes(samples, start, modes) {
  const offset = Math.floor(start * SR)
  for (let i = offset; i < samples.length; i++) {
    const time = (i - offset) / SR
    for (const [frequency, decay, amplitude] of modes) {
      samples[i] += Math.sin(TAU * frequency * time) * Math.exp(-time / decay) * amplitude
    }
  }
}

function addClick(samples, start, duration, amplitude, rng) {
  const offset = Math.floor(start * SR)
  const length = Math.floor(duration * SR)
  let previous = 0
  for (let i = 0; i < length && offset + i < samples.length; i++) {
    const time = i / SR
    const white = rng() * 2 - 1
    const highPassed = white - previous
    previous = white
    samples[offset + i] += highPassed * Math.exp(-time / (duration * 0.2)) * amplitude
  }
}

// Rising magnetic pull, insertion snap, then a compact glassy acknowledgement.
function makeMaterialAdd() {
  const samples = new Float32Array(Math.floor(SR * 0.26))
  const rng = makeRng(0xA44D1234)
  addSweep(samples, 0.004, 0.15, 175, 760, 0.32)
  addClick(samples, 0.054, 0.028, 0.22, rng)
  addMetalModes(samples, 0.058, [
    [310, 0.045, 0.23],
    [940, 0.082, 0.25],
    [1410, 0.095, 0.17],
    [2190, 0.065, 0.09],
  ])
  for (let i = 0; i < samples.length; i++) samples[i] = Math.tanh(samples[i] * 1.15)
  normalize(samples, 0.84)
  fadeEdges(samples, 2, 24)
  return samples
}

// Release click and a falling magnetic field make removal distinct from insertion.
function makeMaterialRemove() {
  const samples = new Float32Array(Math.floor(SR * 0.22))
  const rng = makeRng(0xD1500A6E)
  addClick(samples, 0.006, 0.03, 0.2, rng)
  addMetalModes(samples, 0.008, [
    [1180, 0.048, 0.23],
    [790, 0.058, 0.2],
    [395, 0.07, 0.16],
  ])
  addSweep(samples, 0.018, 0.172, 720, 145, 0.3)
  for (let i = 0; i < samples.length; i++) samples[i] = Math.tanh(samples[i] * 1.12)
  normalize(samples, 0.78)
  fadeEdges(samples, 1, 26)
  return samples
}

// A physical lock lands first; a rising two-hit chime confirms a full load.
function makeMaterialsComplete() {
  const samples = new Float32Array(Math.floor(SR * 0.72))
  const rng = makeRng(0xC011EC7E)
  addClick(samples, 0.012, 0.055, 0.32, rng)
  addMetalModes(samples, 0.012, [
    [82, 0.13, 0.62],
    [168, 0.11, 0.38],
    [344, 0.085, 0.2],
    [875, 0.055, 0.09],
  ])
  addSweep(samples, 0.072, 0.19, 245, 680, 0.12)
  addMetalModes(samples, 0.17, [
    [660, 0.13, 0.22],
    [990, 0.14, 0.16],
    [1320, 0.11, 0.1],
  ])
  addMetalModes(samples, 0.3, [
    [784, 0.24, 0.27],
    [1176, 0.28, 0.2],
    [1568, 0.31, 0.14],
    [2352, 0.2, 0.07],
  ])
  for (let i = 0; i < samples.length; i++) samples[i] = Math.tanh(samples[i] * 1.08)
  normalize(samples, 0.88)
  fadeEdges(samples, 1, 55)
  return samples
}

const sounds = [
  ['material-add.wav', makeMaterialAdd()],
  ['material-remove.wav', makeMaterialRemove()],
  ['materials-complete.wav', makeMaterialsComplete()],
]

mkdirSync(OUT_DIR, { recursive: true })
for (const [filename, samples] of sounds) {
  writeFileSync(resolve(OUT_DIR, filename), encodeWav(samples))
  console.log(`${filename}: ${(samples.length / SR).toFixed(2)}s`)
}
