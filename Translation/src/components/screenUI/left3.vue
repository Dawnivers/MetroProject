<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

// 20 条线路客流数据集：id / 名称 / 实时客流 / 设计运力上限 / 主题色
const routeData = ref([
  { id: '1', name: '一号线', flow: 1682, max: 2000, color: '#2563eb' },
  { id: '2', name: '二号线', flow: 1540, max: 2000, color: '#ec4899' },
  { id: '3', name: '三号线', flow: 920, max: 2000, color: '#eab308' },
  { id: '4', name: '四号线', flow: 1315, max: 2000, color: '#84cc16' },

  { id: '5', name: '五号线', flow: 860, max: 2000, color: '#94a3b8' },
  { id: '6', name: '六号线', flow: 1140, max: 2000, color: '#10b981' },
  { id: '7', name: '七号线', flow: 1780, max: 2000, color: '#f97316' },
  { id: '8', name: '八号线', flow: 1020, max: 2000, color: '#0ea5e9' },

  { id: '9', name: '九号线', flow: 1240, max: 2000, color: '#a855f7' },
  { id: '10', name: '十号线', flow: 1490, max: 2000, color: '#06b6d4' },
  { id: '11', name: '十一号线', flow: 1395, max: 2000, color: '#8b5cf6' },
  { id: '12', name: '十二号线', flow: 1080, max: 2000, color: '#14b8a6' },

  { id: '13', name: '十三号线', flow: 970, max: 2000, color: '#f59e0b' },
  { id: '14', name: '十四号线', flow: 1110, max: 2000, color: '#38bdf8' },
  { id: '15', name: '十五号线', flow: 1050, max: 2000, color: '#a3e635' },
  { id: '16', name: '十六号线', flow: 1420, max: 2000, color: '#2dd4bf' },

  { id: '17', name: '十七号线', flow: 890, max: 2000, color: '#fb923c' },
  { id: '18', name: '十八号线', flow: 1160, max: 2000, color: '#f43f5e' },
]);

const LINES_PER_PAGE = 4;
const CAROUSEL_INTERVAL = 5000;

// 客流量 → 负荷状态标签
const getLoadStatus = (pct) => {
  if (pct < 55) return { label: `畅通 ${pct}%`, className: 'smooth' };
  if (pct < 80) return { label: `平稳 ${pct}%`, className: 'busy' };
  return { label: `高峰 ${pct}%`, className: 'heavy' };
};

// 按每页 4 条分组，并计算每条线路的负荷百分比与状态
const pageRows = computed(() => {
  const pages = [];
  for (let i = 0; i < routeData.value.length; i += LINES_PER_PAGE) {
    pages.push(
      routeData.value.slice(i, i + LINES_PER_PAGE).map((item) => {
        const pct = Math.min(100, Math.round((item.flow / item.max) * 100));
        return { ...item, pct, status: getLoadStatus(pct) };
      }),
    );
  }
  return pages;
});

const totalPagesLabel = computed(() =>
  String(pageRows.value.length).padStart(2, '0'),
);

// 当前页客流合计（右上角"全网实时客流"）
const pageFlowSum = (index) =>
  pageRows.value[index].reduce((sum, item) => sum + item.flow, 0);

const currentPage = ref(0);
const displayFlow = ref(pageFlowSum(0));
const groupNum = computed(() => String(currentPage.value + 1).padStart(2, '0'));

// 数值柔和滚动补间（easeInOut）
let rafId = null;
let timer = null;

const animateValue = (target, duration = 800) => {
  if (rafId) cancelAnimationFrame(rafId);
  const start = displayFlow.value;
  if (start === target) return;
  const startTime = performance.now();

  const update = (now) => {
    const progress = Math.min((now - startTime) / duration, 1);
    const ease =
      progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    displayFlow.value = Math.round(start + (target - start) * ease);
    if (progress < 1) {
      rafId = requestAnimationFrame(update);
    } else {
      displayFlow.value = target;
      rafId = null;
    }
  };
  rafId = requestAnimationFrame(update);
};

const goToPage = (index) => {
  if (index === currentPage.value) return;
  currentPage.value = index;
  animateValue(pageFlowSum(index));
};

const nextPage = () => {
  goToPage((currentPage.value + 1) % pageRows.value.length);
  countRotation();
};

/* ---------------- 客流随机刷新：每轮换两轮触发一次 ---------------- */

// 翻页步数计数（走满“总页数 × 2”步 = 完整轮换两轮）
let rotationSteps = 0;

// 在设计运力的 45%~95% 区间生成随机客流，可覆盖 畅通/平稳/高峰 三种状态
const randomFlow = (max) => Math.round(max * (0.45 + Math.random() * 0.5));

const shuffleFlows = () => {
  routeData.value = routeData.value.map((item) => ({
    ...item,
    flow: randomFlow(item.max),
  }));
  // 头部“全网实时客流”同步滚动到当前页的新合计
  animateValue(pageFlowSum(currentPage.value));
};

const countRotation = () => {
  rotationSteps += 1;
  if (rotationSteps >= pageRows.value.length * 2) {
    rotationSteps = 0;
    shuffleFlows();
  }
};

const startCarousel = () => {
  if (timer) clearInterval(timer);
  timer = setInterval(nextPage, CAROUSEL_INTERVAL);
};

const selectPage = (index) => {
  goToPage(index);
  startCarousel();
};

onMounted(startCarousel);

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  if (rafId) cancelAnimationFrame(rafId);
});
</script>

<template>
  <div class="left3-page">
    <div class="dashboard-panel">
      <!-- 头部栏：标题组 + 全网实时客流 -->
      <div class="header-bar">
        <div class="title-group">
          <div class="title-text">客流指标</div>
          <div class="matrix-dots">
            <span v-for="n in 20" :key="n"></span>
          </div>
        </div>
        <div class="header-meta">
          <div class="total-stat-box">
            <span class="stat-label">全网实时客流</span>
            <span class="stat-num">{{ displayFlow.toLocaleString() }}</span>
            <span class="stat-unit">人次/小时</span>
          </div>
        </div>
      </div>
      <!-- 副标题栏 + 分段充能流光指示器 -->
      <div class="sub-bar">
        <div class="sub-title-wrap">
          <span class="sub-badge"></span>
          <span class="sub-title">线路实时客流量</span>
        </div>
        <div class="carousel-bar-indicator">
          <div
            v-for="(page, i) in pageRows"
            :key="i"
            class="bar-seg"
            :class="{ active: currentPage === i }"
            @click="selectPage(i)"
          >
            <div :key="currentPage" class="bar-seg-fill"></div>
          </div>
          <div class="group-num-tag">
            GROUP <span>{{ groupNum }}</span> / {{ totalPagesLabel }}
          </div>
        </div>
      </div>
      <!-- 线路列表容器：每组一页，交叉淡入淡出切换 -->
      <div class="lines-container">
        <div
          v-for="(rows, p) in pageRows"
          :key="p"
          class="lines-group"
          :class="{ active: currentPage === p }"
        >
          <div v-for="row in rows" :key="row.id" class="line-row">
            <div class="line-meta">
              <span
                class="route-pill"
                :style="{ backgroundColor: row.color }"
                >{{ row.id }}</span
              >
              <span class="line-name">{{ row.name }}</span>
            </div>
            <div class="line-track-box">
              <div class="track-bg">
                <div
                  class="track-fill"
                  :style="{
                    width: row.pct + '%',
                    background: `linear-gradient(90deg, ${row.color}55 0%, ${row.color} 100%)`,
                  }"
                >
                  <div class="track-head" :style="{ color: row.color }"></div>
                </div>
              </div>
            </div>
            <div class="line-data-col">
              <div class="line-val-box">
                <span class="line-val">{{ row.flow.toLocaleString() }}</span>
                <span class="line-val-unit">人次/h</span>
              </div>
              <span class="load-tag" :class="row.status.className">{{
                row.status.label
              }}</span>
            </div>
          </div>
        </div>
      </div>
      <!-- 底部工程参数信息栏 -->
      <div class="footer-spec-bar">
        <div class="spec-left">
          <div class="spec-item"></div>
          <div class="spec-item"></div>
          <div class="spec-item"></div>
        </div>
        <div class="spec-right"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.left3-page {
  background-color: #050b14;
  background-image:
    radial-gradient(
      circle at 50% 30%,
      rgba(13, 33, 64, 0.45) 0%,
      rgba(4, 9, 18, 0.98) 100%
    ),
    linear-gradient(rgba(24, 48, 82, 0.15) 1px, transparent 1px),
    linear-gradient(90deg, rgba(24, 48, 82, 0.15) 1px, transparent 1px);
  background-size:
    100% 100%,
    32px 32px,
    32px 32px;
  color: #e2e8f0;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* 主监控面板：微透磨砂深海蓝工程玻璃质感 */
.dashboard-panel {
  position: relative;
  width: 100%;
  /* 填满单元格并按列排布，列表区用 flex:1 吃掉剩余高度 */
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  border-radius: 10px;
  padding: 12px 16px;
  border: 1px solid rgba(48, 120, 220, 0.22);
  border-top: 1.5px solid rgba(75, 185, 255, 0.65);
  border-bottom: 1px solid rgba(20, 48, 90, 0.35);
  box-shadow:
    inset 0 1.5px 0 rgba(130, 215, 255, 0.22),
    inset 0 -1px 0 rgba(10, 25, 55, 0.5),
    0 0 35px rgba(22, 115, 230, 0.14);
}

/* 顶部掠光细线 */
.dashboard-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 12%;
  right: 12%;
  height: 1.5px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(56, 189, 248, 0.9),
    transparent
  );
  filter: blur(0.5px);
  pointer-events: none;
}

/* 头部栏结构 */
.header-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  /* 头部固定高度，不参与压缩，避免标题被挤没 */
  flex-shrink: 0;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(45, 95, 160, 0.22);
  position: relative;
}

.header-bar::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 160px;
  height: 1.5px;
  background: linear-gradient(90deg, #38bdf8, transparent);
}

/* 标题区域 */
.title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 与其余五个大屏标题统一：21px / 700 / 2px */
.title-text {
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #ffffff;
  text-shadow: 0 0 10px rgba(56, 189, 248, 0.35);
  white-space: nowrap;
}

.matrix-dots {
  display: grid;
  grid-template-columns: repeat(10, 3px);
  gap: 3px;
  margin-left: 6px;
  opacity: 0.5;
}

.matrix-dots span {
  width: 3px;
  height: 3px;
  background-color: #38bdf8;
  border-radius: 50%;
}

/* 右上角数据指标区 */
.header-meta {
  display: flex;
  align-items: center;
  gap: 20px;
}

.total-stat-box {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 10px;
  background: transparent;
  border-radius: 6px;
  border: 1px solid rgba(56, 189, 248, 0.2);
}

.stat-label {
  font-size: 10px;
  color: #94a3b8;
  letter-spacing: 0.5px;
}

.stat-num {
  font-family: 'DIN Alternate', 'SF Pro Display', 'Segoe UI', sans-serif;
  font-size: 18px;
  font-weight: 800;
  color: #38bdf8;
  text-shadow: 0 0 16px rgba(56, 189, 248, 0.5);
  letter-spacing: 1px;
  font-feature-settings: 'tnum';
  display: inline-block;
  min-width: 52px;
  text-align: right;
  transition:
    filter 0.5s ease,
    opacity 0.5s ease;
}

.stat-unit {
  font-size: 9px;
  color: #64748b;
}

/* 副标题栏 + 分段充能流光指示器 */
.sub-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  margin-top: 6px;
  margin-bottom: 6px;
}

.sub-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sub-badge {
  display: inline-block;
  width: 6px;
  height: 6px;
  background-color: #38bdf8;
  border-radius: 50%;
  box-shadow: 0 0 8px #38bdf8;
}

.sub-title {
  font-size: 12px;
  font-weight: 600;
  color: #cbd5e1;
  letter-spacing: 0.6px;
}

/* 分段进度指示条 */
.carousel-bar-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bar-seg {
  position: relative;
  width: 26px;
  height: 3px;
  background: rgba(148, 163, 184, 0.22);
  border-radius: 2px;
  overflow: hidden;
  cursor: pointer;
  transition: background 0.3s ease;
}

.bar-seg.active {
  background: rgba(56, 189, 248, 0.3);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.35);
}

.bar-seg-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 0%;
  background: #38bdf8;
  border-radius: 2px;
  box-shadow: 0 0 6px #38bdf8;
}

.bar-seg.active .bar-seg-fill {
  animation: seg-charging 5s linear forwards;
}

@keyframes seg-charging {
  0% {
    width: 0%;
  }
  100% {
    width: 100%;
  }
}

.group-num-tag {
  font-size: 11px;
  font-family: monospace;
  color: #64748b;
  margin-left: 6px;
  letter-spacing: 0.5px;
}

.group-num-tag span {
  color: #38bdf8;
  font-weight: 700;
  transition: opacity 0.3s ease;
}

/* 线路列表容器 */
.lines-container {
  position: relative;
  /* 不再写死 296px：吃掉头部/副标题/底栏之外的全部剩余高度 */
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow: hidden;
}

/* 交叉淡入淡出（Cross-fade）核心容器 */
.lines-group {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 0.7s cubic-bezier(0.4, 0, 0.2, 1),
    visibility 0.7s ease;
  will-change: opacity;
}

.lines-group.active {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

/* 单条线路行 */
.line-row {
  display: flex;
  align-items: center;
  /* 4 行等分列表容器高度，面板多小都能完整排下 */
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: transparent;
  border: 1px solid rgba(40, 75, 130, 0.2);
  border-radius: 6px;
  padding: 3px 12px;
  transition:
    background 0.25s ease,
    border-color 0.25s ease;
}

.line-row:hover {
  background: rgba(18, 36, 68, 0.6);
  border-color: rgba(56, 189, 248, 0.35);
}

/* 左侧线路标识 */
.line-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 112px;
  flex-shrink: 0;
}

.route-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 3px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  color: #ffffff;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.45);
  flex-shrink: 0;
  letter-spacing: 0;
}

.line-name {
  font-size: 12px;
  font-weight: 600;
  color: #f1f5f9;
  letter-spacing: 0.6px;
}

/* 中间：细轨道光槽 */
.line-track-box {
  flex: 1;
  margin: 0 14px;
  position: relative;
}

.track-bg {
  width: 100%;
  height: 6px;
  background: rgba(13, 27, 48, 0.85);
  border-radius: 3px;
  position: relative;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.7);
}

.track-fill {
  height: 100%;
  border-radius: 3px;
  position: relative;
  transition: width 0.9s ease;
}

.track-head {
  position: absolute;
  right: -3px;
  top: 50%;
  transform: translateY(-50%);
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 0 8px 2px currentColor;
}

/* 右侧客流数据列与负荷状态徽章 */
.line-data-col {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  width: 168px;
  flex-shrink: 0;
}

.line-val-box {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 4px;
}

.line-val {
  font-family: 'DIN Alternate', 'SF Pro Display', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: #38bdf8;
  letter-spacing: 0.5px;
  font-feature-settings: 'tnum';
}

.line-val-unit {
  font-size: 9px;
  color: #64748b;
}

/* 客流负荷状态标签 */
.load-tag {
  font-size: 9px;
  font-weight: 600;
  padding: 2px 4px;
  border-radius: 3px;
  white-space: nowrap;
  letter-spacing: 0.4px;
  width: 56px;
  text-align: center;
}

.load-tag.smooth {
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #34d399;
}

.load-tag.busy {
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #fbbf24;
}

.load-tag.heavy {
  background: rgba(244, 63, 94, 0.14);
  border: 1px solid rgba(244, 63, 94, 0.35);
  color: #f87171;
}

/* 底部极简工业参数栏 */
.footer-spec-bar {
  flex-shrink: 0;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(45, 95, 160, 0.18);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #64748b;
  letter-spacing: 0.5px;
}

.spec-left {
  display: flex;
  align-items: center;
  gap: 18px;
}

.spec-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.spec-item span.spec-val {
  color: #94a3b8;
  font-weight: 600;
  font-family: monospace;
}

.spec-right {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #64748b;
  font-family: monospace;
}
/* 大屏装配适配：填满侧栏单元格，不再撑满整屏 */
.left3-page {
  position: relative;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: transparent;
  /* 关键：覆盖基类的 flex 居中。否则内容比单元格高时会上下同时被裁，
     出现标题看不到、列表只剩两行的现象 */
  display: block;
}
</style>
