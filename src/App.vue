<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
} from 'vue';

import { createStarField } from './three/starfield.js';

const mats = [
  ['AK', 'AK-47 | 红线', '#eb4b4b'],
  ['M4', 'M4A4 | 死寂空间', '#8847ff'],
  ['AWP', 'AWP | 二西莫夫', '#d32ce6'],
  ['USP', 'USP-S | 脑洞大开', '#4b69ff'],
  ['DE', '沙鹰 | 机械工业', '#4b69ff'],
  ['MAC', 'MAC-10 | 灯箱', '#8847ff'],
  ['FAMAS', '法玛斯 | 雪怪迷彩', '#d32ce6'],
  ['GLOCK', '格洛克 | 水灵', '#4b69ff'],
  ['MP7', 'MP7 | 笑一个', '#4b69ff'],
  ['SSG', 'SSG 08 | 酸蚀', '#5e98d9'],
]

const outcomes = {
  profit: {
    cls: 'profit',
    icon: 'AK',
    name: 'AK-47 | 火蛇',
    tag: '隐秘',
    color: '#eb4b4b',
    title: '出了大货',
    profit: '本次爆赚 +¥1,522',
    value: '¥1,850',
    wear: '略有磨损',
    float: '0.083421',
    particles: 96,
    edge: '#ff4747',
  },
  small: {
    cls: 'small',
    icon: 'M4A4',
    name: 'M4A4 | 皇帝',
    tag: '保密',
    color: '#8847ff',
    title: '小赚一手',
    profit: '本次小赚 +¥86',
    value: '¥414',
    wear: '久经沙场',
    float: '0.214589',
    particles: 54,
    edge: '#8847ff',
  },
  loss: {
    cls: 'loss',
    icon: 'MP7',
    name: 'MP7 | 笑一个',
    tag: '军规',
    color: '#4b69ff',
    title: '这次手感一般',
    profit: '本次未命中高价值产物 -¥241',
    value: '¥87',
    wear: '破损不堪',
    float: '0.391204',
    particles: 18,
    edge: '#475569',
  },
}

const slots = ref(Array(10).fill(null))
const current = ref('profit')
const running = ref(false)
const dragIndex = ref(null)
const overIndex = ref(null)

const showBuilder = ref(true)
const showProcess = ref(false)
const showResult = ref(false)
const phaseText = ref('CONTRACT CONFIRMED')
const craftCards = ref([])
const cardEls = []

const flashBoom = ref(false)
const edgeOn = ref(false)
const edgeColor = ref('#ffcf28')
const stageShake = ref(false)

const toastMsg = ref('')
const toastShow = ref(false)
let toastTimer = null

const stageRef = ref(null)
const bgRef = ref(null)
let starField = null

const cfg = computed(() => outcomes[current.value])
const filled = computed(() => slots.value.filter((x) => x !== null).length)
const countText = computed(() => `${filled.value}/10`)
const statusText = computed(() =>
  filled.value < 10 ? '等待添加材料' : '材料已齐，等待确认合同',
)
const canCombine = computed(() => filled.value >= 10 && !running.value)

function isUsed(m) {
  return slots.value.some((x) => x === m)
}

function setOutcome(type) {
  current.value = type
  toast(
    type === 'loss'
      ? '已切换为亏损结果演示'
      : type === 'small'
      ? '已切换为小赚/保本结果演示'
      : '已切换为大赚结果演示',
  )
}

function addMat(i) {
  if (isUsed(mats[i])) return
  const empty = slots.value.findIndex((x) => x === null)
  if (empty >= 0) slots.value[empty] = mats[i]
}

function dropMat(slot, e) {
  e.preventDefault()
  overIndex.value = null
  if (dragIndex.value === null) return
  const m = mats[dragIndex.value]
  if (slots.value[slot] || isUsed(m)) return
  slots.value[slot] = m
}

function resetMaterials() {
  const next = Array(10).fill(null)
  mats.slice(0, 5).forEach((m, i) => (next[i] = m))
  slots.value = next
  toast('已恢复到 5/10 待合成状态')
}

function autoFill() {
  slots.value = mats.slice()
  toast('已一键添加 10 件材料')
}

async function startCraft() {
  if (running.value || filled.value < 10) return
  running.value = true
  showBuilder.value = false
  showProcess.value = true
  craftCards.value = slots.value.slice()
  cardEls.length = 0
  phaseText.value = 'CONTRACT CONFIRMED'
  await nextTick()
  const cards = cardEls.filter(Boolean)

  // 卡片 DOM 会被复用，先清掉上一轮合成遗留的内联样式与类，重置回初始态
  cards.forEach((c) => {
    c.classList.remove('show', 'hot')
    c.style.transition = ''
    c.style.transform = ''
    c.style.opacity = ''
  })
  void cards[0]?.offsetWidth // 强制回流，确保重置在动画前生效

  cards.forEach((c, i) => setTimeout(() => c.classList.add('show'), i * 55))
  setTimeout(() => (phaseText.value = 'MATERIALS LOCKED'), 650)
  setTimeout(() => {
    phaseText.value = 'CONTRACT EXECUTING'
    cards.forEach((c) => c.classList.add('hot'))
    collapseCards(cards)
  }, 1450)
  setTimeout(() => explode(), 3150)
  setTimeout(() => showResultView(), 4550)
}

function collapseCards(cards) {
  const stage = stageRef.value.getBoundingClientRect()
  const cx = stage.width / 2
  const cy = stage.height * 0.47
  cards.forEach((c, i) => {
    const r = c.getBoundingClientRect()
    const x = r.left - stage.left + r.width / 2
    const y = r.top - stage.top + r.height / 2
    c.style.transition = 'all .9s cubic-bezier(.12,.86,.2,1)'
    c.style.transform = `translate(${cx - x}px,${cy - y}px) rotate(${
      (i - 4.5) * 13
    }deg) scale(.1)`
    c.style.opacity = 0.72
  })
}

function explode() {
  const c = cfg.value
  flashBoom.value = true
  edgeColor.value = c.edge
  edgeOn.value = true
  if (current.value !== 'loss') stageShake.value = true
  for (let i = 0; i < c.particles; i++) particle(c.color)
  setTimeout(() => {
    flashBoom.value = false
    stageShake.value = false
  }, 900)
}

function particle(color) {
  const stage = stageRef.value
  if (!stage) return
  const w = stage.clientWidth
  const h = stage.clientHeight
  const cx = w / 2
  const cy = h * 0.47
  const a = Math.random() * Math.PI * 2
  const d = 60 + Math.random() * 310
  const s = 2 + Math.random() * 5
  const p = document.createElement('div')
  p.className = 'particle'
  p.style.cssText = `left:${cx}px;top:${cy}px;width:${s}px;height:${s}px;background:${color};box-shadow:0 0 ${
    s * 3
  }px ${color}`
  stage.appendChild(p)
  p.animate(
    [
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      {
        transform: `translate(${Math.cos(a) * d}px,${
          Math.sin(a) * d
        }px) scale(.2)`,
        opacity: 0,
      },
    ],
    {
      duration: 900 + Math.random() * 900,
      easing: 'cubic-bezier(0,.7,.3,1)',
      fill: 'forwards',
    },
  ).onfinish = () => p.remove()
}

function showResultView() {
  showProcess.value = false
  showResult.value = true
  running.value = false
}

function resetAll() {
  showBuilder.value = true
  showProcess.value = false
  showResult.value = false
  edgeOn.value = false
  running.value = false
  resetMaterials()
}

function toast(msg) {
  toastMsg.value = msg
  toastShow.value = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastShow.value = false), 1800)
}

function setCardEl(el, i) {
  cardEls[i] = el
}

onMounted(() => {
  resetMaterials()
  if (bgRef.value) starField = createStarField(bgRef.value)
})

onBeforeUnmount(() => {
  clearTimeout(toastTimer)
  starField?.dispose()
})
</script>

<template>
  <div class="app">
    <div class="top">
      <div class="brand">元游猫 <span>汰换合同交互原型</span></div>
      <div class="top-actions">
        <button
          class="ghost"
          :class="{ active: current === 'profit' }"
          @click="setOutcome('profit')"
        >
          赚的效果
        </button>
        <button
          class="ghost"
          :class="{ active: current === 'small' }"
          @click="setOutcome('small')"
        >
          小赚/保本
        </button>
        <button
          class="ghost"
          :class="{ active: current === 'loss' }"
          @click="setOutcome('loss')"
        >
          亏的效果
        </button>
      </div>
    </div>
    <main class="layout">
      <section class="stage" :class="{ shake: stageShake }" ref="stageRef">
        <canvas class="stage-bg" ref="bgRef"></canvas>
        <div class="stage-head">
          <div>
            <div class="eyebrow">TRADE UP CONTRACT</div>
            <div class="title">汰换合同</div>
            <div class="subtitle">
              基于 CS 汰换合同的交互：待合成材料 → 5 秒打造 → 亏赚差异化结果
            </div>
          </div>
          <div class="status-pill">
            <strong>{{ countText }}</strong
            ><span>{{ statusText }}</span>
          </div>
        </div>

        <div class="builder" :class="{ hidden: !showBuilder }">
          <div class="slots">
            <div
              v-for="(m, i) in slots"
              :key="i"
              class="slot"
              :class="{ filled: m, over: overIndex === i }"
              :style="{ '--c': m ? m[2] : '#ffcf28' }"
              @dragover.prevent="overIndex = i"
              @dragleave="overIndex = null"
              @drop="dropMat(i, $event)"
            >
              <span class="idx">{{ i + 1 }}</span>
              <template v-if="m">
                <div class="weapon">{{ m[0] }}</div>
                <div class="name">{{ m[1] }}</div>
              </template>
              <template v-else>等待添加</template>
            </div>
          </div>
          <aside class="panel">
            <h3>待合成材料</h3>
            <p>
              默认进入 5/10 状态。PC
              可拖拽材料到空槽；移动端点击「添加」或「一键添加」。放满 10
              件后才能确认合同。
            </p>
            <div class="pool">
              <div
                v-for="(m, i) in mats"
                :key="i"
                class="mat"
                :class="{ used: isUsed(m) }"
                :style="{ '--c': m[2] }"
                :draggable="!isUsed(m)"
                @dragstart="dragIndex = i"
              >
                <b>{{ m[0] }}</b>
                <div>
                  <strong>{{ m[1] }}</strong>
                  <span>{{ isUsed(m) ? '已添加' : '拖拽或点击添加' }}</span>
                </div>
                <button :disabled="isUsed(m)" @click="addMat(i)">添加</button>
              </div>
            </div>
            <div class="actions">
              <button class="btn secondary" @click="resetMaterials">
                重置 5/10
              </button>
              <button class="btn primary" @click="autoFill">一键添加</button>
            </div>
            <div class="actions">
              <button
                class="btn primary"
                :disabled="!canCombine"
                @click="startCraft"
              >
                确认合同 · 合成
              </button>
            </div>
          </aside>
        </div>

        <div class="process" :class="{ show: showProcess }">
          <div class="phase">{{ phaseText }}</div>
          <div class="process-grid">
            <div
              v-for="(m, i) in craftCards"
              :key="i"
              class="card"
              :style="{ '--c': m[2] }"
              :ref="(el) => setCardEl(el, i)"
            >
              <b>{{ m[0] }}</b>
              <span>{{ m[1] }}</span>
            </div>
          </div>
        </div>

        <div class="flash" :class="{ boom: flashBoom }"></div>
        <div
          class="edge"
          :class="{ on: edgeOn }"
          :style="{ '--edge': edgeColor }"
        ></div>

        <div class="result" :class="[{ show: showResult }, cfg.cls]">
          <div class="result-card" :style="{ '--c': cfg.color }">
            <div class="prize">{{ cfg.icon }}</div>
            <div class="prize-name">{{ cfg.name }}</div>
            <div class="tag" :style="{ background: cfg.color }">
              {{ cfg.tag }}
            </div>
          </div>
          <div class="result-side">
            <h2>{{ cfg.title }}</h2>
            <div class="profit-text">{{ cfg.profit }}</div>
            <div class="result-meta">
              <div class="stat">
                <label>参考估值</label><strong>{{ cfg.value }}</strong>
              </div>
              <div class="stat">
                <label>投入成本</label><strong>¥328</strong>
              </div>
              <div class="stat">
                <label>磨损</label><strong>{{ cfg.wear }}</strong>
              </div>
              <div class="stat">
                <label>Float</label><strong>{{ cfg.float }}</strong>
              </div>
            </div>
            <div class="result-actions">
              <button
                class="main"
                @click="toast('已进入背包，订单结果同步刷新')"
              >
                查看背包
              </button>
              <button @click="toast('分享图已生成，可保存发微信/QQ')">
                分享结果
              </button>
              <button @click="toast('已推荐同商家相同汰换合同')">
                再来一单
              </button>
              <button @click="resetAll">重新演示</button>
            </div>
          </div>
        </div>
      </section>

      <aside class="side">
        <div class="note">
          <h3>状态 1：开启前</h3>
          <p>
            用户看到一个待合成界面，材料槽可显示 5/10、6/10 到
            10/10。支持拖拽添加、点击单件添加、一键添加。
          </p>
        </div>
        <div class="note">
          <h3>状态 2：合成中</h3>
          <p>
            点击确认合同后进入固定打造过场，过程控制在 5
            秒内。材料聚拢、能量爆发、粒子和边缘光承担爽感。
          </p>
        </div>
        <div class="note">
          <h3>状态 3：出结果</h3>
          <p>
            结果弹出后按亏赚分层：赚的更炫酷，亏的更克制但不羞辱用户，继续承接分享和再来一单。
          </p>
        </div>
      </aside>
    </main>

    <div class="toast" :class="{ show: toastShow }">{{ toastMsg }}</div>
  </div>
</template>

<style scoped>
.stage-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
}
</style>
