<script setup>
/**
 * 线路轨迹栏目 —— 路由 /realtime。
 *
 * 进入栏目后：左栏 18 条线路，点一条 → 列车按这条线的折线漫游；
 * 右栏是该线的站点序列，实时高亮「当前在第几站」，并有进度条。
 *
 * 三条设计纪律（决定了这个文件为什么这么写）：
 *
 * 1) **时间即唯一真值**，但那个时间是「本栏目自己的时间」（trainRoam 的 elapsed），
 *    不是 viewer.clock。位置、当前站、进度全部由它派生（见 trainSchedule.js 的 locate），
 *    所以没有「到站计数器」；面板这条进度条就是列车的时间轴。
 *
 * 2) **停站停顿烘焙在采样时间轴里**（同一顶点上的 arrive/leave 两个采样），
 *    不用 setTimeout。参考实现那个「每 2 秒反复暂停」的死循环就是这么来的。
 *
 * 3) **不动 Cesium 那条时间条**。列车与 viewer.clock 解耦之后，顶部时间条
 *    （head.vue 挂的那个 Timeline）完全保持原本用途：昼夜 / 场景时间。
 *    这里既不 zoomTo、也不改 clock.startTime / multiplier / clockRange。
 *
 * 三维对象全部由 cesiumTools 负责，本文件只管「说要看哪条线、什么方向」：
 *   · 漫游内核 —— cesiumTools/lineAndpoints/train/trainRoam.js
 *   · 时间表   —— cesiumTools/lineAndpoints/train/trainSchedule.js
 *   · 列车气泡 —— 复用 popup.js 的 popupRoutes.carPopup
 */

import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import * as Cesium from 'cesium';
import dayjs from 'dayjs';

import { cesiumStore } from '@/stores/counter';
import { useStationState } from '@/stores/stationState';
import { LINE_COLORS, shortLineName } from '@/config/lineAndStationStyle';
import SimpleLabel from '@/cesiumTools/lineAndpoints/popup/popup';
import { TrainRoam } from '@/cesiumTools/lineAndpoints/train/trainRoam';
import { startTimeBetweenStations } from '@/cesiumTools/lineAndpoints/train/trainSchedule';
import { resetTimeLine } from '@/cesiumTools/Time/resetTimeline';

const dataStore = cesiumStore();
const { focusedStationLine } = useStationState();

/**
 * 线路视图模型。源数据由 left1.vue 请求 /getLine 并从 line1to18_2.json
 * 合并完整坐标后写入仓库；色块索引必须与 Toolbar.vue 一致（index % LINE_COLORS.length）。
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

/** 当前线路短名；空串表示线路数据还没到 */
const focusedLine = ref('');
watch(
  lines,
  (list) => {
    if (!focusedLine.value && list.length) focusedLine.value = list[0].short;
  },
  { immediate: true },
);

const currentLine = computed(
  () => lines.value.find((line) => line.short === focusedLine.value) ?? null,
);

/** 'forward' | 'reverse'：右上角 ⇄ 按钮切换 */
const direction = ref('forward');

/**
 * 正向站序（按 sort 升序）。
 * line1to18_2.json 就是按这个顺序数字化的，所以「站点顺序 == 折线顶点顺序」，
 * 时间表才能用单调前扫精确落位（18/18 条线已验证，见 trainSchedule.js 头注释）。
 */
const forwardStations = computed(() =>
  [...(currentLine.value?.stations ?? [])].sort(
    (a, b) => Number(a.sort) - Number(b.sort),
  ),
);

/** 行车方向的站序（只影响显示与时间表，绝不动 station.sort 本身） */
const travelStations = computed(() =>
  direction.value === 'reverse'
    ? forwardStations.value.slice().reverse()
    : forwardStations.value,
);

/** 每帧由 trainRoam.onUpdate 写入的状态 */
const activeIndex = ref(-1);
const inStation = ref(false);
const playing = ref(true);

/** 进度条走 DOM 直写，避免每帧触发一次 Vue patch */
const barRef = ref(null);

/** 列车气泡的数据源。必须是 reactive，否则到站改人数不会重渲染 */
const carAttr = reactive({
  lineName: '',
  currentPassengers: 0,
  nextStation: '',
  speed: 0,
});

let roam = null;
let carLabel = null;

const today = computed(() => dayjs().format('YYYY-MM-DD'));

/** 站数进度文案 */
const stationText = computed(() =>
  activeIndex.value >= 0
    ? `${activeIndex.value + 1} / ${travelStations.value.length}`
    : `— / ${travelStations.value.length}`,
);

/** 到站时刷新车上人数：用该站客流做个像样的随机，而不是纯随机数 */
const refreshPassengers = (index) => {
  const station = travelStations.value[index];
  const base = Number(station?.peopleFlow) || 800;
  carAttr.currentPassengers = Math.round(base * (0.55 + Math.random() * 0.7));
};

/** 每帧回调：只在高亮站变化时才碰 Vue 状态 */
const handleTrain = (state) => {
  if (!state) return;

  if (state.position && carLabel) {
    carLabel.changePosition(state.position);
    // 气泡上抬量跟着视距走：相机拉近时车在屏幕上更大，固定偏移就会被车压住；
    // 拉远时车变小，抬太高又会飘得莫名其妙。按 1/range 反比给，再夹到安全区间。
    const lift = Cesium.Math.clamp(
      (115 * 90) / Math.max(roam?.range ?? 90, 1),
      70,
      240,
    );
    carLabel.offset[1] = lift;
  }

  if (barRef.value) {
    barRef.value.style.width = `${(state.progress * 100).toFixed(2)}%`;
  }

  if (state.inStation !== inStation.value) inStation.value = state.inStation;

  if (state.index !== activeIndex.value) {
    activeIndex.value = state.index;
    const next = travelStations.value[state.index + 1];
    carAttr.nextStation = next ? next.name : '';
    refreshPassengers(state.index);
  }
};

/** 列车气泡：不进 popupManager，挂到自己身上，退出时显式回收 */
const ensurePopup = (viewer) => {
  if (carLabel || !viewer) return;
  carLabel = new SimpleLabel(viewer, {
    position: Cesium.Cartesian3.ZERO,
    label: 'train',
    color: '#11efe3',
    attr: carAttr,
    type: 'carPopup',
    // 上抬到车顶之上，别压住车身；实际每帧还会按视距微调（见 handleTrain）
    offset: [400, 415],
    // 不按距离剔除：相机一直跟着车，剔除逻辑只会误判
    needOptimize: false,
    // 自己挂 postRender，才能跟着列车每帧移动
    managedByManager: false,
    clickable: false,
  });
  carLabel.addLabel();
};

const removePopup = () => {
  if (!carLabel) return;
  carLabel.removeMarker();
  carLabel = null;
};

/**
 * 起一段漫游。线路切换与反向重建都走这里。
 * @param {boolean} keepCamera 反向重建时保留相机，避免闪一帧
 */
const startRoam = ({ keepCamera = false } = {}) => {
  const viewer = dataStore.Viewer;
  const line = currentLine.value;
  if (!viewer || !line || !line.positions.length) return;

  // 交给 Toolbar 的唯一一句话：这条线的站点可以亮了（mode='line'，不让位）
  focusedStationLine.value = line.name;

  if (roam && keepCamera) roam.destroy({ keepCamera: true });
  if (!roam) roam = new TrainRoam(viewer);

  ensurePopup(viewer);

  const schedule = roam.load({
    positions: line.positions,
    stations: forwardStations.value,
    color: line.color,
    direction: direction.value,
  });
  if (!schedule) return;

  roam.onUpdate = handleTrain;
  playing.value = true;
  activeIndex.value = -1;
  inStation.value = false;
  carAttr.lineName = line.short;
  carAttr.speed = Math.round(schedule.speed * 3.6);
  carAttr.nextStation = travelStations.value[0]?.name ?? '';
};

/**
 * 单一入口：viewer 就绪 + 当前线路确定 → 起漫游。
 * 与 ActivePanel 一样用 watch 而不是 onMounted，因为
 * 「线路数据先到」和「viewer 先到」两种顺序都会发生。
 */
const setup = () => {
  if (!dataStore.Viewer || !currentLine.value) return;
  startRoam();
};

watch([currentLine, () => dataStore.Viewer], setup, { immediate: true });

/** 切换线路（左栏点击） */
const switchLine = (short) => {
  if (short === focusedLine.value) return;
  focusedLine.value = short;
  // 换线路时方向回到正向，免得留下「上一条线是反向」的困惑
  direction.value = 'forward';
  startRoam();
};

/** 右上角 ⇄：调换起点站与终点站 */
const reverseDirection = () => {
  direction.value = direction.value === 'reverse' ? 'forward' : 'reverse';
  startRoam({ keepCamera: true });
};

/**
 * 点站点 → 列车改从「这一站与上一站之间」的某个折线折点起跑。
 *
 * 这里**不重建漫游**（不调 startRoam）：起点只是时间表上的一个秒数，
 * 改 roam.elapsed / startOffset 就够了 —— 采样表、模型、相机全都不动，
 * 切换是瞬间的（不会重载 24MB 的 glb）。
 * 首站（index 0）没有「上一站」，startTimeBetweenStations 会返回 0，
 * 等价于从首站正常发车。
 */
const jumpToStation = (index) => {
  if (!roam?.schedule) return;
  roam.jumpTo(startTimeBetweenStations(roam.schedule, index));
  playing.value = true;
};

const togglePlay = () => {
  if (!roam) return;
  playing.value = !playing.value;
  if (playing.value) roam.play();
  else roam.pause();
};

const restart = () => {
  if (!roam) return;
  roam.restart();
  playing.value = true;
};

/* ---------------- 进度条拖动（把自己当成时间轴） ---------------- */

const progressRef = ref(null);
let isScrubbing = false;

/**
 * 把鼠标位置换成 0~1 的比例。
 * HUD 整层被 CSS 缩放过，但 clientX 与 getBoundingClientRect 都是屏幕像素，
 * 相除的结果不受缩放影响，所以这里不用管 hud 的 scale。
 */
const ratioAt = (event) => {
  const el = progressRef.value;
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  if (!rect.width) return 0;
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
};

const seekTo = (ratio) => {
  if (!roam?.schedule) return;
  roam.seek(ratio * roam.schedule.total);
};

const onScrubDown = (event) => {
  if (!roam?.schedule) return;
  isScrubbing = true;
  roam.beginScrub();
  seekTo(ratioAt(event));
  progressRef.value?.setPointerCapture?.(event.pointerId);
  event.preventDefault();
};

const onScrubMove = (event) => {
  if (!isScrubbing) return;
  seekTo(ratioAt(event));
};

const onScrubUp = (event) => {
  if (!isScrubbing) return;
  isScrubbing = false;
  roam?.endScrub();
  progressRef.value?.releasePointerCapture?.(event.pointerId);
};

onBeforeUnmount(() => {
  if (roam) {
    roam.onUpdate = null;
    roam.destroy();
  }
  roam = null;
  removePopup();
  focusedStationLine.value = '';

  // 列车重新挂回 viewer.clock 之后，漫游会把时间轴窗口改写成「几十秒跑完本条线」，
  // 并在 destroy 里把 shouldAnimate 置 false。离开栏目必须还原成「现在 ~ 2 天」，
  // 否则其他栏目的昼夜 / 时间条就停住了（resetTimeline 的 else 分支就是干这个的）。
  const viewer = dataStore.Viewer;
  if (viewer && !viewer.isDestroyed?.()) resetTimeLine(viewer);
});
</script>

<template>
  <Teleport to=".hud-canvas" defer>
    <Transition name="rp-pop">
      <div
        class="realtime-panel"
        :style="{ '--line-color': currentLine?.color ?? '#e2ba64' }"
      >
        <!-- ============ 左：线路 ============ -->
        <section class="rp-col rp-col-lines">
          <header class="rp-head">
            <span class="rp-title">地铁线路</span>
            <span class="rp-tag">{{ lines.length }} 条</span>
          </header>

          <div class="rp-body rp-body-lines">
            <button
              v-for="line in lines"
              :key="line.id"
              type="button"
              class="rp-line"
              :class="{ 'is-focus': line.short === focusedLine }"
              :title="`查看 ${line.short} 的线路轨迹`"
              @click="switchLine(line.short)"
            >
              <i class="rp-chip" :style="{ '--c': line.color }"></i>
              <span>{{ line.short }}</span>
            </button>
          </div>
        </section>

        <!-- ============ 右：站点序列 ============ -->
        <section class="rp-col rp-col-stations">
          <header class="rp-head">
            <span class="rp-title">地铁站点</span>
            <span class="rp-tag">
              {{ currentLine?.short ?? '—' }} · {{ stationText }} ·
              {{ direction === 'reverse' ? '反向' : '正向' }}
            </span>

            <!-- 右上角：反向（起点/终点调换） -->
            <div class="rp-actions">
              <button
                type="button"
                class="rp-btn"
                :title="playing ? '暂停漫游' : '继续漫游'"
                @click="togglePlay"
              >
                {{ playing ? '❚❚' : '▶' }}
              </button>
              <button
                type="button"
                class="rp-btn"
                title="回到首发站"
                @click="restart"
              >
                ↺
              </button>
              <button
                type="button"
                class="rp-btn rp-btn-reverse"
                :class="{ 'is-reverse': direction === 'reverse' }"
                title="调换起点站与终点站"
                @click="reverseDirection"
              >
                ⇄
              </button>
            </div>
          </header>

          <div
            ref="progressRef"
            class="rp-progress"
            title="拖动可查看任意时刻"
            @pointerdown="onScrubDown"
            @pointermove="onScrubMove"
            @pointerup="onScrubUp"
            @pointercancel="onScrubUp"
          >
            <span class="rp-progress-clip">
              <i
                ref="barRef"
                class="rp-bar"
                :style="{ '--c': currentLine?.color }"
              ></i>
            </span>
          </div>

          <div v-if="!travelStations.length" class="rp-empty">
            该线路暂无站点数据
          </div>

          <div v-else class="rp-body rp-body-stations">
            <div
              v-for="(station, index) in travelStations"
              :key="`${station.name}-${index}`"
              class="rp-station"
              :class="{
                'is-done': index < activeIndex,
                'is-active': index === activeIndex,
                'is-here': index === activeIndex && inStation,
              }"
              :title="
                index === 0
                  ? '从首站发车'
                  : `从${travelStations[index - 1].name} 与 ${station.name} 之间起跑`
              "
              @click="jumpToStation(index)"
            >
              <i class="rp-dot"></i>
              <span class="rp-idx">{{ index + 1 }}</span>
              <span class="rp-name">{{ station.name }}</span>
              <span v-if="index === activeIndex && inStation" class="rp-badge"
                >到站</span
              >
            </div>
          </div>
        </section>

        <span class="rp-date">{{ today }}</span>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 尺寸/位置与 .activity-panel、.history-panel 完全一致：1040×232、bottom 145，
   三个栏目互相切换时面板不跳。 */
.realtime-panel {
  position: absolute;
  left: 50%;
  bottom: 145px;
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

.rp-col {
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

.rp-col-lines {
  width: 31%;
  flex: none;
}

.rp-col-stations {
  flex: 1;
  position: relative;
}

/* ---- 头部 ---- */
.rp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 5px 10px;
  border-bottom: 1px solid rgba(226, 186, 100, 0.35);
  background: rgba(226, 186, 100, 0.07);
}

.rp-title {
  font-family: var(--font-scifi);
  font-size: 15px;
  letter-spacing: 0.16em;
  color: var(--color-gold-glow);
  white-space: nowrap;
}

.rp-tag {
  font-size: 13px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 站点栏目右上角的操作区：反向按钮就在这里 */
.rp-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.rp-btn {
  width: 22px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: rgba(226, 186, 100, 0.08);
  border: 1px solid rgba(226, 186, 100, 0.4);
  color: var(--color-text-main);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.18s ease;
}

.rp-btn:hover {
  border-color: var(--color-cyan-glow);
  color: var(--color-cyan-glow);
  background: rgba(17, 239, 227, 0.12);
}

/* 反向按钮：反向态整体转 180°，一眼看出现在是哪个方向 */
.rp-btn-reverse {
  font-size: 14px;
  transition:
    transform 0.3s ease,
    border-color 0.18s ease,
    color 0.18s ease;
}

.rp-btn-reverse.is-reverse {
  transform: rotate(180deg);
  border-color: var(--color-cyan-glow);
  color: var(--color-cyan-glow);
}

/* ---- 进度条 ---- */
.rp-progress {
  position: relative;
  flex: none;
  height: 3px;
  background: rgba(226, 186, 100, 0.14);
  /* 可见高度仍是 3px，但命中区上下各撑 5px：3px 的条拖起来手一抖就丢。
     真正的裁切交给下面那个 .rp-progress-clip，观感与改动前完全一致。 */
  cursor: ew-resize;
}

.rp-progress::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -5px;
  bottom: -5px;
}

.rp-progress-clip {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.rp-bar {
  display: block;
  width: 0;
  height: 100%;
  background: linear-gradient(
    90deg,
    rgba(17, 239, 227, 0.35),
    var(--c, var(--color-cyan-glow))
  );
  box-shadow: 0 0 8px var(--c, var(--color-cyan-glow));
}

/* ---- 列表体 ---- */
.rp-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 5px 8px;
}

.rp-body-lines {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px 6px;
  align-content: start;
}

.rp-line {
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

.rp-line:hover {
  color: var(--color-cyan-glow);
}

.rp-line.is-focus {
  border-color: rgba(226, 186, 100, 0.85);
  background: rgba(226, 186, 100, 0.12);
}

.rp-line > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rp-chip {
  width: 8px;
  height: 8px;
  flex: none;
  background: var(--c);
  box-shadow: 0 0 6px var(--c);
}

/* 站点：4 列。最长 37 站（11 号线）→ 10 行，正好一屏装得下 */
.rp-body-stations {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px 10px;
  align-content: start;
}

.rp-station {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 16px;
  font-size: 12px;
  color: var(--color-text-muted);
  transition: color 0.18s ease;
  /* 整行都是「从这里起跑」的点击目标 */
  cursor: pointer;
}

.rp-station:hover .rp-name {
  color: var(--color-cyan-glow);
}

.rp-station:hover .rp-dot {
  background: var(--color-cyan-glow);
  box-shadow: 0 0 6px var(--color-cyan-glow);
}

.rp-dot {
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 50%;
  background: rgba(136, 162, 190, 0.5);
  transition: all 0.18s ease;
}

.rp-idx {
  flex: none;
  min-width: 15px;
  font-family: var(--font-scifi);
  font-size: 11px;
  opacity: 0.65;
  text-align: right;
}

.rp-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 已过站 */
.rp-station.is-done .rp-dot {
  background: var(--line-color);
  box-shadow: 0 0 5px var(--line-color);
}

.rp-station.is-done {
  color: rgba(226, 241, 255, 0.55);
}

/* 当前站 */
.rp-station.is-active {
  color: var(--color-gold-glow);
  font-weight: 600;
}

.rp-station.is-active .rp-dot {
  background: var(--color-gold-glow);
  box-shadow: 0 0 8px var(--color-gold-glow);
}

/* 正停在站里：dot 呼吸一下，和「路过」区分开 */
.rp-station.is-here .rp-dot {
  animation: rp-breathe 1s ease-in-out infinite;
}

.rp-badge {
  flex: none;
  padding: 0 3px;
  font-size: 10px;
  line-height: 12px;
  color: #0a111a;
  background: var(--color-gold-glow);
}

.rp-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--color-text-muted);
}

.rp-date {
  position: absolute;
  right: 14px;
  bottom: 6px;
  font-family: var(--font-scifi);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: rgba(136, 162, 190, 0.55);
  pointer-events: none;
}

@keyframes rp-breathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.6);
    opacity: 0.55;
  }
}

/* 进出场：与另外两个栏目一致的轻微上浮 */
.rp-pop-enter-active,
.rp-pop-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}

.rp-pop-enter-from,
.rp-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
