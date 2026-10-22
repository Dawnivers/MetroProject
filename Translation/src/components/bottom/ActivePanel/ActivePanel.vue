<script setup>
/**
 * 重点活动（重保活动）栏目 —— 路由 /experiment。
 *
 * 「重保」= 重点保障。进入栏目后：左栏列出 18 条线路，点任意一条 →
 *   ① 该线路叠一条加粗高亮线并飞过去；
 *   ② 这条线上所有重点活动所在车站各立一根光柱；
 * 再点右栏某张活动卡 → 相机飞到那根光柱。
 *
 * 三个约束（与 /strategy 的发展历程面板保持一致，两个栏目互切时观感不跳）：
 *   · 面板自己 Teleport 到 .hud-canvas，这一层不占布局；
 *   · 左右两侧的大屏侧栏**不收起**（stationPanelOpen 只对 /nodes 为 true）；
 *   · 面板尺寸与位置和 historyPanel 完全一致（1040×232，bottom 145）。
 *
 * 三维侧的副产物（高亮叠线、光柱实体）都挂在 Cesium 上、不在 Vue 树里，
 * 路由切走不会自动回收，所以切换线路与 onBeforeUnmount 都要显式清。
 *
 * 具体几何/材质逻辑不写在这里，全部走 cesiumTools：
 *   · 光柱 —— lineAndpoints/points/circleAndcone/setlightcolumn.js
 *   · 高亮 —— lineAndpoints/line/lineHighlight.js
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import * as Cesium from 'cesium';
import dayjs from 'dayjs';

import { cesiumStore } from '@/stores/counter';
import { useStationState } from '@/stores/stationState';
import { LINE_COLORS, shortLineName } from '@/config/lineAndStationStyle';
import { activityOfLine, totalActivityCount } from '@/config/shmetroActivity';
import {
  lightColumn,
  removeAllLightColumns,
  flyToLightColumn,
} from '@/cesiumTools/lineAndpoints/points/circleAndcone/setlightcolumn';
import {
  highlightLine,
  clearLineHighlight,
} from '@/cesiumTools/lineAndpoints/line/lineHighlight';

/** 光柱尺寸：城市尺度下 3km 高、160m 粗，既看得见又不会糊成一根柱子墙 */
const COLUMN_HEIGHT = 3000;
const COLUMN_RADIUS = 360;

const dataStore = cesiumStore();
/**
 * 只取 focusedStationLine：面板**只负责说「要看哪条线」**，
 * 站点标记真正的显隐由 Toolbar 里那个 watcher 统一落（见 stationState.js 的注释）。
 */
const { focusedStationLine } = useStationState();

/**
 * 线路视图模型。源数据由 left1.vue 请求 /getLine 后写入仓库，
 * 这里只做「长度/坐标取出来 + 按序补色块 + 补短名」的整理。
 *
 * 色块索引必须和 Toolbar.vue 完全一致（都是 index % LINE_COLORS.length），
 * 否则左栏的色块会和三维里的线路颜色对不上。
 */
const lines = computed(() =>
  (dataStore.Lines || []).map((item, index) => ({
    id: item.id,
    name: item.name,
    short: shortLineName(item.name),
    color: LINE_COLORS[index % LINE_COLORS.length],
    stations: item.stationList ?? [],
    positions: item.positions ?? [],
  })),
);

/** 当前聚焦的线路短名（如 '1号线'）。空串表示数据还没到 */
const focusedLine = ref('');

/** 线路数据到达后补一个默认选中项；已有选中项时不覆盖用户的选择 */
watch(
  lines,
  (list) => {
    if (!focusedLine.value && list.length) {
      focusedLine.value = list[0].short;
    }
  },
  { immediate: true },
);

const currentLine = computed(
  () => lines.value.find((line) => line.short === focusedLine.value) ?? null,
);

/** 面板抬头显示当天日期，和参考项目的「重点活动 2024-05-14」一致 */
const today = computed(() => dayjs().format('YYYY-MM-DD'));

/** "121.355833,31.220052" → { lng, lat }；解析失败返回 null */
const parseCoord = (xyCoords) => {
  const [lng, lat] = String(xyCoords ?? '')
    .split(',')
    .map((token) => Number(token.trim()));
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
};

/**
 * 当前线路的活动列表，每项补一个 `coord`。
 *
 * 这里做了一次**站名 → 库内站点**的解析，解析不到就标记 found=false：
 * 数据集是用站名写死的（比参考项目用数组下标稳），但站名仍可能因为库的改动失效，
 * 那种情况下右栏照常显示这张卡片、只是不立光柱，并且明确标出来，不会静默少一根。
 */
const activities = computed(() => {
  const line = currentLine.value;
  if (!line) return [];

  //
  return activityOfLine(line.short).map((item) => {
    const station = line.stations.find((s) => s.name === item.station);
    return {
      ...item,
      found: Boolean(station),
      coord: station ? parseCoord(station.xy_coords) : null,
    };
  });
});

/** 当前被点开的活动（用于卡片高亮），存 station 名 */
const activeStation = ref('');

const teardown = () => {
  const viewer = dataStore.Viewer;
  // 先摘实体再清登记表，顺序反了 removeAllLightColumns 会拿到空的列表
  removeAllLightColumns(viewer);
  clearLineHighlight(viewer);
  activeStation.value = '';
};

/**
 * 重新装配三维侧效果：清掉上一轮的 → 叠高亮线 + 飞过去 → 立本线路的光柱。
 *
 * 合并成一个 watch 是必要的（发展历程面板踩过同一个坑）：拆成 onMounted + 两个
 * watch 时三者在挂载期会各触发一次，每次都先 teardown 再重建，肉眼看到的是闪烁。
 */
const setup = () => {
  teardown();

  const line = currentLine.value;
  if (!line) return;

  // 先把「要看的线路」告诉 Toolbar，站点才会跟着切。
  // 放在 viewer 判空之前：线路数据到了、viewer 还没就绪时，站点照样该切。
  focusedStationLine.value = line.name;

  const viewer = dataStore.Viewer;
  if (!viewer || line.positions.length < 4) return;

  const highlight = highlightLine(viewer, {
    name: line.name,
    positions: line.positions,
    color: line.color,
  });

  // 飞到整条高亮线：flyTo 走 Entity 的包围球取景，不用自己算俯角距离
  if (highlight) viewer.flyTo(highlight, { duration: 1.6 });

  activities.value.forEach((item) => {
    if (!item.coord) return;
    lightColumn(viewer, {
      lng: item.coord.lng,
      lat: item.coord.lat,
      height: COLUMN_HEIGHT,
      radius: COLUMN_RADIUS,
      color: line.color,
      name: item.station,
      flowSpeed: 1.0,
      breatheSpeed: 0,
      opacity:1.0
      
    });
  });
};

watch([currentLine, () => dataStore.Viewer], setup, { immediate: true });

/** 点活动卡片：相机飞到那根光柱（只在光柱真的立起来了才有意义） */
const focusActivity = (item) => {
  activeStation.value = item.station;
  flyToLightColumn(dataStore.Viewer, item.station);
};

onBeforeUnmount(() => {
  teardown();
  // 复位：留着的话下次进栏目会先按上一次的线路点亮一次站点，再跳到正确的线上
  focusedStationLine.value = '';
});
</script>

<template>
  <Teleport to=".hud-canvas" defer>
    <Transition name="ap-pop">
      <div
        class="activity-panel"
        :style="{ '--line-color': currentLine?.color ?? '#e2ba64' }"
      >
        <!-- ============ 左：线路 ============ -->
        <section class="ap-col ap-col-lines">
          <header class="ap-head">
            <span class="ap-title">地铁线路</span>
            <span class="ap-tag">{{ lines.length }} 条</span>
          </header>

          <div class="ap-body ap-body-lines">
            <button
              v-for="line in lines"
              :key="line.id"
              type="button"
              class="ap-line"
              :class="{ 'is-focus': line.short === focusedLine }"
              :title="`查看 ${line.short} 的重点活动`"
              @click="focusedLine = line.short"
            >
              <i class="ap-chip" :style="{ '--c': line.color }"></i>
              <span>{{ line.short }}</span>
            </button>
          </div>
        </section>

        <!-- ============ 右：重点活动 ============ -->
        <section class="ap-col ap-col-activity">
          <header class="ap-head">
            <span class="ap-title">重点活动</span>
            <span class="ap-tag">{{ today }}</span>
            <span class="ap-tag ap-tag-right">
              {{ currentLine ? currentLine.short : '—' }} ·
              {{ activities.length }} 项 / 全网 {{ totalActivityCount }} 项
            </span>
          </header>

          <div v-if="!activities.length" class="ap-empty">
            该线路暂无重点活动数据
          </div>

          <div v-else class="ap-body ap-body-activity">
            <button
              v-for="item in activities"
              :key="item.station + item.time"
              type="button"
              class="ap-card"
              :class="{
                'is-active': item.station === activeStation,
                'is-missing': !item.found,
              }"
              :title="
                item.found
                  ? `飞到 ${item.station} 的光柱`
                  : `库内没有车站「${item.station}」，无法定位`
              "
              @click="focusActivity(item)"
            >
              <span class="ap-time">{{ item.time }}</span>
              <span class="ap-place">{{ item.place }}</span>
              <span class="ap-desc">{{ item.activity }}</span>
              <span class="ap-station">
                {{ item.found ? item.station : `${item.station}（库内无此站）` }}
              </span>
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* .hud-canvas 内部已被整体缩放过，所以这里写的 px 就是设计 px；
   尺寸与位置和 .history-panel 完全一致，两个栏目互切时面板不跳。
   横向可用区是 x 422–1498（左右侧栏各占 422px），故宽度取 1040 居中。 */
.activity-panel {
  position: absolute;
  left: 50%;
  bottom: 145px; /* 导航条顶边在设计 y=937 处，留 2px 缝隙 */
  transform: translateX(-50%);
  z-index: 60;

  width: 1040px;
  height: 232px;
  display: flex;
  gap: 9px;
  pointer-events: auto;

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

.ap-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: linear-gradient(
    180deg,
    rgba(9, 26, 50, 0.95),
    rgba(5, 11, 20, 0.97)
  );
  border: 1px solid var(--panel-border);
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
}

.ap-col-lines {
  width: 31%;
  flex: none;
}

.ap-col-activity {
  flex: 1;
}

/* ---- 头部 ---- */
.ap-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 5px 10px;
  border-bottom: 1px solid rgba(226, 186, 100, 0.35);
  background: rgba(226, 186, 100, 0.07);
}

.ap-title {
  font-family: var(--font-scifi);
  font-size: 15px;
  letter-spacing: 0.16em;
  color: var(--color-gold-glow);
  white-space: nowrap;
}

.ap-tag {
  font-size: 13px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

/* 右栏的汇总信息推到最右，和左栏的「18 条」位置感一致 */
.ap-tag-right {
  margin-left: auto;
  color: var(--color-text-main);
  letter-spacing: 0.04em;
}

/* ---- 列表体 ---- */
.ap-body {
  flex: 1;
  min-height: 0;
  /* 一屏装得下，按需求不出滚动条 */
  overflow: hidden;
  padding: 6px 8px;
}

.ap-body-lines {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px 6px;
  align-content: start;
}

/* 整个按钮都是「切换右栏」的点击目标 */
.ap-line {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: 3px 4px;
  background: none;
  border: 1px solid transparent;
  color: var(--color-text-main);
  font-family: var(--font-scifi);
  font-size: 14px;
  letter-spacing: 0.05em;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.18s ease;
}

.ap-line:hover {
  color: var(--color-cyan-glow);
}

.ap-line.is-focus {
  border-color: rgba(226, 186, 100, 0.85);
  background: rgba(226, 186, 100, 0.12);
}

.ap-line > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ap-chip {
  flex: none;
  width: 9px;
  height: 9px;
  background: var(--c, #e2ba64);
  box-shadow: 0 0 6px var(--c, #e2ba64);
}

/* ---- 活动卡片 ---- */
.ap-body-activity {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-content: flex-start;
  padding: 10px 12px;
}

.ap-card {
  flex: 1 1 150px;
  max-width: 176px;
  height: 84px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 7px 9px;
  background: rgba(214, 174, 41, 0.1);
  border: 1px solid rgba(226, 186, 100, 0.5);
  color: var(--color-text-main);
  text-align: left;
  cursor: pointer;
  transition: all 0.2s linear;
}

.ap-card:hover {
  background: rgba(214, 174, 41, 0.28);
}

.ap-card.is-active {
  background: rgba(214, 174, 41, 0.32);
  border-color: var(--color-gold-glow);
  box-shadow: 0 0 12px rgba(252, 227, 138, 0.35);
}

/* 站名对不上库：卡片照常显示，但明说无法定位，不静默少一根光柱 */
.ap-card.is-missing {
  border-style: dashed;
  border-color: rgba(255, 127, 176, 0.7);
}

.ap-time {
  font-family: var(--font-scifi);
  font-size: 15px;
  letter-spacing: 0.06em;
  color: var(--color-gold-glow);
}

.ap-place {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.ap-desc {
  font-size: 12px;
  color: var(--color-cyan-glow);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.ap-station {
  margin-top: auto;
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.ap-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 13px;
  letter-spacing: 0.08em;
}

/* ---- 进出场 ---- */
.ap-pop-enter-active,
.ap-pop-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}

.ap-pop-enter-from,
.ap-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}
</style>
