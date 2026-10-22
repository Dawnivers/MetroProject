<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { getWeather } from '@/api/request';
import { cesiumStore } from '@/stores/counter';
import { resetTimeLine } from '@/cesiumTools/Time/resetTimeline';

/* ---------------- 静态文案（单一数据源） ---------------- */

const hudText = {
  city: '上海市',
  badge: 'XULING · 01',
  title: '地铁三维可视化管控平台',
  subtitle: 'SUBWAY 3D VISUAL CONTROL SYSTEM · VER 4.8',
  matrixLabel: 'MATRIX',
  matrixValue: 'ONLINE',
  freqTag: 'FREQ',
  freqValue: '60.0',
  freqUnit: 'FPS',
};

/* ---------------- 阶梯式背景框几何数据 ---------------- */

/** 台阶拐点处的星站节点（原 8 个 circle） */
const backdropNodes = [
  { cx: 520, cy: 46, r: 2.5, color: '#11efe3', blur: 5 },
  { cx: 550, cy: 64, r: 3, color: '#e2ba64', blur: 7, pulse: true },
  { cx: 670, cy: 64, r: 2.5, color: '#11efe3', blur: 5 },
  { cx: 710, cy: 88, r: 3.5, color: '#e2ba64', blur: 8, pulse: true },
  { cx: 1210, cy: 88, r: 3.5, color: '#e2ba64', blur: 8, pulse: true },
  { cx: 1250, cy: 64, r: 2.5, color: '#11efe3', blur: 5 },
  { cx: 1370, cy: 64, r: 3, color: '#e2ba64', blur: 7, pulse: true },
  { cx: 1400, cy: 46, r: 2.5, color: '#11efe3', blur: 5 },
];

/** 中间台阶的霓虹刻痕（原 2 个 rect，仅 x 不同） */
const railNotches = [560, 1332];

/** 罗盘徽标的 8 道辐条（4 道轴向 + 4 道斜向，由同一数组驱动） */
const compassRays = [
  { x1: 18, y1: 2, x2: 18, y2: 5, width: 1.8, round: true },
  { x1: 18, y1: 31, x2: 18, y2: 34, width: 1.8, round: true },
  { x1: 2, y1: 18, x2: 5, y2: 18, width: 1.8, round: true },
  { x1: 31, y1: 18, x2: 34, y2: 18, width: 1.8, round: true },
  { x1: 6.5, y1: 6.5, x2: 8.8, y2: 8.8, width: 1.5, round: false },
  { x1: 27.2, y1: 27.2, x2: 29.5, y2: 29.5, width: 1.5, round: false },
  { x1: 6.5, y1: 29.5, x2: 8.8, y2: 27.2, width: 1.5, round: false },
  { x1: 27.2, y1: 8.8, x2: 29.5, y2: 6.5, width: 1.5, round: false },
];

/** 夜间月亮徽标的星点（对应白天罗盘的辐条，落在弦月挖空出的“夜空”里） */
const moonStars = [
  { cx: 25.5, cy: 9.5, r: 1.2, color: '#11efe3', delay: '0s' },
  { cx: 27.5, cy: 15.5, r: 0.8, color: '#e2ba64', delay: '0.8s' },
  { cx: 19.5, cy: 5.5, r: 0.9, color: '#fff8dc', delay: '1.5s' },
];

/* ---------------- 实时时钟 ---------------- */

const WEEKDAYS = [
  '星期日',
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
];

const clockDate = ref('');
const clockWeekday = ref('');
const clockTime = ref('');

/** 昼夜切换：18:00（含）后入夜，6:00（含）后天亮 */
const isNight = ref(false);

let clockTimer = null;

const updateClock = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  clockDate.value = `${year}/${month}/${day}`;
  clockWeekday.value = WEEKDAYS[now.getDay()];
  clockTime.value = `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes(),
  ).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  isNight.value = now.getHours() >= 18 || now.getHours() < 6;
};

/* ---------------- 天气实况（高德接口经后端 /getWeather 代理） ---------------- */

const weatherText = ref('--');
const temperatureText = ref('--');

let weatherTimer = null;

const fetchWeather = async () => {
  try {
    const res = await getWeather('base');
    if (res.code === 200 && res.data) {
      console.log(res.data, '天气数据');
      weatherText.value = res.data.weather || '--';
      temperatureText.value = res.data.temperature || '--';
    }
  } catch {
    /* 天气加载失败时保留占位符，不打断 HUD 渲染 */
  }
};

/* ---------------- 金色星站节点的无规律随机运动 ---------------- */

const backdropSvgEl = ref(null);

/** 随机挑选的缓动曲线，避免各节点走出同一种节奏 */
const NODE_EASINGS = [
  'cubic-bezier(0.25, 0.1, 0.25, 1)',
  'cubic-bezier(0.34, 1.56, 0.64, 1)',
  'cubic-bezier(0.45, 0.05, 0.55, 0.95)',
  'cubic-bezier(0.68, -0.55, 0.27, 1.55)',
];

const randomBetween = (min, max) => min + Math.random() * (max - min);

/** 给单个节点随机一组位移 / 缩放 / 亮度 / 时长与缓动 */
const driftNode = (node) => {
  const dx = randomBetween(-14, 14);
  const dy = randomBetween(-8, 8);
  const scale = randomBetween(0.6, 1.35);
  const duration = randomBetween(1.4, 4.4);
  const easing = NODE_EASINGS[Math.floor(Math.random() * NODE_EASINGS.length)];

  node.style.transition = `transform ${duration}s ${easing}, opacity ${duration}s ease-in-out`;
  node.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${scale.toFixed(3)})`;
  node.style.opacity = randomBetween(0.35, 1).toFixed(2);
};

let nodeDriftTimer = null;

/** 每次只抽一部分节点动，且下一次触发时刻同样随机，整体不形成周期 */
const scheduleNodeDrift = () => {
  const svg = backdropSvgEl.value;
  if (svg) {
    svg.querySelectorAll('.node-pulse-gold').forEach((node) => {
      if (Math.random() < 0.45) return;
      driftNode(node);
    });
  }
  nodeDriftTimer = setTimeout(scheduleNodeDrift, randomBetween(600, 2200));
};

/* ---------------- 自制时间轴（代替 Cesium 默认时间轴） ---------------- */

const dataStore = cesiumStore();
const timelineBoxRef = ref(null);

/*
 * 「线路轨迹」栏目把顶部时间条藏起来。
 * 那个栏目里 clock 被列车漫游接管（clock.start/stop 被改成几十秒的窗口，
 * multiplier 也被改写），时间条显示的是「这趟车跑到哪」而不是真实时间；
 * 而面板里已经有一条自己的进度条，两个并存只会让人误判。
 * 只在本栏目隐藏，其它栏目照常。
 *
 * 隐藏方式取「缩到 0 宽 + 不可见」，**不能用 display:none**：
 * 那会把宽度变成 0，Cesium 的 Timeline 会按 0 宽重新量尺子，等再显示出来时
 * 刻度就乱了（实测只剩一个刻度）。这里容器仍是 200px 宽，只是移出视野。
 */
const route = useRoute();
const hideTimeline = computed(() => route.path === '/realtime');

let timelineInited = false;

/** viewer 就绪后在指定容器内挂载自制时间轴 */
const initTimeline = () => {
  const viewer = dataStore.Viewer;
  if (!viewer || !timelineBoxRef.value || timelineInited) return;
  resetTimeLine(viewer, timelineBoxRef.value);
  timelineInited = true;
};

// 时序兜底：若 head 挂载早于 viewer 就绪，等 viewer 写入 store 后再初始化
watch(
  () => dataStore.Viewer,
  () => initTimeline(),
);

onMounted(() => {
  updateClock();
  clockTimer = setInterval(updateClock, 1000);

  fetchWeather();
  weatherTimer = setInterval(fetchWeather, 10 * 60 * 1000);

  scheduleNodeDrift();

  initTimeline();
});

onBeforeUnmount(() => {
  clearInterval(clockTimer);
  clearInterval(weatherTimer);
  clearTimeout(nodeDriftTimer);
});
</script>

<template>
  <div class="head-page">
    <!-- BEGIN: 倒阶梯式 HUD 顶部标头 -->
    <header class="hud-header-container">
      <!-- 顶部横向贯穿微光线 -->
      <div class="hud-top-line"></div>

      <!-- 阶梯式倒角背景框 / 导轨层 -->
      <div class="hud-stepped-backdrop">
        <svg
          ref="backdropSvgEl"
          class="hud-backdrop-svg"
          preserveAspectRatio="none"
          viewBox="0 0 1920 96"
        >
          <defs>
            <!-- 主体玻璃背板渐变 -->
            <linearGradient id="hudGlassGrad" x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stop-color="#0b1c31" stop-opacity="0.94" />
              <stop offset="40%" stop-color="#050b14" stop-opacity="0.92" />
              <stop offset="100%" stop-color="#03070e" stop-opacity="0.96" />
            </linearGradient>
            <!-- 两侧向中心收敛的外描边渐变 -->
            <linearGradient
              id="steppedBorderGrad"
              x1="0%"
              x2="100%"
              y1="0%"
              y2="0%"
            >
              <stop offset="0%" stop-color="#e2ba64" stop-opacity="0.3" />
              <stop offset="25%" stop-color="#e2ba64" stop-opacity="0.55" />
              <stop offset="42%" stop-color="#e2ba64" stop-opacity="0.9" />
              <stop offset="50%" stop-color="#ffffff" stop-opacity="1" />
              <stop offset="58%" stop-color="#e2ba64" stop-opacity="0.9" />
              <stop offset="75%" stop-color="#e2ba64" stop-opacity="0.55" />
              <stop offset="100%" stop-color="#e2ba64" stop-opacity="0.3" />
            </linearGradient>
            <!-- 底部微光滤镜 -->
            <filter id="railGlow" height="160%" width="120%" x="-10%" y="-30%">
              <feGaussianBlur result="blur" stdDeviation="3" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          <!-- 阶梯玻璃背板主体 -->
          <polygon
            fill="url(#hudGlassGrad)"
            points="0,0 1920,0 1920,46 1400,46 1370,64 1250,64 1210,88 710,88 670,64 550,64 520,46 0,46"
          />
          <!-- 内侧次级轮廓线 -->
          <polyline
            fill="none"
            points="0,42 516,42 546,60 666,60 706,84 1214,84 1254,60 1374,60 1404,42 1920,42"
            stroke="rgba(226, 186, 100, 0.15)"
            stroke-width="1"
          />
          <!-- 主阶梯导轨描线（贴合下边缘） -->
          <polyline
            fill="none"
            filter="url(#railGlow)"
            points="0,46 520,46 550,64 670,64 710,88 1210,88 1250,64 1370,64 1400,46 1920,46"
            stroke="url(#steppedBorderGrad)"
            stroke-width="1.6"
          />
          <!-- 中央平台下沿高亮线 -->
          <line
            filter="drop-shadow(0 0 6px #e2ba64)"
            stroke="#ffffff"
            stroke-linecap="round"
            stroke-width="2.4"
            x1="730"
            x2="1190"
            y1="88"
            y2="88"
          />
          <!-- 中间台阶霓虹刻痕 -->
          <rect
            v-for="x in railNotches"
            :key="x"
            :x="x"
            :y="62.5"
            fill="#e2ba64"
            filter="drop-shadow(0 0 4px #e2ba64)"
            height="2"
            width="28"
          />
          <!-- 台阶拐点星站节点 -->
          <circle
            v-for="node in backdropNodes"
            :key="node.cx"
            :class="{ 'node-pulse-gold': node.pulse }"
            :cx="node.cx"
            :cy="node.cy"
            :fill="node.color"
            :filter="`drop-shadow(0 0 ${node.blur}px ${node.color})`"
            :r="node.r"
            :stroke="node.pulse ? '#fff8dc' : null"
            :stroke-width="node.pulse ? 1 : null"
          />
        </svg>
      </div>

      <!-- HUD 真实内容层 -->
      <div class="hud-content-bar">
        <!-- BEGIN: 左侧区域（定位、子系统徽标与实时时钟） -->
        <div class="hud-left-meta">
          <!-- 金色旋转罗盘徽标（白天=太阳，夜晚=月亮） -->
          <div class="compass-box">
            <svg
              v-if="!isNight"
              class="animate-spin-slow compass-svg"
              fill="none"
              viewBox="0 0 36 36"
            >
              <circle
                cx="18"
                cy="18"
                opacity="0.65"
                r="16"
                stroke="#e2ba64"
                stroke-dasharray="2 3"
                stroke-width="1.2"
              />
              <circle
                cx="18"
                cy="18"
                opacity="0.85"
                r="11"
                stroke="#e2ba64"
                stroke-width="1.2"
              />
              <circle
                cx="18"
                cy="18"
                fill="#e2ba64"
                fill-opacity="0.95"
                r="5"
              />
              <!-- 8 轴环绕辐条 -->
              <line
                v-for="ray in compassRays"
                :key="`${ray.x1}-${ray.y1}-${ray.x2}-${ray.y2}`"
                :x1="ray.x1"
                :x2="ray.x2"
                :y1="ray.y1"
                :y2="ray.y2"
                stroke="#e2ba64"
                :stroke-linecap="ray.round ? 'round' : null"
                :stroke-width="ray.width"
              />
            </svg>

            <!-- 夜间月亮徽标：沿用虚线外环与金色辉光，mask 挖出弦月 + 星点闪烁 -->
            <svg v-else class="moon-svg" fill="none" viewBox="0 0 36 36">
              <defs>
                <mask id="moonCrescentMask">
                  <rect width="36" height="36" fill="#ffffff" />
                  <circle cx="22" cy="12" fill="#000000" r="12" />
                </mask>
              </defs>
              <!-- 与太阳版一致的外环轮廓 -->
              <circle
                cx="18"
                cy="18"
                opacity="0.65"
                r="16"
                stroke="#e2ba64"
                stroke-dasharray="2 3"
                stroke-width="1.2"
              />
              <!-- 弦月主体（主圆减去偏移圆） -->
              <circle
                cx="18"
                cy="18"
                fill="#e2ba64"
                fill-opacity="0.95"
                mask="url(#moonCrescentMask)"
                r="11"
              />
              <!-- 夜空星点 -->
              <circle
                v-for="s in moonStars"
                :key="s.cx"
                :cx="s.cx"
                :cy="s.cy"
                :fill="s.color"
                :r="s.r"
                class="moon-star"
                :style="{ animationDelay: s.delay }"
              />
            </svg>
          </div>

          <!-- 城市名 -->
          <span class="city-name">{{ hudText.city }}</span>

          <!-- 金色战术胶囊徽标 -->
          <div class="capsule-badge">
            <span class="capsule-text">{{ hudText.badge }}</span>
            <span class="capsule-dot"></span>
          </div>

          <div class="v-divider"></div>

          <!-- 高精度实时时钟 -->
          <div class="live-clock-box">
            <span class="clock-date">{{ clockDate }}</span>
            <span class="clock-weekday">{{ clockWeekday }}</span>
            <span class="clock-time">{{ clockTime }}</span>
            <span class="v-divider"></span>
            <!-- 天气实况：现象 + 温度 -->
            <span class="clock-weather">{{ weatherText }}</span>
            <span class="clock-temp"
              >{{ temperatureText }}<span class="temp-unit">°C</span></span
            >
          </div>
        </div>
        <!-- END: 左侧区域 -->

        <!-- BEGIN: 中央区域（倒阶梯下沉平台主标题） -->
        <div class="hud-center-title-container">
          <h1 class="glow-cyan-title">{{ hudText.title }}</h1>
          <div class="glow-cyan-subtitle">{{ hudText.subtitle }}</div>
        </div>
        <!-- END: 中央区域 -->

        <!-- BEGIN: 右侧区域（矩阵状态与帧率） -->
        <div class="hud-right-controls">
          <!-- 矩阵在线状态胶囊 -->
          <div class="matrix-status-pill">
            <span class="pulse-dot-green"></span>
            <span class="matrix-label">{{ hudText.matrixLabel }}</span>
            <span class="matrix-value">{{ hudText.matrixValue }}</span>
          </div>

          <!-- 帧率盒 -->
          <div class="freq-box">
            <span class="freq-tag">{{ hudText.freqTag }}</span>
            <span class="freq-num">{{ hudText.freqValue }}</span>
            <span class="freq-unit">{{ hudText.freqUnit }}</span>
          </div>

          <!-- 自制时间轴容器（代替 Cesium 默认时间轴，onMounted 时动态挂载）
               「线路轨迹」栏目里隐藏：那个栏目用面板自己的进度条 -->
          <div
            ref="timelineBoxRef"
            class="timeline-box"
            :class="{ 'is-hidden': hideTimeline }"
          ></div>
        </div>
        <!-- END: 右侧区域 -->
      </div>
    </header>
    <!-- END: 倒阶梯式 HUD 顶部标头 -->
  </div>
</template>

<style scoped>
/* ================= 重置与设计令牌（原 :root，改为组件根作用域变量以适配 scoped 样式） ================= */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.head-page {
  /* 对齐 foot.vue 设计令牌：金色为主色，青色仅作状态/英文副标题点缀 */
  --hud-bg-core: rgba(7, 16, 32, 0.88);
  --hud-gold: #e2ba64;
  --hud-gold-glow: #fce38a;
  --hud-cyan: #11efe3;
  --hud-border-gold: rgba(226, 186, 100, 0.45);
  --hud-border-dim: rgba(226, 186, 100, 0.2);

  background-color: #03070e;
  min-height: 100vh;
  color: #e2f1ff;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC',
    'Microsoft YaHei', sans-serif;
  overflow-x: hidden;
  user-select: none;
  -webkit-user-select: none;
}

/* 顶部标头外层包裹 */
.hud-header-container {
  position: relative;
  width: 100%;
  height: 96px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  z-index: 100;
  pointer-events: auto;
}

/* 全屏贯穿金色微光线 */
.hud-top-line {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1.5px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(226, 186, 100, 0.2) 15%,
    #e2ba64 50%,
    rgba(226, 186, 100, 0.2) 85%,
    transparent 100%
  );
  box-shadow: 0 0 10px rgba(226, 186, 100, 0.6);
  z-index: 25;
}

/* 阶梯式倒角背景框 */
.hud-stepped-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
  filter: drop-shadow(0 14px 28px rgba(0, 0, 0, 0.85));
}

.hud-stepped-backdrop .hud-backdrop-svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* 内容布局容器 */
.hud-content-bar {
  position: relative;
  width: 100%;
  max-width: 1720px;
  height: 100%;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 0 28px;
  z-index: 10;
}

/* 左侧区域（第一阶：48px） */
.hud-left-meta {
  height: 48px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}

.compass-box {
  width: 28px;
  height: 28px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.animate-spin-slow {
  animation: spin-slow 18s linear infinite;
}

/* 罗盘 SVG（原为行内 style，等价迁移到类） */
.compass-svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 7px rgba(226, 186, 100, 0.85));
}

@keyframes spin-slow {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.city-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #ffffff;
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.4);
}

/* 金色胶囊徽标 */
.capsule-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 9px;
  background: linear-gradient(
    180deg,
    rgba(226, 186, 100, 0.08) 0%,
    rgba(226, 186, 100, 0.18) 100%
  );
  border: 1px solid var(--hud-border-gold);
  border-radius: 3px;
  box-shadow:
    inset 0 0 6px rgba(226, 186, 100, 0.3),
    0 0 10px rgba(226, 186, 100, 0.2);
}

.capsule-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--hud-gold-glow);
}

.capsule-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--hud-gold);
  box-shadow:
    0 0 6px var(--hud-gold),
    0 0 10px var(--hud-gold);
}

.v-divider {
  width: 1px;
  height: 15px;
  background: rgba(148, 163, 184, 0.35);
  margin: 0 2px;
}

/* 动态时钟 */
.live-clock-box {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  letter-spacing: 0.05em;
}

.clock-date {
  color: #88a2be;
  font-weight: 500;
}

.clock-weekday {
  color: #64748b;
}

.clock-time {
  font-size: 15px;
  font-weight: 800;
  color: #f8fafc;
  letter-spacing: 0.08em;
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.6);
}

/* 天气现象文字（高德返回：晴 / 多云 / 小雨 …） */
.clock-weather {
  font-size: 13px;
  font-weight: 600;
  color: #cbd5e1;
  letter-spacing: 0.08em;
}

/* 温度文字：主数值用金色高光，°C 小单位弱化，呼应 freq-num/freq-unit */
.clock-temp {
  font-size: 14px;
  font-weight: 800;
  color: var(--hud-gold-glow);
  text-shadow: 0 0 6px rgba(252, 227, 138, 0.7);
}

.temp-unit {
  font-size: 9px;
  font-weight: 700;
  color: #64748b;
  margin-left: 1px;
  text-shadow: none;
}

/* 夜间月亮徽标：不做旋转，改为呼吸式辉光 */
.moon-svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 7px rgba(226, 186, 100, 0.85));
  animation: moon-breathe 3.6s ease-in-out infinite;
}

@keyframes moon-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.75;
  }
}

.moon-star {
  animation: star-twinkle 2.2s ease-in-out infinite;
}

@keyframes star-twinkle {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}

/* 中央区域（第三阶：最深下沉船体 88px） */
.hud-center-title-container {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: 0;
  height: 86px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  pointer-events: none;
  z-index: 12;
  width: 580px;
}

.glow-cyan-title {
  font-size: 23px;
  font-weight: 900;
  letter-spacing: 0.26em;
  padding-left: 0.26em;
  color: #fff6d9;
  text-transform: uppercase;
  text-shadow:
    0 0 12px rgba(226, 186, 100, 0.85),
    0 0 24px rgba(226, 186, 100, 0.45);
  line-height: 1.25;
}

.glow-cyan-subtitle {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.28em;
  color: var(--hud-cyan);
  text-transform: uppercase;
  margin-top: 4px;
  opacity: 0.95;
  text-shadow: 0 0 8px rgba(17, 239, 227, 0.7);
}

/* 右侧区域（第一阶：48px） */
.hud-right-controls {
  height: 48px;
  display: flex;
  align-items: center;
  gap: 13px;
  flex-shrink: 0;
}

.matrix-status-pill {
  height: 28px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 3px;
  background: var(--hud-bg-core);
  border: 1px solid var(--hud-border-dim);
  box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.6);
}

.pulse-dot-green {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--hud-cyan);
  box-shadow:
    0 0 8px var(--hud-cyan),
    0 0 14px rgba(17, 239, 227, 0.85);
  animation: pulse-green 2s infinite ease-in-out;
}

@keyframes pulse-green {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(0.85);
  }
}

.matrix-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: #88a2be;
}

.matrix-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.1em;
  color: #ffffff;
  text-shadow: 0 0 5px rgba(255, 255, 255, 0.7);
}

.freq-box {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.freq-tag {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: #88a2be;
}

.freq-num {
  font-size: 13px;
  font-weight: 800;
  color: var(--hud-gold-glow);
  text-shadow: 0 0 6px rgba(252, 227, 138, 0.7);
}

.freq-unit {
  font-size: 8px;
  font-weight: 700;
  color: #64748b;
  margin-left: -2px;
}

/* ================= 自制时间轴（HUD 风格，代替 Cesium 默认时间轴） ================= */
.timeline-box {
  width: 200px;
  height: 30px;
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
}

/* 「线路轨迹」栏目隐藏：退出布局、不可见、不接鼠标，但**保留 200px 宽度**，
   这样 Cesium Timeline 量到的宽度不变，回来时刻度不会乱 */
.timeline-box.is-hidden {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
}

/* Cesium Timeline 内部 DOM 由 JS 动态创建，scoped 下需用 :deep 穿透命中 */
.timeline-box :deep(.cesium-timeline-main) {
  position: relative;
  left: 0;
  bottom: 0;
  height: 100%;
  overflow: hidden;
}

.timeline-box :deep(.cesium-timeline-bar) {
  position: relative;
  left: 0;
  top: 0;
  height: 100%;
  width: 100%;
  overflow: hidden;
  cursor: pointer;
  background: rgba(8, 20, 42, 0.72);
  border: 1px solid rgba(226, 186, 100, 0.28);
  border-radius: 3px;
  box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.6);
}

.timeline-box :deep(.cesium-timeline-ruler) {
  visibility: hidden;
  white-space: nowrap;
  font-size: 80%;
  z-index: -200;
}

.timeline-box :deep(.cesium-timeline-needle) {
  position: absolute;
  left: 0;
  top: 14%;
  bottom: 14%;
  width: 1px;
  background: var(--hud-gold);
  box-shadow: 0 0 6px rgba(226, 186, 100, 0.9);
}

.timeline-box :deep(.cesium-timeline-ticMain) {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 1px;
  height: 56%;
  background: #ffe9b0;
}

.timeline-box :deep(.cesium-timeline-ticSub) {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 1px;
  height: 34%;
  background: rgba(226, 186, 100, 0.5);
}

.timeline-box :deep(.cesium-timeline-ticTiny) {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 1px;
  height: 20%;
  background: rgba(226, 186, 100, 0.28);
}

.timeline-box :deep(.cesium-timeline-ticLabel) {
  position: absolute;
  top: 3px;
  left: 0;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  color: #88a2be;
  cursor: default;
}

.timeline-box :deep(.cesium-timeline-icon16) {
  display: block;
  position: absolute;
  bottom: 0;
  left: 0;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 8px solid var(--hud-gold);
  filter: drop-shadow(0 0 4px rgba(226, 186, 100, 0.8));
}

/* 本项目未添加轨道，隐藏轨道层，避免多余空白 */
.timeline-box :deep(.cesium-timeline-trackContainer) {
  display: none;
}

/*
 * 金色星站节点：脉冲关键帧已改为脚本随机写入的位移 / 缩放 / 亮度。
 * 这里必须把变换基准锁定到节点自身包围盒 —— SVG 子元素的 transform-origin
 * 默认按 viewBox 解析，若不改，scale() 会绕整个 viewBox 中心缩放，节点会被甩飞。
 */
.node-pulse-gold {
  transform-box: fill-box;
  transform-origin: 50% 50%;
}
/* 大屏装配适配：填满顶部 96px 栏，不再撑满整屏 */
.head-page {
  min-height: 0;
  height: 100%;
  background: transparent;
}
</style>
