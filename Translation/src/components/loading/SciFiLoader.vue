<template>
  <Transition name="boot">
    <div
      v-if="state.visible"
      class="boot"
      :class="{ 'boot--done': state.done }"
      role="status"
      aria-live="polite"
      aria-label="系统加载中"
    >
      <!-- 背景层：透视网格 / 暗角 / 扫描线 -->
      <div class="boot-grid" aria-hidden="true"></div>
      <div class="boot-vignette" aria-hidden="true"></div>
      <div class="boot-scan" aria-hidden="true"></div>

      <!-- 四角 HUD 标记 -->
      <span class="boot-corner boot-corner--tl" aria-hidden="true"></span>
      <span class="boot-corner boot-corner--tr" aria-hidden="true"></span>
      <span class="boot-corner boot-corner--bl" aria-hidden="true"></span>
      <span class="boot-corner boot-corner--br" aria-hidden="true"></span>

      <div class="boot-main">
        <!-- 徽记：双环 + 六边形核心 -->
        <div class="boot-emblem" aria-hidden="true">
          <svg class="boot-ring boot-ring--a" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="92" />
          </svg>
          <svg class="boot-ring boot-ring--b" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="78" />
          </svg>
          <svg class="boot-ring boot-ring--c" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="64" />
          </svg>

          <svg class="boot-hex" viewBox="0 0 100 112">
            <defs>
              <linearGradient id="bootHexFill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="rgba(17,239,227,0.28)" />
                <stop offset="100%" stop-color="rgba(4,18,34,0.92)" />
              </linearGradient>
            </defs>
            <polygon
              points="50,4 96,28 96,84 50,108 4,84 4,28"
              fill="url(#bootHexFill)"
              stroke="#11efe3"
              stroke-width="1.6"
            />
            <text x="50" y="70" text-anchor="middle" class="boot-hex__glyph">M</text>
          </svg>
        </div>

        <h1 class="boot-title">智慧地铁</h1>
        <p class="boot-sub">SMART METRO · OPERATION CENTER</p>

        <!-- 进度条 + 读数 -->
        <div class="boot-meter">
          <div class="boot-bar">
            <span class="boot-bar__fill" :style="{ width: state.percent + '%' }"></span>
            <span class="boot-bar__head" :style="{ left: state.percent + '%' }"></span>
            <i v-for="n in 10" :key="n" class="boot-bar__tick" :style="{ left: n * 10 + '%' }"></i>
          </div>
          <div class="boot-readout">
            <span class="boot-readout__phase">{{ state.phase }}</span>
            <span class="boot-readout__pct">{{ shown }}<i>%</i></span>
          </div>
        </div>

        <!-- 资源校验清单：三项各自独立判定，失败会明确标红 -->
        <ul class="boot-assets">
          <li
            v-for="a in state.assets"
            :key="a.key"
            :class="[`is-${a.status}`, { 'is-blocking-off': !a.blocking }]"
          >
            <i class="boot-assets__mark"></i>
            <span class="boot-assets__label">{{ a.label }}</span>
            <span class="boot-assets__detail">
              <em v-if="!a.blocking" class="boot-assets__tag">后台</em>
              {{ a.detail }}
            </span>
          </li>
        </ul>
      </div>

      <div class="boot-foot">
        <span class="boot-foot__sys">SYS.BOOT // 3D-TILES PIPELINE</span>
        <span class="boot-foot__tiles">TILES <b>{{ state.tileCount }}</b></span>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useLoadingState } from '@/stores/loadingState';

const state = useLoadingState();

/** 百分比读数做一点惯性追赶，避免数字跳变 */
const shown = ref(0);
let rafId = 0;
const tick = () => {
  const target = state.percent;
  const delta = target - shown.value;
  shown.value = Math.abs(delta) < 0.4 ? target : shown.value + delta * 0.16;
  rafId = requestAnimationFrame(tick);
};

/**
 * 看门狗：任何环节卡死都不让用户停在加载页。
 * 本地加载通常 2~5 秒，40 秒还没好说明是真出问题了，直接放行。
 */
const WATCHDOG_MS = 40000;

onMounted(() => {
  rafId = requestAnimationFrame(tick);
  window.setTimeout(() => {
    if (!state.done) state.fail('加载超时，已跳过等待');
  }, WATCHDOG_MS);
});

onBeforeUnmount(() => cancelAnimationFrame(rafId));
</script>

<style scoped>
/* ================= 容器 ================= */
.boot {
  position: fixed;
  inset: 0;
  z-index: 9900;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background:
    radial-gradient(120% 90% at 50% 42%, #071a2e 0%, #040c18 46%, #01050b 100%);
  color: #d9f6ff;
  font-family: 'Rajdhani', 'Noto Sans SC', system-ui, sans-serif;
  user-select: none;
}

/* ================= 背景 ================= */
.boot-grid {
  position: absolute;
  inset: -30% -20% -10%;
  background-image:
    linear-gradient(rgba(17, 239, 227, 0.075) 1px, transparent 1px),
    linear-gradient(90deg, rgba(17, 239, 227, 0.075) 1px, transparent 1px);
  background-size: 56px 56px;
  transform: perspective(680px) rotateX(64deg) translateY(22%);
  transform-origin: 50% 100%;
  -webkit-mask-image: linear-gradient(to top, #000 4%, transparent 68%);
  mask-image: linear-gradient(to top, #000 4%, transparent 68%);
  animation: boot-grid-drift 14s linear infinite;
}

@keyframes boot-grid-drift {
  to {
    background-position:
      0 56px,
      56px 0;
  }
}

.boot-vignette {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(80% 60% at 50% 50%, transparent 40%, rgba(0, 0, 0, 0.72) 100%);
  pointer-events: none;
}

.boot-scan {
  position: absolute;
  left: 0;
  right: 0;
  height: 220px;
  top: -220px;
  background: linear-gradient(
    to bottom,
    transparent,
    rgba(17, 239, 227, 0.055),
    transparent
  );
  animation: boot-scan 5.2s linear infinite;
  pointer-events: none;
}

@keyframes boot-scan {
  to {
    transform: translateY(calc(100vh + 220px));
  }
}

/* ================= 四角 ================= */
.boot-corner {
  position: absolute;
  width: 46px;
  height: 46px;
  border: 1px solid rgba(17, 239, 227, 0.42);
  pointer-events: none;
}

.boot-corner--tl {
  top: 26px;
  left: 26px;
  border-right: 0;
  border-bottom: 0;
}
.boot-corner--tr {
  top: 26px;
  right: 26px;
  border-left: 0;
  border-bottom: 0;
}
.boot-corner--bl {
  bottom: 26px;
  left: 26px;
  border-right: 0;
  border-top: 0;
}
.boot-corner--br {
  bottom: 26px;
  right: 26px;
  border-left: 0;
  border-top: 0;
}

/* ================= 主体 ================= */
.boot-main {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 24px;
  text-align: center;
}

/* ---- 徽记 ---- */
.boot-emblem {
  position: relative;
  width: 186px;
  height: 186px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 26px;
}

.boot-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  fill: none;
  stroke: rgba(17, 239, 227, 0.55);
  stroke-width: 1;
}

.boot-ring--a {
  stroke-dasharray: 4 12;
  animation: boot-spin 22s linear infinite;
}

.boot-ring--b {
  stroke-dasharray: 118 300;
  stroke-width: 2;
  stroke: rgba(226, 186, 100, 0.75);
  filter: drop-shadow(0 0 6px rgba(226, 186, 100, 0.45));
  animation: boot-spin 7s linear infinite reverse;
}

.boot-ring--c {
  stroke-dasharray: 2 8;
  stroke: rgba(17, 239, 227, 0.35);
  animation: boot-spin 14s linear infinite reverse;
}

@keyframes boot-spin {
  to {
    transform: rotate(360deg);
  }
}

.boot-hex {
  width: 74px;
  height: 83px;
  animation: boot-breathe 2.8s ease-in-out infinite;
  filter: drop-shadow(0 0 14px rgba(17, 239, 227, 0.5));
}

.boot-hex__glyph {
  font-family: 'Rajdhani', sans-serif;
  font-size: 34px;
  font-weight: 700;
  fill: #d9f6ff;
  letter-spacing: 1px;
}

@keyframes boot-breathe {
  0%,
  100% {
    opacity: 0.9;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.045);
  }
}

/* ---- 文字 ---- */
.boot-title {
  margin: 0;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 0.36em;
  text-indent: 0.36em;
  background: linear-gradient(180deg, #ffffff 0%, #8fe9ff 58%, #11efe3 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 18px rgba(17, 239, 227, 0.35));
}

.boot-sub {
  margin: 10px 0 30px;
  font-size: 11px;
  letter-spacing: 0.34em;
  text-indent: 0.34em;
  color: rgba(143, 233, 255, 0.55);
}

/* ---- 进度 ---- */
.boot-meter {
  width: min(560px, 74vw);
}

.boot-bar {
  position: relative;
  height: 4px;
  background: rgba(17, 239, 227, 0.12);
  overflow: visible;
}

.boot-bar__fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: linear-gradient(90deg, rgba(17, 239, 227, 0.25), #11efe3 70%, #d9f6ff);
  box-shadow: 0 0 14px rgba(17, 239, 227, 0.75);
  transition: width 0.45s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.boot-bar__fill::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.65), transparent);
  animation: boot-sheen 1.8s linear infinite;
}

@keyframes boot-sheen {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(100%);
  }
}

.boot-bar__head {
  position: absolute;
  top: 50%;
  width: 9px;
  height: 9px;
  margin-left: -4.5px;
  transform: translateY(-50%) rotate(45deg);
  background: #eafcff;
  box-shadow: 0 0 12px rgba(17, 239, 227, 0.95);
  transition: left 0.45s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.boot-bar__tick {
  position: absolute;
  top: -5px;
  width: 1px;
  height: 4px;
  background: rgba(17, 239, 227, 0.28);
}

.boot-readout {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: 12px;
  font-size: 12px;
  letter-spacing: 0.16em;
  color: rgba(143, 233, 255, 0.72);
}

.boot-readout__phase {
  min-height: 1em;
}

.boot-readout__pct {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #eafcff;
  text-shadow: 0 0 14px rgba(17, 239, 227, 0.6);
}

.boot-readout__pct i {
  font-style: normal;
  font-size: 11px;
  margin-left: 2px;
  color: rgba(143, 233, 255, 0.6);
}

/* ---- 资源校验清单 ---- */
.boot-assets {
  display: flex;
  flex-direction: column;
  gap: 9px;
  width: min(560px, 74vw);
  margin: 28px 0 0;
  padding: 14px 18px;
  list-style: none;
  font-size: 12px;
  letter-spacing: 0.08em;
  border: 1px solid rgba(17, 239, 227, 0.12);
  background: linear-gradient(180deg, rgba(8, 24, 42, 0.55), rgba(4, 12, 22, 0.35));
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
  transition: border-color 0.4s ease;
}

.boot-assets li {
  display: grid;
  grid-template-columns: 14px 1fr auto;
  align-items: center;
  gap: 10px;
  color: rgba(143, 233, 255, 0.38);
  transition: color 0.35s ease;
}

/* 状态标记：小方点，按状态变色 */
.boot-assets__mark {
  position: relative;
  width: 8px;
  height: 8px;
  border: 1px solid currentColor;
  transform: rotate(45deg);
  transition: all 0.35s ease;
}

.boot-assets__label {
  text-align: left;
}

.boot-assets__detail {
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  opacity: 0.8;
  white-space: nowrap;
}

/* 「后台」标签：不参与闸门的资源（城市模型 / 外滩） */
.boot-assets__tag {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 5px;
  font-style: normal;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: rgba(226, 186, 100, 0.85);
  border: 1px solid rgba(226, 186, 100, 0.35);
  vertical-align: 1px;
}

/* 非阻塞项整体压暗一点，和"必须等"的三项区分开 */
.boot-assets li.is-blocking-off .boot-assets__label {
  opacity: 0.7;
}

/* 加载中 */
.boot-assets li.is-loading {
  color: rgba(143, 233, 255, 0.92);
}

.boot-assets li.is-loading .boot-assets__mark {
  background: rgba(17, 239, 227, 0.25);
  animation: boot-assets-pulse 1.3s ease-in-out infinite;
}

@keyframes boot-assets-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 rgba(17, 239, 227, 0);
  }
  50% {
    box-shadow: 0 0 10px rgba(17, 239, 227, 0.85);
  }
}

/* 成功 */
.boot-assets li.is-ok {
  color: rgba(17, 239, 227, 0.95);
}

.boot-assets li.is-ok .boot-assets__mark {
  background: #11efe3;
  border-color: #11efe3;
  box-shadow: 0 0 9px rgba(17, 239, 227, 0.85);
}

/* 失败 */
.boot-assets li.is-fail {
  color: #ff7a7a;
}

.boot-assets li.is-fail .boot-assets__mark {
  background: #ff5a5a;
  border-color: #ff5a5a;
  box-shadow: 0 0 9px rgba(255, 90, 90, 0.8);
}

/* ---- 底部 ---- */
.boot-foot {
  position: absolute;
  left: 40px;
  right: 40px;
  bottom: 34px;
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  letter-spacing: 0.22em;
  color: rgba(143, 233, 255, 0.32);
}

.boot-foot__tiles b {
  color: rgba(17, 239, 227, 0.8);
  font-variant-numeric: tabular-nums;
}

/* ================= 完成态 ================= */
.boot--done .boot-bar__fill {
  background: linear-gradient(90deg, #11efe3, #eafcff);
}

.boot--done .boot-emblems,
.boot--done .boot-emblem {
  filter: drop-shadow(0 0 26px rgba(17, 239, 227, 0.8));
}

/* ================= 退场 ================= */
.boot-leave-active {
  transition:
    opacity 0.85s ease,
    transform 0.85s cubic-bezier(0.4, 0, 0.2, 1),
    filter 0.85s ease;
}

.boot-leave-to {
  opacity: 0;
  transform: scale(1.035);
  filter: blur(6px);
}
</style>
