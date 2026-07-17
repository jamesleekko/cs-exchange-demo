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

const BRAND_LOGO_URL = `${import.meta.env.BASE_URL}yuanyoumao-logo.png`
const GENERIC_WEAPON_URL = `${import.meta.env.BASE_URL}weapons/generic-weapon.png`
const FILTER_RARITIES = RARITY_ORDER.filter((key) => RARITIES[key].need > 0)

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
    particles: cls === 'profit' ? 110 : cls === 'small' ? 56 : 20,
  }
}

const themeOverrides = {
  common: {
    primaryColor: '#ffcf28',
    primaryColorHover: '#ffe373',
    primaryColorPressed: '#f5b301',
    primaryColorSuppl: '#ffcf28',
    borderRadius: '4px',
    fontWeightStrong: '800',
  },
  Button: {
    textColorPrimary: '#101010',
    textColorHoverPrimary: '#101010',
    textColorPressedPrimary: '#101010',
    textColorFocusPrimary: '#101010',
    fontWeight: '800',
  },
  Checkbox: {
    colorChecked: '#ffcf28',
    checkMarkColor: '#101010',
    borderChecked: '1px solid #ffcf28',
    borderFocus: '1px solid #ffcf28',
    boxShadowFocus: '0 0 0 2px rgba(255,207,40,.3)',
  },
}

const selected = ref([])
const confirmChecked = ref(false)
const dragItem = ref(null)
const dropActive = ref(false)
const rarityFilter = ref('all')
const inventoryRefreshing = ref(false)
let inventoryRefreshTimer = null

// 本次汰换结果（严格按 CS2 规则生成，见 generateOutcome）
const PLACEHOLDER_OUTCOME = {
  cls: 'small', icon: '—', name: '等待汰换', tag: '', color: '#8fa2c0', edge: '#8fa2c0',
  title: '', profit: '', value: '¥0', cost: '¥0', wear: '—', wearColor: '#8fa2c0',
  float: '0.000000', particles: 40,
}
const currentOutcome = ref(PLACEHOLDER_OUTCOME)
const running = ref(false)

const showBuilder = ref(true)
const showProcess = ref(false)
const showResult = ref(false)
const phaseText = ref('CONTRACT CONFIRMED')
const craftCards = ref([])
const cardEls = []

const flashBoom = ref(false)
const furnaceWhiteout = ref(false)
const furnaceWhiteoutColor = ref(PLACEHOLDER_OUTCOME.color)
const edgeOn = ref(false)
const edgeColor = ref('#ffcf28')
const stageShake = ref(false)
const pageImpact = ref(false)
const furnaceRumbling = ref(false)
const pageImpactDuration = ref(480)
let pageImpactTimer = null
let pageImpactFrame = 0
let whiteoutReleaseFrame = 0

const toastMsg = ref('')
const toastShow = ref(false)
let toastTimer = null

const stageRef = ref(null)

// 新的统一流程：合同签订 → 熔炉开合

// 「合同签订」three.js 特效
const contractRef = ref(null)
let contract = null
const showContract = ref(false)
const contractPhase = ref('')
const showStampHint = ref(false) // 「点击此处盖章」提示
const stampHintStyle = ref({})
let paperAudio = null
let stampAudio = null

// 「机械熔炉」three.js 特效（常驻背景层，可交互开合）
const furnaceRef = ref(null)
let furnace = null
let furnaceCloseAudio = null // 液压机构合拢音
let furnaceLockAudio = null // 炉体锁合冲击音
let furnaceReleaseAudio = null
let furnaceLiftAudio = null
let furnaceSpinAudio = null
let furnaceRumbleAudio = null
let energyIgniteAudio = null
let energyChargeAudio = null
let energyClimaxAudio = null
let resultRevealAudio = null

function playSound(el) {
  if (!el) return
  try {
    el.currentTime = 0
    el.play().catch(() => {})
  } catch {
    /* 忽略自动播放限制 */
  }
}

function stopSound(el) {
  if (!el) return
  el.pause()
  el.currentTime = 0
}

function stopFurnaceRevealAudio() {
  [
    furnaceReleaseAudio,
    furnaceLiftAudio,
    furnaceSpinAudio,
    furnaceRumbleAudio,
    energyIgniteAudio,
    energyChargeAudio,
    energyClimaxAudio,
    resultRevealAudio,
  ].forEach(stopSound)
}

function prepareAudio(src, volume) {
  const audio = new Audio(src)
  audio.volume = volume
  audio.preload = 'auto'
  return audio
}

function triggerPageImpact(duration = 480) {
  clearTimeout(pageImpactTimer)
  cancelAnimationFrame(pageImpactFrame)
  pageImpact.value = false
  pageImpactDuration.value = duration
  pageImpactFrame = requestAnimationFrame(() => {
    pageImpact.value = true
    pageImpactTimer = setTimeout(() => (pageImpact.value = false), duration)
  })
}

function resetFurnaceWhiteout() {
  cancelAnimationFrame(whiteoutReleaseFrame)
  whiteoutReleaseFrame = 0
  furnaceWhiteout.value = false
}

function releaseFurnaceWhiteout() {
  cancelAnimationFrame(whiteoutReleaseFrame)
  whiteoutReleaseFrame = requestAnimationFrame(() => {
    whiteoutReleaseFrame = requestAnimationFrame(() => {
      furnaceWhiteout.value = false
      whiteoutReleaseFrame = 0
    })
  })
}

const cfg = computed(() => currentOutcome.value)
const furnaceWhiteoutStyle = computed(() => ({
  '--whiteout-color': furnaceWhiteoutColor.value,
}))

const available = computed(() =>
  inventory.filter(
    (it) => RARITIES[it[4]].need > 0 && !selected.value.includes(it),
  ),
)
const filteredAvailable = computed(() =>
  rarityFilter.value === 'all'
    ? available.value
    : available.value.filter((item) => item[4] === rarityFilter.value),
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
const contractGuideText = computed(() => {
  if (!activeRarity.value) return '选择 10 件相同品质（普通级起）的道具'
  return `选择 ${currentNeed.value} 件相同品质（${RARITIES[activeRarity.value].name}）的道具`
})
const expectedOutcomeText = computed(() => {
  if (!activeRarity.value) return '一件更高一级品质的道具'
  const nextKey = RARITY_ORDER[RARITY_ORDER.indexOf(activeRarity.value) + 1]
  return nextKey ? `一件${RARITIES[nextKey].name}道具` : '一件更高一级品质的道具'
})

function isTradeable(m) {
  return RARITIES[m[4]].need > 0
}
function rarityName(m) {
  return RARITIES[m[4]].name
}
function skinName(m) {
  const separator = m[1].indexOf('|')
  return separator >= 0 ? m[1].slice(separator + 1).trim() : m[1]
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

async function refreshInventory() {
  clearTimeout(inventoryRefreshTimer)
  inventoryRefreshing.value = false
  await nextTick()
  inventoryRefreshing.value = true
  inventoryRefreshTimer = setTimeout(() => {
    inventoryRefreshing.value = false
  }, 520)
  toast('可用库存已刷新')
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

function startCraft() {
  if (running.value || !canConfirmItems.value) return
  running.value = true
  // 按 CS2 汰换规则生成本次结果（随机产出皮肤 → 盈亏随之产生）
  currentOutcome.value = generateOutcome(selected.value, currentNeed.value)
  // 先让左右面板完整离场，再由 onBuilderLeaveComplete 启动 3D 合同
  showBuilder.value = false
}

function onBuilderLeaveComplete() {
  if (!running.value || showBuilder.value || showContract.value) return
  startContract()
}

async function startClassic() {
  showProcess.value = true
  craftCards.value = selected.value.slice()
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
  if (cfg.value.cls !== 'loss') stageShake.value = true
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
  if (window.innerWidth <= 900) {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }
}

async function startContract() {
  showContract.value = true
  contractPhase.value = ''
  showStampHint.value = false
  // 合同逐条列出的材料：名称 + 品质色
  const items = selected.value.map((m) => ({ name: m[1], color: m[2] }))
  await nextTick()
  if (!running.value || !contractRef.value || !furnace) return
  if (!contract) contract = createContract(contractRef.value)
  contract.resize()
  // 面板离场后，同帧启动炉体下降与合同自底部抽出。
  lowerFurnace()
  contract.play({
    items,
    resultTag: cfg.value.tag,
    onPhase: () => {}, // 不显示阶段文字
    onPaper: () => playSound(paperAudio),
    onAwaitStamp: () => {
      // 合同到达盖章位置，显示「点击此处盖章」提示
      const position = contract.getStampScreenPosition()
      const canvasRect = contractRef.value.getBoundingClientRect()
      stampHintStyle.value = {
        left: `${canvasRect.left + position.x}px`,
        top: `${canvasRect.top + position.y}px`,
        width: `${position.diameter}px`,
        height: `${position.diameter}px`,
      }
      showStampHint.value = true
    },
    onStamp: () => {
      playSound(stampAudio)
    },
    onDone: () => {
      contractPhase.value = ''
      showContract.value = false
      showStampHint.value = false
      // 合同生效并抽离后直接开启；若炉体仍在下降，open() 会排队到闭合完成。
      furnace?.open()
    },
  })
}

// 用户点击「盖章」提示
function clickStampHint() {
  if (!showStampHint.value) return
  showStampHint.value = false
  contract?.triggerStamp()
}

// 材料确认后：熔炉上部下降合拢，同时准备后续自动揭晓。
function lowerFurnace() {
  if (!furnace) return
  resetFurnaceWhiteout()
  furnaceRumbling.value = false
  edgeOn.value = false
  furnace.close({
    onCloseStart: () => {
      playSound(furnaceCloseAudio)
    },
    onClose: () => {
      playSound(furnaceLockAudio)
    },
    onClosed: () => {
      furnace.armReveal({
        color: cfg.value.color,
        onOpen: () => {
          stopFurnaceRevealAudio()
          playSound(furnaceReleaseAudio)
          playSound(furnaceLiftAudio)
        },
        onColumn: () => {
          playSound(energyIgniteAudio)
          playSound(energyChargeAudio)
          triggerPageImpact(360)
        },
        onRumbleStart: () => {
          furnaceRumbling.value = true
          playSound(furnaceSpinAudio)
          playSound(furnaceRumbleAudio)
        },
        onRumbleEnd: () => {
          furnaceRumbling.value = false
          stopSound(furnaceSpinAudio)
          stopSound(furnaceRumbleAudio)
          stopSound(energyChargeAudio)
        },
        onClimax: () => {
          furnaceWhiteoutColor.value = cfg.value.color
          furnaceWhiteout.value = true
          playSound(energyClimaxAudio)
          triggerPageImpact(520)
        },
        onDone: () => {
          edgeOn.value = false
          furnaceRumbling.value = false
          playSound(resultRevealAudio)
          showResultView()
          releaseFurnaceWhiteout()
        },
      })
    },
  })
}

function resetAll() {
  clearTimeout(pageImpactTimer)
  cancelAnimationFrame(pageImpactFrame)
  resetFurnaceWhiteout()
  pageImpact.value = false
  furnaceRumbling.value = false
  stopFurnaceRevealAudio()
  showBuilder.value = true
  showProcess.value = false
  showResult.value = false
  showContract.value = false
  contractPhase.value = ''
  showStampHint.value = false
  contract?.stop()
  // 熔炉回到打开待机态
  furnace?.showOpen()
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

function setCardEl(el, i) {
  cardEls[i] = el
}

onMounted(() => {
  // 熔炉常驻背景层，进入页面即打开待机
  if (furnaceRef.value) {
    furnace = createFurnace(furnaceRef.value)
    furnace.showOpen()
  }
  furnaceCloseAudio = new Audio('/sfx/furnace-close.wav')
  furnaceCloseAudio.volume = 0.72
  furnaceCloseAudio.preload = 'auto'
  furnaceLockAudio = new Audio('/sfx/furnace-lock.wav')
  furnaceLockAudio.volume = 0.88
  furnaceLockAudio.preload = 'auto'
  furnaceReleaseAudio = prepareAudio('/sfx/furnace-release.wav', 0.75)
  furnaceLiftAudio = prepareAudio('/sfx/furnace-lift.wav', 0.68)
  furnaceSpinAudio = prepareAudio('/sfx/furnace-spin.wav', 0.52)
  furnaceRumbleAudio = prepareAudio('/sfx/furnace-rumble.wav', 0.28)
  energyIgniteAudio = prepareAudio('/sfx/energy-ignite.wav', 0.48)
  energyChargeAudio = prepareAudio('/sfx/energy-charge.wav', 0.42)
  energyClimaxAudio = prepareAudio('/sfx/energy-climax.wav', 0.58)
  resultRevealAudio = prepareAudio('/sfx/result-reveal.wav', 0.62)
  paperAudio = new Audio('/sfx/paper-rustle.wav')
  paperAudio.volume = 0.6
  paperAudio.preload = 'auto'
  stampAudio = new Audio('/sfx/stamp.wav')
  stampAudio.volume = 0.85
  stampAudio.preload = 'auto'
})

onBeforeUnmount(() => {
  clearTimeout(toastTimer)
  clearTimeout(inventoryRefreshTimer)
  clearTimeout(pageImpactTimer)
  cancelAnimationFrame(pageImpactFrame)
  resetFurnaceWhiteout()
  stopFurnaceRevealAudio()
  contract?.dispose()
  furnace?.dispose()
})
</script>

<template>
  <n-config-provider :theme="darkTheme" :theme-overrides="themeOverrides">
    <div
      class="app"
      :class="{
        'impact-shake': pageImpact,
        'furnace-rumbling': furnaceRumbling,
      }"
      :style="{ '--impact-duration': `${pageImpactDuration}ms` }"
    >
      <!-- 常驻 3D 熔炉铺满视口，与页面背景图融为一体 -->
      <canvas
        class="furnace-layer"
        :class="{ dimmed: showResult }"
        ref="furnaceRef"
      ></canvas>
      <div class="furnace-base-shadow" aria-hidden="true"></div>
      <div class="top">
        <div class="brand">
          <img class="brand-logo" :src="BRAND_LOGO_URL" alt="元游猫" />
        </div>
        <div class="top-actions">
          <!-- 动效模式切换已移除，现在使用统一流程 -->
        </div>
      </div>
      <main class="layout">
        <section class="stage" :class="{ shake: stageShake }" ref="stageRef">
          <div class="stage-head">
            <div>
              <div class="title-line">
                <span class="contract-mark" aria-hidden="true"><span></span></span>
                <div class="title">汰换合同</div>
              </div>
              <div class="subtitle">
                使用同品质道具合成更高一级品质的 1 件道具
              </div>
            </div>
          </div>

          <div class="builder">
            <!-- 左：符合汰换资格的材料池 -->
            <Transition appear name="builder-left">
            <section v-show="showBuilder" class="inv-panel panel-box">
              <div class="inv-head">
                <div class="inv-title-row">
                  <div class="inv-title">
                    <span>可用库存</span>
                    <b>{{ eligibleCount }}</b>
                    <small>件</small>
                    <button
                      class="refresh-btn"
                      :class="{ refreshing: inventoryRefreshing }"
                      type="button"
                      aria-label="刷新可用库存"
                      title="刷新可用库存"
                      @click="refreshInventory"
                    >
                      <span aria-hidden="true">↻</span>
                    </button>
                  </div>
                  <label class="quality-select">
                    <span class="sr-only">按品质筛选</span>
                    <select v-model="rarityFilter" aria-label="按品质筛选库存">
                      <option value="all">全部品质</option>
                      <option v-for="key in FILTER_RARITIES" :key="key" :value="key">
                        {{ RARITIES[key].name }}
                      </option>
                    </select>
                  </label>
                </div>
              </div>
              <div class="inv-list">
                <div
                  v-for="m in filteredAvailable"
                  :key="m[5]"
                  class="inv-item"
                  :class="{ locked: !canAdd(m) }"
                  :style="{ '--c': m[2] }"
                  :draggable="canAdd(m)"
                  @dragstart="onDragStart(m)"
                  @dragend="dragItem = null"
                >
                  <span v-if="canAdd(m)" class="add-hint">拖拽</span>
                  <span v-else class="lock-tag">{{ lockReason(m) }}</span>
                  <div class="weapon-thumb">
                    <img :src="GENERIC_WEAPON_URL" alt="" aria-hidden="true" draggable="false" />
                  </div>
                  <div class="code">{{ m[0] }}</div>
                  <div class="nm">{{ skinName(m) }}</div>
                  <div class="meta">
                    <span class="rarity" :style="{ color: wearFor(m).color }">{{
                      wearFor(m).name
                    }}</span>
                    <span class="fl" :title="`Float ${m[3]}`">{{ m[3] }}</span>
                  </div>
                </div>
                <div v-if="!filteredAvailable.length" class="inv-empty">
                  {{ rarityFilter === 'all' ? '材料已全部加入汰换栏' : '当前品质暂无可用物品' }}
                </div>
              </div>
            </section>
            </Transition>

            <!-- 右：汰换合同栏 -->
            <Transition
              appear
              name="builder-right"
              @after-leave="onBuilderLeaveComplete"
            >
            <section v-show="showBuilder" class="contract-panel panel-box">
              <div class="contract-head">汰换合同</div>
              <div class="contract-summary">
                <div class="contract-count">
                  <strong>{{ selected.length }}</strong>
                  <span>/</span>
                  <b>{{ activeRarity ? currentNeed : 10 }}</b>
                </div>
                <div class="selected-count">已选择 {{ selected.length }} 件</div>
                <div class="contract-guide">{{ contractGuideText }}</div>
              </div>
              <div
                class="contract-drop"
                :class="{ drag: dropActive }"
                @dragover.prevent="dropActive = true"
                @dragleave="onDragLeave"
                @drop="onDrop"
              >
                <div v-if="!selected.length" class="contract-placeholder">
                  <div class="ph-icon" aria-hidden="true"><span></span><span></span></div>
                  <div class="big">从左侧库存中选择道具</div>
                  <div class="small">或将道具拖入此处</div>
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
                    <div class="weapon-thumb">
                      <img :src="GENERIC_WEAPON_URL" alt="" aria-hidden="true" draggable="false" />
                    </div>
                    <div class="code">{{ m[0] }}</div>
                    <div class="nm">{{ skinName(m) }}</div>
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
              <div class="expected-outcome">
                <span>预计获得：</span><strong>{{ expectedOutcomeText }}</strong>
              </div>
              <div class="contract-footer">
                <div class="contract-tools">
                  <n-button secondary class="tool-btn" @click="resetSelected">
                    <span class="button-icon" aria-hidden="true">↻</span>重置合同
                  </n-button>
                  <n-button secondary class="tool-btn" @click="autoFill">
                    <span class="button-icon check-icon" aria-hidden="true">✓</span>自动选择
                  </n-button>
                </div>
                <div class="confirm-tools">
                  <n-checkbox
                    v-model:checked="confirmChecked"
                    :disabled="!canConfirmItems"
                  >
                    确认物品
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
              </div>
            </section>
            </Transition>
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
                <img :src="GENERIC_WEAPON_URL" alt="" aria-hidden="true" draggable="false" />
                <b>{{ m[0] }}</b>
                <span>{{ skinName(m) }}</span>
              </div>
            </div>
          </div>

          <canvas
            class="forge-layer contract-layer"
            :class="{ show: showContract }"
            ref="contractRef"
          ></canvas>
          <div class="forge-phase contract-phase" :class="{ show: showContract && !!contractPhase }">
            {{ contractPhase }}
          </div>
          <!-- 「点击此处盖章」提示：合同到达盖章位置时显示，覆盖在印章位置 -->
          <button
            class="stamp-hint"
            :class="{ show: showStampHint }"
            :style="stampHintStyle"
            @click="clickStampHint"
          >
            <span class="stamp-ring"></span>
            <span class="stamp-text">点击此处<br />盖章</span>
          </button>

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
    <Teleport to="body">
      <div
        class="furnace-whiteout"
        :class="{ active: furnaceWhiteout }"
        :style="furnaceWhiteoutStyle"
        aria-hidden="true"
      ></div>
    </Teleport>
  </n-config-provider>
</template>

<style scoped>
/* 移除右侧状态说明栏后，舞台占满整行 */
.layout {
  grid-template-columns: minmax(0, 1fr);
}

/* 舞台透明化：去掉实心背景/边框/阴影/网格与辉光遮罩，
   让 .app 的背景图透出来，3D 熔炉直接叠在背景图上（同一图层观感） */
.stage {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  overflow: visible !important;
}
.stage::before,
.stage::after {
  display: none !important;
}

/* 3D 熔炉铺满整个视口，与背景图融为一体。 */
.furnace-layer {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  z-index: 1;
  pointer-events: none;
  transition: opacity 0.35s ease, filter 0.35s ease;
}
.furnace-layer.dimmed {
  opacity: 0.16;
  filter: brightness(0.55) saturate(0.55);
}

/* CSS contact shadow beneath the floating furnace base. */
.furnace-base-shadow {
  position: fixed;
  left: 50%;
  top: 75.5vh;
  z-index: 0;
  width: clamp(320px, 42vw, 620px);
  height: clamp(72px, 9vw, 124px);
  pointer-events: none;
  transform: translate(-50%, -50%);
  transform-origin: center;
  border-radius: 50%;
  background:
    radial-gradient(
      ellipse at center,
      rgba(0, 0, 0, 0.82) 0%,
      rgba(0, 0, 0, 0.66) 27%,
      rgba(2, 7, 14, 0.4) 48%,
      rgba(4, 12, 24, 0.16) 65%,
      transparent 78%
    ),
    radial-gradient(
      ellipse at center,
      rgba(13, 31, 54, 0.34),
      transparent 70%
    );
  filter: blur(9px);
  mix-blend-mode: multiply;
  opacity: 0.88;
  transition: opacity 0.35s ease, filter 0.35s ease;
  will-change: opacity, transform;
}
.furnace-layer.dimmed + .furnace-base-shadow {
  opacity: 0.18;
  filter: blur(12px);
}

.furnace-whiteout {
  --whiteout-color: #ffcf28;

  position: fixed;
  inset: 0;
  z-index: 80;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.34s ease-out;
  will-change: opacity;
}
.furnace-whiteout::before,
.furnace-whiteout::after {
  content: '';
  position: absolute;
  pointer-events: none;
}
.furnace-whiteout::before {
  left: 50%;
  top: 54%;
  width: 28vmax;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    #fff 0%,
    #fff 18%,
    color-mix(in oklab, #fff 76%, var(--whiteout-color)) 44%,
    color-mix(in oklab, var(--whiteout-color) 42%, transparent) 64%,
    transparent 76%
  );
  filter: blur(10px);
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.08);
  transition: transform 0.34s ease-out, opacity 0.2s ease-out;
  will-change: transform, opacity;
}
.furnace-whiteout::after {
  inset: 0;
  background-color: #fff;
  background-color: color-mix(in oklab, #fff 88%, var(--whiteout-color));
  background-image: radial-gradient(
    circle at 50% 54%,
    #fff 0%,
    rgba(255, 255, 255, 0.98) 18%,
    rgba(255, 255, 255, 0.62) 48%,
    transparent 78%
  );
  opacity: 0;
  transition: opacity 0.3s ease-out;
  will-change: opacity;
}
.furnace-whiteout.active {
  opacity: 1;
  transition: none;
}
.furnace-whiteout.active::before {
  opacity: 1;
  transform: translate(-50%, -50%) scale(7.4);
  transition: transform 0.52s cubic-bezier(0.42, 0, 0.72, 1), opacity 0.12s linear;
}
.furnace-whiteout.active::after {
  opacity: 1;
  transition: opacity 0.52s linear;
}

@media (max-width: 900px) {
  .furnace-base-shadow {
    top: 76.5vh;
    width: min(88vw, 430px);
    height: 82px;
    filter: blur(7px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .furnace-whiteout,
  .furnace-whiteout::before,
  .furnace-whiteout::after,
  .furnace-whiteout.active,
  .furnace-whiteout.active::before,
  .furnace-whiteout.active::after {
    transition-duration: 0.12s;
    transition-delay: 0s;
  }
  .furnace-whiteout.active::before {
    transform: translate(-50%, -50%) scale(7.4);
  }
}

/* 右上角：切换汰换动效 */
.anim-switch {
  display: flex;
  align-items: center;
  gap: 8px;
}
.anim-label {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #94a3b8;
}
.anim-select {
  width: 152px;
}
.top-divider {
  width: 1px;
  height: 22px;
  background: rgba(255, 255, 255, 0.14);
  margin: 0 4px;
}

/* three.js「熔炉锻造」覆盖层 */
.forge-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: transparent;
  z-index: 5;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.45s ease;
}
.forge-layer.show {
  opacity: 1;
}
.forge-layer.contract-layer {
  position: fixed;
  inset: 88px 24px 24px;
  width: calc(100vw - 48px);
  height: calc(100vh - 112px);
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
/* 「合同签订」阶段标签：改用暖金/羊皮纸配色，区别于熔炉的火焰橙 */
.forge-phase.contract-phase {
  border-color: rgba(212, 175, 55, 0.5);
  background: rgba(20, 16, 8, 0.6);
  color: #ffe9b0;
  text-shadow: 0 0 16px rgba(212, 175, 55, 0.6);
}
/* 「武器箱开启」需要接收点击（Raycaster 命中箱体才开箱） */
.forge-layer.case-layer.show {
  pointer-events: auto;
}

/* 「点击此处盖章」提示按钮 */
.stamp-hint {
  position: fixed;
  z-index: 7;
  width: 120px;
  height: 120px;
  border: 3px solid rgba(212, 175, 55, 0.9);
  border-radius: 50%;
  background: rgba(255, 207, 40, 0.12);
  backdrop-filter: blur(8px);
  color: #ffe9b0;
  font-size: 15px;
  font-weight: 900;
  line-height: 1.4;
  letter-spacing: 0.05em;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.8);
  pointer-events: none;
  transition: all 0.4s ease;
  text-shadow: 0 0 12px rgba(212, 175, 55, 0.8);
}
.stamp-hint.show {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
  pointer-events: auto;
  animation: stampHintPulse 1.8s ease-in-out infinite;
}
.stamp-hint:hover {
  background: rgba(255, 207, 40, 0.22);
  border-color: rgba(212, 175, 55, 1);
  box-shadow: 0 0 24px rgba(212, 175, 55, 0.6);
}
.stamp-hint .stamp-ring {
  position: absolute;
  inset: -8px;
  border: 2px solid rgba(212, 175, 55, 0.4);
  border-radius: 50%;
}
.stamp-hint .stamp-text {
  position: relative;
  z-index: 1;
  text-align: center;
}
@keyframes stampHintPulse {
  0%, 100% {
    transform: translate(-50%, -50%) scale(1);
    box-shadow: 0 0 16px rgba(212, 175, 55, 0.4);
  }
  50% {
    transform: translate(-50%, -50%) scale(1.08);
    box-shadow: 0 0 28px rgba(212, 175, 55, 0.6);
  }
}

/* ===== 参考图工业控制台视觉；双栏宽度定义保持不变 ===== */
.top {
  height: 62px;
  padding: 0 28px;
  border-bottom-color: rgba(162, 174, 180, 0.16);
  background: rgba(2, 5, 7, 0.78);
  backdrop-filter: blur(10px);
}
.brand {
  display: flex;
  align-items: center;
  color: #c8ff00;
  font-size: 15px;
  letter-spacing: 0;
}
.brand-logo {
  display: block;
  width: auto;
  height: 38px;
}
.brand span {
  margin-left: 14px;
  color: #f1f3f4;
  font-size: 14px;
}
.layout {
  padding-top: 18px;
}
.stage-head {
  padding: 26px 30px 14px;
}
.title-line {
  display: flex;
  align-items: center;
  gap: 12px;
}
.contract-mark {
  position: relative;
  width: 25px;
  height: 25px;
  flex: 0 0 25px;
  border: 3px solid #ffc928;
  transform: rotate(45deg);
}
.contract-mark::before,
.contract-mark span {
  content: '';
  position: absolute;
  inset: 5px;
  border: 2px solid #ffc928;
}
.contract-mark span {
  inset: 11px -4px -4px 11px;
  border-left: 0;
  border-top: 0;
}
.title {
  margin: 0;
  color: #f4f6f7;
  font: 800 34px/1.05 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  letter-spacing: 0;
}
.subtitle {
  margin-top: 8px;
  color: #b4bbc0;
  font-size: 13px;
}

.builder {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.02fr);
  gap: 22px;
  align-items: stretch;
}
.builder-left-enter-active,
.builder-right-enter-active {
  transition:
    transform 0.62s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.48s ease;
  will-change: transform, opacity;
}
.builder-right-enter-active {
  transition-delay: 0.07s;
}
.builder-left-leave-active,
.builder-right-leave-active {
  pointer-events: none;
  transition:
    transform 0.5s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.46s ease-in;
  will-change: transform, opacity;
}
.builder-left-enter-from,
.builder-left-leave-to {
  opacity: 0;
  transform: translate3d(-88px, 0, 0) scale(0.985);
}
.builder-right-enter-from,
.builder-right-leave-to {
  opacity: 0;
  transform: translate3d(88px, 0, 0) scale(0.985);
}

.panel-box {
  height: 656px;
  min-height: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #5b6266;
  border-radius: 3px;
  background: rgba(8, 13, 16, 0.92);
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.7),
    0 14px 38px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(7px);
}

/* 左侧库存 */
.inv-head {
  flex: 0 0 46px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid #30383c;
  background: rgba(20, 25, 28, 0.96);
}
.inv-title-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.inv-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #f0f2f3;
  white-space: nowrap;
}
.inv-title span {
  font-size: 14px;
  font-weight: 800;
}
.inv-title b,
.inv-title small {
  color: #c5cbd0;
  font-size: 13px;
  font-weight: 600;
}
.refresh-btn {
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: #8d979c;
  font: 400 19px/1 sans-serif;
  cursor: pointer;
}
.refresh-btn:hover,
.refresh-btn:focus-visible {
  color: #ffc928;
  outline: 1px solid #555f64;
  outline-offset: -3px;
}
.refresh-btn.refreshing span {
  display: inline-block;
  animation: inventoryRefresh 0.52s cubic-bezier(0.3, 0.8, 0.3, 1);
}
@keyframes inventoryRefresh {
  to { transform: rotate(360deg); }
}
.quality-select {
  position: relative;
  flex: 0 0 auto;
}
.quality-select select {
  width: 112px;
  height: 30px;
  padding: 0 28px 0 10px;
  border: 1px solid #596267;
  border-radius: 2px;
  background: #0d1215;
  color: #dce0e2;
  font-size: 12px;
  cursor: pointer;
}
.quality-select select:focus-visible {
  border-color: #ffc928;
  outline: 1px solid rgba(255, 201, 40, 0.45);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.inv-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 10px;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-auto-rows: 111px;
  gap: 6px;
  align-content: start;
  overflow-y: auto;
}
.inv-list::-webkit-scrollbar,
.contract-grid::-webkit-scrollbar {
  width: 6px;
}
.inv-list::-webkit-scrollbar-track,
.contract-grid::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.025);
}
.inv-list::-webkit-scrollbar-thumb,
.contract-grid::-webkit-scrollbar-thumb {
  border-radius: 0;
  background: #3c454a;
}
.inv-item,
.contract-item {
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 111px;
  padding: 7px 7px 3px 10px;
  overflow: hidden;
  border: 1px solid #2d373c;
  border-radius: 2px;
  background: linear-gradient(180deg, rgba(26, 34, 38, 0.98), rgba(14, 20, 23, 0.98));
  user-select: none;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.inv-item {
  cursor: grab;
}
.inv-item::after,
.contract-item::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  height: auto;
  background: var(--c);
  box-shadow: none;
}
.inv-item:hover {
  border-color: rgba(255, 201, 40, 0.62);
  background: linear-gradient(180deg, rgba(35, 43, 47, 0.98), rgba(17, 24, 27, 0.98));
  transform: none;
  box-shadow: none;
}
.inv-item:active {
  cursor: grabbing;
}
.weapon-thumb {
  width: 100%;
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.weapon-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 1;
  filter: brightness(1.35) saturate(0.78);
}
.inv-item .code,
.contract-item .code {
  overflow: hidden;
  color: #eef1f2;
  font: 800 11px/15px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0;
  text-shadow: none;
}
.inv-item .nm,
.contract-item .nm {
  margin-top: 1px;
  overflow: hidden;
  color: #b7bec2;
  font-size: 10px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inv-item .meta,
.contract-item .meta {
  min-width: 0;
  margin-top: 2px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.inv-item .rarity,
.contract-item .rarity {
  min-width: 0;
  overflow: hidden;
  font-size: 9px;
  font-weight: 700;
  line-height: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0;
}
.inv-item .fl,
.contract-item .fl {
  flex: none;
  color: #7f8a90;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  line-height: 13px;
}
.inv-item .add-hint,
.inv-item .lock-tag,
.contract-item .rm {
  position: absolute;
  z-index: 2;
  top: 5px;
  right: 5px;
  padding: 2px 4px;
  border-radius: 1px;
  background: rgba(7, 11, 13, 0.84);
  color: #a2abb0;
  font-size: 8px;
  font-weight: 700;
  line-height: 12px;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease;
}
.inv-item:hover .add-hint,
.contract-item:hover .rm {
  opacity: 1;
}
.inv-item .lock-tag {
  color: #c3c8ca;
  opacity: 1;
}
.inv-item.locked {
  cursor: not-allowed;
  filter: grayscale(0.45);
  opacity: 0.38;
}
.inv-item.locked:hover {
  border-color: #2d373c;
  background: linear-gradient(180deg, rgba(26, 34, 38, 0.98), rgba(14, 20, 23, 0.98));
}
.inv-empty {
  grid-column: 1 / -1;
  padding: 42px 0;
  color: #737d82;
  font-size: 12px;
  text-align: center;
}

/* 右侧合同 */
.contract-head {
  flex: 0 0 44px;
  padding: 0 15px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid #30383c;
  background: rgba(20, 25, 28, 0.96);
  color: #f0f2f3;
  font-size: 14px;
  font-weight: 800;
}
.contract-summary {
  flex: 0 0 91px;
  padding: 8px 14px 7px;
  text-align: center;
}
.contract-count {
  color: #f4f5f5;
  font-size: 27px;
  font-weight: 800;
  line-height: 30px;
}
.contract-count strong,
.contract-count b {
  font: inherit;
}
.contract-count span {
  margin: 0 7px;
  color: #8f989d;
}
.contract-count b {
  color: #ffc928;
}
.selected-count {
  color: #c0c5c8;
  font-size: 11px;
  line-height: 16px;
}
.contract-guide {
  margin-top: 4px;
  overflow: hidden;
  color: #8d969b;
  font-size: 11px;
  line-height: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.contract-drop {
  flex: 1;
  min-height: 0;
  margin: 0 14px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px dashed #596267;
  border-radius: 2px;
  background: rgba(5, 9, 11, 0.47);
  transition: border-color 0.18s ease, background-color 0.18s ease;
}
.contract-drop.drag {
  border-color: #ffc928;
  background: rgba(255, 201, 40, 0.04);
  box-shadow: inset 0 0 28px rgba(255, 201, 40, 0.08);
}
.contract-placeholder {
  margin: auto;
  padding: 18px;
  color: #6e777c;
  text-align: center;
}
.contract-placeholder .ph-icon {
  position: relative;
  width: 58px;
  height: 46px;
  margin: 0 auto 14px;
  opacity: 0.62;
}
.contract-placeholder .ph-icon span {
  position: absolute;
  left: 15px;
  width: 28px;
  height: 28px;
  border: 3px solid #555d61;
  transform: rotate(45deg);
}
.contract-placeholder .ph-icon span:first-child {
  top: 1px;
}
.contract-placeholder .ph-icon span:last-child {
  top: 13px;
  clip-path: inset(0 0 11px 0);
}
.contract-placeholder .big {
  color: #aeb4b7;
  font-size: 15px;
  font-weight: 700;
}
.contract-placeholder .small {
  margin-top: 10px;
  color: #70797e;
  font-size: 12px;
}
.contract-grid {
  flex: 1;
  min-height: 0;
  padding-right: 2px;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-auto-rows: 111px;
  gap: 6px;
  align-content: start;
  overflow-y: auto;
}
.contract-item {
  cursor: pointer;
}
.contract-item:hover {
  border-color: rgba(255, 105, 105, 0.64);
  transform: none;
  box-shadow: none;
}
.contract-item:hover .rm {
  color: #ff7373;
}
.contract-item.empty {
  height: 111px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed #323b40;
  background: rgba(255, 255, 255, 0.012);
  cursor: default;
}
.contract-item.empty::after {
  display: none;
}
.contract-item.empty:hover {
  border-color: #323b40;
}
.contract-item.empty .slot-idx {
  color: #424b50;
  font-size: 12px;
  font-weight: 700;
}
.expected-outcome {
  flex: 0 0 41px;
  margin: 0 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid #293135;
  color: #a9afb2;
  font-size: 11px;
}
.expected-outcome strong {
  color: #ffc928;
  font-weight: 800;
}
.contract-footer {
  flex: 0 0 64px;
  margin: 0;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-top: 1px solid #30383c;
  background: rgba(17, 22, 25, 0.96);
}
.contract-tools,
.confirm-tools {
  display: flex;
  align-items: center;
  gap: 7px;
}
.contract-tools :deep(.n-button),
.confirm-btn {
  border-radius: 2px;
  font-size: 12px;
}
.contract-tools :deep(.n-button) {
  height: 36px;
  padding: 0 11px;
}
.button-icon {
  margin-right: 7px;
  color: #c8ced1;
  font-size: 18px;
  line-height: 1;
}
.check-icon {
  width: 16px;
  height: 16px;
  display: inline-grid;
  place-items: center;
  border: 1px solid #768086;
  font-size: 11px;
}
.contract-footer :deep(.n-checkbox) {
  font-weight: 700;
  --n-font-size: 12px;
}
.confirm-btn {
  min-width: 142px;
  height: 42px;
  letter-spacing: 0;
  --n-color-disabled: #3a3f42 !important;
  --n-color-hover-disabled: #3a3f42 !important;
  --n-color-pressed-disabled: #3a3f42 !important;
  --n-text-color-disabled: #777d80 !important;
  --n-border-disabled: 1px solid #444b4f !important;
}

.process-grid .card img {
  width: 86%;
  height: 50px;
  object-fit: contain;
}
.process-grid .card b {
  margin-top: 4px;
  font: 800 15px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.result-card,
.stat,
.result-actions button,
.tag {
  border-radius: 3px;
}
.result-card {
  border-color: #596267;
  background: linear-gradient(180deg, rgba(23, 30, 34, 0.96), rgba(7, 12, 15, 0.98));
}

@media (min-width: 901px) and (max-width: 1200px) {
  .inv-list,
  .contract-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .builder {
    grid-template-columns: 1fr;
  }
  .builder-left-enter-from,
  .builder-left-leave-to {
    transform: translate3d(-36px, 0, 0) scale(0.99);
  }
  .builder-right-enter-from,
  .builder-right-leave-to {
    transform: translate3d(36px, 0, 0) scale(0.99);
  }
  .stamp-hint {
    border-width: 2px;
    font-size: 12px;
  }
  .forge-layer.contract-layer {
    inset: 80px 12px 12px;
    width: calc(100vw - 24px);
    height: calc(100vh - 92px);
  }
  .inv-list {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .contract-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .top {
    height: 58px;
    padding: 0 16px;
  }
  .brand {
    font-size: 14px;
  }
  .brand-logo {
    height: 32px;
  }
  .brand span {
    margin-left: 8px;
    font-size: 12px;
  }
  .stage-head {
    padding: 20px 16px 12px;
  }
  .title {
    font-size: 28px;
  }
  .contract-mark {
    width: 21px;
    height: 21px;
    flex-basis: 21px;
  }
  .panel-box {
    height: 640px;
  }
  .inv-title-row {
    gap: 8px;
  }
  .quality-select select {
    width: 104px;
  }
  .inv-list,
  .contract-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .contract-footer {
    flex-basis: 108px;
    flex-wrap: wrap;
  }
  .contract-tools,
  .confirm-tools {
    width: 100%;
    justify-content: space-between;
  }
  .contract-tools :deep(.n-button) {
    flex: 1;
  }
  .confirm-btn {
    min-width: 142px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .refresh-btn.refreshing span {
    animation: none;
  }
  .builder-left-enter-active,
  .builder-right-enter-active,
  .builder-left-leave-active,
  .builder-right-leave-active {
    transition-duration: 1ms;
    transition-delay: 0s;
  }
  .builder-left-enter-from,
  .builder-left-leave-to,
  .builder-right-enter-from,
  .builder-right-leave-to {
    transform: none;
  }
}
</style>
