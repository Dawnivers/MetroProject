<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  /** 线路图插槽图片地址 */
  src: {
    type: String,
    default: 'src/assets/地铁图.png',
  },
  /** 最小缩放比例 */
  minScale: { type: Number, default: 1.75 },
  /** 最大缩放比例 */
  maxScale: { type: Number, default: 4.0 },
});

// 视口状态
const scale = ref(props.minScale);
const translateX = ref(0);
const translateY = ref(0);

// 最大缩放需始终大于最小缩放（对应原 updateScaleConstraints 的兜底校验）
const effectiveMaxScale = computed(() =>
  Math.max(props.maxScale, props.minScale + 0.5),
);

// 舞台变换与插槽图片
const stageStyle = computed(() => ({
  transform: `translate3d(${translateX.value}px, ${translateY.value}px, 0) scale(${scale.value})`,
}));

const currentSrc = ref(props.src);

// 缩放极值提示条
const limitText = ref('已达到缩放极值');
const limitVisible = ref(false);
let tooltipTimer = null;

const showLimitTooltip = (text) => {
  limitText.value = text;
  limitVisible.value = true;
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(() => {
    limitVisible.value = false;
  }, 1500);
};

/* ---------------- 鼠标拖拽平移 (Pan) ---------------- */
const viewportEl = ref(null);
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let initialTranslateX = 0;
let initialTranslateY = 0;

const onMouseDown = (event) => {
  // 避免点击输入控件时触发拖动
  if (event.target.closest('input')) return;
  isDragging = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  initialTranslateX = translateX.value;
  initialTranslateY = translateY.value;
};

const onWindowMouseMove = (event) => {
  if (!isDragging) return;
  translateX.value = initialTranslateX + (event.clientX - dragStartX);
  translateY.value = initialTranslateY + (event.clientY - dragStartY);
};

const onWindowMouseUp = () => {
  isDragging = false;
};

/* ---------------- 滚轮以光标为中心缩放 (Zoom) ---------------- */
const onWheel = (event) => {
  const rect = viewportEl.value.getBoundingClientRect();
  const cursorX = event.clientX - rect.left - rect.width / 2;
  const cursorY = event.clientY - rect.top - rect.height / 2;

  const zoomFactor = event.deltaY < 0 ? 1.15 : 0.87;
  let targetScale = scale.value * zoomFactor;

  if (targetScale > effectiveMaxScale.value) {
    if (scale.value !== effectiveMaxScale.value) {
      showLimitTooltip(
        `已达到设定的最大缩放比例 (${effectiveMaxScale.value}x)`,
      );
    }
    targetScale = effectiveMaxScale.value;
  } else if (targetScale < props.minScale) {
    if (scale.value !== props.minScale) {
      showLimitTooltip(`已达到设定的最小缩放比例 (${props.minScale}x)`);
    }
    targetScale = props.minScale;
  }

  if (targetScale === scale.value) return;

  // 以光标为锚点平移补偿计算
  const scaleRatio = targetScale / scale.value;
  translateX.value = cursorX - (cursorX - translateX.value) * scaleRatio;
  translateY.value = cursorY - (cursorY - translateY.value) * scaleRatio;
  scale.value = targetScale;
};

/* ---------------- 复位 / 插槽 API ---------------- */
const resetToCenter = () => {
  scale.value = props.minScale;
  translateX.value = 0;
  translateY.value = 0;
};

const setImage = (url) => {
  currentSrc.value = url;
  resetToCenter();
};

const fileInputEl = ref(null);

const openFilePicker = () => {
  fileInputEl.value?.click();
};

const onFileChange = (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (loadEvent) => {
    setImage(loadEvent.target.result);
  };
  reader.readAsDataURL(file);
};

// props 变更时同步
watch(
  () => props.src,
  (value) => {
    currentSrc.value = value;
    resetToCenter();
  },
);

watch([() => props.minScale, () => props.maxScale], () => {
  if (scale.value < props.minScale) scale.value = props.minScale;
  else if (scale.value > effectiveMaxScale.value)
    scale.value = effectiveMaxScale.value;
});

onMounted(() => {
  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);
});

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onWindowMouseMove);
  window.removeEventListener('mouseup', onWindowMouseUp);
  clearTimeout(tooltipTimer);
});

defineExpose({ setImage, resetView: resetToCenter, openFilePicker });
</script>

<template>
  <div class="right1-page">
    <!-- 主组件容器 -->
    <div class="overview-widget">
      <!-- 四角工控瞄准角 -->
      <div class="corner-bracket corner-tl"></div>
      <div class="corner-bracket corner-tr"></div>
      <div class="corner-bracket corner-bl"></div>
      <div class="corner-bracket corner-br"></div>

      <!-- 顶部标题栏 -->
      <header class="widget-header">
        <div class="header-left">
          <h1 class="widget-title">线路概览</h1>
          <div class="dot-matrix" title="系统联机正常">
            <div v-for="n in 14" :key="n" class="dot"></div>
          </div>
        </div>
        <div class="header-controls">
          <input
            ref="fileInputEl"
            accept="image/*"
            class="slot-file-input"
            type="file"
            @change="onFileChange"
          />
        </div>
      </header>

      <!-- 线路图插槽视口 (支持拖动与缩放) -->
      <main
        ref="viewportEl"
        class="slot-viewport-container"
        @mousedown="onMouseDown"
        @wheel.prevent="onWheel"
      >
        <!-- 极值告警提示条 -->
        <div class="limit-tooltip" :class="{ show: limitVisible }">
          {{ limitText }}
        </div>

        <!-- 快捷预设区域跳转 -->
        <nav class="preset-nav"></nav>

        <!-- 装饰用网格层与中心十字准星 -->
        <div class="grid-overlay"></div>
        <div class="center-reticle"></div>

        <!-- 拖拽与缩放的舞台层 (Stage) -->
        <div ref="dragStageEl" class="drag-stage" :style="stageStyle">
          <!-- 插槽图片：默认填满插槽，可传入更换 -->
          <img
            alt="城市地铁综合线网拓扑图"
            class="slot-line-image"
            draggable="false"
            :src="currentSrc"
          />
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
/* 纯原生工业级 OCC 调度大屏通用样式 */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  user-select: none;
}

.right1-page {
  background-color: #070d19;
  background-image:
    radial-gradient(
      circle at 50% 30%,
      rgba(13, 38, 77, 0.45) 0%,
      transparent 70%
    ),
    linear-gradient(rgba(0, 229, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 229, 255, 0.03) 1px, transparent 1px);
  background-size:
    100% 100%,
    32px 32px,
    32px 32px;
  color: #cfd9e8;
  font-family:
    'Noto Sans SC',
    -apple-system,
    sans-serif;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  overflow: hidden;
}

/* 主组件卡片容器 */
.overview-widget {
  width: 100%;
  height: 100%;
  background: transparent;
  border: 1px solid rgba(0, 229, 255, 0.22);
  border-radius: 4px;
  position: relative;
  display: flex;
  flex-direction: column;
  box-shadow: inset 0 0 25px rgba(0, 229, 255, 0.05);
  overflow: hidden;
}

/* 科技感非均匀薄厚微光描线 */
.overview-widget::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(0, 229, 255, 0.8) 15%,
    #00e5ff 35%,
    rgba(255, 179, 0, 0.7) 65%,
    transparent 100%
  );
  pointer-events: none;
  z-index: 20;
}

/* 四角工控瞄准切角 */
.corner-bracket {
  position: absolute;
  width: 10px;
  height: 10px;
  border-color: #00e5ff;
  border-style: solid;
  pointer-events: none;
  z-index: 20;
}

.corner-tl {
  top: 3px;
  left: 3px;
  border-width: 2px 0 0 2px;
}

.corner-tr {
  top: 3px;
  right: 3px;
  border-width: 2px 2px 0 0;
}

.corner-bl {
  bottom: 3px;
  left: 3px;
  border-width: 0 0 2px 2px;
}

.corner-br {
  bottom: 3px;
  right: 3px;
  border-width: 0 2px 2px 0;
}

/* ================= 顶部标题与控制台 Header ================= */
.widget-header {
  height: 60px;
  padding: 0 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(0, 229, 255, 0.15);
  background: transparent;
  position: relative;
  z-index: 15;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.widget-title {
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 2px;
  background: linear-gradient(180deg, #ffffff 10%, #ffd066 85%, #ffb300 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 2px 10px rgba(255, 179, 0, 0.3);
}

/* 点阵装饰 */
.dot-matrix {
  display: grid;
  grid-template-columns: repeat(7, 3px);
  gap: 3px;
  margin-left: 4px;
  opacity: 0.6;
}

.dot {
  width: 3px;
  height: 3px;
  background-color: #00e5ff;
  border-radius: 50%;
}

/* 顶部右侧参数设置栏 */
.header-controls {
  display: flex;
  align-items: center;
  gap: 16px;
}

.param-group {
  display: flex;
  align-items: center;
  background: transparent;
  border: 1px solid rgba(0, 229, 255, 0.22);
  border-radius: 3px;
  padding: 3px 8px;
  gap: 8px;
  font-size: 12px;
}

.param-label {
  color: #6d93b8;
  font-family: 'JetBrains Mono', monospace;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.5px;
}

.param-input-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}

.param-input {
  width: 48px;
  background: rgba(0, 229, 255, 0.08);
  border: 1px solid rgba(0, 229, 255, 0.35);
  border-radius: 2px;
  color: #00e5ff;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  padding: 2px 0;
  outline: none;
  transition: all 0.2s;
}

.param-input:focus {
  border-color: #ffb300;
  box-shadow: 0 0 8px rgba(255, 179, 0, 0.4);
  color: #ffb300;
}

.param-unit {
  color: #4a759c;
  font-size: 11px;
}

/* 插槽管理按钮与指示灯 */
.slot-badge-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(0, 229, 255, 0.1);
  border: 1px solid rgba(0, 229, 255, 0.4);
  color: #00e5ff;
  padding: 4px 10px;
  border-radius: 3px;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  cursor: pointer;
  transition: all 0.2s;
}

.slot-badge-btn:hover {
  background: rgba(0, 229, 255, 0.25);
  border-color: #00e5ff;
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.35);
  color: #ffffff;
}

.live-dot {
  width: 6px;
  height: 6px;
  background-color: #00e5ff;
  border-radius: 50%;
  box-shadow: 0 0 8px #00e5ff;
  animation: pulseDot 2s infinite ease-in-out;
}

@keyframes pulseDot {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.8);
  }
}

/* ================= 线路图插槽视口 (Slot Viewport) ================= */
.slot-viewport-container {
  position: relative;
  flex: 1;
  width: 100%;
  background: transparent;
  overflow: hidden;
  cursor: grab;
}

.slot-viewport-container:active {
  cursor: grabbing;
}

/* 内部拖动舞台 (Stage) */
.drag-stage {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  transform-origin: center center;
  will-change: transform;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 插槽中注入的线路图图片 (占满插槽，并可受控平移缩放) */
.slot-line-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  pointer-events: none; /* 防止浏览器默认的图片拖拽鬼影 */
  transition: filter 0.3s;
}

/* 视口网格雷达刻度背景层 (纯装饰增加专业质感) */
.grid-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(0, 229, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 229, 255, 0.05) 1px, transparent 1px);
  background-size:
    80px 80px,
    80px 80px;
  z-index: 5;
}

/* 中心校准十字线 (轻微透明) */
.center-reticle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 32px;
  height: 32px;
  pointer-events: none;
  z-index: 6;
  opacity: 0.25;
}

.center-reticle::before,
.center-reticle::after {
  content: '';
  position: absolute;
  background: #00e5ff;
}

.center-reticle::before {
  top: 0;
  left: 15px;
  width: 2px;
  height: 32px;
}

.center-reticle::after {
  top: 15px;
  left: 0;
  width: 32px;
  height: 2px;
}

/* ================= 浮动快捷操作栏 & 工控浮标 ================= */
/* 左下角状态反馈仪 */
.status-hud {
  position: absolute;
  bottom: 14px;
  left: 16px;
  background: transparent;
  border: 1px solid rgba(0, 229, 255, 0.25);
  border-radius: 3px;
  padding: 6px 14px;
  display: flex;
  align-items: center;
  gap: 16px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #799ab8;
  z-index: 10;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4);
}

.hud-val {
  color: #00e5ff;
  font-weight: 600;
}

.hud-val.alert {
  color: #ffb300;
}

/* 右下角缩放控制器浮标 */
.zoom-toolbar {
  position: absolute;
  bottom: 14px;
  right: 16px;
  background: transparent;
  border: 1px solid rgba(0, 229, 255, 0.25);
  border-radius: 4px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 10;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4);
}

.tool-btn {
  width: 32px;
  height: 32px;
  background: rgba(0, 229, 255, 0.08);
  border: 1px solid rgba(0, 229, 255, 0.2);
  border-radius: 3px;
  color: #00e5ff;
  font-family: 'JetBrains Mono', monospace;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.tool-btn:hover {
  background: rgba(0, 229, 255, 0.25);
  border-color: #00e5ff;
  color: #ffffff;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.4);
}

.tool-btn:active {
  transform: scale(0.92);
}

/* 缩放比例滑杆条 (悬浮在右侧) */
.slider-track-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 0;
}

.zoom-slider {
  writing-mode: bt-lr; /* IE/Edge */
  -webkit-appearance: slider-vertical; /* WebKit */
  width: 14px;
  height: 90px;
  cursor: pointer;
  accent-color: #00e5ff;
}

/* 隐藏的原生文件上传 (支持随时替换插槽图片) */
.slot-file-input {
  display: none;
}

/* 快捷预设区域标签 */
.preset-nav {
  position: absolute;
  top: 14px;
  left: 16px;
  display: flex;
  gap: 8px;
  z-index: 10;
}

.preset-chip {
  background: transparent;
  border: 1px solid rgba(0, 229, 255, 0.2);
  border-radius: 2px;
  color: #8da9c4;
  font-size: 11px;
  padding: 3px 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.preset-chip:hover {
  border-color: #00e5ff;
  color: #00e5ff;
  background: rgba(0, 229, 255, 0.12);
}

/* 缩放极限状态提示气泡 */
.limit-tooltip {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%) translateY(-10px);
  background: rgba(255, 179, 0, 0.9);
  color: #040914;
  font-size: 11px;
  font-weight: 700;
  padding: 4px 12px;
  border-radius: 3px;
  opacity: 0;
  pointer-events: none;
  transition: all 0.25s ease;
  z-index: 30;
  box-shadow: 0 4px 12px rgba(255, 179, 0, 0.4);
}

.limit-tooltip.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
/* 大屏装配适配：填满侧栏单元格，不再撑满整屏 */
.right1-page {
  position: relative;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: transparent;
}
</style>
