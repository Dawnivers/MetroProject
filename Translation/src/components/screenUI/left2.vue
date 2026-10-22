<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

// 上海地铁建设历程大事记：条目、日期、是否最新均由该数组决定
const activities = [
  {
    id: 'HIS-01',
    text: '上海地铁1号线南段（锦江乐园—徐家汇）建成观光试运营',
    date: '1993-05-28',
    isLatest: true,
  },
  {
    id: 'HIS-02',
    text: '1号线全线贯通运营，北达上海火车站',
    date: '1995-04-10',
    isLatest: true,
  },
  {
    id: 'HIS-03',
    text: '2号线一期（中山公园—龙阳路）开通试运营',
    date: '2000-06-11',
    isLatest: false,
  },
  {
    id: 'HIS-04',
    text: '3号线（明珠线）建成通车，上海首条高架轨道交通线路',
    date: '2000-12-26',
    isLatest: false,
  },
  {
    id: 'HIS-05',
    text: '5号线开通，国内首条郊区轻轨线路投入运营',
    date: '2003-11-25',
    isLatest: false,
  },
  {
    id: 'HIS-06',
    text: '磁浮示范运营线（龙阳路—浦东机场）正式通车',
    date: '2002-12-31',
    isLatest: false,
  },
  {
    id: 'HIS-07',
    text: '4号线“C”字型环线段投入试运营',
    date: '2005-12-31',
    isLatest: false,
  },
  {
    id: 'HIS-08',
    text: '“三线两段”（6、8、9号线等）同步开通，世博前的线网大扩张',
    date: '2007-12-29',
    isLatest: false,
  },
  {
    id: 'HIS-09',
    text: '7、9号线二期、11号线等新线开通，线网突破400公里',
    date: '2009-12-31',
    isLatest: false,
  },
  {
    id: 'HIS-10',
    text: '世博会前线网里程跃居世界第一，11条线路成网运营',
    date: '2010-04-20',
    isLatest: false,
  },
  {
    id: 'HIS-11',
    text: '11号线延伸段开通，跨省地铁（昆山花桥段）试运营',
    date: '2013-10-16',
    isLatest: false,
  },
  {
    id: 'HIS-12',
    text: '17号线开通运营，线网总长突破700公里',
    date: '2017-12-30',
    isLatest: false,
  },
  {
    id: 'HIS-13',
    text: '18号线一期开通，全网运营线路增至20条（含磁浮）',
    date: '2021-12-30',
    isLatest: false,
  },
  {
    id: 'HIS-14',
    text: '机场联络线开通，市域铁路网络化运营新阶段',
    date: '2024-12-27',
    isLatest: false,
  },
];

const ROW_HEIGHT = 54;
const SCROLL_SPEED = 0.52; // 像素/标准帧
const singleCycleHeight = activities.length * ROW_HEIGHT;

// 原始条目 + 首尾克隆组，拼成无缝无限滚动的列表
const tickerRows = computed(() => [
  ...activities.map((item) => ({ ...item, clone: false })),
  ...activities.map((item) => ({ ...item, clone: true })),
]);

/* ---------------- 无缝无限平滑滚动引擎 ---------------- */
const tickerListEl = ref(null);

let rafId = null;
let currentScrollY = 0;
let lastTimestamp = 0;

const updateMarquee = (now) => {
  const elapsed = now - lastTimestamp;
  lastTimestamp = now;

  // 步长补偿：即使刷新率波动或切换标签页也保持匀速平滑
  const delta = Math.min(elapsed / 16.666, 2.2);
  currentScrollY += SCROLL_SPEED * delta;

  if (currentScrollY >= singleCycleHeight) {
    currentScrollY -= singleCycleHeight;
  }

  const list = tickerListEl.value;
  if (list) {
    list.style.transform = `translate3d(0, -${currentScrollY.toFixed(2)}px, 0)`;
  }

  rafId = requestAnimationFrame(updateMarquee);
};

onMounted(() => {
  lastTimestamp = performance.now();
  rafId = requestAnimationFrame(updateMarquee);
});

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId);
});
</script>

<template>
  <div class="left2-page">
    <!-- 视口景深柔光遮罩 -->
    <div aria-hidden="true" class="viewport-ambient-light"></div>

    <!-- 地铁活动监控组件 -->
    <div class="metro-panel-container" data-purpose="metro-activities-widget">
      <!-- 四角工控精细定位角标 -->
      <div aria-hidden="true" class="corner-marker corner-tl"></div>
      <div aria-hidden="true" class="corner-marker corner-tr"></div>
      <div aria-hidden="true" class="corner-marker corner-bl"></div>
      <div aria-hidden="true" class="corner-marker corner-br"></div>
      <div class="top-light-edge"></div>

      <!-- 顶部标题与状态栏 -->
      <header class="metro-panel-header" data-purpose="panel-header">
        <div class="header-left">
          <!-- 主标题 -->
          <h2 class="panel-title">建设历程</h2>
          <!-- 精密科技点阵指示 -->
          <div aria-hidden="true" class="matrix-dots" title="系统点阵指示">
            <div v-for="n in 16" :key="n" class="matrix-dot"></div>
          </div>
        </div>
        <div class="header-right">
          <!-- 条目统计胶囊 -->
          <div class="count-capsule">
            <span>条目</span>
            <span class="count-num">{{ activities.length }}</span>
          </div>
        </div>
      </header>

      <!-- 顶栏微光匀速扫略进度条 -->
      <div aria-hidden="true" class="sync-meter-bar">
        <div class="sync-meter-fill"></div>
      </div>

      <!-- 滚动主体视口（带上下各36px 平滑渐隐 Mask） -->
      <main class="metro-ticker-viewport" data-purpose="ticker-viewport">
        <ul
          ref="tickerListEl"
          class="metro-ticker-list"
          data-purpose="ticker-list"
        >
          <li
            v-for="row in tickerRows"
            :key="`${row.id}-${row.clone ? 'clone' : 'origin'}`"
            class="ticker-row"
            :class="{ 'is-latest': row.isLatest }"
            :data-id="row.id"
            :data-clone="row.clone ? 'true' : null"
          >
            <div class="ticker-row-left">
              <span class="node-track-icon" aria-hidden="true"></span>
              <span class="ticker-text" :title="row.text">{{ row.text }}</span>
            </div>
            <time class="ticker-date">{{ row.date }}</time>
          </li>
        </ul>
      </main>
    </div>
  </div>
</template>

<style scoped>
.left2-page {
  width: 100%;
  height: 100vh;
  min-height: 100vh;
  overflow: hidden;
  position: relative;
  background-color: #030813;
  background-image:
    radial-gradient(
      ellipse at 50% 45%,
      rgba(10, 48, 96, 0.45) 0%,
      rgba(3, 8, 19, 0.98) 72%
    ),
    linear-gradient(rgba(0, 240, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 240, 255, 0.035) 1px, transparent 1px);
  background-size:
    100% 100%,
    32px 32px,
    32px 32px;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #cbd5e1;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 调度大屏暗场径向辉光与视口景深遮罩 */
.viewport-ambient-light {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    circle at 50% 50%,
    rgba(0, 210, 255, 0.05) 0%,
    transparent 60%
  );
  z-index: 1;
}

/* 卡片架构：深海蓝高质感毛玻璃与工控切角外框 */
.metro-panel-container {
  position: relative;
  z-index: 10;
  width: 100%;
  height: 100%;
  background: transparent;
  border: 1px solid rgba(0, 220, 255, 0.28);
  border-radius: 4px;
  box-shadow:
    0 0 35px rgba(0, 200, 255, 0.08) inset,
    0 1px 0 rgba(255, 255, 255, 0.12) inset;
  display: flex;
  flex-direction: column;
  user-select: none;
  transform: translateZ(0);
}

/* 经典工业大屏四角精密卡标 */
.corner-marker {
  position: absolute;
  width: 10px;
  height: 10px;
  pointer-events: none;
  z-index: 5;
}

.corner-tl {
  top: -2px;
  left: -2px;
  border-top: 2.5px solid #00f0ff;
  border-left: 2.5px solid #00f0ff;
  filter: drop-shadow(0 0 4px #00f0ff);
}

.corner-tr {
  top: -2px;
  right: -2px;
  border-top: 2.5px solid #00f0ff;
  border-right: 2.5px solid #00f0ff;
  filter: drop-shadow(0 0 4px #00f0ff);
}

.corner-bl {
  bottom: -2px;
  left: -2px;
  border-bottom: 2.5px solid #00f0ff;
  border-left: 2.5px solid #00f0ff;
  filter: drop-shadow(0 0 4px #00f0ff);
}

.corner-br {
  bottom: -2px;
  right: -2px;
  border-bottom: 2.5px solid #00f0ff;
  border-right: 2.5px solid #00f0ff;
  filter: drop-shadow(0 0 4px #00f0ff);
}

/* 顶部非均匀微光棱线 */
.top-light-edge {
  position: absolute;
  top: 0;
  left: 8%;
  right: 8%;
  height: 1.5px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(0, 240, 255, 0.9) 45%,
    rgba(56, 189, 248, 0.9) 55%,
    transparent 100%
  );
  filter: drop-shadow(0 0 6px rgba(0, 240, 255, 0.8));
  pointer-events: none;
}

/* 标题区：精工字号、拉丝金光感、点阵与推流状态灯 */
.metro-panel-header {
  height: 56px;
  padding: 0 18px 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(0, 240, 255, 0.18);
  background: transparent;
  position: relative;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 饱满金属质感标题 */
.panel-title {
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 2px;
  background: linear-gradient(180deg, #ffffff 10%, #ffeaa7 60%, #e69500 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 2px 8px rgba(245, 158, 11, 0.4));
  display: flex;
  align-items: center;
  margin: 0;
  line-height: 1;
}

/* 标头工控科技点阵指示 */
.matrix-dots {
  display: grid;
  grid-template-columns: repeat(8, 3px);
  grid-template-rows: repeat(2, 3px);
  gap: 3px;
  margin-left: 6px;
  opacity: 0.75;
}

.matrix-dot {
  width: 3px;
  height: 3px;
  background-color: #38bdf8;
  border-radius: 0.5px;
  box-shadow: 0 0 3px rgba(56, 189, 248, 0.6);
}

/* 标头右侧：胶囊状态与指标 */
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-capsule {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-family: 'JetBrains Mono', Consolas, 'SF Pro Text', monospace;
  color: #34d399;
  background: rgba(16, 185, 129, 0.1);
  padding: 3px 9px;
  border-radius: 3px;
  border: 1px solid rgba(16, 185, 129, 0.32);
  letter-spacing: 0.5px;
}

.pulse-indicator {
  width: 6px;
  height: 6px;
  background-color: #10b981;
  border-radius: 50%;
  box-shadow: 0 0 8px #10b981;
  animation: pulse-ring 2s infinite ease-in-out;
}

@keyframes pulse-ring {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.3;
    transform: scale(0.8);
  }
}

.count-capsule {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  color: #94a3b8;
  background: transparent;
  border: 1px solid rgba(56, 189, 248, 0.22);
  padding: 3px 8px;
  border-radius: 3px;
}

.count-num {
  color: #38bdf8;
  font-weight: 700;
  font-size: 12px;
  text-shadow: 0 0 6px rgba(56, 189, 248, 0.6);
}

/* 进度条指示器：微光匀速平缓扫略 */
.sync-meter-bar {
  width: 100%;
  height: 2px;
  background: rgba(15, 30, 54, 0.8);
  position: relative;
  overflow: hidden;
}

.sync-meter-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: 32%;
  background: linear-gradient(
    90deg,
    transparent,
    #0284c7,
    #00f0ff,
    transparent
  );
  box-shadow: 0 0 8px #00f0ff;
  animation: meter-scan 3.2s linear infinite;
}

@keyframes meter-scan {
  0% {
    left: -32%;
  }
  100% {
    left: 100%;
  }
}

/* 滚动主体：上下各36px 高精平滑羽化遮罩与无缝行排版 */
.metro-ticker-viewport {
  flex: 1;
  overflow: hidden;
  position: relative;
  padding: 0 16px;
  mask-image: linear-gradient(
    to bottom,
    transparent 0px,
    #000000 36px,
    #000000 calc(100% - 36px),
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0px,
    #000000 36px,
    #000000 calc(100% - 36px),
    transparent 100%
  );
}

.metro-ticker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  will-change: transform;
  pointer-events: none; /* 保持纯正大屏纯流式滚动 */
}

/* 单行活动条目 */
.ticker-row {
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  position: relative;
  border-bottom: 1px dashed rgba(56, 189, 248, 0.14);
  box-sizing: border-box;
}

.ticker-row-left {
  display: flex;
  align-items: center;
  gap: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding-right: 14px;
}

/* 轨道工控微型菱形状态图符 */
.node-track-icon {
  position: relative;
  width: 7px;
  height: 7px;
  background: #0ea5e9;
  transform: rotate(45deg);
  flex-shrink: 0;
  box-shadow: 0 0 6px #0ea5e9;
  border-radius: 1px;
}

.ticker-row.is-latest .node-track-icon {
  background: #00f0ff;
  box-shadow: 0 0 9px #00f0ff;
  transform: rotate(45deg) scale(1.15);
}

/* 文本内容 */
.ticker-text {
  font-size: 14.5px;
  font-weight: 400;
  letter-spacing: 0.6px;
  color: #b0cfee;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
}

.ticker-row.is-latest .ticker-text {
  color: #e0f2fe;
}

/* 右侧专业等宽日期胶囊标签 */
.ticker-date {
  flex-shrink: 0;
  font-family: 'JetBrains Mono', Consolas, 'SF Mono', monospace;
  font-size: 12.5px;
  font-weight: 500;
  color: #38bdf8;
  letter-spacing: 0.6px;
  background: rgba(14, 165, 233, 0.08);
  padding: 3px 8px;
  border-radius: 3px;
  border: 1px solid rgba(56, 189, 248, 0.22);
  text-shadow: 0 0 5px rgba(56, 189, 248, 0.4);
}

/* 底部 OCC 调度元信息控制台栏 */
.metro-panel-footer {
  height: 38px;
  padding: 0 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid rgba(0, 240, 255, 0.14);
  background: transparent;
  font-size: 11px;
  color: #64748b;
  position: relative;
}

.footer-left-info {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.occ-tag {
  color: #38bdf8;
  letter-spacing: 1px;
  font-weight: 600;
}

.flow-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #94a3b8;
  font-size: 10.5px;
}

.flow-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #00f0ff;
  box-shadow: 0 0 5px #00f0ff;
}

.footer-right-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10.5px;
  color: #64748b;
  letter-spacing: 0.5px;
}

.comm-active {
  color: #10b981;
}
</style>

<style scoped>
/* 原文追加的日期样式覆盖：弱化为纯文本日期 */
.ticker-date {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  text-shadow: none !important;
  padding: 0 !important;
  opacity: 0.65;
}

/* 大屏装配适配：填满侧栏单元格，不再撑满整屏 */
.left2-page {
  position: relative;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: transparent;
}
</style>
