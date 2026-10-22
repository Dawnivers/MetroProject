<script setup>
/**
 * 列车气泡模板 —— 走 popup.js 的「模板路由表」机制（popupRoutes.carPopup）。
 *
 * 三件必须配合的事，写在这里免得下次踩：
 *   1. 摆位由 SimpleLabel.postRender 直接写 `el.style.left / bottom`，
 *      换算基准是**元素的下边缘中点**贴着目标点（见 popup.js:231-261）。
 *      所以根节点要给一个「从下往上长」的布局，指针落在最底部。
 *   2. 这个组件挂在 `viewer.cesiumWidget.container` 里，**不在 .hud-canvas 的缩放层**，
 *      所以这里的 px 是屏幕 px，不是设计 px。
 *   3. 实例化时传 needOptimize:false（不按距离剔除）、managedByManager:false
 *      （自己挂 postRender 才能跟着列车每帧移动）、pointer-events 关掉（不吃画布拖拽）。
 *
 * attr 需要传入一个 **reactive 对象**，否则到站时改人数不会触发重渲染。
 */
defineProps({
  label: { type: String, default: '' },
  color: { type: String, default: '#e2ba64' },
  attr: { type: Object, default: () => ({}) },
});
</script>

<template>
  <div class="car-popup" :style="{ '--c': color }">
    <div class="car-card">
      <div class="car-head">
        <span class="car-line">{{ attr.lineName || '地铁' }}</span>
        <span class="car-dir">⇄</span>
        <span class="car-speed">
          {{ attr.speed ?? '—' }}<i>km/h</i>
        </span>
      </div>

      <div class="car-body">
        <div class="car-row">
          <span class="car-key">车内人数</span>
          <b class="car-value">
            {{ attr.currentPassengers ?? '—' }}<i>人</i>
          </b>
        </div>
        <div class="car-row">
          <span class="car-key">下一站</span>
          <b class="car-value car-next">{{ attr.nextStation || '终点站' }}</b>
        </div>
      </div>
    </div>

    <div class="car-pin"></div>
  </div>
</template>

<style scoped>
.car-popup {
  position: absolute;
  width: 210px;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* 气泡不吃画布拖拽：它是纯展示，压住鼠标会让拖动场景变得很别扭 */
  pointer-events: none;
  font-family: 'Noto Sans SC', sans-serif;
}

.car-card {
  width: 100%;
  padding: 6px 10px 8px;
  background: linear-gradient(
    180deg,
    rgba(9, 26, 50, 0.94),
    rgba(5, 11, 20, 0.96)
  );
  border: 1px solid var(--c);
  border-radius: 4px 4px 4px 4px;
  box-shadow:
    0 8px 22px rgba(0, 0, 0, 0.65),
    inset 0 0 18px rgba(17, 239, 227, 0.12);
}

.car-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(226, 186, 100, 0.28);
}

.car-line {
  font-family: 'Rajdhani', 'Noto Sans SC', sans-serif;
  font-size: 14px;
  letter-spacing: 0.08em;
  color: var(--c);
  white-space: nowrap;
}

.car-dir {
  font-size: 13px;
  color: #11efe3;
}

.car-speed {
  margin-left: auto;
  font-family: 'Rajdhani', sans-serif;
  font-size: 12px;
  color: #88a2be;
}

.car-speed i {
  font-style: normal;
  font-size: 10px;
  margin-left: 2px;
}

.car-body {
  padding-top: 5px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.car-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.car-key {
  font-size: 12px;
  color: #88a2be;
  white-space: nowrap;
}

.car-value {
  font-family: 'Rajdhani', 'Noto Sans SC', sans-serif;
  font-size: 16px;
  color: #11efe3;
  text-shadow: 0 0 8px rgba(17, 239, 227, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.car-value i {
  font-style: normal;
  font-size: 11px;
  margin-left: 2px;
  color: #88a2be;
}

.car-next {
  font-size: 14px;
  color: #fce38a;
  text-shadow: 0 0 8px rgba(252, 227, 138, 0.45);
}

/* 底部指针：根节点下边缘中点正好是列车位置，指针尖端落在这里 */
.car-pin {
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 7px solid var(--c);
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.6));
}
</style>
