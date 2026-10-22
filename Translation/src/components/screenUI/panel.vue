<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import Head from './head.vue';
import Foot from './foot.vue';
import Left1 from './left1.vue';
import Left2 from './left2.vue';
import Left3 from './left3.vue';
import Right1 from './right1.vue';
import Right2 from './right2.vue';
import Right3 from './right3.vue';
import { useStationState } from '@/stores/stationState';

/**
 * 进入「站点管理」(/nodes) 时收起左右两组侧栏，把屏幕让给站点控制栏。
 * head 与 foot 保留 —— 底部导航条在，NODES 按钮本身就能再点一次退出。
 *
 * 用 v-show 而不是 v-if：三块侧栏各自挂着定时器与逐帧写 DOM 的逻辑，
 * 卸载再重建会白白重启一遍，而且它们的状态（比如 left1 的线路列表）也会丢。
 */
const { stationPanelOpen } = useStationState();

/* 大屏设计分辨率：HUD 内部所有 px 尺寸（字号 / 间距 / 行高）都按这块画布取值 */
const DESIGN_W = 1920;
const DESIGN_H = 1080;

/* 画布 → 视口的整体放缩比例。
   用 transform: scale 缩放整块画布（而非逐个组件写弹性尺寸），
   好处是内部任何写死的 px 都会跟着等比缩小，
   浏览器 Ctrl +/- 或窗口变化时，组件内容始终完整落在视口内。 */
const scaleX = ref(1);
const scaleY = ref(1);

const updateScale = () => {
  scaleX.value = window.innerWidth / DESIGN_W;
  scaleY.value = window.innerHeight / DESIGN_H;
};

onMounted(() => {
  updateScale();
  window.addEventListener('resize', updateScale);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateScale);
});
</script>

<template>
  <!-- 设计画布容器：铺满视口，只负责裁掉溢出部分 -->
  <div class="hud-stage">
    <!-- 固定 1920×1080 的画布，整体缩放到视口大小 -->
    <div
      class="hud-canvas"
      :style="{
        transform: `translate(-50%, -50%) scale(${scaleX}, ${scaleY})`,
      }"
    >
      <!-- HUD 覆盖层：三行两列栅格，中间透明透出三维，层级高于三维场景 -->
      <div class="hud-layer">
        <Head class="hud-top" />

        <!-- 左右侧栏：站点管理模式下整体收起（head / foot 保留） -->
        <div v-show="!stationPanelOpen" class="side-column side-left">
          <Left1 />
          <Left2 />
          <Left3 />
        </div>

        <div v-show="!stationPanelOpen" class="side-column side-right">
          <Right1 />
          <Right2 />
          <Right3 />
        </div>

        <Foot class="hud-bottom" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 画布外框：不拦截鼠标，交互仍交给下层三维场景 */
.hud-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

/* 1920×1080 设计画布，以视口中心为基准整体放缩 */
.hud-canvas {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 1920px;
  height: 1080px;
  transform-origin: center center;
  pointer-events: none;
}

/* 覆盖层整体高于三维场景，铺满整块设计画布 */
.hud-layer {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: grid;
  grid-template-rows: 96px 1fr auto;
  grid-template-columns: 22% 1fr 22%;
  grid-template-areas:
    'top    top    top'
    'left   center right'
    'bottom bottom bottom';
  /* 中间空白格子不拦截鼠标事件，把交互让给三维 */
  pointer-events: none;
}

.hud-top {
  grid-area: top;
  pointer-events: auto;
}

.hud-bottom {
  grid-area: bottom;
  pointer-events: auto;
}

.side-left {
  grid-area: left;
}

.side-right {
  grid-area: right;
}

.side-column {
  min-height: 0;
  display: grid;
  /* minmax(0,1fr)：强制三等分，避免某块内容高就把该格撑大、把相邻格挤成 0 */
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 8px 12px;
  pointer-events: auto;
}
</style>