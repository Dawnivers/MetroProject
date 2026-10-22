<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as Cesium from 'cesium';
import { cesiumStore } from '@/stores/counter';
import { useStationState } from '@/stores/stationState';
import { hideStationByName } from '@/cesiumTools/lineAndpoints/points/setpoints';
import {
  LINE_COLORS,
  TRANSFER_COLOR,
  shortLineName,
} from '@/config/lineAndStationStyle';
import QueryModePanel from './QueryModePanel/QueryModePanel.vue';

/**
 * 「站点管理」栏目：左栏选线路，右栏是这条线的站点。
 *
 * 显隐的落点与线路完全对称：
 *   线路 —— lineEnts(线路实体，存在 stores/stationState.js) + setlines.js 的
 *           hideLineByName(entities, names, isShow)
 *   站点 —— stationObjs(站点开关列表) + setpoints.js 的 hideStationByName(stations, names, isShow)
 * 点击时改自己的 checked，然后把这个动作落到三维对象的 show 上；只切 show，不销毁对象。
 *
 * stationObjs 与 Toolbar.vue 共用（对象在那边创建），面板只管改它的 checked。
 */

const dataStore = cesiumStore();
const { stationObjs, lineStationOn, stationMarkerMode } = useStationState();

/** 右栏正在查看的线路（面板本地状态，重新进入栏目会回到第一条线） */
const focusedLine = ref(null);

/** 线路视图模型：色块按索引从共享色板取，与三维里的光锥颜色同源 */
const lines = computed(() =>
  (dataStore.Lines || []).map((item, index) => ({
    id: item.id,
    name: item.name,
    short: shortLineName(item.name),
    color: LINE_COLORS[index % LINE_COLORS.length],
    stations: item.stationList ?? [],
  })),
);

/** 数据到位后默认聚焦第一条线，用户不点也不会出现空面板 */
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

/** 站名 → 开关对象（换乘站只有一份，多条线共用同一个开关） */
const stationByName = computed(
  () => new Map(stationObjs.map((item) => [item.name, item])),
);

/**
 * 站名 → 拥有它的线路名集合，由线路数据现算。
 * 换乘站（如人民广场属于 1/2/8 号线）在三维里只画一个光锥，
 * 所以判断它该不该显示必须看「全部业主线路」，不能只看当前浏览的那条。
 */
const stationOwners = computed(() => {
  const map = new Map();
  lines.value.forEach((line) => {
    line.stations.forEach((station) => {
      if (!station.name) return;
      const owners = map.get(station.name);
      if (owners) {
        if (!owners.includes(line.name)) owners.push(line.name);
      } else {
        map.set(station.name, [line.name]);
      }
    });
  });
  return map;
});

/** 这个站所属的线路里，有没有至少一条是亮着的（没设过＝灭） */
const anyOwnedLineOn = (name) =>
  (stationOwners.value.get(name) ?? []).some((n) => lineStationOn[n] === true);

/** 清掉这些站点上「单站开口子」的临时标记（线路开关一动，就交还给线路管） */
const clearForced = (stations = []) => {
  stations.forEach((station) => {
    const target = stationByName.value.get(station.name);
    if (target) target.forced = false;
  });
};

/**
 * 站点是否可见 = 它自己的开关开着 && 所属线路里至少有一条开着。
 *
 * 两个条件缺一不可，这是本面板的核心规则：
 *   - 只有站点开关 → 关 4 号线会把它和 3 号线共用的站也写成熄灭，
 *     导致 3 号线的站被连带关掉（就是这个 bug）；
 *   - 只有线路开关 → 没法单独关掉某一个站。
 * 分开存、组合算，两边就互不干扰了：
 *   关掉 4 号线只是把 4 号线那份开关置灭，
 *   共站因为 3 号线还开着，依然可见。
 *
 * forced 是给「线路全灭时想单独点亮某一个站」用的第三个开关：
 * 没有它的话，那个站无论 checked 是什么都亮不起来 —— 线路开关是否决项。
 *
 * 线路开关的默认值是「灭」（lineStationOn 里没这个键就算 false）：
 * 进入站控措施时默认一个站点都不显示，由用户逐个点亮，或点「全部显示」。
 */
const isVisible = (name) => {
  const target = stationByName.value.get(name);
  if (!target || target.checked === false) return false;
  // 被单独点亮的站绕开线路开关，这是它唯一的作用范围
  if (target.forced === true) return true;
  const owners = stationOwners.value.get(name) ?? [];
  return owners.length === 0 || owners.some((n) => lineStationOn[n] === true);
};

/**
 * 这条线路是否「亮着」—— 只认它自己的那份线路开关，不拿站点标志位反推。
 *
 * 为什么不能反推：站点被多条线路共享，全部熄灭时点亮 1 号线，会让
 * 2/3/8 号线「还有亮的站」也成立，一整片行跟着亮 —— 而那几条线用户根本没点。
 * （反向的 every 判定同样会连坐。）行状态只认自己的开关，才不会互相牵连。
 */
const lineLit = (line) => lineStationOn[line.name] === true;

/** 把当前两份开关算出的结果整体落到三维对象上 */
const syncAll = () => {
  const on = [];
  const off = [];
  stationObjs.forEach((item) => {
    (isVisible(item.name) ? on : off).push(item.name);
  });
  hideStationByName(stationObjs, on, true);
  hideStationByName(stationObjs, off, false);
};

/**
 * 点线路左边的方形勾选框：亮着的整条熄灭，灭着的整条亮起。
 *
 * 这里**只动线路开关**，不碰任何站点的 checked —— 碰了就会连带改到别的线路
 * 共用的站（关 4 号线把 3 号线的共站一起关掉）。可见性交给 syncAll 重新组合。
 *
 * 注意：这里不切换右栏。切线路是「点线路名字」的事（见模板里的 sp-line-name）。
 */
const toggleLine = (line) => {
  lineStationOn[line.name] = !lineLit(line);
  // 线路开关一动，这条线的站点就重新归线路管，清掉单站开口子的临时状态。
  // 不清的话，关闭线路后那个被单独点亮的站会「关不掉」。
  clearForced(line.stations);
  syncAll();
};

/**
 * 点击站点后相机的落位：相机高度 height 米、俯仰 pitch 度。
 * 想调「飞过去之后站得多高、多斜」改这里即可。
 */
const FLY_TO_STATION = { height: 2200, pitch: -50, duration: 1.6 };

/**
 * 把相机飞到某个站点上方，并让该站点落在视野中心。
 *
 * 注意**不能**把相机直接放在站点正上方：那样站点投影落在视野下边缘之外
 * （实测 pitch -50° 时视线与天底夹角 40° > Cesium 默认垂直半视角 30°，
 * 结果是面板显示「1/28 显示」但三维里一个站点标签都看不到）。
 * 正确做法是沿 heading 的反方向后退 d 米，d = 高度 / tan(俯角)，
 * 相机从斜上方看向目标，目标正好居中。
 */
const flyToStation = (target) => {
  const viewer = dataStore.Viewer;
  // SimpleLabel 上存的 position 就是这个站点的世界坐标，不用再查经纬度
  const position = target?.popup?.position;
  if (!viewer || !position) return;
  const carto = Cesium.Cartographic.fromCartesian(position);
  if (!carto) return;

  const heading = viewer.camera.heading;
  const pitch = Cesium.Math.toRadians(FLY_TO_STATION.pitch);
  const height = FLY_TO_STATION.height;
  const back = height / Math.tan(-pitch); // 视线俯角下看得见地面目标的后退距离

  // 在目标的 ENU 坐标系里摆相机：x=东、y=北、z=上，水平分量取 heading 的反方向
  const ground = Cesium.Cartesian3.fromRadians(
    carto.longitude,
    carto.latitude,
    0,
  );
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(ground);
  const offset = new Cesium.Cartesian3(
    -back * Math.sin(heading),
    -back * Math.cos(heading),
    height,
  );
  const destination = Cesium.Matrix4.multiplyByPoint(
    enu,
    offset,
    new Cesium.Cartesian3(),
  );

  viewer.camera.flyTo({
    destination,
    duration: FLY_TO_STATION.duration,
    orientation: { heading, pitch, roll: 0 },
  });
};

/**
 * 点站点块：单独开关这一个站点。
 * 若它当前不可见（可能是自己的开关关了，也可能是所属线路都灭了），
 * 点一下就是「让它亮起来」—— 同时把相机飞到它正上方，并弹出它的详情卡。
 * 已经亮着的再点一下则熄灭，并把它那张详情卡一起收掉。
 *
 * 线路全灭时**不能**顺手把整条线点亮：线路灭着的时候，站点的 checked
 * 还都是 true，线路开关一开，整条线的站就全跟着亮起来 —— 点一个站亮一条线。
 * 正确做法是只给这一个站打 forced 标记，让它单独绕开线路开关。
 */
const toggleStation = (station) => {
  const target = stationByName.value.get(station.name);
  if (!target) return;

  if (isVisible(station.name)) {
    target.checked = false;
    target.forced = false;
    // 站点灭了卡片不能留着，否则会有一张卡悬在空地上
    target.popup?.removeQueryPopup?.();
    syncAll();
    return;
  }

  target.checked = true;
  // 所属线路还有亮着的，靠线路开关就够了；全灭时才需要单独开口子
  target.forced = !anyOwnedLineOn(station.name);
  syncAll();

  // 点亮之后：相机飞过去 + 弹出该站的详情卡
  // （popup 是 Toolbar 建标记时一起存进来的 SimpleLabel 实例）
  flyToStation(target);
  target.popup?.showQueryPopup?.();
};

/**
 * 全部显示：只给「站点 + 基础站点气泡」，**不弹详情卡**。
 * 所以先把所有已打开的详情卡收掉 —— 否则 400 个站的 queryTemplate
 * 会一起涌出来。
 */
const onShowAll = () => {
  stationObjs.forEach((item) => item.popup?.removeQueryPopup?.());
  stationObjs.forEach((item) => {
    item.checked = true;
    // 全开了就不需要单站开口子，清掉免得留下不一致的残留状态
    item.forced = false;
  });
  lines.value.forEach((line) => {
    lineStationOn[line.name] = true;
  });
  syncAll();
};

/**
 * 全部隐藏：只关线路开关，**不动站点的 checked**。
 * 站点开关记的是「这个站我想不想看」的个人意图，不该被一次批量操作抹掉；
 * 线路全灭之后它们本来就都不可见。
 *
 * 但 forced 必须清掉：它是「绕开线路开关也要亮」的例外，
 * 留着的话「全部隐藏」会藏不干净被单独点亮过的站。
 */
const onHideAll = () => {
  // 站点都藏了，详情卡当然也要一起收掉
  stationObjs.forEach((item) => item.popup?.removeQueryPopup?.());
  lines.value.forEach((line) => {
    lineStationOn[line.name] = false;
  });
  stationObjs.forEach((item) => {
    item.forced = false;
  });
  syncAll();
};

/**
 * 进入栏目：默认**不显示任何站点**。
 * 先把线路总闸全关、单站口子全清，再落到三维上；
 * 之后由用户点某个站（只亮它一个 + 相机飞过去 + 弹详情卡）或点「全部显示」。
 *
 * 退出不需要本组件操心：进入本栏目时只收起左右侧栏，foot.vue 的底部导航
 * 一直在，再点一次「站点管理」就回首页路由了。
 */
onMounted(() => {
  lines.value.forEach((line) => {
    lineStationOn[line.name] = false;
  });
  stationObjs.forEach((item) => {
    item.forced = false;
  });
  syncAll();
});

/**
 * 离开栏目：
 *   ① 销毁所有详情卡（queryTemplate）—— 卡片挂在 viewer.cesiumWidget.container
 *      下、不在 HUD 里，路由切走不会跟着卸载，不主动收就会一直飘在新页面上；
 *      removeQueryPopup 会连 DOM 和它自己那个 postRender 监听一起摘掉。
 *   ② 再隐藏全部站点。站点光锥/底圈只是切 show，一个对象都没销毁。
 */
onBeforeUnmount(() => {
  stationObjs.forEach((item) => item.popup?.removeQueryPopup?.());

  // 切去「重点活动」时**不要**收站点：那个栏目要站点当背景图层，
  // 显隐已由 Toolbar 按路由统一落（stationMarkerMode 变成 'all'）。
  // 必须挡这一下，是因为本组件的 unmount 晚于新面板的 mount 执行，
  // 不挡的话刚显示的站点会被这里又收掉，且之后没有任何东西会再触发一次显示。
  // 路由此刻已经切完，所以直接看当前模式即可。
  if (stationMarkerMode.value === 'all') return;

  hideStationByName(
    stationObjs,
    stationObjs.map((item) => item.name),
    false,
  );
});

/** 当前线路的勾选数量，用于头部计数 */
const visibleCount = computed(() => {
  const line = currentLine.value;
  if (!line) return 0;
  return line.stations.filter((s) => isVisible(s.name)).length;
});
</script>

<template>
  <Teleport to=".hud-canvas" defer>
    <Transition name="sp-pop">
      <div class="station-panel" :style="{ '--transfer-color': TRANSFER_COLOR }">
        <!-- ============ 左：线路 ============ -->
        <section class="sp-col sp-col-lines">
          <header class="sp-head">
            <span class="sp-title">地铁线路</span>
            <span class="sp-tag">{{ lines.length }} 条</span>
          </header>

          <div class="sp-body sp-body-lines">
            <!-- 一行里两个各自独立的点击目标：
                   · 左边的方形勾选框 = 只负责这条线站点的亮 / 灭
                   · 线路名字           = 只负责把右栏切到这条线，不动显隐 -->
            <div
              v-for="line in lines"
              :key="line.id"
              class="sp-line"
              :class="{
                'is-focus': line.name === currentLine?.name,
                'is-on': lineLit(line),
              }"
            >
              <button
                type="button"
                class="sp-check"
                :class="{ on: lineLit(line) }"
                :title="
                  lineLit(line)
                    ? `熄灭 ${line.short} 全部站点`
                    : `点亮 ${line.short} 全部站点`
                "
                @click.stop="toggleLine(line)"
              ></button>
              <button
                type="button"
                class="sp-line-name"
                :title="`查看 ${line.short} 的站点`"
                @click="focusedLine = line.name"
              >
                <i class="sp-chip" :style="{ '--c': line.color }"></i>
                <span>{{ line.short }}</span>
              </button>
            </div>
          </div>
        </section>

        <!-- ============ 右：站点 ============ -->
        <section class="sp-col sp-col-stations">
          <header class="sp-head">
            <span class="sp-title">地铁站点</span>
            <span class="sp-tag">
              {{ currentLine ? currentLine.short : '—' }} ·
              {{ visibleCount }}/{{ currentLine?.stations.length ?? 0 }} 显示
            </span>
            <span class="sp-actions">
              <button type="button" @click="onShowAll">全部显示</button>
              <button type="button" @click="onHideAll">全部隐藏</button>
            </span>
          </header>

          <div v-if="!currentLine" class="sp-empty">暂无线路数据</div>
          <div v-else class="sp-body sp-body-stations">
            <button
              v-for="(station, index) in currentLine.stations"
              :key="`${station.name}-${index}`"
              type="button"
              class="sp-station"
              :class="{
                off: !isVisible(station.name),
                transfer: Number(station.isChange) === 1,
              }"
              :title="`${station.name}${Number(station.isChange) === 1 ? '（换乘站）' : ''}`"
              @click="toggleStation(station)"
            >
              <i class="sp-dot"></i>
              <span class="sp-st-name">{{ station.name }}</span>
            </button>
          </div>
        </section>
      </div>
    </Transition>

    <!-- 左上角的查询模式选择：目前只有「站点拥挤度」接入了热力图，
         热力图实例的生命周期完全关在这个组件里（切模式 / 卸载时销毁） -->
    <QueryModePanel />
  </Teleport>
</template>

<style scoped>
/* ================= 站点控制栏 =================
   被 Teleport 到 .hud-canvas（1920×1080 设计画布），
   所以这里的 px 就是设计 px，不需要再乘 .foot-page 的 zoom。
   可用横向区间实测为 x 422–1498（两侧栏各占 422px），故宽度取 1040 居中。 */
.station-panel {
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

.sp-col {
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

.sp-col-lines {
  width: 31%;
  flex: none;
}

.sp-col-stations {
  flex: 1;
}

/* ---- 头部 ---- */
.sp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 5px 10px;
  border-bottom: 1px solid rgba(226, 186, 100, 0.35);
  background: rgba(226, 186, 100, 0.07);
}

.sp-title {
  font-family: var(--font-scifi);
  font-size: 15px;
  letter-spacing: 0.16em;
  color: var(--color-gold-glow);
  white-space: nowrap;
}

.sp-tag {
  font-size: 13px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sp-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
  flex: none;
}

.sp-actions button {
  padding: 2px 9px;
  background: rgba(10, 22, 40, 0.85);
  border: 1px solid rgba(226, 186, 100, 0.4);
  color: var(--color-gold);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.sp-actions button:hover {
  color: var(--color-cyan-glow);
  border-color: var(--color-cyan-glow);
  background: rgba(14, 38, 70, 0.92);
}

/* ---- 列表体 ---- */
.sp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 8px;
}

.sp-body::-webkit-scrollbar {
  width: 5px;
}

.sp-body::-webkit-scrollbar-thumb {
  background: rgba(226, 186, 100, 0.45);
}

.sp-body-lines {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px 6px;
  align-content: start;
}

.sp-body-stations {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 5px;
  align-content: start;
}

/* ---- 线路行：一行里两个独立点击目标 ----
   左边方形 = 显隐开关；名字 = 切换右栏。两者互不影响。 */
.sp-line {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 1px 3px;
  border: 1px solid transparent;
  color: var(--color-text-main);
  font-family: var(--font-scifi);
  font-size: 14px;
  letter-spacing: 0.05em;
  white-space: nowrap;
  transition: all 0.18s ease;
}

.sp-line.is-focus {
  border-color: rgba(226, 186, 100, 0.85);
  background: rgba(226, 186, 100, 0.12);
}

/* 整条线熄灭时，线路名和色块一起压暗 —— 与三维里的「亮起 / 熄灭」对应 */
.sp-line:not(.is-on) .sp-line-name {
  opacity: 0.42;
}

.sp-line:not(.is-on) .sp-chip {
  opacity: 0.35;
  box-shadow: none;
}

/* 显隐开关：14px 有点小，所以补一个 hover 高亮，让它一眼看出可点 */
.sp-check {
  flex: none;
  width: 14px;
  height: 14px;
  padding: 0;
  background: transparent;
  border: 1px solid rgba(226, 186, 100, 0.6);
  cursor: pointer;
  transition: all 0.18s ease;
}

.sp-check:hover {
  border-color: var(--color-cyan-glow);
  box-shadow: 0 0 8px rgba(17, 239, 227, 0.55);
}

.sp-check.on {
  background: var(--color-gold);
  box-shadow: 0 0 8px rgba(252, 227, 138, 0.7);
}

/* 线路名：只负责把右栏切到这条线 */
.sp-line-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  transition: color 0.18s ease;
}

.sp-line-name:hover {
  color: var(--color-cyan-glow);
}

.sp-chip {
  flex: none;
  width: 9px;
  height: 9px;
  background: var(--c, #e2ba64);
  box-shadow: 0 0 6px var(--c, #e2ba64);
}

/* ---- 站点块 ---- */
.sp-station {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: 3px 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(226, 186, 100, 0.55);
  color: var(--color-text-main);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.sp-station:hover {
  border-color: var(--color-cyan-glow);
  background: rgba(17, 239, 227, 0.12);
}

/* 换乘站用共享色板里的洋红，与三维里的光锥同源 */
.sp-station.transfer {
  border-color: var(--transfer-color, #ff2bd1);
}

/* 被隐藏的站点：压暗 + 虚线框，一眼看出当前哪些没显示 */
.sp-station.off {
  opacity: 0.38;
  border-style: dashed;
  border-color: rgba(136, 162, 190, 0.6);
}

.sp-dot {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-gold);
}

.sp-station.transfer .sp-dot {
  background: var(--transfer-color, #ff2bd1);
  box-shadow: 0 0 6px var(--transfer-color, #ff2bd1);
}

.sp-st-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sp-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--color-text-muted);
}

/* ---- 出入场动画 ----
   Transition 与样式同处一个组件，作用域 id 必然对得上。 */
.sp-pop-enter-active {
  transition:
    opacity 0.22s ease,
    transform 0.26s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.sp-pop-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.sp-pop-enter-from,
.sp-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(14px) scale(0.97);
}
</style>
