<script setup>
import { computed, onMounted, ref } from 'vue';
import { getLine } from '@/api/request';
import { cesiumStore } from '@/stores/counter';
import { useLoadingState } from '@/stores/loadingState';
import lineGeoJson from '@/assets/line1to18_2.json';

const dataStore = cesiumStore();
const loading = useLoadingState();

// 线路数据来源：left1 请求 /getLine 后写入 cesiumStore，这里是展示态映射（名称 / 长度 / 主题色）
const routes = computed(() =>
  (dataStore.Lines || []).map((line, i) => ({
    // 数据库名为“上海地铁X号线”，截掉前缀保持网格紧凑
    name: String(line.name ?? '').replace(/^上海地铁/, ''),
    // 后端 length 为字符串，模板中有 toFixed 等数值运算，转回数字
    length: Number(line.length) || 0,
    color: COLOR_PALETTE[i % COLOR_PALETTE.length],
  })),
);

// 主题色盘：按数据顺序循环分配（后端无颜色字段）
const COLOR_PALETTE = [
  '#2563eb',
  '#fb7185',
  '#c2410c',
  '#a3e635',
  '#94a3b8',
  '#10b981',
  '#f97316',
  '#60a5fa',
  '#c084fc',
  '#14b8a6',
  '#a855f7',
  '#06b6d4',
  '#f59e0b',
  '#38bdf8',
  '#84cc16',
  '#2dd4bf',
  '#d97706',
  '#f43f5e',
];

/**
 * 线路完整坐标来自 line1to18_2.json 的 geometry.coordinates。
 * 数据库 line 表的 xs/ys 字段被截断成 254 字符，末端是半截数字，
 * 画出来的线是跨洲尖刺；而这套 GeoJSON 里的 coordinates 是完整 LineString。
 */
const GEO_COORDS_BY_NAME = new Map(
  (lineGeoJson.features || []).map((feature) => [
    feature.properties?.name,
    feature.geometry?.coordinates || [],
  ]),
);

/** 把 [[lng,lat],...] 压成一维 [lng1,lat1,lng2,lat2,...]，供 fromDegreesArray 用 */
const flattenCoords = (coords) =>
  coords.reduce((flat, [lng, lat]) => {
    if (Number.isFinite(lng) && Number.isFinite(lat)) flat.push(lng, lat);
    return flat;
  }, []);

/** 线路名里取数字用于排序（上海地铁1号线 → 1；无数字的排最后） */
const lineNo = (name) => {
  const m = String(name ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : Infinity;
};

onMounted(async () => {
  try {
    const res = await getLine();
    if (res.code === 200 && Array.isArray(res.data)) {
      // 线路数据的唯一入口：按名称匹配 json 完整坐标覆盖截断的 xs/ys，再按线号 1→18 排序写入仓库
      const list = res.data
        .map((item) => ({
          ...item,
          positions: flattenCoords(GEO_COORDS_BY_NAME.get(item.name) || []),
        }))
        .sort((a, b) => lineNo(a.name) - lineNo(b.name));
      dataStore.setLines(list);
      // 开屏闸门：线路数据到位才算这一项完成（后续 Toolbar 靠它建实体）
      loading.doneAsset('data', `${list.length} 条线路`);
      console.log(list, '线路数据');
    }
  } catch {
    /* 线路加载失败时列表留空，不影响面板其余指标渲染 */
    loading.failAsset('data', '接口失败');
    loading.failAsset('entities', '跳过（无数据）');
  }
});

// 汇总指标：全部由长度数组推导
const totalLength = computed(() =>
  routes.value.reduce((sum, r) => sum + r.length, 0),
);
const maxLength = computed(() =>
  routes.value.length ? Math.max(...routes.value.map((r) => r.length)) : 1,
);
const avgLength = computed(() =>
  routes.value.length ? totalLength.value / routes.value.length : 0,
);

/* ---------------- 安全运营数显牌（1993-05-28 开通日起算） ---------------- */

const OPERATION_START = new Date(1993, 4, 28); // 月份从 0 计数，4 即 5 月

// 截至日期：当天 年/月/日
const counterDate = computed(() => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}/${month}/${day}`;
});

// 年度安全运营天数 = 当天 - 运营日
const safeDays = computed(() => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - OPERATION_START) / 86400000);
});

// 右侧列表：进度条宽度按“占最长线路的比例”换算
const routeRows = computed(() =>
  routes.value.map((r) => ({
    ...r,
    percent: (r.length / maxLength.value) * 100,
    isMax: r.length === maxLength.value,
  })),
);

// 左侧同心圆弧：每段弧长 = 该线路长度占全网总长的比例 × 所在圆周长
const TRACK_GAP = 8; // 同一轨道内相邻弧线之间的留白（弧长单位）
const trackConfig = [
  { radius: 118, count: 5, start: 0 },
  { radius: 104, count: 5, start: 10 },
  { radius: 90, count: 4, start: 15 },
  { radius: 76, count: 4, start: 8 },
];

const tracks = computed(() => {
  const sorted = [...routes.value].sort((a, b) => b.length - a.length);
  let cursor = 0;
  return trackConfig.map(({ radius, count, start }) => {
    const circumference = 2 * Math.PI * radius;
    let offset = start;
    const arcs = sorted.slice(cursor, cursor + count).map((r) => {
      const arc = (r.length / totalLength.value) * circumference;
      const item = {
        ...r,
        radius,
        dashArray: `${arc.toFixed(2)} ${(circumference - arc).toFixed(2)}`,
        dashOffset: (-offset).toFixed(2),
      };
      offset += arc + TRACK_GAP;
      return item;
    });
    cursor += count;
    return { radius, arcs };
  });
});

// 悬停高亮
const hoveredIndex = ref(-1);
const itemOpacity = (index) =>
  hoveredIndex.value === -1 || hoveredIndex.value === index ? 1 : 0.55;
</script>

<template>
  <div class="left1-page">
    <main class="dashboard-card" data-purpose="operational-statistics-panel">
      <!-- 顶部科技渐变微光细线 -->
      <div class="top-accent-line"></div>
      <!-- 头部区域 -->
      <header class="card-header">
        <div class="header-left">
          <h1 class="main-title">运营统计</h1>
        </div>
        <!-- 右上角：安全运营数显牌 -->
        <div class="safety-counter">
          <div class="counter-meta">
            <span class="counter-date">截至 {{ counterDate }}</span>
            <span class="counter-label">年度安全运营</span>
          </div>
          <div class="counter-digits-wrap">
            <span class="counter-digits">{{ safeDays }}</span>
            <span class="counter-unit">天</span>
          </div>
        </div>
      </header>
      <!-- 主体内容 -->
      <div class="card-body">
        <div class="body-layout">
          <!-- 左侧：多轨同心圆弧图谱与核心指标 -->
          <section class="gauge-section" data-purpose="circular-metric-gauge">
            <div class="gauge-container">
              <svg class="gauge-svg" viewBox="0 0 280 280">
                <!-- 仪表盘极细标尺外圆与刻度 -->
                <circle
                  cx="140"
                  cy="140"
                  fill="none"
                  opacity="0.6"
                  r="136"
                  stroke="#334155"
                  stroke-dasharray="2 6"
                  stroke-width="0.75"
                />
                <circle
                  cx="140"
                  cy="140"
                  fill="none"
                  r="132"
                  stroke="#1e293b"
                  stroke-width="1"
                />
                <!-- 4个主分位刻度点 -->
                <line
                  opacity="0.85"
                  stroke="#38bdf8"
                  stroke-width="1.5"
                  x1="140"
                  x2="140"
                  y1="4"
                  y2="11"
                />
                <line
                  opacity="0.85"
                  stroke="#38bdf8"
                  stroke-width="1.5"
                  x1="276"
                  x2="269"
                  y1="140"
                  y2="140"
                />
                <line
                  opacity="0.85"
                  stroke="#38bdf8"
                  stroke-width="1.5"
                  x1="140"
                  x2="140"
                  y1="276"
                  y2="269"
                />
                <line
                  opacity="0.85"
                  stroke="#38bdf8"
                  stroke-width="1.5"
                  x1="4"
                  x2="11"
                  y1="140"
                  y2="140"
                />
                <!-- 慢速旋转雷达微光环 -->
                <g class="radar-indicator">
                  <circle
                    cx="140"
                    cy="140"
                    fill="none"
                    opacity="0.3"
                    r="128"
                    stroke="#0284c7"
                    stroke-dasharray="16 180"
                    stroke-width="1"
                  />
                </g>
                <!-- 各线路轨道：弧长与线路长度成正比 -->
                <g v-for="track in tracks" :key="track.radius">
                  <circle
                    cx="140"
                    cy="140"
                    fill="none"
                    :r="track.radius"
                    stroke="var(--track-bg)"
                    stroke-width="5"
                  />
                  <circle
                    v-for="arc in track.arcs"
                    :key="arc.name"
                    cx="140"
                    cy="140"
                    fill="none"
                    :r="arc.radius"
                    :stroke="arc.color"
                    :stroke-dasharray="arc.dashArray"
                    :stroke-dashoffset="arc.dashOffset"
                    stroke-linecap="round"
                    stroke-width="5.5"
                  />
                </g>
                <!-- 仪表盘内部遮罩圆 -->
                <circle
                  cx="140"
                  cy="140"
                  fill="none"
                  opacity="0.7"
                  r="63"
                  stroke="#334155"
                  stroke-dasharray="3 4"
                  stroke-width="1"
                />
                <circle cx="140" cy="140" fill="#0c1322" r="60" />
              </svg>
              <!-- 环内中心核心指标 -->
              <div class="gauge-center-info">
                <span class="gauge-subtext">全网运营总里程</span>
                <div class="gauge-value-row">
                  <span class="gauge-value">{{ totalLength.toFixed(1) }}</span>
                  <span class="gauge-unit">km</span>
                </div>
                <div class="gauge-badge">
                  <span class="pulse-dot"></span>
                  <span class="badge-text">{{ routes.length }}条线路在网</span>
                </div>
              </div>
            </div>
          </section>
          <!-- 右侧：线路统计网格 -->
          <section
            class="routes-section"
            data-purpose="subway-lines-statistics-grid"
          >
            <div class="route-grid">
              <div
                v-for="(route, index) in routeRows"
                :key="route.name"
                class="route-item"
                :style="{ opacity: itemOpacity(index) }"
                @mouseenter="hoveredIndex = index"
                @mouseleave="hoveredIndex = -1"
              >
                <div class="route-header-info">
                  <div class="route-label-wrap">
                    <span
                      class="route-dot"
                      :style="{
                        backgroundColor: route.color,
                        color: route.color,
                      }"
                    ></span>
                    <span class="route-name">{{ route.name }}</span>
                  </div>
                  <span
                    class="route-mileage"
                    :class="{ 'is-max': route.isMax }"
                  >
                    {{ route.length.toFixed(1)
                    }}<span class="route-unit">km</span>
                  </span>
                </div>
                <div class="route-bar-track">
                  <div
                    class="route-bar-fill"
                    :style="{
                      width: route.percent.toFixed(1) + '%',
                      backgroundColor: route.color,
                      color: route.color,
                    }"
                  ></div>
                </div>
              </div>
            </div>
            <!-- 底部线网统计汇总 -->
            <footer class="stats-footer">
              <div class="stats-summary">
                <span
                  >线路总数: <strong>{{ routes.length }}</strong> 条</span
                >
                <span class="divider-pipe">|</span>
                <span
                  >线网平均长度:
                  <strong>{{ avgLength.toFixed(2) }}</strong> km</span
                >
              </div>
              <div>
                <span>标准运行监控已联机</span>
              </div>
            </footer>
          </section>
        </div>
      </div>
      <!-- 底部细微边缘光收敛线 -->
      <div class="bottom-accent-line"></div>
    </main>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&display=swap');

.left1-page {
  --bg-dark: #090d16;
  --panel-bg: linear-gradient(
    180deg,
    rgba(14, 21, 33, 0.94) 0%,
    rgba(9, 14, 22, 0.97) 100%
  );
  --card-border-glow: rgba(56, 189, 248, 0.35);
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --amber-main: #f59e0b;
  --amber-light: #fef3c7;
  --cyan-accent: #38bdf8;
  --track-bg: #151e2e;
  --font-sans: 'Noto Sans SC', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --font-display: 'Chakra Petch', sans-serif;

  background-color: var(--bg-dark);
  background-image:
    radial-gradient(
      circle at 50% 15%,
      rgba(24, 45, 78, 0.45) 0%,
      transparent 60%
    ),
    radial-gradient(
      circle at 10% 85%,
      rgba(14, 28, 48, 0.5) 0%,
      transparent 50%
    ),
    radial-gradient(
      circle at 90% 80%,
      rgba(18, 36, 62, 0.45) 0%,
      transparent 50%
    ),
    linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
  background-size:
    100% 100%,
    100% 100%,
    100% 100%,
    28px 28px,
    28px 28px;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-family: var(--font-sans);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
  user-select: none;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* 工业级专业控制面板容器与非均匀多层光感边框 */
.dashboard-card {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  border-radius: 10px;
  overflow: hidden;
  box-shadow:
    rgba(56, 189, 248, 0.5) 0px 1.5px 0px 0px inset,
    rgba(56, 189, 248, 0.22) 0px 3px 8px -1px inset,
    rgba(255, 255, 255, 0.06) 1px 0px 0px 0px inset,
    rgba(255, 255, 255, 0.04) -1px 0px 0px 0px inset,
    rgba(255, 255, 255, 0.04) 0px -1px 0px 0px inset;
  border: 1px solid rgba(56, 80, 116, 0.45);
  border-top-color: rgba(56, 189, 248, 0.65);
  border-bottom-color: rgba(30, 41, 59, 0.6);
}

/* 顶层非对称高光线条带 */
.top-accent-line {
  position: relative;
  width: 100%;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(56, 189, 248, 0.2) 15%,
    rgba(56, 189, 248, 0.95) 50%,
    rgba(56, 189, 248, 0.2) 85%,
    transparent 100%
  );
  box-shadow: 0 1px 6px rgba(56, 189, 248, 0.45);
}

/* 头部区域 */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 14px;
  border-bottom: 1px solid rgba(51, 65, 85, 0.45);
  background: transparent;
  gap: 8px;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 六个大屏组件的标题统一为 21px / 700 / 2px。
   改这里时请同步：left2 .panel-title、left3 .title-text、
   right1 .widget-title、right2 .main-title、right3 .header-title */
.main-title {
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #f8fafc;
  text-shadow:
    0 0 8px rgba(0, 0, 0, 0.6),
    0 2px 10px rgba(255, 255, 255, 0.12);
}

/* 右上角安全运营数显牌 */
.safety-counter {
  display: flex;
  align-items: center;
  background: transparent;
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 6px;
  padding: 2px 9px;
  box-shadow:
    inset 0 2px 6px rgba(0, 0, 0, 0.65),
    0 0 12px rgba(245, 158, 11, 0.12);
}

.counter-meta {
  display: flex;
  flex-direction: column;
  text-align: right;
  margin-right: 12px;
}

.counter-date {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  line-height: 1.1;
}

.counter-label {
  font-size: 11px;
  color: #fde68a;
  font-weight: 500;
  margin-top: 2px;
}

.counter-digits-wrap {
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding-left: 10px;
  border-left: 1px solid rgba(71, 85, 105, 0.6);
}

.counter-digits {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  color: var(--amber-main);
  line-height: 1;
  letter-spacing: -0.02em;
  text-shadow: 0 0 14px rgba(245, 158, 11, 0.38);
}

.counter-unit {
  font-size: 11px;
  color: rgba(245, 158, 11, 0.85);
  font-weight: 500;
}

/* 面板主体内容布局 */
/* overflow: hidden 是兜底：万一以后线路变多导致内容高于容器，
   宁可贴边裁掉，也不能像之前那样"居中溢出"去盖住右上角的数显牌 */
.card-body {
  flex: 1 1 0;
  min-height: 0;
  padding: 6px 14px 8px;
  display: flex;
  align-items: center;
  overflow: hidden;
}

.body-layout {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(80px, 108px) minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}

/* 左侧环形仪表区域 */
.gauge-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.gauge-container {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.gauge-svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

@keyframes radar-scan {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.radar-indicator {
  transform-origin: 140px 140px;
  animation: radar-scan 45s linear infinite;
}

.gauge-center-info {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  pointer-events: none;
}

.gauge-subtext {
  font-size: 10px;
  color: var(--text-secondary);
  letter-spacing: 0.08em;
}

.gauge-value-row {
  display: flex;
  align-items: baseline;
  justify-content: center;
  margin: 4px 0 6px;
}

.gauge-value {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  color: #ffffff;
  line-height: 1;
  letter-spacing: -0.02em;
  text-shadow: 0 0 16px rgba(255, 255, 255, 0.2);
}

.gauge-unit {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-secondary);
  margin-left: 4px;
}

.gauge-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: transparent;
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 20px;
  box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.5);
}

.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cyan-accent);
  box-shadow: 0 0 6px var(--cyan-accent);
}

.badge-text {
  font-size: 9px;
  font-family: var(--font-mono);
  color: #bae6fd;
  font-weight: 500;
}

/* 右侧线路列表（3列网格）通透极简 */
.routes-section {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 0;
}

/* 行距/条高整体收紧：原来 6 行要 211.6 设计像素，
   而主体只有 166.7，多出来的部分会向上溢出压住头部数显牌 */
.route-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-content: center;
  row-gap: 4px;
  column-gap: 10px;
  width: 100%;
}

.route-item {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 1px;
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.route-item:hover {
  transform: translateY(-1px);
}

.route-header-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
}

.route-label-wrap {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.route-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 6px currentColor;
}

.route-name {
  font-size: 10.5px;
  line-height: 1.15;
  font-weight: 600;
  color: #e2e8f0;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.route-mileage {
  font-family: var(--font-mono);
  font-size: 9.5px;
  line-height: 1.15;
  font-weight: 600;
  color: #f1f5f9;
  white-space: nowrap;
}

.route-mileage.is-max {
  color: #fde047;
  text-shadow: 0 0 6px rgba(253, 224, 71, 0.4);
}

.route-unit {
  font-size: 9px;
  font-weight: 400;
  color: var(--text-muted);
  margin-left: 1px;
}

/* 通透型微光里程条基底与进度条 */
.route-bar-track {
  width: 100%;
  height: 3px;
  background: rgba(30, 41, 59, 0.65);
  border-radius: 2px;
  overflow: hidden;
}

.route-bar-fill {
  height: 100%;
  border-radius: 2px;
  box-shadow: 0 0 6px currentColor;
}

/* 底部汇总统计行 */
.stats-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  margin-top: 5px;
  padding-top: 4px;
  border-top: 1px solid rgba(51, 65, 85, 0.4);
  font-size: 9.5px;
  line-height: 1.3;
  color: var(--text-muted);
  gap: 2px 8px;
}

.stats-summary {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stats-summary strong {
  font-family: var(--font-mono);
  color: #cbd5e1;
  font-size: 10px;
}

.divider-pipe {
  color: rgba(71, 85, 105, 0.6);
}

/* 卡片底部极细渐隐光边 */
.bottom-accent-line {
  height: 1px;
  width: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(71, 85, 105, 0.4),
    transparent
  );
}
/* 大屏装配适配：填满侧栏单元格，不再撑满整屏 */
.left1-page {
  position: relative;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: transparent;
}
</style>
