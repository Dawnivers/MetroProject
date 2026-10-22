<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import * as Cesium from 'cesium';
import { cesiumStore } from '@/stores/counter';
import { useStationState } from '@/stores/stationState';
import { renderLines } from '@/cesiumTools/lineAndpoints/line/setlines';
import { LINE_COLORS, shortLineName } from '@/config/lineAndStationStyle';
import { historyOfLine } from '@/config/shmetroHistory';

/**
 * 「发展历程」栏目（路由 /strategy）：左栏选线路，右栏是这条线的建设历程，
 * 三维里那条线会**按建设顺序从已建成的部分长出来**。
 *
 * ── 生长动画怎么做的 ────────────────────────────────────────
 * 不给每条线配「从头长还是从尾长」的方向开关。18 条线里有 6 条的首通段落在
 * **线路中段**（1/2/9/10/11/13），是同时往两头长的，任何单一方向都表达不了。
 * 改为用 shmetroHistory.js 里每个里程碑的 range: [lo, hi]（已开通站的区间），
 * 每帧把 lo/hi 在两段之间插值，取折线对应的那一段，交给 CallbackProperty。
 * 于是：单头延伸只有一端动、两头延伸两端一起动、中段补站则区间不动只是文案变。
 *
 * 性能：整条折线**只转一次** Cartesian3 数组，每帧只做 slice（复用对象）。
 * 不学参考项目每帧 `Cartesian3.fromDegreesArray(curPaths)` —— 11 号线 816 个点，
 * 那样每秒要新建近 5 万个对象。
 *
 * 实体归属：**方案 A，私有实体**。用 setlines.js 现成的 renderLines 自己造一条，
 * 画完自己 remove，不碰 Toolbar 里那 18 条全局线路的实体本身；只是进入栏目时
 * 把它们整体藏起来（否则底下压着一条完整的线，看不出生长），离开时逐条还原。
 *
 * ── 与「站点管理」的关系 ────────────────────────────────────
 * 面板外壳、Teleport 目标、尺寸位置完全沿用 StationPanel.vue 那一套；
 * 但**不收起左右侧栏**：侧栏是否收起由 panel.vue 按路由判断（stationPanelOpen
 * 只对 /nodes 为 true），所以 /strategy 天然保持侧栏可见，这里不需要动它。
 */

/** 一个里程碑占 10 个时间单位 → 整条线的 max = (节点数 - 1) * 10 */
const UNIT = 10;
/** 播放速度（单位/秒）：6 → 一个里程碑约 1.7 秒，1 号线 7 个节点约 10 秒播完 */
const SPEED = 6;

/**
 * 进入栏目时相机落到的那个**固定视角**。
 *
 * 注意这不是「按线路取景」：换线路时相机**不动**，始终停在这个视角上，
 * 只在从别的路由切进 /strategy 时飞一次。
 *
 * 六个值就是 Cesium 相机的位置 + 姿态（度）：
 *   lon / lat / height  → camera.positionCartographic
 *   heading / pitch / roll → camera 的朝向
 * 传 null 表示不干预相机（保持进入前的视角）。
 */
const ENTRY_VIEW = {
  lon: 121.358358,
  lat: 31.009985,
  height: 225000.98,
  heading: -1.0786,
  pitch: -83.5848,
  roll: 0.0399,
  duration: 1.6,
};

const dataStore = cesiumStore();
const { lineEnts } = useStationState();

/* ---------------- 线路数据 ---------------- */

const lines = computed(() =>
  (dataStore.Lines || []).map((item, index) => ({
    id: item.id,
    name: item.name,
    short: shortLineName(item.name),
    color: LINE_COLORS[index % LINE_COLORS.length],
    positions: item.positions || [],
    // 站点按 sort 升序，与折线顶点的先后一致（line1to18_2.json 就是按这个顺序数字化）
    stations: (item.stationList || [])
      .slice()
      .sort((a, b) => Number(a.sort) - Number(b.sort)),
  })),
);

/** 右栏正在查看的线路（面板本地状态，重新进入栏目回到第一条线） */
const focusedLine = ref(null);

watch(
  lines,
  (list) => {
    if (!list.some((line) => line.name === focusedLine.value)) {
      focusedLine.value = list[0]?.name ?? null;
    }
  },
  { immediate: true },
);

const currentLine = computed(
  () => lines.value.find((line) => line.name === focusedLine.value) ?? null,
);

/** 当前线路的建设历程节点，按时间升序 */
const history = computed(() =>
  currentLine.value ? historyOfLine(currentLine.value.name) : [],
);

const max = computed(() => Math.max(0, (history.value.length - 1) * UNIT));

const currentTime = ref(0);

/**
 * 时间轴进度（0~1），用于那条**连续**的填充条。
 *
 * 与下面的 currentIndex 分工不同：currentIndex 是「走到第几个里程碑」，按段跳变
 * （文案就跟着它翻）；progress 是「整条线建到了几成」，每帧都在动。
 * 两者在段边界上正好对齐：progress = seg/(N-1)，而第 i 个圆点位于 i/(N-1) 处。
 */
const progress = computed(() => {
  const m = max.value;
  if (m <= 0) return 1;
  return Math.max(0, Math.min(1, currentTime.value / m));
});

/** 播放进度 → 当前节点下标。**段头翻**：走到哪个里程碑，文案就显示哪一条 */
const currentIndex = computed(() => {
  const n = history.value.length;
  if (!n) return 0;
  return Math.max(0, Math.min(n - 1, Math.floor(currentTime.value / UNIT)));
});

const currentMilestone = computed(() => history.value[currentIndex.value] ?? null);

/** 右栏头部的区间摘要，例如 1993-05 → 2007-12 */
const span = computed(() => {
  const list = history.value;
  if (!list.length) return '—';
  return `${list[0].time} → ${list[list.length - 1].time}`;
});

/* ---------------- 生长动画 ----------------
   growthEntity / geom / cur 都是普通变量（不是 ref）：
   它们只在逐帧回调里被读，推进模板渲染没有意义，做成响应式反而会被
   Vue 包成代理 —— 而 Cesium 的 remove() 是按引用查找的，传代理进去会静默失败。 */

/** 发展历程自己画的那一条实体 */
let growthEntity = null;
/** 当前线路的几何缓存 { cart: Cartesian3[], map: 站点下标→坐标下标, nPt } */
let geom = null;
/** 每帧被 CallbackProperty 读走的「已开通那一段」顶点 */
let cur = [];
let rafId = null;
/** 是否正在播放。用 ref：播放键的高亮要跟着它变，普通变量驱动不了模板 */
const playing = ref(false);
let lastTs = 0;

/**
 * 准备一条线的几何：把加密折线一次性转成 Cartesian3 数组，
 * 并建一张「站点下标(1 基) → 最近坐标下标」的表。
 *
 * 为什么需要这张表：line.positions 是加密折线（1 号线 337 个坐标点对 28 个站，
 * 平均每站间约 12 个点），站点下标不能直接拿去 slice，否则生长速度跟里程碑对不上、
 * 而且在站与站之间会跳。
 */
const buildGeometry = (line) => {
  const flat = line.positions;
  if (!flat || flat.length < 4 || !line.stations.length) return null;

  const cart = Cesium.Cartesian3.fromDegreesArray(flat);
  const nPt = cart.length;
  const map = new Array(line.stations.length + 1).fill(0);

  line.stations.forEach((station, i) => {
    const [lng, lat] = String(station.xy_coords || '').split(',').map(Number);

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      map[i + 1] = map[i];
      return;
    }
    const cosLat = Math.cos((lat * Math.PI) / 180);
    let best = 0;
    let bestD = Infinity;

    //线的坐标 数组与 对应的站点下标 寻找最近值
    //在站点循环下 循环线路坐标 
    for (let k = 0; k < nPt; k++) {
      const dx = (flat[k * 2] - lng) * cosLat;
      const dy = flat[k * 2 + 1] - lat;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }

    // 强制非递减：万一同一条线里两个站落到同一个坐标点（14 号线东昌路/浦东南路
    // 在库内只差 16m，就是这个情况），后面的 slice 仍然成立
    map[i + 1] = Math.max(best, map[i]);
    //这一步后 站点就能在线路坐标数组中找到对应的下标
  });

  return { cart, map, nPt };
};

/**
 * 站点下标（浮点）→ 坐标下标（浮点）。站内再插一次值，跨站才不会一顿一顿。
 *
 * 首末两站直接对齐折线的第一个/最后一个坐标：折线是数字化出来的，端点在终点站
 * 附近但带一点余量（3 号线首点离上海南站 534m、1 号线离富锦路 242m）。
 * 不这么处理的话，线画完会比全局线路短一截，离开栏目切回全局线路时能看出「接上一段」。
 */
const stationToCoord = (s) => {
  const { map, nPt } = geom;
  const last = map.length - 1;
  const v = Math.max(1, Math.min(last, s));
  if (v <= 1) return 0;
  if (v >= last) return nPt - 1;
  const k = Math.floor(v);
  return map[k] + (map[k + 1] - map[k]) * (v - k);
};

/** 当前时间 → 已开通的站点区间（浮点）：在相邻两个里程碑的 range 之间插值 */
const stationRangeAt = (t) => {
  const list = history.value;
  const n = list.length;
  if (!n || !geom) return null;
  if (n === 1) return list[0].range;
  const seg = t / UNIT;
  const i = Math.max(0, Math.min(n - 2, Math.floor(seg)));
  const f = Math.max(0, Math.min(1, seg - i));
  const a = list[i].range;
  const b = list[i + 1].range;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
};

/** 按当前时间把「已开通那一段」切出来，放进 cur 供 CallbackProperty 读取 */
const applyFrame = () => {
  if (!geom) {
    cur = [];
    return;
  }
  const r = stationRangeAt(currentTime.value);//在相邻里程碑的range之间插值 返回小数[18.6,23]

  if (!r) {
    cur = [];
    return;
  }

  let a = Math.max(0, Math.ceil(stationToCoord(r[0]))); //将小数站点下标18.6 映射到小数线路坐标213.4
  let b = Math.min(geom.nPt, Math.floor(stationToCoord(r[1])) + 1);
  // 折线至少要两个点才画得出来；区间极窄时补到两个
  if (b - a < 2) b = Math.min(geom.nPt, a + 2);
  if (b - a < 2) a = Math.max(0, b - 2);
  cur = geom.cart.slice(a, b);
};

const tick = (ts) => {
  if (!playing.value) return;
  if (!lastTs) lastTs = ts;
  // 按真实时间推进而不是「每帧 +0.1」：帧率掉到 9 的时候动画不会跟着变慢
  const dt = Math.min(0.1, (ts - lastTs) / 1000);//毫秒转换为秒级
  lastTs = ts;
  //currentTime.value  = ref（0）
  currentTime.value = Math.min(max.value, currentTime.value + dt * SPEED); //防止currentTime.value超过最大时间
  applyFrame();
  if (currentTime.value >= max.value) {
    playing.value = false;
    rafId = null;
    return;
  }
  rafId = requestAnimationFrame(tick);
};

const pause = () => {
  playing.value = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  lastTs = 0;
};

const play = () => {
  if (!geom || max.value <= 0) return;
  pause();
  // 已经播到头了再点播放 = 从头重播
  if (currentTime.value >= max.value) currentTime.value = 0;
  applyFrame();
  playing.value = true;
  rafId = requestAnimationFrame(tick);
};

const replay = () => {
  pause();
  currentTime.value = 0;
  applyFrame();
  play();
};

const teardownGrowth = () => {
  pause();
  const viewer = dataStore.Viewer;
  // 先摘实体再清 geom：CallbackProperty 还挂在实体上时不该让它读到空数组
  if (growthEntity) {
    if (viewer && !(viewer.isDestroyed && viewer.isDestroyed())) {
      viewer.entities.remove(growthEntity);
    }
    growthEntity = null;
  }
  geom = null;
  cur = [];
  currentTime.value = 0;
};

/**
 * 飞到配置好的入场视角。只在本次挂载里执行一次 —— 换线路不会再动相机。
 */
const flyToEntryView = (viewer) => {
  if (!ENTRY_VIEW) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      ENTRY_VIEW.lon,
      ENTRY_VIEW.lat,
      ENTRY_VIEW.height,
    ),
    orientation: {
      heading: Cesium.Math.toRadians(ENTRY_VIEW.heading),
      pitch: Cesium.Math.toRadians(ENTRY_VIEW.pitch),
      roll: Cesium.Math.toRadians(ENTRY_VIEW.roll),
    },
    duration: ENTRY_VIEW.duration ?? 1.6,
  });
};

/** 入场视角只飞一次：setupGrowth 在换线路时也会跑，不能被它带得每次都飞 */
let entryViewApplied = false;

const setupGrowth = () => {
  teardownGrowth();// 先清掉旧的生长实体
  const viewer = dataStore.Viewer;
  const line = currentLine.value;// 当前选中的线路
  if (!viewer || (viewer.isDestroyed && viewer.isDestroyed()) || !line) return;

  const g = buildGeometry(line);//{cart,map,nPt} //线数组 总数  站点对应的线路数组下标
  if (!g) return;
  geom = g;

  growthEntity = renderLines(viewer, {
    positions: line.positions,
    color: line.color,
    name: line.name,
    /*
     * 关掉「流动高亮段」，只留生长这一个动效。
     *
     * 为什么必须用 flowLength: 0 而不是 flowIntensity: 0：
     * polyGlowflow.glsl 里那一支是
     *     if (st.s > iTime && st.s < iTime + flowLength) {
     *         alpha = smoothstep(...);
     *         material.emission *= flowIntensity;   // 乘 0 = 把发射光清零
     *     }
     * 传 flowIntensity: 0 只会让那一截变成**黑带**（发光被乘成 0、alpha 反而拉满），
     * 而 flowLength: 0 让条件变成 `st.s > iTime && st.s < iTime`，永远不成立，
     * 整支不执行，才是真正的「没有流线」。
     *
     * 另外这条线在生长时流线本来也会变形：st.s 是**当前渲染出来的折线**上的归一化
     * 弧长，亮带的世界位置 = iTime × 当前长度，长度从 2 个站涨到 28 个站的过程中，
     * 同一时刻的亮带会被一路往外拽，看着像在窜。
     */
    flowLength: 0,
    /*
     * 关掉流线后线条会明显变暗变细 —— 平时那条线的亮度有相当一部分是流线的高亮段
     * 贡献的。这里把基础泛光补回来：
     *   glowPower  0.5  → 1.2  （横截面中心亮带的亮度）
     *   taperPower 0.05 → 0.5  （沿长度两端的锥形淡出；0.05 淡出得太狠，调到 0.5 更「实」）
     */
    glowPower: 1.2,
    taperPower: 0.5,
  });

  if (!growthEntity) {
    geom = null;
    return;
  }

  applyFrame();
  // isConstant = false 是整段动画的总开关：Cesium 会把它当**动态几何**，
  // 每帧重新取一次值，于是 cur 变长 → 顶点变多 → 线从已建成的一端长出去
  growthEntity.polyline.positions = new Cesium.CallbackProperty(() => cur, false);

  // 相机落到固定入场视角（只飞一次，换线路不再动它）
  if (!entryViewApplied && ENTRY_VIEW) {
    entryViewApplied = true;
    flyToEntryView(viewer);
  }

  // 14/15 号线只有 1 个里程碑（max = 0）：没有可播的过程，直接显示全线
  play();
};

/* ---------------- 全局 18 条线路的藏 / 还原 ---------------- */

/**
 * 进入栏目时记住每条全局线路原本的 show，离开时**逐条还原**。
 * 不能一律还原成 true：用户可能先在「线路图层」里关掉了几条，那样会被我们打开。
 */
const savedLineShow = new Map();

const hideGlobalLines = () => {
  lineEnts.forEach((entity) => {
    if (!savedLineShow.has(entity)) savedLineShow.set(entity, entity.show);
    entity.show = false;
  });
};

const restoreGlobalLines = () => {
  lineEnts.forEach((entity) => {
    if (savedLineShow.has(entity)) {
      entity.show = savedLineShow.get(entity);
      savedLineShow.delete(entity);
    }
  });
};

/**
 * 不能在 onMounted 里只藏一次：直接打开 /strategy 时，viewer 就绪、线路数据到位、
 * Toolbar 渲染出实体、面板挂载 这几件事的先后是不定的，实体可能是后出现的。
 * 跟着实体集合的长度变化补藏，immediate 顺便覆盖首次。
 */
watch(() => lineEnts.length, hideGlobalLines, { immediate: true });

/**
 * 线路数据到位、或 viewer 就绪、或更换了聚焦线路，就重建生长动画。
 *
 * 合并成一个 watch 是必要的：拆成 onMounted + 两个 watch 时，三者在挂载期会先后
 * 各触发一次，每次 setupGrowth 都会把 currentTime 归零重新起播，肉眼看到的是
 * 「动画刚开始又从头来」。
 */
watch([currentLine, () => dataStore.Viewer], setupGrowth, { immediate: true });

/**
 * 离开栏目：
 *   ① 取消 raf，并把私有实体连同它身上的 CallbackProperty 一起移除
 *      —— 它挂在 Cesium 的 entities 上、不在 Vue 的树里，路由切走不会自动清；
 *   ② 把 18 条全局线路还原成进入前的显示状态。
 *     不做第 ② 步的话，回首页会一条线都没有。
 */
onBeforeUnmount(() => {
  teardownGrowth();
  restoreGlobalLines();
});
</script>

<template>
  <Teleport to=".hud-canvas" defer>
    <Transition name="hp-pop">
      <div
        class="history-panel"
        :style="{ '--line-color': currentLine?.color ?? '#e2ba64' }"
      >
        <!-- ============ 左：线路 ============ -->
        <section class="hp-col hp-col-lines">
          <header class="hp-head">
            <span class="hp-title">地铁线路</span>
            <span class="hp-tag">{{ lines.length }} 条</span>
          </header>

          <div class="hp-body hp-body-lines">
            <button
              v-for="line in lines"
              :key="line.id"
              type="button"
              class="hp-line"
              :class="{ 'is-focus': line.name === currentLine?.name }"
              :title="`查看 ${line.short} 的建设历程`"
              @click="focusedLine = line.name"
            >
              <i class="hp-chip" :style="{ '--c': line.color }"></i>
              <span>{{ line.short }}</span>
            </button>
          </div>
        </section>

        <!-- ============ 右：建设历程 ============ -->
        <section class="hp-col hp-col-history">
          <header class="hp-head">
            <span class="hp-title">建设历程</span>
            <span class="hp-tag">
              {{ currentLine ? currentLine.short : '—' }} · {{ span }} ·
              {{ history.length }} 个节点
            </span>

            <span class="hp-actions">
              <button
                type="button"
                class="hp-icon"
                title="暂停"
                aria-label="暂停"
                @click="pause"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6.5" y="5" width="3.6" height="14" />
                  <rect x="13.9" y="5" width="3.6" height="14" />
                </svg>
              </button>
              <button
                type="button"
                class="hp-icon"
                :class="{ 'is-active': playing }"
                title="播放"
                aria-label="播放"
                @click="play"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5.2v13.6L19 12z" />
                </svg>
              </button>
              <button
                type="button"
                class="hp-icon"
                title="重新播放"
                aria-label="重新播放"
                @click="replay"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.9"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 12a8 8 0 1 1-2.6-5.9" />
                  <path d="M20.2 3.6v4.8h-4.8" />
                </svg>
              </button>
            </span>
          </header>

          <div v-if="!history.length" class="hp-empty">
            暂无该线路的建设历程数据
          </div>

          <div v-else class="hp-body hp-body-history">
            <!-- 时间轴：灰色轨道由每个节点自带的左右半段连线拼成（首节点的左半段、
                 末节点的右半段不画，两端正好齐平）；上面再压一条**连续**的填充条，
                 宽度跟着播放进度走，不再是按里程碑一段一段跳。 -->
            <ul
              class="hp-marks"
              :style="{ '--n': history.length, '--progress': progress }"
            >
              <span class="hp-track-fill" aria-hidden="true"></span>
              <li
                v-for="(mark, index) in history"
                :key="mark.date"
                class="hp-mark"
                :class="{
                  'is-done': index < currentIndex,
                  'is-current': index === currentIndex,
                  'is-pending': index > currentIndex,
                }"
                :title="`${mark.date} ${mark.text}`"
              >
                <i class="hp-dot"></i>
                <span class="hp-date">{{ mark.time }}</span>
              </li>
            </ul>

            <p v-if="currentMilestone" class="hp-message">
              <i class="hp-quote"></i>
              <span class="hp-msg-date">{{ currentMilestone.date }}</span>
              <span class="hp-msg-text">{{ currentMilestone.text }}</span>
            </p>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ================= 发展历程控制栏 =================
   与 StationPanel.vue 同一套外壳：Teleport 到 .hud-canvas（1920×1080 设计画布），
   所以这里写的 px 就是设计 px；位置与尺寸也保持一致，两个栏目互切时面板不跳。
   横向可用区是 x 422–1498（左右侧栏各占 422px），故宽度取 1040 居中。 */
.history-panel {
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

.hp-col {
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

.hp-col-lines {
  width: 31%;
  flex: none;
}

.hp-col-history {
  flex: 1;
}

/* ---- 头部 ---- */
.hp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 5px 10px;
  border-bottom: 1px solid rgba(226, 186, 100, 0.35);
  background: rgba(226, 186, 100, 0.07);
}

.hp-title {
  font-family: var(--font-scifi);
  font-size: 15px;
  letter-spacing: 0.16em;
  color: var(--color-gold-glow);
  white-space: nowrap;
}

.hp-tag {
  font-size: 13px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---- 播放控件（暂停 / 播放 / 重新播放）---- */
.hp-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
  flex: none;
}

.hp-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--color-gold);
  background: rgba(10, 22, 40, 0.85);
  border: 1px solid rgba(226, 186, 100, 0.4);
  cursor: pointer;
  transition: all 0.18s ease;
}

.hp-icon svg {
  width: 13px;
  height: 13px;
  fill: currentColor;
}

.hp-icon:hover {
  color: var(--color-cyan-glow);
  border-color: var(--color-cyan-glow);
  background: rgba(14, 38, 70, 0.92);
  box-shadow: 0 0 10px rgba(17, 239, 227, 0.4);
}

.hp-icon:active {
  transform: translateY(1px);
}

/* 正在播放时点亮播放键，一眼看出当前是「在走」还是「停住了」 */
.hp-icon.is-active {
  color: var(--color-cyan-glow);
  border-color: var(--color-cyan-glow);
  box-shadow: 0 0 10px rgba(17, 239, 227, 0.45);
}

/* ---- 列表体 ---- */
.hp-body {
  flex: 1;
  min-height: 0;
  /* 一屏装得下，按需求不出滚动条 */
  overflow: hidden;
  padding: 6px 8px;
}

.hp-body-lines {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px 6px;
  align-content: start;
}

/* ---- 线路行：整个按钮都是「切换右栏」的点击目标 ---- */
.hp-line {
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

.hp-line:hover {
  color: var(--color-cyan-glow);
}

.hp-line.is-focus {
  border-color: rgba(226, 186, 100, 0.85);
  background: rgba(226, 186, 100, 0.12);
}

.hp-line > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hp-chip {
  flex: none;
  width: 9px;
  height: 9px;
  background: var(--c, #e2ba64);
  box-shadow: 0 0 6px var(--c, #e2ba64);
}

/* ================= 右栏：时间轴 ================= */
.hp-body-history {
  display: flex;
  flex-direction: column;
  padding: 10px 12px 8px;
}

.hp-marks {
  position: relative;
  display: flex;
  align-items: flex-start;
  margin: 0;
  padding: 0;
  list-style: none;
  flex: none;
}

/* 连续填充条：从第一个圆点的圆心铺到「当前进度」处。
   两端按半个格宽内缩（半格 = 50% / n）—— 因为每个节点占 1/n 且圆点居中，
   第一个圆点圆心正好在 50%/n 处，最后一个在 100% - 50%/n 处。
   z-index 2 压住灰色轨道（标记的 ::before/::after）、又低于圆点（3）。 */
.hp-track-fill {
  position: absolute;
  z-index: 2;
  top: 5px;
  height: 2px;
  left: calc(50% / var(--n, 1));
  width: calc((100% - 100% / var(--n, 1)) * var(--progress, 0));
  background: var(--line-color);
  box-shadow: 0 0 6px var(--line-color);
  transition: width 0.08s linear;
}

.hp-mark {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

/* 节点左右各半段连线：相邻节点的两个半段接起来就是完整的一节轨道。
   首节点的左半段、末节点的右半段不画，轨道首尾正好落在两端的圆点上。 */
.hp-mark::before,
.hp-mark::after {
  content: '';
  position: absolute;
  top: 5px;
  height: 2px;
  background: rgba(136, 162, 190, 0.3);
}

.hp-mark::before {
  left: 0;
  right: 50%;
}

.hp-mark::after {
  left: 50%;
  right: 0;
}

.hp-mark:first-child::before,
.hp-mark:last-child::after {
  display: none;
}

/* 轨道基色只留灰的：亮起来的部分由上面那条连续的 .hp-track-fill 负责，
   这里不再按 is-done / is-current 给线段上色（否则会跟连续条打架、
   又变回一段一段跳）。节点的三态只作用在圆点和日期上。 */

.hp-dot {
  position: relative;
  z-index: 3;
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  box-sizing: border-box;
  background: #061020;
  border: 2px solid rgba(136, 162, 190, 0.55);
}

.hp-mark.is-done .hp-dot {
  background: var(--line-color);
  border-color: var(--line-color);
}

/* 当前节点：更大一圈 + 外发光 + 慢速呼吸，是整条轴上的视觉焦点 */
.hp-mark.is-current .hp-dot {
  width: 14px;
  height: 14px;
  margin-top: -1px;
  background: var(--color-gold-glow);
  border-color: #fff;
  box-shadow:
    0 0 0 3px rgba(252, 227, 138, 0.18),
    0 0 14px rgba(252, 227, 138, 0.9);
  animation: hp-pulse 1.9s ease-in-out infinite;
}

.hp-date {
  font-family: var(--font-scifi);
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.hp-mark.is-done .hp-date {
  color: var(--color-text-main);
}

.hp-mark.is-current .hp-date {
  color: var(--color-gold-glow);
  font-weight: 700;
}

/* ---- 里程碑描述 ---- */
.hp-message {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 6px 4px;
  padding: 8px 14px;
  background: rgba(17, 239, 227, 0.06);
  border: 1px solid rgba(17, 239, 227, 0.3);
  color: var(--color-text-main);
  font-size: 15px;
  line-height: 1.5;
}

/* 左侧青色竖条：把「这是当前读到的里程碑」和上面的圆点对起来 */
.hp-quote {
  position: absolute;
  left: -1px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: var(--color-cyan-glow);
  box-shadow: 0 0 8px rgba(17, 239, 227, 0.7);
}

.hp-msg-date {
  flex: none;
  font-family: var(--font-scifi);
  font-size: 14px;
  letter-spacing: 0.05em;
  color: var(--color-cyan-glow);
}

.hp-msg-text {
  min-width: 0;
}

.hp-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--color-text-muted);
}

@keyframes hp-pulse {
  0%,
  100% {
    box-shadow:
      0 0 0 3px rgba(252, 227, 138, 0.18),
      0 0 14px rgba(252, 227, 138, 0.9);
  }
  50% {
    box-shadow:
      0 0 0 5px rgba(252, 227, 138, 0.1),
      0 0 20px rgba(252, 227, 138, 0.55);
  }
}

/* ---- 出入场动画 ----
   Transition 与样式同处一个组件，作用域 id 必然对得上。 */
.hp-pop-enter-active {
  transition:
    opacity 0.22s ease,
    transform 0.26s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.hp-pop-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.hp-pop-enter-from,
.hp-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(14px) scale(0.97);
}
</style>
