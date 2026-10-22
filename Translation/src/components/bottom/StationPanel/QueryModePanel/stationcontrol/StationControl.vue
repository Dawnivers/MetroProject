<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { useStationState } from '@/stores/stationState';
import { hideStationByName } from '@/cesiumTools/lineAndpoints/points/setpoints';
import { useStationSnapshot } from '../useStationSnapshot';
import { MEASURE_META, STATION_MEASURES } from './stationMeasures';
import { disableMeasures, enableMeasures } from './measureStore';
import MeasureIcon from './MeasureIcon.vue';

/**
 * 「站控措施」这个查询模式的组件（模式的生命周期边界）。
 *
 * 和另外两个模式不同的地方：**它不自己造气泡**。措施是画在站点自己的气泡里的
 * （MarkerTemplate 里那一排小方框），所以：
 *   · 站点隐藏 → 气泡不显示 → 措施自然跟着消失，不需要任何联动代码；
 *   · 这里只负责「把数据灌进去 + 进入时点亮有措施的站 + 退出时还原」。
 *
 * 数据是**静态的**（stationMeasures.js），不再随机、也没有「重新模拟」按钮。
 * 进入模式**不动相机**：全局视角 flyTo 过去会有一瞬跳变，观感很差，
 * 需要看细节时用户自己滚轮/拖动即可（气泡本身按距离剔除，不会糊屏）。
 */
const { stationObjs } = useStationState();
const { hideAll, restore } = useStationSnapshot();

/** 有措施的站名（点亮范围） */
const names = Object.keys(STATION_MEASURES);

/** 图例：每类措施覆盖多少个站，按数量倒序 */
const legend = computed(() => {
  const counts = new Map();
  Object.values(STATION_MEASURES).forEach((codes) => {
    codes.forEach((code) => counts.set(code, (counts.get(code) ?? 0) + 1));
  });
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count, ...MEASURE_META[code] }))
    .sort((a, b) => b.count - a.count);
});

const totalMeasures = computed(() =>
  legend.value.reduce((sum, item) => sum + item.count, 0),
);

/** 把「有措施的站」点亮；其它站保持原样（/nodes 里默认就是灭的） */
const applyVisibility = () => {
  hideAll();
  hideStationByName(stationObjs, names, true);
};

onMounted(() => {
  // 先灌数据，再点亮 —— 顺序反了会先亮出一批没有图标的站名
  enableMeasures();
  applyVisibility();
});

// Toolbar 的站点实体可能比本面板晚渲染出来：新出现的那批也要按同样规则点亮
watch(() => stationObjs.length, applyVisibility);

onBeforeUnmount(() => {
  disableMeasures();
  restore();
});
</script>

<template>
  <section class="sc-panel">
    <header class="sc-head">
      <span class="sc-title">站控措施</span>
      <span class="sc-tag">{{ names.length }} 站 · {{ totalMeasures }} 条</span>
    </header>

    <div class="sc-body">
      <p class="sc-note">站点气泡上方的小方框即当前执行的措施，站点隐藏时一并隐藏。</p>

      <ul class="sc-legend">
        <li v-for="item in legend" :key="item.code" class="sc-legend-item">
          <span class="sc-tile" :style="{ '--c': item.color }">
            <MeasureIcon :code="item.code" />
          </span>
          <span class="sc-name">{{ item.title }}</span>
          <span class="sc-count">{{ item.count }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
/* 与另外两个模式面板同一槽位：24(左) + 186(宽) + 12(间隙) */
.sc-panel {
  position: absolute;
  left: 222px;
  top: 112px;
  z-index: 60;
  width: 236px;
  max-height: 560px;
  display: flex;
  flex-direction: column;
  pointer-events: auto;

  background: linear-gradient(
    180deg,
    rgba(9, 26, 50, 0.95),
    rgba(5, 11, 20, 0.97)
  );
  border: 1px solid var(--panel-border, rgba(226, 186, 100, 0.45));
  box-shadow:
    0 10px 28px rgba(0, 0, 0, 0.7),
    inset 0 0 16px rgba(11, 30, 56, 0.55);
  clip-path: polygon(
    12px 0,
    100% 0,
    100% calc(100% - 12px),
    calc(100% - 12px) 100%,
    0 100%,
    0 12px
  );

  /* 弹层离开了 .foot-page，设计令牌要在这里重新声明一份 */
  --color-gold: #e2ba64;
  --color-gold-glow: #fce38a;
  --color-cyan-glow: #11efe3;
  --color-text-main: #e2f1ff;
  --color-text-muted: #88a2be;
  --panel-border: rgba(226, 186, 100, 0.45);
  --font-scifi: 'Rajdhani', 'Noto Sans SC', sans-serif;
  --font-sans: 'Noto Sans SC', sans-serif;
  font-family: var(--font-sans);
}

.sc-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid rgba(226, 186, 100, 0.35);
  background: rgba(226, 186, 100, 0.07);
}

.sc-title {
  font-family: var(--font-scifi);
  font-size: 15px;
  letter-spacing: 0.16em;
  color: var(--color-gold-glow);
  white-space: nowrap;
}

.sc-tag {
  font-size: 12px;
  color: var(--color-text-muted);
}

.sc-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

.sc-body::-webkit-scrollbar {
  width: 5px;
}

.sc-body::-webkit-scrollbar-thumb {
  background: rgba(226, 186, 100, 0.45);
}

.sc-note {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.sc-legend {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sc-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 1.5;
}

/* 图例里的图标框与三维气泡上的小方框同款 */
.sc-tile {
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 3px;
  color: var(--c, #e2ba64);
  background: rgba(6, 16, 30, 0.92);
  border: 1px solid var(--c, #e2ba64);
}

.sc-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--color-text-main);
}

.sc-count {
  flex: none;
  font-family: var(--font-scifi);
  font-size: 13px;
  color: var(--color-cyan-glow);
}
</style>
