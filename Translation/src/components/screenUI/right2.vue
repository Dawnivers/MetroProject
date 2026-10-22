<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

// 12 个月告警遥测数据集：仅记录原始值，坐标与曲线全部由数组推导
const monthData = [
  { month: '1月', current: 108, last: 130 },
  { month: '2月', current: 118, last: 150 },
  { month: '3月', current: 128, last: 148 },
  { month: '4月', current: 110, last: 130 },
  { month: '5月', current: 148, last: 145 },
  { month: '6月', current: 125, last: 155 },
  { month: '7月', current: 210, last: 230 },
  { month: '8月', current: 125, last: 150 },
  { month: '9月', current: 105, last: 120 },
  { month: '10月', current: 98, last: 112 },
  { month: '11月', current: 165, last: 205 },
  { month: '12月', current: 228, last: 258 },
];

// SVG 视口与坐标映射常量
const VIEW_W = 760;
const VIEW_H = 240;
const X_START = 58;
const X_END = 732;
const Y_BASE = 200; // 数值 0 对应的 y
const Y_TOP = 20; // 数值 300 对应的 y
const Y_MAX_VALUE = 300;

const toX = (i) => X_START + (i * (X_END - X_START)) / (monthData.length - 1);
const toY = (value) =>
  Math.round(Y_BASE - (value / Y_MAX_VALUE) * (Y_BASE - Y_TOP));

// 月份 + 坐标（x / 今年 y / 去年 y）
const chartData = computed(() =>
  monthData.map((item, i) => ({
    ...item,
    x: toX(i),
    currentY: toY(item.current),
    lastY: toY(item.last),
  })),
);

// Y 轴刻度与网格线
const gridTicks = computed(() =>
  [300, 250, 200, 150, 100, 50, 0].map((value) => ({
    value,
    y: toY(value),
    isBase: value === 0,
  })),
);

// 平滑样条：每个数据点处切线水平，控制点取相邻两点的中点
const buildLinePath = (key) => {
  const points = chartData.value;
  let d = `M ${points[0].x},${points[0][key]}`;
  for (let i = 1; i < points.length; i++) {
    const midX = (points[i - 1].x + points[i].x) / 2;
    d += ` C ${midX},${points[i - 1][key]} ${midX},${points[i][key]} ${points[i].x},${points[i][key]}`;
  }
  return d;
};

const buildAreaPath = (key) => {
  const points = chartData.value;
  const last = points[points.length - 1];
  return `${buildLinePath(key)} L ${last.x},${Y_BASE} L ${points[0].x},${Y_BASE} Z`;
};

const lastYearLinePath = computed(() => buildLinePath('lastY'));
const lastYearAreaPath = computed(() => buildAreaPath('lastY'));
const currentYearLinePath = computed(() => buildLinePath('currentY'));
const currentYearAreaPath = computed(() => buildAreaPath('currentY'));

const lastPoint = computed(() => chartData.value[chartData.value.length - 1]);

// 年同比变动率（由数组求和推导）
const yearOverYear = computed(() => {
  const currentSum = monthData.reduce((sum, m) => sum + m.current, 0);
  const lastSum = monthData.reduce((sum, m) => sum + m.last, 0);
  const ratio = ((currentSum - lastSum) / lastSum) * 100;
  return {
    text: `${ratio > 0 ? '+' : ''}${ratio.toFixed(1)}%`,
    isUp: ratio > 0,
    currentSum,
    lastSum,
  };
});

/* ---------------- 交互式探针 ---------------- */
const svgEl = ref(null);
const hoverState = ref({
  index: -1,
  left: 0,
  top: 0,
  transform: 'translate(-50%, -115%)',
});

const hoveredItem = computed(() =>
  hoverState.value.index >= 0 ? chartData.value[hoverState.value.index] : null,
);

const hoveredDiff = computed(() => {
  const item = hoveredItem.value;
  if (!item) return null;
  const ratio = (((item.current - item.last) / item.last) * 100).toFixed(1);
  const isUp = item.current > item.last;
  return {
    text: `${isUp ? '↑ +' : '↓ '}${ratio}%`,
    color: isUp ? '#f87171' : '#34d399',
  };
});

// 默认 7月(索引6)、12月(索引11) 常亮，其余跟随悬停
const labelFill = (i) => {
  if (i === hoverState.value.index) return '#38bdf8';
  if (i === 6) return '#38bdf8';
  if (i === 11) return '#00f5b8';
  return 'rgba(148, 163, 184, 0.65)';
};

const labelWeight = (i) => {
  if (i === hoverState.value.index) return 700;
  if (i === 6 || i === 11) return 600;
  return 400;
};

const handleMouseMove = (event) => {
  const svg = svgEl.value;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const svgX = (event.clientX - rect.left) * (VIEW_W / rect.width);

  // 仅在数据有效范围内激活
  if (svgX < 35 || svgX > 750) {
    handleMouseLeave();
    return;
  }

  // 吸附到最近的月份刻度
  let closest = 0;
  let minDiff = Infinity;
  chartData.value.forEach((item, i) => {
    const diff = Math.abs(item.x - svgX);
    if (diff < minDiff) {
      minDiff = diff;
      closest = i;
    }
  });

  const item = chartData.value[closest];
  const pixelX = (item.x / VIEW_W) * rect.width;
  const pixelY = (Math.min(item.currentY, item.lastY) / VIEW_H) * rect.height;

  // 边缘避让，避免浮层出界
  let transform = 'translate(-50%, -115%)';
  if (pixelX < 75) transform = 'translate(0%, -115%)';
  else if (pixelX > rect.width - 75) transform = 'translate(-100%, -115%)';

  hoverState.value = { index: closest, left: pixelX, top: pixelY, transform };
};

const handleMouseLeave = () => {
  hoverState.value = { ...hoverState.value, index: -1 };
};

/* ---------------- 沿曲线流动的能量脉冲 ---------------- */
const currentYearPathEl = ref(null);
const pulseGroupEl = ref(null);
const PULSE_DURATION = 4800;

let pathLength = 0;
let rafId = null;
let pulseStartTimer = null;
let pulseStart = null;

const animatePulse = (timestamp) => {
  const path = currentYearPathEl.value;
  const group = pulseGroupEl.value;

  if (path && group && pathLength > 0) {
    if (pulseStart === null) pulseStart = timestamp;
    const progress =
      ((timestamp - pulseStart) % PULSE_DURATION) / PULSE_DURATION;

    const point = path.getPointAtLength(progress * pathLength);
    group.setAttribute('transform', `translate(${point.x}, ${point.y})`);

    // 首尾平滑淡入淡出
    if (progress < 0.05) group.style.opacity = String(progress / 0.05);
    else if (progress > 0.95)
      group.style.opacity = String((1 - progress) / 0.05);
    else group.style.opacity = '1';
  }

  rafId = requestAnimationFrame(animatePulse);
};

onMounted(() => {
  const path = currentYearPathEl.value;
  if (path) {
    try {
      pathLength = path.getTotalLength();
    } catch (e) {
      pathLength = 800;
    }
  }
  // 曲线描边入场动画初步展开后再启动流光
  pulseStartTimer = setTimeout(() => {
    rafId = requestAnimationFrame(animatePulse);
  }, 300);
});

onBeforeUnmount(() => {
  clearTimeout(pulseStartTimer);
  if (rafId) cancelAnimationFrame(rafId);
});
</script>

<template>
  <div class="right2-page">
    <section
      aria-label="告警趋势分析"
      class="occ-panel-wrapper"
      data-purpose="alarm-trend-panel"
    >
      <!-- 四角科技卡角 -->
      <span class="corner-bracket corner-tl"></span>
      <span class="corner-bracket corner-tr"></span>
      <span class="corner-bracket corner-bl"></span>
      <span class="corner-bracket corner-br"></span>

      <!-- 头部栏：标题 + 图例 + 指标小标 -->
      <header class="header-container" data-purpose="panel-header">
        <div class="title-group">
          <div class="main-title">
            <span>告警趋势</span>
          </div>
          <div aria-hidden="true" class="matrix-dots">
            <span v-for="n in 12" :key="n" class="matrix-dot"></span>
          </div>
        </div>
        <div class="indicator-group" data-purpose="legend-stats">
          <div class="legend-item">
            <span class="legend-indicator-line legend-last-year"></span>
            <span>去年</span>
          </div>
          <div class="legend-item">
            <span class="legend-indicator-line legend-current-year"></span>
            <span>今年实时</span>
          </div>
          <div class="stat-pill font-mono-num" title="年同比变动率">
            <span>同比</span>
            <span
              class="trend-down-val"
              :style="yearOverYear.isUp ? { color: '#f87171' } : null"
              >{{ yearOverYear.text }}</span
            >
          </div>
          <div class="stat-pill font-mono-num" title="OCC 活跃待闭环故障">
            <span class="open-alert-dot"></span>
          </div>
        </div>
      </header>

      <!-- 图表舞台 -->
      <div class="chart-container" data-purpose="chart-canvas-view">
        <svg
          ref="svgEl"
          class="svg-chart"
          preserveAspectRatio="none"
          viewBox="0 0 760 240"
          @mousemove="handleMouseMove"
          @mouseleave="handleMouseLeave"
        >
          <defs>
            <linearGradient id="lastYearAreaGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="#0284c7" stop-opacity="0.22"></stop>
              <stop
                offset="100%"
                stop-color="#0284c7"
                stop-opacity="0.0"
              ></stop>
            </linearGradient>
            <linearGradient
              id="currentYearAreaGrad"
              x1="0"
              x2="0"
              y1="0"
              y2="1"
            >
              <stop offset="0%" stop-color="#00f5b8" stop-opacity="0.34"></stop>
              <stop
                offset="60%"
                stop-color="#00f5b8"
                stop-opacity="0.08"
              ></stop>
              <stop
                offset="100%"
                stop-color="#00f5b8"
                stop-opacity="0.0"
              ></stop>
            </linearGradient>
            <filter id="pulseGlow" height="200%" width="200%" x="-50%" y="-50%">
              <feGaussianBlur
                in="SourceGraphic"
                result="blur"
                stdDeviation="3"
              ></feGaussianBlur>
              <feMerge>
                <feMergeNode in="blur"></feMergeNode>
                <feMergeNode in="SourceGraphic"></feMergeNode>
              </feMerge>
            </filter>
          </defs>

          <!-- Y 轴水平刻度辅助线与数值 -->
          <g v-for="tick in gridTicks" :key="tick.value" class="grid-group">
            <line
              class="grid-line"
              :stroke="tick.isBase ? 'rgba(56, 189, 248, 0.28)' : null"
              :stroke-width="tick.isBase ? 1.2 : null"
              x1="45"
              x2="745"
              :y1="tick.y"
              :y2="tick.y"
            ></line>
            <text
              class="axis-label font-mono-num"
              text-anchor="end"
              x="35"
              :y="tick.y + 4"
            >
              {{ tick.value }}
            </text>
          </g>

          <!-- 轴单位标识 -->
          <text
            class="axis-label"
            fill="rgba(148, 163, 184, 0.5)"
            font-size="9"
            text-anchor="start"
            x="44"
            y="8"
          >
            (件/次)
          </text>

          <!-- X 轴月份刻度 -->
          <g class="x-axis-labels">
            <text
              v-for="(item, i) in chartData"
              :key="item.month"
              class="axis-label"
              :fill="labelFill(i)"
              :font-weight="labelWeight(i)"
              text-anchor="middle"
              :x="item.x"
              y="222"
            >
              {{ item.month }}
            </text>
          </g>

          <!-- 去年趋势（天蓝） -->
          <path
            class="chart-area"
            :d="lastYearAreaPath"
            fill="url(#lastYearAreaGrad)"
          ></path>
          <path class="line-last-year" :d="lastYearLinePath"></path>

          <!-- 今年实时趋势（极光翠青） -->
          <path
            class="chart-area"
            :d="currentYearAreaPath"
            fill="url(#currentYearAreaGrad)"
          ></path>
          <path
            ref="currentYearPathEl"
            class="line-current-year"
            :d="currentYearLinePath"
          ></path>

          <!-- 沿曲线流动的能量脉冲微光光束 -->
          <g
            ref="pulseGroupEl"
            :transform="`translate(${lastPoint.x}, ${lastPoint.currentY})`"
          >
            <circle
              cx="0"
              cy="0"
              fill="#ffffff"
              filter="url(#pulseGlow)"
              r="3.2"
            ></circle>
            <circle
              cx="0"
              cy="0"
              fill="none"
              opacity="0.8"
              r="7"
              stroke="#00f5b8"
              stroke-width="1.2"
            ></circle>
          </g>

          <!-- 12月 关键节点垂直参考线 -->
          <line
            stroke="rgba(0, 245, 184, 0.3)"
            stroke-dasharray="2 3"
            stroke-width="1"
            :x1="lastPoint.x"
            :x2="lastPoint.x"
            y1="20"
            y2="200"
          ></line>

          <!-- 12月 当前节点锚点（双层雷达光环） -->
          <g
            class="pulse-group"
            :transform="`translate(${lastPoint.x}, ${lastPoint.currentY})`"
          >
            <circle
              class="pulse-wave-1"
              cx="0"
              cy="0"
              fill="none"
              r="6"
              stroke="#00f5b8"
            ></circle>
            <circle
              class="pulse-wave-2"
              cx="0"
              cy="0"
              fill="none"
              r="6"
              stroke="#00f5b8"
            ></circle>
            <circle
              class="pulse-point"
              cx="0"
              cy="0"
              fill="#00f5b8"
              r="4.2"
              stroke="#ffffff"
              stroke-width="1.8"
            ></circle>
          </g>

          <!-- 交互式探针（鼠标 Hover 显现） -->
          <g
            class="interactive-crosshair-group"
            :style="{ opacity: hoveredItem ? 1 : 0 }"
          >
            <template v-if="hoveredItem">
              <line
                class="crosshair-line"
                :x1="hoveredItem.x"
                :x2="hoveredItem.x"
                y1="20"
                y2="200"
              ></line>
              <circle
                class="probe-point-last"
                :cx="hoveredItem.x"
                :cy="hoveredItem.lastY"
                r="4.5"
              ></circle>
              <circle
                class="probe-point-current"
                :cx="hoveredItem.x"
                :cy="hoveredItem.currentY"
                r="5"
              ></circle>
            </template>
          </g>
        </svg>

        <!-- 跟随 HTML 富文本 Tooltip 卡片 -->
        <div
          class="probe-tooltip font-mono-num"
          :style="{
            opacity: hoveredItem ? 1 : 0,
            left: hoverState.left + 'px',
            top: hoverState.top + 'px',
            transform: hoverState.transform,
          }"
        >
          <div class="tooltip-header">
            <span>{{ hoveredItem?.month }} 遥测数据</span>
            <span style="font-size: 9px; color: #38bdf8">OCC-PROBE</span>
          </div>
          <div class="tooltip-row">
            <span class="tooltip-label">
              <span class="tooltip-dot dot-cyan"></span>今年实时:
            </span>
            <span class="tooltip-val-cyan">{{ hoveredItem?.current }} 件</span>
          </div>
          <div class="tooltip-row" style="margin-top: 2px">
            <span class="tooltip-label">
              <span class="tooltip-dot dot-blue"></span>去年同期:
            </span>
            <span class="tooltip-val-blue">{{ hoveredItem?.last }} 件</span>
          </div>
          <div class="tooltip-diff">
            <span style="color: #94a3b8">同比变动:</span>
            <span :style="{ fontWeight: 600, color: hoveredDiff?.color }">{{
              hoveredDiff?.text
            }}</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.right2-page {
  background-color: #030712;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif;
  color: #e2e8f0;
  overflow-x: hidden;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 工业等宽数值字体 */
.font-mono-num {
  font-family: 'JetBrains Mono', 'SF Mono', 'Roboto Mono', Consolas, monospace;
  font-feature-settings: 'tnum' 1;
}

/* 科技感卡片与晶圆边框质感 */
.occ-panel-wrapper {
  position: relative;
  width: 100%;
  /* 填满单元格并按列排布，图表区 flex:1 吃掉剩余高度 */
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  border: 1px solid rgba(56, 189, 248, 0.18);
  border-radius: 8px;
  padding: 10px 14px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    inset 0 0 24px rgba(0, 140, 255, 0.06);
  overflow: hidden;
}

/* 精密科技直角线饰与光晕角标 */
.occ-panel-wrapper::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(56, 189, 248, 0.2) 15%,
    rgba(0, 245, 184, 0.8) 50%,
    rgba(56, 189, 248, 0.2) 85%,
    transparent 100%
  );
}

.corner-bracket {
  position: absolute;
  width: 6px;
  height: 6px;
  border-color: rgba(56, 189, 248, 0.55);
  pointer-events: none;
}

.corner-tl {
  top: -1px;
  left: -1px;
  border-top: 1.5px solid #00f5b8;
  border-left: 1.5px solid #00f5b8;
}

.corner-tr {
  top: -1px;
  right: -1px;
  border-top: 1.5px solid #38bdf8;
  border-right: 1.5px solid #38bdf8;
}

.corner-bl {
  bottom: -1px;
  left: -1px;
  border-bottom: 1.5px solid #38bdf8;
  border-left: 1.5px solid #38bdf8;
}

.corner-br {
  bottom: -1px;
  right: -1px;
  border-bottom: 1.5px solid #00f5b8;
  border-right: 1.5px solid #00f5b8;
}

/* 头部控制栏与矩阵点点阵 */
.header-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  /* 标题栏固定高度，不参与压缩 */
  flex-shrink: 0;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(56, 189, 248, 0.12);
}

.title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 与其余五个大屏标题统一：21px / 700 / 2px */
.main-title {
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #f8fafc;
  text-shadow: 0 0 12px rgba(56, 189, 248, 0.5);
  display: flex;
  align-items: baseline;
  gap: 8px;
}

/* base.css 里有一条全局 `* { font-weight: normal }`。
   它作用在 span「自身」上，而 .main-title 的 700 只能「继承」下去 ——
   直接命中的声明永远赢过继承来的值（与选择器权重无关），
   所以标题里的 span 实测是 400、比其它五个标题细一档。
   必须在这一层再显式写一次字重。 */
.main-title > span {
  font-weight: 700;
}

.sub-code {
  font-size: 10px;
  font-weight: 500;
  color: rgba(148, 163, 184, 0.6);
  letter-spacing: 0.15em;
}

/* 矩阵阵列光标与波浪闪烁动效 */
.matrix-dots {
  display: grid;
  grid-template-columns: repeat(6, 3px);
  gap: 3px;
  opacity: 0.75;
}

.matrix-dot {
  width: 3px;
  height: 3px;
  border-radius: 0.5px;
  background-color: #38bdf8;
  animation: dotShimmer 2.4s ease-in-out infinite;
}

.matrix-dot:nth-child(1) {
  animation-delay: 0s;
}
.matrix-dot:nth-child(2) {
  animation-delay: 0.15s;
}
.matrix-dot:nth-child(3) {
  animation-delay: 0.3s;
}
.matrix-dot:nth-child(4) {
  animation-delay: 0.45s;
}
.matrix-dot:nth-child(5) {
  animation-delay: 0.6s;
}
.matrix-dot:nth-child(6) {
  animation-delay: 0.75s;
}
.matrix-dot:nth-child(7) {
  animation-delay: 0.15s;
}
.matrix-dot:nth-child(8) {
  animation-delay: 0.3s;
}
.matrix-dot:nth-child(9) {
  animation-delay: 0.45s;
}
.matrix-dot:nth-child(10) {
  animation-delay: 0.6s;
}
.matrix-dot:nth-child(11) {
  animation-delay: 0.75s;
}
.matrix-dot:nth-child(12) {
  animation-delay: 0.9s;
}

/* 右侧指标指示与图例 */
.indicator-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: #94a3b8;
}

.legend-indicator-line {
  width: 14px;
  height: 3px;
  border-radius: 2px;
}

.legend-last-year {
  background: #0284c7;
  box-shadow: 0 0 6px rgba(2, 132, 199, 0.6);
}

.legend-current-year {
  background: #00f5b8;
  box-shadow: 0 0 8px rgba(0, 245, 184, 0.8);
}

.stat-pill {
  background: transparent;
  border: 1px solid rgba(56, 189, 248, 0.2);
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 9px;
  color: #cbd5e1;
  display: flex;
  align-items: center;
  gap: 5px;
}

.trend-down-val {
  color: #34d399;
  font-weight: 600;
}

.open-alert-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f59e0b;
  box-shadow: 0 0 6px #f59e0b;
  animation: alertBlink 1.8s infinite;
}

/* 图表舞台与 SVG 视觉 */
.chart-container {
  position: relative;
  width: 100%;
  /* 不再写死 250px：吃掉标题栏之外的全部剩余高度 */
  flex: 1;
  min-height: 0;
  margin-top: 4px;
  user-select: none;
}

.svg-chart {
  width: 100%;
  height: 100%;
  overflow: visible;
  cursor: crosshair;
}

/* 刻度文字与网格 */
.axis-label {
  font-size: 10.5px;
  fill: rgba(148, 163, 184, 0.65);
  font-family: 'JetBrains Mono', monospace;
  transition:
    fill 0.2s ease,
    font-weight 0.2s ease;
}

.axis-label.active-month {
  fill: #38bdf8;
  font-weight: 700;
}

.grid-line {
  stroke: rgba(56, 189, 248, 0.1);
  stroke-dasharray: 3, 3;
  stroke-width: 1;
}

/* 面积渐进显现遮罩动画 */
.chart-area {
  opacity: 0;
  animation: areaReveal 1.8s cubic-bezier(0.16, 1, 0.3, 1) forwards 0.25s;
}

/* 曲线动态描边入场 */
.line-last-year {
  stroke: #0284c7;
  stroke-width: 2.2;
  fill: none;
  filter: drop-shadow(0 2px 5px rgba(2, 132, 199, 0.35));
  stroke-dasharray: 1200;
  stroke-dashoffset: 1200;
  animation: drawCurve 1.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.line-current-year {
  stroke: #00f5b8;
  stroke-width: 2.8;
  fill: none;
  filter: drop-shadow(0 0 8px rgba(0, 245, 184, 0.6));
  stroke-dasharray: 1200;
  stroke-dashoffset: 1200;
  animation: drawCurve 1.8s cubic-bezier(0.16, 1, 0.3, 1) forwards 0.15s;
}

/* 水波纹 / 雷达脉冲扩散波 */
.pulse-point {
  transform-origin: center;
  animation: pulseCore 2.2s ease-in-out infinite;
}

.pulse-wave-1 {
  transform-origin: center;
  animation: sonarWave 2.4s cubic-bezier(0.2, 0.6, 0.35, 1) infinite;
}

.pulse-wave-2 {
  transform-origin: center;
  animation: sonarWave 2.4s cubic-bezier(0.2, 0.6, 0.35, 1) infinite 0.8s;
}

/* 交互式数据探针及跟随提示卡片 */
.interactive-crosshair-group {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.crosshair-line {
  stroke: rgba(0, 245, 184, 0.45);
  stroke-width: 1.2;
  stroke-dasharray: 3, 3;
  filter: drop-shadow(0 0 4px rgba(0, 245, 184, 0.4));
}

.probe-point-current {
  fill: #00f5b8;
  stroke: #051726;
  stroke-width: 2;
  filter: drop-shadow(0 0 6px #00f5b8);
}

.probe-point-last {
  fill: #0284c7;
  stroke: #051726;
  stroke-width: 2;
  filter: drop-shadow(0 0 6px #0284c7);
}

/* 探针富文本浮层卡片 (HTML DOM) */
.probe-tooltip {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  opacity: 0;
  transform: translate(-50%, -105%);
  transition:
    opacity 0.2s ease,
    transform 0.15s ease-out;
  background: rgba(6, 18, 38, 0.94);
  border: 1px solid rgba(56, 189, 248, 0.4);
  border-radius: 6px;
  padding: 8px 12px;
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.75),
    0 0 14px rgba(56, 189, 248, 0.2);
  backdrop-filter: blur(12px);
  z-index: 50;
  min-width: 130px;
}

.tooltip-header {
  font-size: 11px;
  color: #94a3b8;
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(56, 189, 248, 0.15);
  padding-bottom: 4px;
}

.tooltip-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  line-height: 1.5;
}

.tooltip-label {
  color: #cbd5e1;
  display: flex;
  align-items: center;
  gap: 5px;
}

.tooltip-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}

.dot-cyan {
  background-color: #00f5b8;
  box-shadow: 0 0 5px #00f5b8;
}

.dot-blue {
  background-color: #0284c7;
  box-shadow: 0 0 5px #0284c7;
}

.tooltip-val-cyan {
  color: #00f5b8;
  font-weight: 700;
}

.tooltip-val-blue {
  color: #38bdf8;
  font-weight: 600;
}

.tooltip-diff {
  margin-top: 5px;
  padding-top: 4px;
  border-top: 1px dashed rgba(56, 189, 248, 0.15);
  font-size: 10px;
  display: flex;
  justify-content: space-between;
}

/* 动效定义 */
@keyframes drawCurve {
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes areaReveal {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes dotShimmer {
  0%,
  100% {
    opacity: 0.25;
    transform: scale(0.9);
  }
  50% {
    opacity: 1;
    background-color: #00f5b8;
    box-shadow: 0 0 4px #00f5b8;
    transform: scale(1.15);
  }
}

@keyframes pulseCore {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.22);
    opacity: 0.9;
  }
}

@keyframes sonarWave {
  0% {
    r: 4;
    opacity: 0.9;
    stroke-width: 1.8;
  }
  70% {
    opacity: 0.3;
  }
  100% {
    r: 16;
    opacity: 0;
    stroke-width: 0.3;
  }
}

@keyframes alertBlink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
/* 大屏装配适配：填满侧栏单元格，不再撑满整屏 */
.right2-page {
  position: relative;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: transparent;
  /* 关键：覆盖基类的 flex 居中。否则内容比单元格高时会被上下同时裁掉，
     出现标题只剩半个字的现象 */
  display: block;
}
</style>
