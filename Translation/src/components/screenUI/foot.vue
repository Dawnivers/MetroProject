<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { cesiumStore } from '@/stores/counter';
import { useScreenState, useToolbarState } from '@/stores/screenState';
import { useStationState } from '@/stores/stationState';
import cursorSkinUrl from '@/assets/cursor-hud.png';
import Toolbar from '../bottom/Toolbar.vue';

/* ---------------- 数据源 ---------------- */

/**
 * 战术导航按钮：同一个数组驱动左侧 / 右侧两个中阶功能区的全部 4 个按钮。
 * highlight = 原 DOM 中的 .btn-tactical-highlight（金色切角 + 扫描流光 + 双角星 + 金色光条）
 */
const navItems = [
  {
    key: 'realtime',
    side: 'left',
    en: 'REALTIME',
    cn: '线路轨迹',
    highlight: false,
  },
  {
    key: 'experiment',
    side: 'left',
    en: 'EXP.TRIAL',
    cn: '重点活动',
    highlight: true,
  },
  {
    key: 'strategy',
    side: 'right',
    en: 'STRATEGY',
    cn: '发展历程',
    highlight: true,
    scannerDelay: '1.8s',
  },
  {
    key: 'nodes',
    side: 'right',
    en: 'NODES',
    cn: '站点管理',
    highlight: false,
  },
];

/** 按 side 分组后交给模板顺序展开（左功能区 → 中央罗盘 → 右功能区） */
const navGroups = computed(() =>
  ['left', 'right'].map((side) => ({
    side,
    items: navItems.filter((item) => item.side === side),
  })),
);

/** 双轨黄金导轨上的星点：同一份数据镜像渲染到导轨左右两侧 */
const railStarNodes = [
  {
    offset: '20%',
    bottom: 44,
    size: 7,
    color: '#ffd700',
    glow: '#ffd700',
    blur: 10,
  },
  {
    offset: '22.5%',
    bottom: 68,
    size: 7,
    color: '#fce38a',
    glow: '#fce38a',
    blur: 8,
  },
  {
    offset: '40.8%',
    bottom: 68,
    size: 7,
    color: '#fce38a',
    glow: '#fce38a',
    blur: 8,
  },
  {
    offset: '43.8%',
    bottom: 90,
    size: 8,
    color: '#11efe3',
    glow: '#11efe3',
    blur: 12,
  },
];

/** 星点定位：side 为 'left' / 'right'，其余样式由数据项推导 */
const railStarStyle = (node, side) => ({
  [side]: node.offset,
  bottom: `${node.bottom}px`,
  width: `${node.size}px`,
  height: `${node.size}px`,
  background: node.color,
  boxShadow: `0 0 ${node.blur}px ${node.glow}`,
});

/** 星盘六边形顶点：多边形轮廓与 6 个顶点圆点由同一份顶点数组推导 */
const dialNodes = [
  { cx: 50, cy: 2, r: 2.2, color: '#ffd700' },
  { cx: 92, cy: 26, r: 2, color: '#11efe3' },
  { cx: 92, cy: 74, r: 2, color: '#ffd700' },
  { cx: 50, cy: 98, r: 2.2, color: '#ffd700' },
  { cx: 8, cy: 74, r: 2, color: '#11efe3' },
  { cx: 8, cy: 26, r: 2, color: '#ffd700' },
];

const dialHexPoints = computed(() =>
  dialNodes.map((node) => `${node.cx},${node.cy}`).join(' '),
);

/** 左右翼部信息（两块结构不对称：左翼带微型链路灯，右翼带齿轮设置键，故分列） */
const leftWing = {
  badge: '01',
  status: 'LNK_OK // SEC-01',
  sub: 'SYS.LATENCY: 18ms',
};

const rightWing = {
  badge: '02',
  status: 'CORE BURDEN',
  sub: '78% STABLE',
};

/* ---------------- 交互状态 ---------------- */

/**
 * 战术导航按钮 → 路由的映射。
 * 按钮高亮与「站点管理」栏目的展开**都由路由推导**，不再单独存一份 activeNav：
 * URL 成为唯一真相来源，刷新 / 前进后退 / 直接粘链接都能落在同一个界面状态。
 */
const NAV_ROUTES = {
  realtime: '/realtime',
  experiment: '/experiment',
  strategy: '/strategy',
  nodes: '/nodes',
};

const route = useRoute();
const router = useRouter();

/** 当前激活的导航按钮 key：由当前路由反查，查不到就是首页（无高亮） */
const activeNav = computed(() => {
  const hit = Object.entries(NAV_ROUTES).find(
    ([, path]) => path === route.path,
  );
  return hit ? hit[0] : null;
});

/** 当前按住中的元素 key（对应原 JS 的 mousedown / mouseup / mouseleave 微动效） */
const pressedKey = ref(null);
/** 中央主控按钮点击后的标题闪烁态 */
const coreFlashing = ref(false);
let coreFlashTimer = null;

const onNavClick = (key) => {
  // 再点一次已展开的「站点管理」＝收起栏目，等价于回首页路由。
  // 站点本身的显隐由 stationState 从路由推导，这里不需要手动开关。
  if (key === 'nodes' && route.path === '/nodes') {
    router.push('/');
    return;
  }
  router.push(NAV_ROUTES[key] ?? '/');
};

const onCoreClick = () => {
  // 回到主控中心：路由回首页（面板随之收起）+ 标题瞬时闪青
  router.push('/');
  coreFlashing.value = true;
  clearTimeout(coreFlashTimer);
  coreFlashTimer = setTimeout(() => {
    coreFlashing.value = false;
  }, 300);
};

const pressDown = (key) => {
  pressedKey.value = key;
};

const pressUp = () => {
  pressedKey.value = null;
};

const pressedStyle = (key) =>
  pressedKey.value === key ? { transform: 'scale(0.96)' } : null;

/** 高亮按钮的底部光条（由 highlight 推导，避免重复字段） */
const glowBarStyle = (item) =>
  item.highlight
    ? {
        background: 'var(--color-gold-glow)',
        boxShadow: '0 0 8px var(--color-gold-glow)',
      }
    : null;

/** 扫描流光延时（仅右侧高亮按钮带 1.8s 偏移） */
const scannerStyle = (item) =>
  item.scannerDelay ? { animationDelay: item.scannerDelay } : null;

/* ---------------- 齿轮工具（已拆到 ./Toolbar.vue） ---------------- */

/** 工具栏与鼠标工具共享状态（foot 与 Toolbar 双向读写）。线路图层面板已随 Toolbar 一起拆出。 */
const { activeTool, mouseToolOn, gearHover } = useToolbarState();

const dataStore = cesiumStore();

/**
 * 「站点管理」栏目开关。
 * 面板挂在中央舞台（本文件），被控的站点对象在 Toolbar.vue，
 * 所以状态走共享仓库中转：这里只负责开合，Toolbar 负责把 show 同步到三维。
 */
const { stationPanelOpen } = useStationState();

/* ---------------- 全屏（沉浸）模式 ---------------- */

const { immersive, exitAnchor } = useScreenState();

/**
 * 进入全屏：先量下当前这颗按钮的位置（换算成距视口右下角的距离），
 * 再收起工具栏并切到沉浸模式；App.vue 会在同一位置放出「退出全屏」按钮。
 * 同时尝试请求浏览器全屏 —— 被拒（非用户手势等）也不影响沉浸效果。
 */
const enterImmersive = () => {
  const button = document.querySelector('[aria-label="全屏模型"]');
  const rect = button?.getBoundingClientRect();
  exitAnchor.value = rect
    ? {
        right: Math.max(8, Math.round(window.innerWidth - rect.right)),
        bottom: Math.max(8, Math.round(window.innerHeight - rect.bottom)),
        size: Math.round(rect.width),
      }
    : null;

  // 工具栏先收干净，免得隐藏后残留焦点/悬停态
  gearHover.value = false;
  activeTool.value = null;

  immersive.value = true;
  document.documentElement.requestFullscreen?.().catch(() => {});
};

/* ---------------- 自定义鼠标皮肤（工具：显示鼠标位置） ---------------- */

/**
 * 鼠标工具默认开启：皮肤显示、系统光标隐藏。
 * 注意：这是**唯一**参与响应式渲染的鼠标状态，状态存于 useToolbarState，
 * 与 Toolbar.vue 共享；坐标 / 经纬度不能用 ref 存——那样每次 mousemove
 * 都会让整个 foot.vue（上千行、含线路列表与各种 SVG）重渲染，皮肤跟不上手。
 */

/** 皮肤上的两个读数节点：直接写 textContent，绕开 Vue 渲染管线 */
const cursorXyRef = ref(null);
const cursorGeoRef = ref(null);

/** 鼠标隐藏时的浮窗提示 */
const cursorHintVisible = computed(() => !mouseToolOn.value);

/**
 * 原生光标皮肤：PNG + 热区（32,32，即图片正中）。
 * 由浏览器/系统合成器绘制，和页面帧率无关 —— 三维场景再卡，指针也永远跟手。
 * Chrome 的 cursor 只吃位图，不支持 SVG，所以素材是导出的 PNG。
 */
const CURSOR_SKIN = `url(${cursorSkinUrl}) 32 32, crosshair`;

/**
 * 光标表面完全由我们接管（用户要求：页面内只允许出现「皮肤」或「彻底隐藏」，
 * 绝不出现系统默认光标）。
 *
 * 做法：把 .hud-cursor-managed 常驻在 <html> 上 —— 这条全局规则带 !important，
 * 连 Cesium 给 canvas 写的行内 cursor 也会被覆盖 —— 再靠 CSS 变量切换取值：
 *   工具开 → --hud-cursor-skin = 准星 PNG（热区 32,32）
 *   工具关 → --hud-cursor-skin = none（整页光标彻底不可见，按 ESC 找回）
 */
const syncNativeCursor = () => {
  const root = document.documentElement;
  root.classList.add('hud-cursor-managed');
  root.style.setProperty(
    '--hud-cursor-skin',
    mouseToolOn.value ? CURSOR_SKIN : 'none',
  );
};

/**
 * 画布矩形缓存。
 * getBoundingClientRect 会强制同步布局，每帧调用是实打实的开销，
 * 所以 1 秒最多量一次；窗口尺寸变化时置空重算。
 */
let cachedCanvasRect = null;
let cachedRectAt = 0;

const canvasRect = () => {
  const now = performance.now();
  if (cachedCanvasRect !== null && now - cachedRectAt < 1000)
    return cachedCanvasRect;
  const viewer = dataStore.viewer;
  const canvas = viewer && viewer.canvas;
  if (!canvas) return null;
  cachedCanvasRect = canvas.getBoundingClientRect();
  cachedRectAt = now;
  return cachedCanvasRect;
};

/**
 * 屏幕坐标 → 经纬度。
 * 只借 viewer 自带的对象（camera.pickEllipsoid + ellipsoid.cartesianToCartographic），
 * 不额外 import cesium，免得把整包再拉进这个组件。
 */
const pickLngLat = (x, y) => {
  const viewer = dataStore.viewer;
  if (!viewer || (viewer.isDestroyed && viewer.isDestroyed())) return null;
  const rect = canvasRect();
  if (!rect) return null;
  const px = x - rect.left;
  const py = y - rect.top;
  if (px < 0 || py < 0 || px > rect.width || py > rect.height) return null;
  const ellipsoid = viewer.scene.globe.ellipsoid;
  const cartesian = viewer.camera.pickEllipsoid({ x: px, y: py }, ellipsoid);
  if (!cartesian) return null;
  const carto = ellipsoid.cartesianToCartographic(cartesian);
  if (!carto) return null;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  return { lng: toDeg(carto.longitude), lat: toDeg(carto.latitude) };
};

/**
 * rAF 节流：每帧最多刷一次读数。
 * 指针本体由系统级图片光标绘制（见全局样式里的 --hud-cursor-skin），
 * 不经过这里，所以读数慢一点完全不影响跟手。
 */
let cursorRaf = null;
let pendingPoint = null;
/** 经纬度读数节流：10Hz 足够 */
let lastGeoAt = 0;

const flushCursor = () => {
  cursorRaf = null;
  const point = pendingPoint;
  if (!point) return;

  if (cursorXyRef.value) {
    cursorXyRef.value.textContent = `X ${Math.round(point.x)} Y ${Math.round(point.y)}`;
  }

  const now = performance.now();
  if (now - lastGeoAt >= 100) {
    lastGeoAt = now;
    const geo = pickLngLat(point.x, point.y);
    const geoEl = cursorGeoRef.value;
    if (geoEl) {
      geoEl.textContent = geo
        ? `${formatLng(geo.lng)} ${formatLat(geo.lat)}`
        : '超出地球范围';
      geoEl.classList.toggle('is-empty', geo === null);
    }
  }
};

const onCursorMove = (event) => {
  pendingPoint = { x: event.clientX, y: event.clientY };
  if (cursorRaf === null) cursorRaf = requestAnimationFrame(flushCursor);
};

/** 开启工具时才挂监听，关掉就摘掉 */
const startCursorTracking = () => {
  window.addEventListener('mousemove', onCursorMove, { passive: true });
};

const stopCursorTracking = () => {
  window.removeEventListener('mousemove', onCursorMove);
  if (cursorRaf !== null) {
    cancelAnimationFrame(cursorRaf);
    cursorRaf = null;
  }
  pendingPoint = null;
};

/** 经纬度显示：东经 / 北纬，保留 4 位 */
const formatLng = (lng) =>
  `${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
const formatLat = (lat) =>
  `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`;

const onWindowResize = () => {
  cachedCanvasRect = null; // 画布尺寸变了，矩形缓存作废
};

/** 鼠标工具开关变化时，同步光标皮肤与坐标跟随（初始立即执行一次） */
watch(
  () => mouseToolOn.value,
  (on) => {
    syncNativeCursor();
    if (on) {
      cachedCanvasRect = null; // 重开时重量一次画布
      startCursorTracking();
    } else {
      stopCursorTracking();
    }
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('resize', onWindowResize);
});

onBeforeUnmount(() => {
  clearTimeout(coreFlashTimer);
  stopCursorTracking();
  document.documentElement.classList.remove('hud-cursor-managed');
  document.documentElement.style.removeProperty('--hud-cursor-skin');
  window.removeEventListener('resize', onWindowResize);
});
</script>

<template>
  <div class="foot-page">
    <!-- 原快照的顶部战术状态栏（.hud-header）已从 DOM 中删除，对应 CSS 仍保留在本文件末尾，如需可在该处补回 -->

    <!-- BEGIN: 中央星轨 HUD 背景层 -->
    <main class="central-stage">
      <div class="orbit-container">
        <div class="orbit-inner-dashed"></div>
        <div class="orbit-node-top"></div>
        <div class="orbit-node-bottom"></div>
      </div>
      <div
        class="center-hud-label"
        :class="{ 'is-behind-panel': stationPanelOpen }"
      >
        <div class="center-hud-en">CYBER CHINESE TACTICAL HUD ARCHITECTURE</div>
        <div class="center-hud-cn">虚陵浑天战术中枢 · 自适应梯级控制阵列</div>
      </div>

      <!-- 「站点管理」栏目不再挂在这里：它现在是一条路由（/nodes → StationPanel.vue），
           由 App.vue 的 <RouterView> 渲染，与三维场景是兄弟节点。
           面板内部会 Teleport 到 .hud-canvas 并用设计坐标定位
           （留在 .foot-page 里会被它的 overflow 裁掉上半截、点不到），
           所以放在哪一层渲染都不影响它的位置与出入场动画。 -->
    </main>
    <!-- END: 中央星轨 HUD 背景层 -->

    <!-- BEGIN: 底部梯级 HUD 导航控制台 -->
    <footer class="hud-bottom-bar">
      <div class="hud-console-wrap">
        <!-- 双轨黄金梯级导轨（SVG 与星点） -->
        <div class="track-rail-container">
          <svg
            class="rail-svg"
            preserveAspectRatio="none"
            viewBox="0 0 1200 102"
          >
            <defs>
              <linearGradient
                id="goldTrackGrad"
                x1="0%"
                x2="100%"
                y1="0%"
                y2="0%"
              >
                <stop offset="0%" stop-color="#e2ba64" stop-opacity="0" />
                <stop offset="15%" stop-color="#e2ba64" stop-opacity="0.85" />
                <stop offset="35%" stop-color="#ffd778" stop-opacity="0.95" />
                <stop offset="50%" stop-color="#ffffff" stop-opacity="1" />
                <stop offset="65%" stop-color="#ffd778" stop-opacity="0.95" />
                <stop offset="85%" stop-color="#e2ba64" stop-opacity="0.85" />
                <stop offset="100%" stop-color="#e2ba64" stop-opacity="0" />
              </linearGradient>
              <filter
                id="goldGlowBlur"
                height="140%"
                width="140%"
                x="-20%"
                y="-20%"
              >
                <feGaussianBlur result="blur" stdDeviation="2.2" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <!-- 上层主梯级金色导轨 -->
            <path
              d="M 0,58 L 240,58 L 270,34 L 490,34 L 525,12 L 675,12 L 710,34 L 930,34 L 960,58 L 1200,58"
              fill="none"
              filter="url(#goldGlowBlur)"
              stroke="url(#goldTrackGrad)"
              stroke-width="2"
            />
            <!-- 下层次级金/青虚线并行导轨 -->
            <path
              d="M 30,70 L 245,70 L 275,46 L 485,46 L 520,24 L 680,24 L 715,46 L 925,46 L 955,70 L 1170,70"
              fill="none"
              stroke="rgba(226, 186, 100, 0.4)"
              stroke-dasharray="4,4"
              stroke-width="1"
            />
          </svg>
          <!-- 导轨拐点处的金色 / 青色星点（数组镜像渲染到左右两侧） -->
          <template v-for="side in ['left', 'right']" :key="side">
            <div
              v-for="node in railStarNodes"
              :key="`${side}-${node.offset}`"
              class="track-star-node"
              :style="railStarStyle(node, side)"
            ></div>
          </template>
        </div>

        <!-- 主导航控制台 -->
        <nav aria-label="战术导航中枢" class="hud-nav-deck">
          <!-- ========== 1. 左侧低阶翼部 (Tier 1: 48px) ========== -->
          <div class="tier-wing tier-wing-left">
            <div class="wing-info">
              <span class="status-line">
                <span class="ping-box ping-mini">
                  <span class="ping-dot ping-mini"></span>
                </span>
                {{ leftWing.status }}
              </span>
              <span class="wing-sub">{{ leftWing.sub }}</span>
            </div>
            <div class="wing-box-badge">{{ leftWing.badge }}</div>
          </div>

          <!-- ========== 2/4. 中阶功能区 + 3. 中央高阶主控罗盘（按数组顺序展开，罗盘插在左右之间） ========== -->
          <template v-for="group in navGroups" :key="group.side">
            <div class="tier-mid" :class="`tier-mid-${group.side}`">
              <button
                v-for="item in group.items"
                :key="item.key"
                class="btn-tactical"
                :class="{
                  'btn-tactical-highlight': item.highlight,
                  active: activeNav === item.key,
                }"
                :style="pressedStyle(item.key)"
                @mousedown="pressDown(item.key)"
                @mouseup="pressUp"
                @mouseleave="pressUp"
                @click="onNavClick(item.key)"
              >
                <span
                  v-if="item.highlight"
                  class="scanner-light"
                  :style="scannerStyle(item)"
                ></span>
                <span v-if="item.highlight" class="btn-corner-star-left"></span>
                <span
                  v-if="item.highlight"
                  class="btn-corner-star-right"
                ></span>
                <span class="btn-en">{{ item.en }}</span>
                <span class="btn-cn">{{ item.cn }}</span>
                <span class="btn-glow-bar" :style="glowBarStyle(item)"></span>
              </button>
            </div>

            <!-- 中央高阶主控罗盘基座 (Tier 3: 88px+ 抬升) -->
            <div v-if="group.side === 'left'" class="tier-apex">
              <div class="compass-outer-housing">
                <!-- 最外层正六边形外壳 -->
                <div class="compass-polygon-border">
                  <div class="compass-polygon-body">
                    <div class="compass-inner-wireframe"></div>
                  </div>
                </div>
                <!-- 同心星盘旋转环（顶点与轮廓同源驱动） -->
                <div class="compass-dial-ring">
                  <svg class="dial-ring-svg" viewBox="0 0 100 100">
                    <polygon
                      :points="dialHexPoints"
                      fill="none"
                      stroke="rgba(226,186,100,0.6)"
                      stroke-dasharray="5,3.5"
                      stroke-width="1.2"
                    />
                    <circle
                      v-for="node in dialNodes"
                      :key="`${node.cx}-${node.cy}`"
                      :cx="node.cx"
                      :cy="node.cy"
                      :r="node.r"
                      :fill="node.color"
                      :filter="`drop-shadow(0 0 4px ${node.color})`"
                    />
                  </svg>
                </div>
                <!-- 核心主按钮（首页 CORE） -->
                <button
                  class="compass-core-btn"
                  :style="pressedStyle('core')"
                  title="返回主控中心"
                  @mousedown="pressDown('core')"
                  @mouseup="pressUp"
                  @mouseleave="pressUp"
                  @click="onCoreClick"
                >
                  <div class="compass-core-rim">
                    <div class="compass-core-inner">
                      <div class="compass-core-highlight"></div>
                      <!-- 内层反向旋转虚线六边形 -->
                      <svg class="reverse-dial" viewBox="0 0 80 80">
                        <polygon
                          fill="none"
                          points="40,9 68,25 68,55 40,71 12,55 12,25"
                          stroke="#11efe3"
                          stroke-dasharray="4,3"
                          stroke-width="1.2"
                        />
                      </svg>
                      <span
                        class="core-title"
                        :class="{ 'core-title-flash': coreFlashing }"
                        >首页</span
                      >
                      <span class="core-sub">CORE</span>
                      <span class="core-indicator-bar"></span>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </template>

          <!-- ========== 5. 右侧低阶翼部 (Tier 1: 48px) ========== -->
          <div class="tier-wing tier-wing-right">
            <div class="wing-box-badge">{{ rightWing.badge }}</div>
            <div class="wing-right-group">
              <div class="wing-info wing-info-right">
                <span class="status-line">{{ rightWing.status }}</span>
                <span class="wing-sub">{{ rightWing.sub }}</span>
              </div>
              <!-- 齿轮设置键 + 浮出工具箱（已拆到 ./Toolbar.vue，样式/定位/交互不变） -->
              <Toolbar @fullscreen="enterImmersive" />

              <!-- ===== 鼠标位置读数（屏幕右下角常驻）=====
                   指针本体是系统级图片光标（见全局样式的 --hud-cursor-skin），
                   由浏览器合成器绘制，不受页面帧率影响；读数不再跟随指针，
                   固定挂在右下角，因此整条链路上没有任何东西需要"跟手"。 -->
              <Teleport to="body">
                <div
                  v-if="mouseToolOn"
                  class="hud-cursor-panel"
                  :class="{ 'is-immersive': immersive }"
                >
                  <div class="hcp-head"><i class="hcp-mark"></i>鼠标位置</div>
                  <div class="hcp-row">
                    <span class="hcp-k">SCREEN</span>
                    <b ref="cursorXyRef">X -- Y --</b>
                  </div>
                  <div class="hcp-row is-geo">
                    <span class="hcp-k">GEO</span>
                    <b ref="cursorGeoRef" class="is-empty">--</b>
                  </div>
                </div>
              </Teleport>

              <!-- 鼠标隐藏时的浮窗提示：点它或按 ESC 都能恢复 -->
              <Teleport to="body">
                <Transition name="hint-pop">
                  <div
                    v-if="cursorHintVisible"
                    class="hud-cursor-hint"
                    role="alert"
                    title="点击此处也可以重新显示鼠标"
                    @click="mouseToolOn = true"
                  >
                    <svg
                      class="hch-icon"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        d="M7 3.5 17.5 11l-4.6 1.4L11 17.6z"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linejoin="round"
                      />
                    </svg>
                    <span class="hch-text">鼠标已隐藏</span>
                    <kbd class="hch-key">ESC</kbd>
                    <span class="hch-text">按键重新显示鼠标</span>
                  </div>
                </Transition>
              </Teleport>
            </div>
          </div>
        </nav>
      </div>
    </footer>
    <!-- END: 底部梯级 HUD 导航控制台 -->
  </div>
</template>

<style scoped>
/* ================= 设计令牌（原 :root，改为组件根作用域变量以适配 scoped 样式） ================= */
.foot-page {
  --color-bg: #03070e;
  --color-deep-blue: #050b14;
  --color-gold: #e2ba64;
  --color-gold-glow: #fce38a;
  --color-gold-dark: #8b6914;
  --color-cyan: #38ef7d;
  --color-cyan-glow: #11efe3;
  --color-text-main: #e2f1ff;
  --color-text-muted: #88a2be;
  --panel-bg: rgba(7, 16, 32, 0.88);
  --panel-border: rgba(226, 186, 100, 0.35);
  --font-scifi: 'Rajdhani', 'Noto Sans SC', sans-serif;
  --font-sans: 'Noto Sans SC', sans-serif;

  background-color: var(--color-bg);
  color: var(--color-text-main);
  font-family: var(--font-sans);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow-x: hidden;
  user-select: none;
  position: relative;
  /* 虚拟星空与赛博城市底图网格背景 */
  background-image:
    radial-gradient(
      circle at 50% 100%,
      rgba(13, 36, 68, 0.5) 0%,
      rgba(3, 7, 15, 0.98) 75%
    ),
    linear-gradient(rgba(0, 242, 254, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 242, 254, 0.035) 1px, transparent 1px);
  background-size:
    100% 100%,
    40px 40px,
    40px 40px;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

::selection {
  background: #00f2fe;
  color: #03070e;
}

/* Keyframe Animations */
@keyframes dial-rotate {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

@keyframes dial-reverse {
  0% {
    transform: rotate(360deg);
  }
  100% {
    transform: rotate(-360deg);
  }
}

@keyframes pulse-core {
  0%,
  100% {
    transform: scale(1);
    filter: drop-shadow(0 0 14px rgba(226, 186, 100, 0.75))
      drop-shadow(0 0 10px rgba(17, 239, 227, 0.5));
  }
  50% {
    transform: scale(1.03);
    filter: drop-shadow(0 0 24px rgba(226, 186, 100, 0.95))
      drop-shadow(0 0 16px rgba(17, 239, 227, 0.8));
  }
}

@keyframes ping-dot {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  75%,
  100% {
    transform: scale(2.2);
    opacity: 0;
  }
}

@keyframes flow-light {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(240%);
  }
}

/* 顶部状态栏：原快照 DOM 已删除，样式按约定保留待复用 */
.hud-header {
  width: 100%;
  padding: 20px 32px 0 32px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  letter-spacing: 0.15em;
  color: rgba(226, 186, 100, 0.85);
  font-family: var(--font-scifi);
  z-index: 20;
}

.status-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ping-box {
  position: relative;
  width: 8px;
  height: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ping-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--color-cyan-glow);
  box-shadow: 0 0 8px var(--color-cyan-glow);
}

.ping-wave {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--color-cyan-glow);
  animation: ping-dot 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
}

/* 翼部微型链路灯（原为行内 style，等价迁移到类） */
.ping-mini {
  width: 5px;
  height: 5px;
}

.hud-tag {
  border: 1px solid rgba(226, 186, 100, 0.35);
  background: rgba(7, 16, 32, 0.6);
  padding: 2px 8px;
  border-radius: 2px;
}

.cyan-text {
  color: var(--color-cyan-glow);
}

/* ================= 中央星轨与雷达舞台 ================= */
.central-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 16px;
  z-index: 10;
}

.orbit-container {
  position: absolute;
  width: 440px;
  height: 440px;
  border-radius: 50%;
  border: 1px solid rgba(226, 186, 100, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  animation: dial-rotate 28s linear infinite;
}

.orbit-inner-dashed {
  position: absolute;
  width: 380px;
  height: 380px;
  border-radius: 50%;
  border: 1px dashed rgba(17, 239, 227, 0.22);
}

.orbit-node-top {
  position: absolute;
  top: -4px;
  width: 8px;
  height: 8px;
  background-color: var(--color-gold);
  border-radius: 50%;
  box-shadow: 0 0 10px var(--color-gold);
}

.orbit-node-bottom {
  position: absolute;
  bottom: -4px;
  width: 8px;
  height: 8px;
  background-color: var(--color-cyan-glow);
  border-radius: 50%;
  box-shadow: 0 0 10px var(--color-cyan-glow);
}

.center-hud-label {
  position: relative;
  text-align: center;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.center-hud-en {
  font-family: var(--font-scifi);
  font-size: 11px;
  letter-spacing: 0.35em;
  color: rgba(17, 239, 227, 0.8);
  text-shadow: 0 0 8px rgba(17, 239, 227, 0.4);
}

.center-hud-cn {
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.25em;
  color: rgba(226, 186, 100, 0.9);
  text-shadow: 0 0 10px rgba(226, 186, 100, 0.4);
}

/* 站点控制栏展开时中央标题退到后面，避免两者叠字 */
.center-hud-label {
  transition: opacity 0.24s ease;
}

/* 站点控制栏展开时中央标题完全让位：
   面板底色是 95% 不透明，留一点点透明度会从字缝里透出「虚陵浑天…」的残影，
   看起来像渲染故障，所以直接收到 0，收起面板时再淡回来。 */
.center-hud-label.is-behind-panel {
  opacity: 0;
}

/* ================= 底部控制条区域 ================= */
.hud-bottom-bar {
  width: 100%;
  padding: 0 12px 14px 12px;
  position: relative;
  z-index: 30;
}

.hud-console-wrap {
  max-width: 1280px;
  margin: 0 auto;
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

/* 双轨黄金导轨（背景 SVG 与星点） */
.track-rail-container {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding-bottom: 2px;
  z-index: 0;
}

.rail-svg {
  width: 100%;
  height: 102px;
  overflow: visible;
}

/* 导轨上的固定星点 */
.track-star-node {
  position: absolute;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  transform: translate(-50%, 50%);
}

/* 梯级导航甲板 */
.hud-nav-deck {
  width: 100%;
  position: relative;
  z-index: 10;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

/* 翼部（第一阶：48px） */
.tier-wing {
  height: 48px;
  width: 200px;
  background: linear-gradient(
    90deg,
    rgba(5, 11, 20, 0.96),
    rgba(8, 21, 40, 0.92)
  );
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-top: 1px solid rgba(226, 186, 100, 0.35);
  border-bottom: 1px solid rgba(226, 186, 100, 0.35);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.6);
  position: relative;
}

.tier-wing-left {
  border-left: 1px solid rgba(226, 186, 100, 0.35);
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 100%, 0 100%);
}

.tier-wing-right {
  border-right: 1px solid rgba(226, 186, 100, 0.35);
  background: linear-gradient(
    90deg,
    rgba(8, 21, 40, 0.92),
    rgba(5, 11, 20, 0.96)
  );
  clip-path: polygon(0 100%, 10px 0, 100% 0, 100% 100%);
}

.wing-info {
  display: flex;
  flex-direction: column;
  font-family: var(--font-scifi);
  font-size: 9px;
  line-height: 1.25;
  color: #94a3b8;
}

.wing-info .status-line {
  color: var(--color-cyan-glow);
  letter-spacing: 0.08em;
  display: flex;
  align-items: center;
  gap: 5px;
}

/* 右翼信息右对齐（原为行内 style，等价迁移到类） */
.wing-info-right {
  align-items: flex-end;
}

/* 翼部副标题（原为行内 style，等价迁移到类） */
.wing-sub {
  opacity: 0.7;
  font-size: 8px;
  margin-top: 1px;
}

/* 右翼「信息 + 齿轮键」容器（原为行内 style，等价迁移到类） */
.wing-right-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wing-box-badge {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(226, 186, 100, 0.35);
  color: var(--color-gold);
  font-size: 10px;
  font-family: var(--font-scifi);
  background: rgba(5, 11, 20, 0.5);
}

/* 中阶功能区（第二阶：64px） */
.tier-mid {
  height: 64px;
  background: linear-gradient(
    90deg,
    rgba(9, 26, 50, 0.96),
    rgba(12, 33, 61, 0.98),
    rgba(11, 27, 48, 0.96)
  );
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-top: 2px solid var(--color-gold);
  border-bottom: 1px solid rgba(226, 186, 100, 0.55);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  position: relative;
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.7),
    inset 0 0 16px rgba(11, 30, 56, 0.6);
}

.tier-mid-left {
  margin-left: 2px;
  clip-path: polygon(14px 100%, 0 0, calc(100% - 14px) 0, 100% 100%);
}

.tier-mid-right {
  margin-right: 2px;
  clip-path: polygon(0 100%, 14px 0, 100% 0, calc(100% - 14px) 100%);
}

/* 战术导航按钮 */
.btn-tactical {
  position: relative;
  height: 44px;
  padding: 0 18px;
  background: rgba(10, 22, 40, 0.85);
  border: 1px solid rgba(226, 186, 100, 0.4);
  border-left: 1px solid rgba(226, 186, 100, 0.7);
  border-right: 1px solid rgba(226, 186, 100, 0.7);
  border-radius: 2px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.25s ease;
  overflow: hidden;
  outline: none;
}

.btn-tactical:hover {
  background: rgba(14, 38, 70, 0.9);
  border-color: var(--color-cyan-glow);
  box-shadow: 0 0 14px rgba(17, 239, 227, 0.35);
}

.btn-tactical.active {
  background: rgba(17, 43, 79, 0.95);
  border-color: var(--color-cyan-glow);
  box-shadow:
    0 0 18px rgba(17, 239, 227, 0.5),
    inset 0 0 10px rgba(17, 239, 227, 0.25);
}

.btn-tactical-highlight {
  background: linear-gradient(
    180deg,
    rgba(16, 45, 78, 0.7) 0%,
    rgba(7, 18, 33, 0.95) 100%
  );
  border: 1px solid var(--color-gold);
  box-shadow:
    inset 0 0 14px rgba(226, 186, 100, 0.25),
    0 0 10px rgba(226, 186, 100, 0.2);
  clip-path: polygon(10px 0, calc(100% - 10px) 0, 100% 100%, 0% 100%);
}

.btn-tactical-highlight:hover {
  border-color: #ffd778;
  box-shadow:
    inset 0 0 18px rgba(255, 215, 120, 0.4),
    0 0 16px rgba(226, 186, 100, 0.4);
}

.btn-en {
  font-family: var(--font-scifi);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.16em;
  color: rgba(226, 186, 100, 0.75);
  transition: color 0.25s;
}

.btn-cn {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: #e2f1ff;
  transition: color 0.25s;
}

.btn-tactical:hover .btn-en {
  color: var(--color-cyan-glow);
}

.btn-tactical:hover .btn-cn {
  color: #ffffff;
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
}

.btn-tactical-highlight .btn-en {
  color: var(--color-gold-glow);
}

.btn-tactical-highlight .btn-cn {
  color: #fff9e6;
}

.btn-glow-bar {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 2px;
  background: var(--color-cyan-glow);
  box-shadow: 0 0 6px var(--color-cyan-glow);
  transition: width 0.3s ease;
}

.btn-tactical:hover .btn-glow-bar,
.btn-tactical.active .btn-glow-bar {
  width: 100%;
}

.scanner-light {
  position: absolute;
  top: 0;
  left: 0;
  width: 60%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 235, 160, 0.22),
    transparent
  );
  animation: flow-light 3.8s ease-in-out infinite;
  pointer-events: none;
}

.btn-corner-star-left {
  position: absolute;
  top: 3px;
  left: 4px;
  width: 3px;
  height: 3px;
  background: var(--color-gold);
  border-radius: 50%;
  box-shadow: 0 0 4px var(--color-gold);
}

.btn-corner-star-right {
  position: absolute;
  top: 3px;
  right: 4px;
  width: 3px;
  height: 3px;
  background: var(--color-gold);
  border-radius: 50%;
  box-shadow: 0 0 4px var(--color-gold);
}

/* 中央高阶主控罗盘（第三阶：88px+ 抬升） */
.tier-apex {
  position: relative;
  z-index: 20;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 8px;
  bottom: 4px;
}

.compass-outer-housing {
  position: relative;
  width: 108px;
  height: 98px;
  display: flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 0 16px rgba(226, 186, 100, 0.5))
    drop-shadow(0 0 24px rgba(17, 239, 227, 0.35));
}

/* 同心六边形外层框体 */
.compass-polygon-border {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    var(--color-gold) 0%,
    rgba(226, 186, 100, 0.6) 45%,
    var(--color-cyan-glow) 100%
  );
  padding: 2px;
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
}

.compass-polygon-body {
  width: 100%;
  height: 100%;
  background: linear-gradient(180deg, #132d4b 0%, #0b1c31 60%, #050b14 100%);
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.compass-inner-wireframe {
  position: absolute;
  inset: 5px;
  border: 1px solid rgba(226, 186, 100, 0.35);
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
  pointer-events: none;
}

/* 旋转星盘环 */
.compass-dial-ring {
  position: absolute;
  width: 94px;
  height: 94px;
  pointer-events: none;
  animation: dial-rotate 22s linear infinite;
}

/* 星盘 SVG（原为行内 style，等价迁移到类） */
.dial-ring-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

/* 六边形核心按钮 */
.compass-core-btn {
  position: relative;
  width: 76px;
  height: 76px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  outline: none;
  border: none;
  background: transparent;
  z-index: 10;
  animation: pulse-core 3.5s ease-in-out infinite;
  transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.compass-core-btn:active {
  transform: scale(0.94);
}

.compass-core-rim {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #d97706, #ffd700, #11efe3);
  padding: 2.5px;
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
}

.compass-core-inner {
  width: 100%;
  height: 100%;
  background: linear-gradient(180deg, #1b3a4b 0%, #0b1c31 50%, #06111e 100%);
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
}

.compass-core-highlight {
  position: absolute;
  top: 1px;
  left: 10px;
  right: 10px;
  height: 16px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.45) 0%,
    transparent 100%
  );
  pointer-events: none;
}

.compass-core-inner svg.reverse-dial {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  opacity: 0.45;
  animation: dial-reverse 16s linear infinite;
}

.core-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: #fff6d9;
  text-shadow:
    0 0 10px rgba(255, 255, 255, 0.9),
    0 0 20px rgba(226, 186, 100, 0.6);
  position: relative;
  z-index: 2;
}

/* 主控点击瞬间的青色闪烁 */
.core-title-flash {
  color: #11efe3;
}

.core-sub {
  font-family: var(--font-scifi);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: var(--color-cyan-glow);
  text-shadow: 0 0 6px var(--color-cyan-glow);
  position: relative;
  z-index: 2;
  margin-top: -1px;
}

.core-indicator-bar {
  position: absolute;
  bottom: 7px;
  width: 7px;
  height: 3px;
  background: #ffd700;
  border-radius: 1px;
  box-shadow: 0 0 8px #ffd700;
}

/* 响应式适配 */
@media (max-width: 960px) {
  .tier-wing {
    display: none;
  }
  .track-rail-container {
    display: none;
  }
  .tier-mid {
    padding: 0 8px;
    gap: 6px;
  }
  .btn-tactical {
    padding: 0 12px;
  }
  .btn-cn {
    font-size: 12px;
  }
  .hud-header {
    padding: 16px 16px 0 16px;
    font-size: 9px;
  }
}
/* 大屏装配适配：作为底部栏贴底，并支持整体等比放缩 */
.foot-page {
  /* ================= ★ 自定义放缩参数 ★ =================
     只改这一个值，即可整体放大 / 缩小整个 foot 组件：
       1    = 原始大小
       1.2  = 整体放大 20%（默认）
       <1   = 整体缩小（例如 0.8）
     说明：
       - 底栏实际占用高度 = 240px × 该值（默认 1.2 → 288px）
       - 因为是等比放缩，内部星轨、罗盘、导轨、按钮的位置关系不会错乱
       - 底栏变高会挤压左右侧栏的可分配高度；若侧栏内容被挤，
         把该值调小即可（例如 1.05 或 1）。
     ==================================================== */
  --foot-scale: 1.4;

  min-height: 0;
  height: 180px; /* 基准高度，实际占位 = 240px × --foot-scale */
  overflow: hidden;
  background: transparent;

  /* 用 zoom 做整体放缩（而非 transform: scale）：
     zoom 会同步缩放布局尺寸，不会产生横向溢出，也不会与侧栏组件重叠 */
  zoom: var(--foot-scale);
}

/* ================= 鼠标位置读数（工具：显示鼠标位置） =================
   指针本体是系统级图片光标（全局样式里的 --hud-cursor-skin），
   这里只负责右下角那块读数面板 —— 它不跟随指针，所以不需要任何"跟手"性能。 */
.hud-cursor-panel {
  position: fixed;
  right: 16px;
  bottom: 14px;
  z-index: 9000;
  min-width: 196px;
  padding: 8px 12px 9px;
  pointer-events: none;
  font-family: 'Rajdhani', 'Noto Sans SC', sans-serif;
  color: #e2f1ff;
  background: linear-gradient(
    180deg,
    rgba(9, 26, 50, 0.92),
    rgba(5, 11, 20, 0.95)
  );
  border: 1px solid rgba(226, 186, 100, 0.45);
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.55),
    inset 0 0 16px rgba(11, 30, 56, 0.6);
  clip-path: polygon(
    10px 0,
    100% 0,
    100% calc(100% - 10px),
    calc(100% - 10px) 100%,
    0 100%,
    0 10px
  );
}

.hcp-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding-bottom: 5px;
  border-bottom: 1px solid rgba(226, 186, 100, 0.28);
  font-size: 11px;
  letter-spacing: 0.18em;
  color: #fce38a;
}

/* 全屏模式下退出按钮正落在右下角，读数面板抬到它上方，避免叠在一起 */
.hud-cursor-panel.is-immersive {
  bottom: 62px;
}

.hcp-mark {
  width: 6px;
  height: 6px;
  border: 1px solid #11efe3;
  transform: rotate(45deg);
  box-shadow: 0 0 6px rgba(17, 239, 227, 0.8);
}

.hcp-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  letter-spacing: 0.08em;
}

.hcp-row + .hcp-row {
  margin-top: 3px;
}

.hcp-k {
  flex: none;
  width: 48px;
  font-size: 10px;
  letter-spacing: 0.16em;
  color: #88a2be;
}

.hcp-row b {
  color: #fce38a;
  font-weight: 600;
}

.hcp-row.is-geo b {
  color: #11efe3;
}

.hcp-row .is-empty {
  color: #88a2be;
  font-weight: 400;
}

/* ---- 鼠标隐藏时的浮窗提示 ---- */
.hud-cursor-hint {
  position: fixed;
  left: 50%;
  bottom: 12%;
  transform: translateX(-50%);
  z-index: 9001;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  cursor: pointer;
  color: #e2f1ff;
  font-size: 13px;
  letter-spacing: 0.06em;
  background: linear-gradient(
    180deg,
    rgba(9, 26, 50, 0.96),
    rgba(5, 11, 20, 0.98)
  );
  border: 1px solid rgba(226, 186, 100, 0.55);
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.65),
    inset 0 0 18px rgba(11, 30, 56, 0.6);
  clip-path: polygon(
    12px 0,
    100% 0,
    100% calc(100% - 12px),
    calc(100% - 12px) 100%,
    0 100%,
    0 12px
  );
}

/* 呼吸光晕放在伪元素上：Vue 的 <Transition> 会按元素自身的 animation 时长
   决定何时移除节点，根元素上挂 infinite 动画会把离场拖到 2.6s。
   伪元素不参与那次计算，视觉照旧。 */
.hud-cursor-hint::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  animation: hch-breathe 2.6s ease-in-out infinite;
}

.hch-icon {
  width: 18px;
  height: 18px;
  color: #e2ba64;
}

.hch-key {
  padding: 2px 8px;
  font-family: 'Rajdhani', sans-serif;
  font-size: 12px;
  letter-spacing: 0.12em;
  color: #03070e;
  background: linear-gradient(180deg, #fce38a, #e2ba64);
  border-radius: 2px;
  box-shadow: 0 0 12px rgba(252, 227, 138, 0.6);
  animation: hch-blink 1.4s steps(2, end) infinite;
}

@keyframes hch-breathe {
  0%,
  100% {
    box-shadow: inset 0 0 18px rgba(11, 30, 56, 0.6);
  }
  50% {
    box-shadow: inset 0 0 26px rgba(17, 239, 227, 0.35);
  }
}

@keyframes hch-blink {
  50% {
    opacity: 0.55;
  }
}

/* 提示浮窗自己的出入场：必须带上 translateX(-50%)，
   否则会和居中定位打架（元素往右跳半个身位）。 */
.hint-pop-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.24s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.hint-pop-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}

.hint-pop-enter-from,
.hint-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}
</style>

<style>
/* 光标表面全由 foot.vue 接管：这个类常驻 <html>，
   取值由 --hud-cursor-skin 决定 —— 准星 PNG（工具开）或 none（工具关，彻底隐藏）。
   带 !important 是为了压过 Cesium 等库给 canvas 写的行内 cursor，
   保证页面内任何位置都不会冒出系统默认光标。 */
html.hud-cursor-managed,
html.hud-cursor-managed * {
  cursor: var(--hud-cursor-skin, none) !important;
}
</style>
