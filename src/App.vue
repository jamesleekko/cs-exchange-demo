<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';

import {
  darkTheme,
  NButton,
  NCheckbox,
  NConfigProvider,
} from 'naive-ui';

import { createContract } from './three/contract.js';
import { createFurnace } from './three/furnace.js';

// CS2 品质档位（配色见设计图）与最新汰换规则（2025.10 起）：
// 普通级~保密级：10 件同品质 → 上一档；隐秘级：5 件 → 非凡级(金,刀/手套)；
// 非凡级(金)不可作为汰换输入。need=0 表示不可汰换。
const RARITIES = {
  consumer: { name: '普通级', color: '#b0c3d9', need: 10 },
  industrial: { name: '工业级', color: '#5e98d9', need: 10 },
  milspec: { name: '军工级', color: '#4b69ff', need: 10 },
  restricted: { name: '受限级', color: '#8847ff', need: 10 },
  classified: { name: '保密级', color: '#d32ce6', need: 10 },
  covert: { name: '隐秘级', color: '#eb4b4b', need: 5 },
  gold: { name: '非凡级', color: '#e4ae39', need: 0 },
}
const RARITY_ORDER = [
  'consumer',
  'industrial',
  'milspec',
  'restricted',
  'classified',
  'covert',
  'gold',
]

// 各品质材料（代号, 名称）。可汰换品质提供足量，便于凑齐所需数量。
const SKIN_POOL = {
  consumer: [
    ['P2000', 'P2000 | 手电'],
    ['MP9', 'MP9 | 军团'],
    ['NEGEV', '内格夫 | 沙丘'],
    ['NOVA', '新星 | 多边形'],
    ['XM', 'XM1014 | 蓝钢'],
    ['SCAR', 'SCAR-20 | 石板'],
    ['MAG7', 'MAG-7 | 灰烬'],
    ['G3', 'G3SG1 | 沙漠风暴'],
    ['BIZON', 'PP-野牛 | 都市涂装'],
    ['DUAL', '双持贝瑞塔 | 军团'],
  ],
  industrial: [
    ['SAWED', '截短霰弹枪 | 蓝钢'],
    ['P90', 'P90 | 灼热'],
    ['UMP', 'UMP-45 | 铸铁'],
    ['MP7', 'MP7 | 军团'],
    ['USP', 'USP-S | 森林迷彩'],
    ['MP5', 'MP5-SD | 静默'],
    ['CZ', 'CZ75 | 蓝钢'],
    ['DEAGLE', '沙鹰 | 网格纹'],
    ['FAMAS', '法玛斯 | 塑胶'],
    ['GALIL', 'Galil AR | 部落'],
  ],
  milspec: [
    ['AK', 'AK-47 | 蓝色层压板'],
    ['M4', 'M4A1-S | 蓝相'],
    ['AWP', 'AWP | 电路板'],
    ['USP', 'USP-S | 森林'],
    ['GLOCK', '格洛克 | 蓝裂纹'],
    ['P250', 'P250 | 瓦解'],
    ['SG', 'SG 553 | 阿罗哈'],
    ['TEC9', 'Tec-9 | 以撒'],
    ['FIVE7', 'Five-SeveN | 涂鸦'],
    ['AUG', 'AUG | 蓝翼'],
  ],
  restricted: [
    ['AK', 'AK-47 | 黑色魅影'],
    ['M4', 'M4A4 | 蜂巢'],
    ['AWP', 'AWP | 姆罗兹'],
    ['DEAGLE', '沙鹰 | 蓝焰'],
    ['USP', 'USP-S | 印花集'],
    ['P90', 'P90 | 死亡之握'],
    ['GLOCK', '格洛克 | 燃料喷射'],
    ['M4S', 'M4A1-S | 赛博安全'],
    ['P250', 'P250 | 妹妹'],
    ['MAC', 'MAC-10 | 霓虹骑士'],
  ],
  classified: [
    ['AK', 'AK-47 | 表面淬火'],
    ['M4', 'M4A4 | 龙王'],
    ['AWP', 'AWP | 巨兽'],
    ['DEAGLE', '沙鹰 | 印花集'],
    ['USP', 'USP-S | 枪响人亡'],
    ['GLOCK', '格洛克 | 渐变之色'],
    ['M4S', 'M4A1-S | 机械工业'],
    ['SSG', 'SSG 08 | 血腥之网'],
    ['P90', 'P90 | 亚洲毒龙'],
    ['UMP', 'UMP-45 | 主要控制'],
  ],
  covert: [
    ['AK', 'AK-47 | 火神'],
    ['M4', 'M4A4 | 二西莫夫'],
    ['AWP', 'AWP | 巨龙传说'],
    ['AK2', 'AK-47 | 一发入魂'],
    ['DEAGLE', '沙鹰 | 烈焰'],
    ['M4S', 'M4A1-S | 玛卡巴卡'],
  ],
  gold: [
    ['★刀', '蝴蝶刀 | 渐变之色'],
    ['★刀', '爪子刀 | 多普勒'],
    ['★刀', 'M9 刺刀 | 表面淬火'],
    ['★套', '专业手套 | 深红头巾'],
  ],
}

// 稳定的伪随机磨损值，避免每次渲染变化
function floatFor(i) {
  const v = ((i * 9301 + 49297) % 233280) / 233280
  return (v * 0.55).toFixed(4)
}

// 结构：[代号, 名称, 品质色, 磨损值, 品质key, 唯一id]
const inventory = []
RARITY_ORDER.forEach((rk) => {
  SKIN_POOL[rk].forEach(([code, name]) => {
    inventory.push([
      code,
      name,
      RARITIES[rk].color,
      floatFor(inventory.length),
      rk,
      inventory.length,
    ])
  })
})

// 各可汰换档位的基准单价（¥/件），用于估算投入成本
const BASE_PRICE = {
  consumer: 3,
  industrial: 7,
  milspec: 20,
  restricted: 65,
  classified: 220,
  covert: 950,
}

const fmtMoney = (n) => Math.round(n).toLocaleString('en-US')

// 严格按 CS2 汰换合同规则生成结果：
// 1) 产出稀有度 = 输入稀有度的高一档；
// 2) 具体产出皮肤随机（真实规则按来源收藏集概率，此处无收藏集数据，
//    从高一档皮肤池随机抽取来模拟这一随机性）；
// 3) 结果 float = 输入平均 float ×(wearMax-wearMin)+wearMin（逐皮肤磨损范围此处随机模拟）；
// 4) 盈亏 = 随机产出皮肤的市场价值 − 投入成本，随机性来源于「出到哪一款皮肤」。
function generateOutcome(items, count) {
  const inKey = items[0][4]
  const outKey = RARITY_ORDER[RARITY_ORDER.indexOf(inKey) + 1] || inKey
  const pool = SKIN_POOL[outKey]
  const pick = pool[(Math.random() * pool.length) | 0]

  // float：CS2 磨损公式；无逐皮肤磨损范围数据，模拟一个合理的 [wmin, wmax]
  const avg = items.reduce((s, m) => s + parseFloat(m[3]), 0) / items.length
  const wmin = Math.random() * 0.06
  const wmax = 0.55 + Math.random() * 0.45
  const resultFloat = Math.min(0.999, avg * (wmax - wmin) + wmin)
  const wear = wearTier(resultFloat)

  // 盈亏：投入成本按输入档基准计，产出价值随机（模拟同档不同皮肤的价差）
  const cost = BASE_PRICE[inKey] * count
  const r = Math.random()
  let factor
  if (r < 0.45) factor = 0.12 + Math.random() * 0.55
  else if (r < 0.72) factor = 0.7 + Math.random() * 0.45
  else if (r < 0.93) factor = 1.15 + Math.random() * 1.4
  else factor = 2.6 + Math.random() * 6
  const value = Math.max(1, Math.round(cost * factor))
  const diff = value - cost
  const ratio = value / cost

  let cls, title, profit
  if (ratio >= 1.8) {
    cls = 'profit'
    title = '出了大货！'
    profit = `本次爆赚 +¥${fmtMoney(diff)}`
  } else if (ratio > 1.05) {
    cls = 'small'
    title = '小赚一手'
    profit = `本次小赚 +¥${fmtMoney(diff)}`
  } else if (ratio >= 0.9) {
    cls = 'small'
    title = '基本保本'
    profit = diff >= 0 ? `基本持平 +¥${fmtMoney(diff)}` : `基本持平 -¥${fmtMoney(-diff)}`
  } else {
    cls = 'loss'
    title = '这次亏了'
    profit = `本次亏损 -¥${fmtMoney(-diff)}`
  }

  const color = RARITIES[outKey].color
  return {
    cls,
    icon: pick[0],
    name: pick[1],
    tag: RARITIES[outKey].name.replace('级', ''),
    color,
    edge: color,
    title,
    profit,
    value: `¥${fmtMoney(value)}`,
    cost: `¥${fmtMoney(cost)}`,
    wear: wear.name,
    wearColor: wear.color,
    float: resultFloat.toFixed(6),
  }
}

// 主题色改为熔炉火焰橙，与背景图的高炉/警示条氛围统一
const themeOverrides = {
  common: {
    primaryColor: '#ff9a2e',
    primaryColorHover: '#ffb45c',
    primaryColorPressed: '#e8821a',
    primaryColorSuppl: '#ff9a2e',
    borderRadius: '4px',
    fontWeightStrong: '800',
  },
  Button: {
    textColorPrimary: '#120802',
    textColorHoverPrimary: '#120802',
    textColorPressedPrimary: '#120802',
    textColorFocusPrimary: '#120802',
    fontWeight: '800',
  },
  Checkbox: {
    colorChecked: '#ff9a2e',
    checkMarkColor: '#120802',
    borderChecked: '1px solid #ff9a2e',
    borderFocus: '1px solid #ff9a2e',
    boxShadowFocus: '0 0 0 2px rgba(255,154,46,.3)',
  },
}

const selected = ref([])
const confirmChecked = ref(false)
const dragItem = ref(null)
const dropActive = ref(false)

// 本次汰换结果（严格按 CS2 规则生成，见 generateOutcome）
const PLACEHOLDER_OUTCOME = {
  cls: 'small', icon: '—', name: '等待汰换', tag: '', color: '#8fa2c0', edge: '#8fa2c0',
  title: '', profit: '', value: '¥0', cost: '¥0', wear: '—', wearColor: '#8fa2c0',
  float: '0.000000',
}
const currentOutcome = ref(PLACEHOLDER_OUTCOME)
const running = ref(false)

const showBuilder = ref(true)
const showResult = ref(false)

const edgeOn = ref(false)
const edgeColor = ref('#ff9a2e')
const stageShake = ref(false)

const toastMsg = ref('')
const toastShow = ref(false)
let toastTimer = null

const stageRef = ref(null)

// 常驻背景熔炉（three.js）：怠速敞开 → 合同盖章后闭合 → 点击开启光柱爆发
const furnaceRef = ref(null)
let furnace = null
const furnaceWait = ref(false) // 密封完成，等待点击熔炉
let furnaceCloseAudio = null
let furnaceBeamAudio = null

// 「合同签订」three.js 特效（等待用户点击盖章）
const contractRef = ref(null)
let contract = null
const showContract = ref(false)
let paperAudio = null
let stampAudio = null

function playSound(el) {
  if (!el) return
  try {
    el.currentTime = 0
    el.play().catch(() => {})
  } catch {
    /* 忽略自动播放限制 */
  }
}

const cfg = computed(() => currentOutcome.value)

const available = computed(() =>
  inventory.filter(
    (it) => RARITIES[it[4]].need > 0 && !selected.value.includes(it),
  ),
)

// 已选材料的品质（取第一件）决定所需数量与后续可添加的材料
const activeRarity = computed(() =>
  selected.value.length ? selected.value[0][4] : null,
)
const currentNeed = computed(() =>
  activeRarity.value ? RARITIES[activeRarity.value].need : 0,
)
// 左侧「符合汰换资格」计数：可作为输入（need>0）且尚未选中的材料
const eligibleCount = computed(
  () => available.value.filter((m) => RARITIES[m[4]].need > 0).length,
)
const canConfirmItems = computed(
  () => !!activeRarity.value && selected.value.length === currentNeed.value,
)
const countText = computed(() =>
  activeRarity.value ? `${selected.value.length}/${currentNeed.value}` : '0/—',
)
const statusText = computed(() => {
  if (!selected.value.length) return '请拖入同一品质的材料'
  if (selected.value.length < currentNeed.value)
    return `继续添加（${RARITIES[activeRarity.value].name}需 ${currentNeed.value} 件）`
  return '材料已齐，勾选后确认'
})

function isTradeable(m) {
  return RARITIES[m[4]].need > 0
}
function rarityName(m) {
  return RARITIES[m[4]].name
}

// CS2 磨损等级（Exterior）：区间与游戏一致（下含上不含），
// 颜色贴近游戏内磨损条的绿→黄→橙→红渐变
const WEAR_TIERS = [
  { max: 0.07, name: '崭新出厂', color: '#4dd15a' },
  { max: 0.15, name: '略有磨损', color: '#8fc63d' },
  { max: 0.38, name: '久经沙场', color: '#e6c930' },
  { max: 0.45, name: '破损不堪', color: '#e08a3c' },
  { max: Infinity, name: '战痕累累', color: '#eb4b4b' },
]
function wearTier(f) {
  return WEAR_TIERS.find((t) => f < t.max) || WEAR_TIERS[WEAR_TIERS.length - 1]
}
function wearFor(m) {
  return wearTier(parseFloat(m[3]))
}
function canAdd(m) {
  if (!isTradeable(m)) return false
  if (!activeRarity.value) return true
  if (m[4] !== activeRarity.value) return false
  return selected.value.length < currentNeed.value
}
function lockReason(m) {
  if (!isTradeable(m)) return '不可汰换'
  if (activeRarity.value && m[4] !== activeRarity.value) return '品质不符'
  if (activeRarity.value && selected.value.length >= currentNeed.value) return '已满'
  return ''
}

// 数量/品质不满足时自动取消勾选，避免绕过校验
watch(canConfirmItems, (ok) => {
  if (!ok) confirmChecked.value = false
})

function addItem(m) {
  if (selected.value.includes(m)) return
  if (!canAdd(m)) {
    if (!isTradeable(m)) toast(`${rarityName(m)}物品不可汰换`)
    else if (activeRarity.value && m[4] !== activeRarity.value)
      toast('汰换需使用相同品质的材料')
    else toast(`${RARITIES[activeRarity.value].name}只需 ${currentNeed.value} 件`)
    return
  }
  selected.value.push(m)
}

function removeItem(m) {
  const i = selected.value.indexOf(m)
  if (i >= 0) selected.value.splice(i, 1)
}

function onDragStart(m) {
  if (!canAdd(m)) return
  dragItem.value = m
}

function onDragLeave(e) {
  // 拖过子元素时 dragleave 会误触发，通过 relatedTarget 判断是否真正离开
  if (!e.currentTarget.contains(e.relatedTarget)) dropActive.value = false
}

function onDrop(e) {
  e.preventDefault()
  dropActive.value = false
  if (dragItem.value) addItem(dragItem.value)
  dragItem.value = null
}

function resetSelected() {
  selected.value = []
  confirmChecked.value = false
  toast('已清空汰换材料')
}

function autoFill() {
  // 已选品质优先；否则选第一个数量足够的可汰换品质
  let rk = activeRarity.value
  if (!rk) {
    rk = RARITY_ORDER.find(
      (k) =>
        RARITIES[k].need > 0 &&
        inventory.filter((m) => m[4] === k).length >= RARITIES[k].need,
    )
  }
  if (!rk) return
  const need = RARITIES[rk].need
  selected.value = inventory.filter((m) => m[4] === rk).slice(0, need)
  toast(`已一键添加 ${need} 件${RARITIES[rk].name}材料`)
}

// ===== 主流程 =====
// 确认汰换 → 3D 合同（点击盖章）→ 熔炉闭合 → 点击熔炉开启 → 光柱爆发高潮弹结果
async function startCraft() {
  if (running.value || !canConfirmItems.value) return
  running.value = true
  showBuilder.value = false
  // 按 CS2 汰换规则生成本次结果（随机产出皮肤 → 盈亏随之产生）
  currentOutcome.value = generateOutcome(selected.value, currentNeed.value)
  startContract()
}

async function startContract() {
  showContract.value = true
  // 合同逐条列出的材料：名称 + 品质色
  const items = selected.value.map((m) => ({ name: m[1], color: m[2] }))
  await nextTick()
  if (!contract) contract = createContract(contractRef.value)
  contract.resize()
  contract.play({
    items,
    resultTag: cfg.value.tag,
    onPaper: () => playSound(paperAudio),
    onStamp: () => {
      playSound(stampAudio)
      edgeColor.value = cfg.value.edge
      edgeOn.value = true
      setTimeout(() => (edgeOn.value = false), 1600)
    },
    onDone: () => {
      showContract.value = false
      startFurnaceSeal()
    },
  })
}

// 合同生效后：熔炉闭合锁定 → 等待用户点击 → 开启光柱爆发 → 高潮弹结果
function startFurnaceSeal() {
  playSound(furnaceCloseAudio) // 音频内 1.5s 处撞击，与闭合行程对齐
  furnace.close({
    color: cfg.value.color,
    onSlam: () => {
      stageShake.value = true
      setTimeout(() => (stageShake.value = false), 900)
    },
    onSealed: () => {
      furnaceWait.value = true
    },
    onOpen: () => {
      furnaceWait.value = false
      playSound(furnaceBeamAudio) // 音频内 1.62s 处爆发，与光柱高潮对齐
    },
    onPeak: () => {
      edgeColor.value = cfg.value.edge
      edgeOn.value = true
      setTimeout(() => (edgeOn.value = false), 1800)
      showResult.value = true
    },
    onDone: () => {
      running.value = false
    },
  })
}

function resetAll() {
  showBuilder.value = true
  showResult.value = false
  showContract.value = false
  contract?.stop()
  furnace?.reset()
  furnaceWait.value = false
  edgeOn.value = false
  running.value = false
  selected.value = []
  confirmChecked.value = false
}

function toast(msg) {
  toastMsg.value = msg
  toastShow.value = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastShow.value = false), 1800)
}

onMounted(() => {
  furnace = createFurnace(furnaceRef.value)
  paperAudio = new Audio('/sfx/paper-rustle.wav')
  paperAudio.volume = 0.6
  paperAudio.preload = 'auto'
  stampAudio = new Audio('/sfx/stamp.wav')
  stampAudio.volume = 0.85
  stampAudio.preload = 'auto'
  furnaceCloseAudio = new Audio('/sfx/furnace-close.wav')
  furnaceCloseAudio.volume = 0.85
  furnaceCloseAudio.preload = 'auto'
  furnaceBeamAudio = new Audio('/sfx/furnace-beam.wav')
  furnaceBeamAudio.volume = 0.9
  furnaceBeamAudio.preload = 'auto'
})

onBeforeUnmount(() => {
  clearTimeout(toastTimer)
  contract?.dispose()
  furnace?.dispose()
})
</script>

<template>
  <n-config-provider :theme="darkTheme" :theme-overrides="themeOverrides">
    <div class="app">
      <div class="top">
        <div class="brand">元游猫 <span>汰换合同交互原型</span></div>
      </div>
      <main class="layout">
        <section class="stage" :class="{ shake: stageShake }" ref="stageRef">
          <!-- 常驻背景：厂房 + 3D 熔炉（等待点击开启时接收 pointer 事件） -->
          <canvas
            class="furnace-layer"
            :class="{ wait: furnaceWait }"
            ref="furnaceRef"
          ></canvas>
          <div class="stage-head">
            <div>
              <div class="eyebrow">TRADE UP CONTRACT · SECTOR 07</div>
              <div class="title">汰换合同</div>
              <div class="subtitle">
                严格遵循 CS2 汰换规则：10 件同品质随机产出高一档皮肤，盈亏由产物价值决定
              </div>
            </div>
            <div class="status-pill">
              <strong>{{ countText }}</strong
              ><span>{{ statusText }}</span>
            </div>
          </div>

          <div class="builder" :class="{ hidden: !showBuilder }">
            <!-- 左：符合汰换资格的材料池 -->
            <section class="inv-panel panel-box">
              <div class="inv-head">
                <div class="inv-title">
                  <b>{{ eligibleCount }}</b
                  ><span>件物品符合汰换资格</span>
                </div>
                <div class="inv-sub">
                  拖拽同一品质材料汰换升级：普通~保密级需 10 件、隐秘级需 5 件
                </div>
              </div>
              <div class="inv-list">
                <div
                  v-for="m in available"
                  :key="m[5]"
                  class="inv-item"
                  :class="{ locked: !canAdd(m) }"
                  :style="{ '--c': m[2] }"
                  :draggable="canAdd(m)"
                  @dragstart="onDragStart(m)"
                  @dragend="dragItem = null"
                >
                  <span v-if="canAdd(m)" class="add-hint">⠿ 拖拽</span>
                  <span v-else class="lock-tag">{{ lockReason(m) }}</span>
                  <div class="code">{{ m[0] }}</div>
                  <div class="nm">{{ m[1] }}</div>
                  <div class="meta">
                    <span class="rarity" :style="{ color: wearFor(m).color }">{{
                      wearFor(m).name
                    }}</span>
                    <span class="fl">{{ m[3] }}</span>
                  </div>
                </div>
                <div v-if="!available.length" class="inv-empty">
                  材料已全部加入汰换栏
                </div>
              </div>
              <div class="inv-actions">
                <n-button block secondary @click="resetSelected">重置</n-button>
                <n-button block type="primary" @click="autoFill">
                  一键添加{{ activeRarity ? `（${RARITIES[activeRarity].name}）` : '' }}
                </n-button>
              </div>
            </section>

            <!-- 右：汰换合同栏 -->
            <section class="contract-panel panel-box">
              <div
                class="contract-drop"
                :class="{ drag: dropActive }"
                @dragover.prevent="dropActive = true"
                @dragleave="onDragLeave"
                @drop="onDrop"
              >
                <div v-if="!selected.length" class="contract-placeholder">
                  <div class="ph-icon">◈</div>
                  <div class="big">选择材料以汰换更高品质物品</div>
                  <div class="small">
                    从左侧拖入相同品质材料（普通~保密级 10 件 / 隐秘级 5 件）
                  </div>
                </div>
                <div v-else class="contract-grid">
                  <div
                    v-for="m in selected"
                    :key="m[5]"
                    class="contract-item"
                    :style="{ '--c': m[2] }"
                    title="点击移除"
                    @click="removeItem(m)"
                  >
                    <span class="rm">✕</span>
                    <div class="code">{{ m[0] }}</div>
                    <div class="nm">{{ m[1] }}</div>
                    <div class="meta">
                      <span class="rarity" :style="{ color: wearFor(m).color }">{{
                        wearFor(m).name
                      }}</span>
                      <span class="fl">{{ m[3] }}</span>
                    </div>
                  </div>
                  <div
                    v-for="n in currentNeed - selected.length"
                    :key="'empty-' + n"
                    class="contract-item empty"
                  >
                    <span class="slot-idx">{{ selected.length + n }}</span>
                  </div>
                </div>
              </div>
              <div class="contract-footer">
                <n-checkbox
                  v-model:checked="confirmChecked"
                  :disabled="!canConfirmItems"
                >
                  确认汰换物品
                </n-checkbox>
                <n-button
                  type="primary"
                  size="large"
                  class="confirm-btn"
                  :disabled="!confirmChecked"
                  @click="startCraft"
                >
                  确认汰换
                </n-button>
              </div>
            </section>
          </div>

          <!-- 3D 合同（等待点击盖章，canvas 需接收 pointer 事件） -->
          <canvas
            class="forge-layer contract-layer"
            :class="{ show: showContract }"
            ref="contractRef"
          ></canvas>

          <!-- 熔炉密封后的点击提示 -->
          <div class="forge-phase furnace-phase" :class="{ show: furnaceWait }">
            点击熔炉 · 开启汰换
          </div>

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
                  <label>投入成本</label><strong>{{ cfg.cost }}</strong>
                </div>
                <div class="stat">
                  <label>磨损</label><strong :style="{ color: cfg.wearColor }">{{ cfg.wear }}</strong>
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
      </main>

      <div class="toast" :class="{ show: toastShow }">{{ toastMsg }}</div>
    </div>
  </n-config-provider>
</template>

<style scoped>
/* 移除右侧状态说明栏后，舞台占满整行 */
.layout {
  grid-template-columns: minmax(0, 1fr);
}

/* 舞台：3D 熔炉场景自带厂房背景图，去掉原网格/光晕装饰 */
.stage {
  background: #05070d;
}
.stage::before,
.stage::after {
  content: none;
}

/* 常驻熔炉层：底层铺满；密封等待点击时才接收 pointer 事件 */
.furnace-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
}
.furnace-layer.wait {
  pointer-events: auto;
}

/* 顶栏品牌色与背景图的蓝色霓虹统一 */
.brand {
  color: #5eb0ff;
}

/* 标题区：蓝色科技感 + 橙色状态强调 */
.eyebrow {
  color: #5eb0ff;
}
.status-pill {
  border-color: rgba(94, 176, 255, 0.35);
  background: rgba(8, 16, 30, 0.88);
}
.status-pill strong {
  color: #ff9a2e;
}

/* three.js 覆盖层（合同） */
.forge-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 5;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.45s ease;
}
.forge-layer.show {
  opacity: 1;
}
/* 「合同签订」需要接收点击（Raycaster 命中印章区才盖章） */
.forge-layer.contract-layer.show {
  pointer-events: auto;
}

.forge-phase {
  position: absolute;
  left: 50%;
  bottom: 46px;
  transform: translate(-50%, 12px);
  z-index: 6;
  border: 1px solid rgba(255, 179, 71, 0.4);
  background: rgba(30, 12, 4, 0.55);
  backdrop-filter: blur(6px);
  border-radius: 999px;
  color: #ffd9a0;
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 0.22em;
  text-shadow: 0 0 18px rgba(255, 140, 50, 0.6);
  opacity: 0;
  pointer-events: none;
  transition: 0.4s ease;
}
.forge-phase.show {
  opacity: 1;
  transform: translate(-50%, 0);
}
/* 熔炉点击提示：呼吸脉冲 */
.forge-phase.furnace-phase.show {
  animation: furnacePhasePulse 1.6s ease-in-out infinite;
}
@keyframes furnacePhasePulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

/* ===== 汰换构建区：左右两栏（非透明面板，遮挡背后熔炉） ===== */
.builder {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.02fr);
  gap: 22px;
  align-items: stretch;
}

.panel-box {
  border: 1px solid rgba(90, 160, 255, 0.28);
  border-radius: 14px;
  background: linear-gradient(180deg, #0d1626, #090f1a);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), 0 18px 50px rgba(0, 0, 0, 0.6),
    inset 0 0 30px rgba(40, 90, 180, 0.07);
  padding: 16px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}
/* 面板顶部霓虹描边，呼应背景图全息屏 */
.panel-box::before {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  top: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(94, 176, 255, 0.75), transparent);
}

/* 左：材料池 */
.inv-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.inv-title b {
  font: 900 26px Impact, 'Arial Black', sans-serif;
  color: #ff9a2e;
  text-shadow: 0 0 18px rgba(255, 154, 46, 0.35);
}
.inv-title span {
  font-size: 14px;
  font-weight: 800;
  color: #dbeafe;
  letter-spacing: 0.02em;
}
.inv-sub {
  font-size: 12px;
  color: #64748b;
  margin-top: 5px;
  line-height: 1.5;
}

.inv-list {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: max-content;
  gap: 10px;
  max-height: 520px;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 4px 0 0;
  align-content: start;
}
.inv-list::-webkit-scrollbar {
  width: 6px;
}
.inv-list::-webkit-scrollbar-thumb {
  background: rgba(120, 170, 255, 0.22);
  border-radius: 3px;
}

.inv-item {
  position: relative;
  min-height: 92px;
  border: 1px solid rgba(120, 160, 220, 0.16);
  border-radius: 10px;
  background: linear-gradient(180deg, #1d2637, #10161f);
  padding: 12px 12px 15px;
  cursor: grab;
  overflow: hidden;
  user-select: none;
  transition: transform 0.16s, border-color 0.16s, box-shadow 0.16s;
}
.inv-item::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  background: var(--c);
  box-shadow: 0 0 12px var(--c);
}
.inv-item:hover {
  border-color: rgba(255, 154, 46, 0.55);
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.42);
}
.inv-item:active {
  cursor: grabbing;
}
.inv-item .code {
  font: 900 20px Impact, 'Arial Black', sans-serif;
  letter-spacing: 0.03em;
  text-shadow: 0 0 14px var(--c);
}
.inv-item .nm {
  font-size: 12px;
  color: #cbd5e1;
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.inv-item .meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 8px;
}
.inv-item .rarity {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.inv-item .fl {
  flex-shrink: 0;
  font-size: 11px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}
.inv-item .add-hint {
  position: absolute;
  top: 9px;
  right: 10px;
  font-size: 10px;
  font-weight: 800;
  color: #64748b;
  opacity: 0;
  transition: 0.15s;
}
.inv-item:hover .add-hint {
  opacity: 1;
  color: #ff9a2e;
}
/* 不可添加：非凡级(金)、品质不符或已满 */
.inv-item.locked {
  opacity: 0.42;
  cursor: not-allowed;
  filter: grayscale(0.35);
}
.inv-item.locked:hover {
  transform: none;
  border-color: rgba(120, 160, 220, 0.16);
  box-shadow: none;
}
.inv-item .lock-tag {
  position: absolute;
  top: 8px;
  right: 9px;
  font-size: 10px;
  font-weight: 800;
  color: #0b0e16;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 5px;
  padding: 2px 6px;
}
.inv-empty {
  grid-column: 1 / -1;
  text-align: center;
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
  padding: 40px 0;
}

.inv-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 16px;
}

/* 右：汰换合同栏 */
.contract-drop {
  flex: 1;
  min-height: 380px;
  border: 1.5px dashed rgba(120, 170, 255, 0.28);
  border-radius: 12px;
  background: rgba(20, 34, 58, 0.35);
  padding: 14px;
  transition: 0.18s;
  display: flex;
  flex-direction: column;
}
.contract-drop.drag {
  border-color: #ff9a2e;
  background: rgba(255, 154, 46, 0.07);
  box-shadow: inset 0 0 40px rgba(255, 154, 46, 0.12);
}

.contract-placeholder {
  margin: auto;
  text-align: center;
  color: rgba(255, 255, 255, 0.42);
  padding: 20px;
}
.contract-placeholder .ph-icon {
  font-size: 42px;
  color: rgba(255, 154, 46, 0.6);
  text-shadow: 0 0 24px rgba(255, 154, 46, 0.4);
}
.contract-placeholder .big {
  font-size: 16px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.62);
  margin-top: 14px;
}
.contract-placeholder .small {
  font-size: 12px;
  margin-top: 10px;
  color: #64748b;
}

.contract-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: max-content;
  gap: 10px;
  align-content: start;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 4px 0 0;
}
/* 右侧选中项与左侧材料卡保持完全一致的样式 */
.contract-item {
  position: relative;
  min-height: 92px;
  border: 1px solid rgba(120, 160, 220, 0.16);
  border-radius: 10px;
  background: linear-gradient(180deg, #1d2637, #10161f);
  padding: 12px 12px 15px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.16s, border-color 0.16s, box-shadow 0.16s;
}
.contract-item::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  background: var(--c);
  box-shadow: 0 0 12px var(--c);
}
.contract-item:hover {
  border-color: rgba(255, 107, 107, 0.5);
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.42);
}
.contract-item .code {
  font: 900 20px Impact, 'Arial Black', sans-serif;
  letter-spacing: 0.03em;
  text-shadow: 0 0 14px var(--c);
}
.contract-item .nm {
  font-size: 12px;
  color: #cbd5e1;
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.contract-item .meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 8px;
}
.contract-item .rarity {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.contract-item .fl {
  flex-shrink: 0;
  font-size: 11px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}
.contract-item .rm {
  position: absolute;
  top: 9px;
  right: 10px;
  font-size: 12px;
  font-weight: 900;
  color: rgba(255, 255, 255, 0.55);
  opacity: 0;
  transition: 0.15s;
}
.contract-item:hover .rm {
  opacity: 1;
  color: #ff6b6b;
}
.contract-item.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: rgba(255, 255, 255, 0.02);
  border: 1px dashed rgba(120, 170, 255, 0.2);
  cursor: default;
}
.contract-item.empty::after {
  display: none;
}
.contract-item.empty:hover {
  transform: none;
  border-color: rgba(120, 170, 255, 0.2);
  box-shadow: none;
}
.contract-item.empty .slot-idx {
  font: 900 15px Impact, 'Arial Black', sans-serif;
  color: rgba(255, 255, 255, 0.22);
}

.contract-footer {
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-top: 1px solid rgba(94, 176, 255, 0.16);
  padding-top: 16px;
}
.contract-footer :deep(.n-checkbox) {
  font-weight: 800;
  --n-font-size: 15px;
}
.confirm-btn {
  min-width: 168px;
  letter-spacing: 0.08em;
}

/* 结果视图沿用全局样式，但按钮主色跟随主题橙 */
.result-actions .main {
  background: #ff9a2e;
  color: #120802;
}

@media (max-width: 900px) {
  .builder {
    grid-template-columns: 1fr;
  }
  .inv-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-height: 300px;
  }
  .contract-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
