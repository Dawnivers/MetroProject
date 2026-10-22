<script setup>
import { computed, markRaw, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as Cesium from 'cesium';
import { cesiumStore } from '@/stores/counter';
import { useLoadingState } from '@/stores/loadingState';
import { useToolbarState } from '@/stores/screenState';
import {
  renderLines,
  hideLineByName,
} from '@/cesiumTools/lineAndpoints/line/setlines';
import {
  renderStation,
  hideStationByName,
} from '@/cesiumTools/lineAndpoints/points/setpoints';
import {
  LINE_COLORS,
  TRANSFER_COLOR,
  shortLineName,
} from '@/config/lineAndStationStyle';
// 重点活动数据集：只用来知道「哪些站有光柱」，好让这些站的站点标记让位
import { activityOfLine } from '@/config/shmetroActivity';
import { useStationState } from '@/stores/stationState';
import SimpleLabel from '@/cesiumTools/lineAndpoints/popup/popup';
import HtmlMarkerManager from '@/cesiumTools/lineAndpoints/popup/popupManager';

const emit = defineEmits(['fullscreen']);

/**
 * 鼠标划过齿轮浮出的三个工具。本次只实现「线路图层管理」，
 * 另外两个先占位（ready: false → 点了不响应，只留提示）。
 * 图标本身是点击开合，选中后整个工具栏常驻（鼠标移开也不收）。
 */
const GEAR_TOOLS = [
  { key: 'mouse', title: '显示鼠标位置', ready: true },
  { key: 'layers', title: '线路图层管理', ready: true },
  { key: 'fullscreen', title: '全屏模型', ready: true },
];

const { activeTool, mouseToolOn, gearHover, popupPos } = useToolbarState();
/**
 * 「站点管理」/「重点活动」栏目的共享状态。
 * stationObjs 是两地共用的开关列表：本组件负责创建/移除对象，
 * 面板负责改 checked 并调用 hideStationByName 落到 show 上。
 *
 * stationMarkerMode / stationPopupOn 由路由推导：前者决定站点标记整体显示还是
 * 交给站点管理面板逐站控制，后者决定点标签要不要弹 queryTemplate 详情卡。
 */
const {
  stationMarkerMode,
  stationPopupOn,
  focusedStationLine,
  stationObjs,
  lineEnts,
} = useStationState();
const dataStore = cesiumStore();
const loading = useLoadingState();

/**
 * 开屏闸门：线路与站点实体都真正画进 viewer 了才算这一项完成。
 * 只看「数据到了」不够 —— renderLineEntities 还可能因为 viewer 未就绪而空转。
 */
const markEntitiesReady = () => {
  if (!viewer.value || !lines.value.length) return;
  const stationCount = lines.value.reduce(
    (n, l) => n + (l.stations?.length || 0),
    0,
  );
  loading.doneAsset(
    'entities',
    `${lines.value.length} 条线 / ${stationCount} 站`,
  );
};

/* ---------------- 线路图层栏（点「线路图层」工具后展开） ---------------- */

/** 线路图层栏：由「线路图层」这个工具是否被选中决定 */
const layersOpen = computed(() => activeTool.value === 'layers');

const lines = ref([]);
/**
 * 线路实体集合在 stores/stationState.js 里（lineEnts），本组件负责创建/移除实体，
 * 「发展历程」面板负责在栏目期间把它们藏起来、离开时还原。
 * 那里用 reactive 容器装元素、元素 markRaw —— 原因见该文件的注释。
 */

/* 站点特效的开关列表在 stores/stationState.js 里（stationObjs），
   本组件只负责往里放对象、以及删除时把它们摘掉。 */

/**
 * 站点特效参数（想调整体观感改这里即可）：
 *  - 普通站用所在线路的色块色，尺寸为基准值；
 *  - 换乘站用洋红，整体放大，并且「更躁」：流速更快、双能量带、亮度更高、呼吸更快。
 *
 * 观感细节全在 circleAndcone/cone.glsl（流动、呼吸、底亮），这里只管三类参数：
 * 尺寸（height / bottomRadius）、颜色、动效（flowSpeed / bandCount / beatSpeed / energy）。
 */
const STATION_CONF = {
  opacity: 1.0, // 光锥整体强度倍率，越小越淡
  normal: {
    height: 500,
    bottomRadius: 70,
    flowSpeed: 0.55, // 每秒走 0.55 个锥高：一条能量带约 1.8s 从底跑到顶
    bandCount: 1, // 单带向上
    beatSpeed: 1.0, // 呼吸 0.42Hz
    energy: 1.0,
  },
  // 换乘站用洋红，色值来自共享色板（与站点控制栏里的标记色同源）
  transfer: {
    height: 650,
    bottomRadius: 90,
    color: TRANSFER_COLOR,
    flowSpeed: 0.95, // 明显更快
    bandCount: 2, // 双带追赶，视觉密度翻倍
    beatSpeed: 1.6, // 呼吸节奏也快一档
    energy: 1.5, // 更亮，400 个站里一眼能挑出来
  },
};

/**
 * 站点悬浮窗（站名标签）参数。
 *  offset：相对站点投影点的像素偏移，[0, 正值] 表示往上抬，标签浮在光锥顶部之上。
 *  maxDistance：相机到站点的最大可见距离（米）。
 *
 *  这里量的**不是相机高度，而是相机到该站点的真实斜距**
 *  （popup.js 的 filterStructage 是 'distance'，见 popupManager 的 filterFactor）。
 *  两者差别很大：俯视时斜距≈高度，一旦相机斜看，边缘站点的斜距会是高度的两三倍。
 *
 *  历史值：12000（只够街区）→ 80000（够上海全城俯视）。
 *  2026-10-14 再抬到 150000 的原因：「重点活动」点线路时 flyTo 是按整条线取景的，
 *  线路越长相机拉得越高。实测 1 号线取景后相机高 4822m、到各站斜距 53.7~61.1km（<80km，可见）；
 *  而 11 号线（74.3km 长、还伸到花桥）取景后相机高 34786m、斜距 **83.5~98.2km**，
 *  整条线的标签被 80000 全数剔除 —— 表现为「切到长线路后站点全不见了」。
 *  150000 覆盖最坏情形（约 98km）并留余量；再远（球级视角）仍然会收，那是应该的。
 */
const POPUP_CONF = {
  offset: [0, 120],
  maxDistance: 150000,
  near: 2000,
  nearScale: 1.0,
  far: 80000,
  farScale: 0.6,
};

/**
 * 站点悬浮窗的统一管理器：整个 Toolbar 只建一个，内部共用一个 postRender
 * 监听器来更新所有标签的位置（比每个标签各挂一个监听器省一半以上开销）。
 * 用普通变量而不是 ref —— 它不参与模板渲染，也不该被响应式代理包住。
 *
 * 与站控措施的气泡管理器**分开**：那边自己 new 一个（同样是 1 个 postRender）。
 * 尝试过两边共享同一个实例，实测站点标签不再定位，浏览器桥又看不到 console、
 * 无法定位（HMR 双实例 / 真有 bug），所以先保持各自独立，待有 DevTools 再合并。
 */
let markerManager = null;

/** viewer 换了（或首次就绪）就重建管理器，旧的先销毁，避免监听器泄漏 */
const ensureMarkerManager = (viewer_) => {
  if (markerManager && markerManager.viewer === viewer_) return markerManager;
  markerManager?.destroy();
  markerManager = new HtmlMarkerManager(viewer_);
  return markerManager;
};

/**
 * 当前 viewer 的唯一来源：watch 仓库的 viewer，就绪后写入本地 ref。
 * 不能在 setup 里直接 `dataStore.Viewer` 快照——viewer 要等 cesiumView.vue
 * 的 onMounted 才 setViewer，那时本组件早已初始化完，快照到的永远是 null。
 */
const viewer = ref(null);
/**
 * positions（一维 [lng1,lat1,lng2,lat2,...]）不再从被截断的 xs/ys 本地解析，
 * 而是由 left1.vue 从 line1to18_2.json 的完整 coordinates 合并后随线路对象带入。
 */

/**
 * 把当前线路视图模型挂到三维场景上。
 * viewer 未就绪（或已销毁）时静默返回，等 viewer 的 watch 就绪后补渲染。
 */
const renderLineEntities = () => {
  const viewer_ = viewer.value;

  // 重渲染前先清掉上一批实体，避免「勾选开关」之类操作重复叠加
  lineEnts.forEach((entity) => {
    if (viewer_ && !(viewer_.isDestroyed && viewer_.isDestroyed())) {
      viewer_.entities.remove(entity);
    }
  });
  lineEnts.length = 0;

  if (!viewer_ || (viewer_.isDestroyed && viewer_.isDestroyed())) return;

  lines.value.forEach((line) => {
    // show 随 checked 走：重渲染后依然保持面板上的显隐状态
    const entity = renderLines(viewer_, { ...line, show: line.checked });
    // markRaw：装进响应式容器前先摘掉代理可能，否则 Cesium 按引用删除会静默失败
    if (entity) lineEnts.push(markRaw(entity));
  });
};

/**
 * 清掉上一批站点特效。
 * 光锥是 Primitive（挂在 scene.primitives），底圈是 Entity（挂在 viewer.entities），
 * 两者容器不同，必须分别移除。
 * 传进去的必须是**原始对象**：stationObjs 里的 Cesium 对象都做了 markRaw，
 * 一旦被响应式代理包住，Cesium 内部的 indexOf 就找不到对象，remove 会静默失败。
 */
const clearStationMarkers = () => {
  const viewer_ = viewer.value;
  const alive = viewer_ && !(viewer_.isDestroyed && viewer_.isDestroyed());
  if (alive) {
    stationObjs.forEach((item) => {
      if (item.conePrimitve) viewer_.scene.primitives.remove(item.conePrimitve);
      if (item.bottomCircleEntity) {
        viewer_.entities.remove(item.bottomCircleEntity);
      }
    });
  }
  // 悬浮窗不是 Cesium 对象：交给管理器统一移除 DOM 与标记登记
  // （removeAll 会逐个调用 mark.removeMarker()，并摘掉 postRender 监听器）
  markerManager?.removeAll();
  stationObjs.length = 0;
};

/**
 * 给每条线路的每个站点挂上「光锥 + 底圈」特效。
 * 坐标在站点对象的 xy_coords 里，是 "经度,纬度" 的文本，要先转成数字。
 * 同名站点只渲染一次：换乘站会同时出现在多条线路的 stationList 里。
 *
 * 这里只负责「造对象 + 登记到 stationObjs」，显示与隐藏由面板调用
 * hideStationByName 完成（与线路用 hideLineByName 是同一套写法）。
 */
const renderStationMarkers = () => {
  const viewer_ = viewer.value;
  clearStationMarkers();

  if (!viewer_ || (viewer_.isDestroyed && viewer_.isDestroyed())) return;

  // 按站名去重；只要有一条线把它标成换乘站，就按换乘站渲染
  const uniqueStations = new Map();
  lines.value.forEach((line) => {
    (line.stations ?? []).forEach((station) => {
      const key = station.name || station.xy_coords;
      if (!key) return;
      const isChange = Number(station.isChange) === 1;
      const exist = uniqueStations.get(key);
      if (!exist) {
        uniqueStations.set(key, { station, isChange, lineColor: line.color });
      } else if (isChange) {
        exist.isChange = true;
      }
    });
  });

  uniqueStations.forEach(({ station, isChange, lineColor }) => {
    const [lng, lat] = String(station.xy_coords ?? '')
      .split(',')
      .map((token) => Number(token.trim()));
    // 解析失败就跳过，避免把 (0,0) 之类的脏点画到几内亚湾
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    const size = isChange ? STATION_CONF.transfer : STATION_CONF.normal;
    // 普通站跟随线路色，换乘站用洋红
    const stationColor = isChange ? STATION_CONF.transfer.color : lineColor;

    const res = renderStation(viewer_, {
      positions: { lng, lat },
      color: stationColor,
      height: size.height,
      bottomRadius: size.bottomRadius,
      opacity: STATION_CONF.opacity,
      flowSpeed: size.flowSpeed,
      bandCount: size.bandCount,
      beatSpeed: size.beatSpeed,
      energy: size.energy,
      name: station.name,
    });
    if (!res) return;

    // 站名悬浮窗：坐标复用 renderStation 算好的世界坐标，不再二次换算。
    // 初始显隐直接跟随栏目状态，避免「栏目关着、标签先闪一帧」。
    // clickable: true —— 点标签弹出站点详情卡（queryTemplate）。以前这里是 false，
    // 因为当时查询气泡复用 MarkerTemplate，点了只会叠一个同样且关不掉的框；
    // 现在换成 queryTemplate 后可以点了。
    const label = new SimpleLabel(viewer_, {
      position: res.position,
      label: station.name,
      color: stationColor,
      attr: { name: station.name, isChange: isChange ? 1 : 0 },
      type: 'marker',
      offset: POPUP_CONF.offset,
      maxDistance: POPUP_CONF.maxDistance,
      scaleByDistance: new Cesium.NearFarScalar(
        POPUP_CONF.near,
        POPUP_CONF.nearScale,
        POPUP_CONF.far,
        POPUP_CONF.farScale,
      ),
      // 一律建为隐藏，显隐统一交给下面那个 watcher 落。
      // 这里不能写「mode==='all' 就可见」：创建时还不知道聚焦的是哪条线，
      // 那样会先把 400 个站全亮一帧，随后才被 watcher 收窄成一条线。
      isShow: false,
      // 由管理器的统一 postRender 更新位置，本标签不再自己挂监听器
      managedByManager: true,
      // 点站名标签 → 弹出 queryTemplate 详情卡（见 popup.js 的 showQueryPopup）
      clickable: true,
    });
    // addLabel 是异步的（动态 import 模板），这里不等：管理器会跳过尚未挂载 DOM 的标记
    label.addLabel();
    ensureMarkerManager(viewer_).addMarker(label);

    stationObjs.push({
      name: station.name || `${lng},${lat}`,
      checked: true,
      // forced：「线路全灭时被单独点亮」的标记，由 StationPanel 维护，这里只声明初值
      forced: false,
      // markRaw：Cesium 对象永不参与响应式代理，否则 remove() 会按引用查不到
      conePrimitve: markRaw(res.conePrimitve),
      bottomCircleEntity: markRaw(res.bottomCircleEntity),
      // 悬浮窗：同样 markRaw，且不要外泄给 Vue 模板
      popup: markRaw(label),
    });
  });

  // 这里**不再需要**任何「建完再藏一遍」的兜底：上面 isShow 已经是 false，
  // 而真正该亮的那些会在下一帧由下面的 watcher 统一点亮。
};

/**
 * 站点标记的显隐与可点击性：**整个应用里唯一落 show 的地方**（'panel' 模式除外）。
 *
 * 依赖三项都不能省：
 *   · stationObjs.length —— 线路数据到达时 renderStationMarkers 会把 stationObjs
 *     清空再重建，那一刻路由和聚焦线路都没变，只监听它们的话新对象不会被应用；
 *   · lines.length —— 同理，聚焦线路可能比线路数据先到（面板先挂载），
 *     数据到位后要再算一次「这条线有哪些站」；
 *   · focusedStationLine —— 「重点活动」里点另一条线，站点要跟着换。
 *
 * 'panel' 模式下**不动 show** —— 站点管理栏目里显隐是 StationPanel 按
 * checked + lineStationOn + forced 三个开关组合算出来的，这里再写一次会打架。
 */
watch(
  [
    stationMarkerMode,
    stationPopupOn,
    focusedStationLine,
    () => lines.value.length,
    () => stationObjs.length,
  ],
  ([mode, popupOn, lineName]) => {
    const allNames = stationObjs.map((item) => item.name);

    if (mode === 'all') {
      // 点亮当前聚焦线路的站点，但**有重点活动的那些站让位给光柱**：
      // 那个站已经有 3km 高的柱子在标了，再叠一个光锥 + 底圈 + 站名标签只会打架。
      // 判据直接取自活动数据集本身（与面板立光柱用的是同一份），不另存一份状态，
      // 这样「哪些站有柱子」和「哪些站被让位」永远是同一批。
      //
      // 线路名还没到（空串）或数据还没到时 on 为空，这时一个站都不点 ——
      // 宁可空一帧，也不要先闪一下别的线。
      const line = lines.value.find((item) => item.name === lineName);
      const activityStations = new Set(
        activityOfLine(shortLineName(lineName)).map((item) => item.station),
      );
      const on = (line?.stations ?? [])
        .map((station) => station.name)
        .filter((name) => !activityStations.has(name));
      const onSet = new Set(on);
      hideStationByName(stationObjs, on, true);
      hideStationByName(
        stationObjs,
        allNames.filter((name) => !onSet.has(name)),
        false,
      );
    } else if (mode === 'line') {
      // 线路轨迹（/realtime）：只点亮聚焦线路的站点，**不做活动站让位**。
      // 和 'all' 的唯一区别就在这里 —— 那个栏目里没有光柱，若沿用让位规则，
      // 有重点活动的几个站会凭空消失，面板站点栏的高亮就没有三维里的对照锚点。
      const line = lines.value.find((item) => item.name === lineName);
      const on = (line?.stations ?? []).map((station) => station.name);
      const onSet = new Set(on);
      hideStationByName(stationObjs, on, true);
      hideStationByName(
        stationObjs,
        allNames.filter((name) => !onSet.has(name)),
        false,
      );
    } else if (mode === 'none') {
      hideStationByName(stationObjs, allNames, false);
    }

    // 站名气泡的例外：「线路轨迹」栏目里一律不点站名。
    //
    // 上面两个分支点的是「站点标记」（光锥 + 底圈 + 气泡）三件套，但线路轨迹栏目
    // 的主角是列车和轨迹，站名序列由面板右栏那张四列站点表承担（还能点站跳转），
    // 三维里再铺一层站名只会压住轨道。重点活动（'all'）不同：那儿的站名是给
    // 3km 光柱当落点参照的，必须留着。
    //
    // 只关气泡、留着光锥 —— 面板里点站跳过去时，三维里仍然有可见的落点。
    // 注意必须放在三个分支之后：分支内部会先统一 setIsDisplay(true)，
    // 提前写会被覆盖。
    if (mode === 'line') {
      stationObjs.forEach((item) => {
        if (item.popup) item.popup.isDisplay = false;
      });
    }

    // 点击开关是运行时读的（见 popup.js 的 clickCallback），改这里立刻生效
    stationObjs.forEach((item) => {
      if (item.popup) item.popup.clickable = popupOn;
    });
  },
  { immediate: true },
);

/**
 * 线路图层列表：源数据由 left1.vue 请求 /getLine 并合并 json 完整坐标后写入仓库，
 * 这里同步成面板的视图模型（长度转数字、补色块、加本地勾选态）。
 */
watch(
  () => dataStore.Lines,

  (list) => {
    lines.value = (list || []).map((item, index) => ({
      id: item.id,
      name: item.name,
      length: Number(item.length) || 0,
      stations: item.stationList ?? [], // 站点对象数组（含 name / xy_coords / peopleFlow 等）
      color: LINE_COLORS[index % LINE_COLORS.length],
      positions: item.positions ?? [], // 完整坐标由 left1 从 line1to18_2.json 合并带入
      checked: true, // 线路显隐开关：同时驱动三维实体的 show
    }));

    renderLineEntities();
    renderStationMarkers();
    markEntitiesReady();
  },
  { immediate: true },
);

/**
 * 唯一的一次 viewer 获取：watch 仓库的 viewer，就绪后写入本地 ref 并补渲染。
 * viewer 要等 cesiumView.vue 的 onMounted 才 setViewer，而线路数据
 * （left1 的 /getLine）常常更早到达，所以这次补渲染是「数据先到、viewer 后到」的兜底。
 */
watch(
  () => dataStore.viewer,
  (v) => {
    viewer.value = v;
    // viewer 就绪后补渲染：数据先到、viewer 后到的场景下，
    // 数据那一次 watch 里 viewer_ 还是 null，什么都不会画；
    // 这里补一次才能把线路、站点特效与悬浮窗都画出来（两者都是「先清后建」，重复调用安全）
    if (v) {
      renderLineEntities();
      renderStationMarkers();
      markEntitiesReady();
    }
  },
  { immediate: true },
);

const allChecked = computed(
  () => lines.value.length > 0 && lines.value.every((line) => line.checked),
);

/** 「上海地铁1号线」→「1号线」的短名转换由 @/config/lineAndStationStyle 提供 */

/** 点击某条线路：切换面板勾选态，并把显示开关同步到对应的三维实体 */
const toggleLine = (line) => {
  line.checked = !line.checked;
  hideLineByName(lineEnts, [line.name], line.checked);
};

/** 全选 / 全不选：一次把所有线路的显示开关同步过去 */
const toggleAllLines = () => {
  const next = !allChecked.value;
  lines.value.forEach((line) => {
    line.checked = next;
  });
  hideLineByName(
    lineEnts,
    lines.value.map((line) => line.name),
    next,
  );
};

const gearRef = ref(null);
/** 齿轮按下的微动效（等价原 foot 里 pressedStyle('gear')，局部即可） */
const gearPressed = ref(false);

/** 鼠标离开热区后延迟收起的时长：留出从齿轮走到工具栏的时间 */
const HOVER_CLOSE_DELAY = 220;

/** 工具栏是否显示：① 鼠标在热区里；② 或有工具被选中 → 常驻 */
const gearOpen = computed(() => gearHover.value || activeTool.value !== null);

/**
 * 把弹层钉在齿轮按钮上方。
 * 弹层被 Teleport 到 .hud-canvas（1920×1080 设计画布），
 * 所以这里要把视口坐标换算回画布坐标，画布缩放时位置才跟着走。
 */
const syncPopupPos = () => {
  const canvas = document.querySelector('.hud-canvas');
  const gear = gearRef.value;
  if (!canvas || !gear) return;
  const canvasRect = canvas.getBoundingClientRect();
  const gearRect = gear.getBoundingClientRect();
  const scaleX = canvasRect.width / 1920 || 1;
  const scaleY = canvasRect.height / 1080 || 1;
  popupPos.value = {
    right: Math.max(12, (canvasRect.right - gearRect.right) / scaleX - 6),
    bottom: Math.max(12, (canvasRect.bottom - gearRect.top) / scaleY + 16),
  };
};

/** 点空白处 / 按 Esc：彻底收起（清掉选中态，常驻随之解除） */
const closeGearTools = () => {
  gearHover.value = false;
  activeTool.value = null;
};

/**
 * hover 只认「齿轮 + 工具栏」这片热区，两者之间有一小段空隙：
 * 鼠标穿过去时会先触发 mouseleave，所以不能立刻关，
 * 用「延迟关闭 + 回到热区即取消」的策略避免闪烁。
 */
let closeTimer = null;

const cancelClose = () => {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
};

/** 鼠标进入热区（齿轮或工具栏）：展开工具箱 */
const enterZone = () => {
  cancelClose();
  if (!gearOpen.value) syncPopupPos();
  gearHover.value = true;
};

/** 鼠标离开热区：延迟收起；若已有工具被选中则不受影响 */
const leaveZone = () => {
  gearPressed.value = false;
  cancelClose();
  closeTimer = setTimeout(() => {
    gearHover.value = false;
  }, HOVER_CLOSE_DELAY);
};

/**
 * 工具栏里的图标：点击展开 / 再次点击收起（不再用 hover 触发）。
 * 「显示鼠标位置」走共享的 mouseToolOn 开关；
 * 「全屏模型」是一次性动作，交由父组件 foot.vue 处理；
 * 其余是栏目型：选中后 activeTool 非空 → 整个工具栏常驻。
 */
const onToolClick = (tool) => {
  if (!tool.ready) return;
  cancelClose();
  if (tool.key === 'mouse') {
    mouseToolOn.value = !mouseToolOn.value;
    return;
  }
  if (tool.key === 'fullscreen') {
    emit('fullscreen');
    return;
  }
  activeTool.value = activeTool.value === tool.key ? null : tool.key;
};

/** 工具按钮的高亮：鼠标工具看开关状态，其余看是否被选中 */
const toolActive = (tool) =>
  tool.key === 'mouse' ? mouseToolOn.value : activeTool.value === tool.key;

/** 工具按钮的提示文案（鼠标工具带上当前开关状态） */
const toolTitle = (tool) => {
  if (tool.key === 'mouse') {
    return mouseToolOn.value
      ? '显示鼠标位置：已开启（点击隐藏）'
      : '显示鼠标位置：已隐藏（点击或按 ESC 重新显示）';
  }
  if (tool.key === 'fullscreen') return '全屏模型（隐藏大屏面板）';
  return tool.title;
};

/** 齿轮的按压缩放微动效 */
const pressDown = () => {
  gearPressed.value = true;
};
const pressUp = () => {
  gearPressed.value = false;
};

/** 点空白处收起（齿轮、工具箱、线路图层面板内部的点击不触发） */
const onDocMouseDown = (event) => {
  if (!gearOpen.value) return;
  const target = event.target;
  if (gearRef.value?.contains(target)) return;
  if (
    target instanceof Element &&
    target.closest('.gear-tools, .line-layer-panel')
  )
    return;
  closeGearTools();
};

const onDocKeydown = (event) => {
  if (event.key !== 'Escape') return;
  closeGearTools();
  // 鼠标皮肤被关掉后，ESC 是把它找回来的兜底入口（浮窗提示里也这么写）
  if (!mouseToolOn.value) mouseToolOn.value = true;
};

const onWindowResize = () => {
  if (gearOpen.value) syncPopupPos();
};

onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown);
  document.addEventListener('keydown', onDocKeydown);
  window.addEventListener('resize', onWindowResize);
});

onBeforeUnmount(() => {
  clearTimeout(closeTimer);
  document.removeEventListener('mousedown', onDocMouseDown);
  document.removeEventListener('keydown', onDocKeydown);
  window.removeEventListener('resize', onWindowResize);
  // 组件销毁时把挂上去的线路实体、站点特效一并撤掉，避免残留
  const v = viewer.value;
  if (v && !(v.isDestroyed && v.isDestroyed())) {
    lineEnts.forEach((entity) => v.entities.remove(entity));
  }
  lineEnts.length = 0;
  clearStationMarkers();
  // 管理器最后销毁：内部会摘掉 postRender 监听器、清空标记数组
  markerManager?.destroy();
  markerManager = null;
});
</script>

<template>
  <!-- 齿轮设置交互键：鼠标划过浮出工具箱（鼠标位置 / 线路图层 / 全屏模型） -->
  <button
    ref="gearRef"
    aria-label="设置"
    class="gear-icon-btn"
    :class="{ 'gear-active': gearOpen }"
    title="中枢参数配置"
    :style="gearPressed ? { transform: 'scale(0.96)' } : null"
    @mousedown="pressDown"
    @mouseup="pressUp"
    @mouseleave="leaveZone"
    @mouseenter="enterZone"
    @click="enterZone"
  >
    <svg fill="currentColor" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97 0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1 0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66Z"
      ></path>
    </svg>
  </button>

  <!-- ===== 齿轮工具箱：Teleport 到 1920×1080 设计画布 ===== -->
  <Teleport to=".hud-canvas" defer>
    <Transition name="gear-pop">
      <div
        v-if="gearOpen"
        class="gear-tools"
        :style="{
          right: `${popupPos.right}px`,
          bottom: `${popupPos.bottom}px`,
        }"
        @mouseenter="enterZone"
        @mouseleave="leaveZone"
      >
        <button
          v-for="(tool, index) in GEAR_TOOLS"
          :key="tool.key"
          type="button"
          class="gear-tool-btn"
          :class="{
            'is-active': toolActive(tool),
            'is-pending': !tool.ready,
          }"
          :style="{ '--i': index }"
          :title="toolTitle(tool)"
          :aria-label="tool.title"
          @click="onToolClick(tool)"
        >
          <!-- 显示鼠标位置 -->
          <svg
            v-if="tool.key === 'mouse'"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          >
            <path d="M6 3.2 18.6 10l-5.3 1.6L11 17z" />
          </svg>
          <!-- 线路图层管理 -->
          <svg
            v-else-if="tool.key === 'layers'"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          >
            <path d="M12 3.2 3.4 8 12 12.8 20.6 8z" />
            <path d="M3.4 12.4 12 17.2l8.6-4.8" />
            <path d="M3.4 16.4 12 21.2l8.6-4.8" />
          </svg>
          <!-- 全屏模型 -->
          <svg
            v-else
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M9.5 4.5H4.5v5M14.5 4.5h5v5" />
            <path d="M9.5 19.5H4.5v-5M14.5 19.5h5v-5" />
            <path d="M4.5 4.5 9 9M19.5 4.5 15 9" />
            <path d="M4.5 19.5 9 15M19.5 19.5 15 15" />
          </svg>
        </button>
      </div>
    </Transition>
  </Teleport>

  <!-- ===== 线路图层栏：工具箱左上方展开 ===== -->
  <Teleport to=".hud-canvas" defer>
    <Transition name="gear-panel">
      <div
        v-if="layersOpen"
        class="line-layer-panel"
        :style="{
          right: `${popupPos.right + 56}px`,
          bottom: `${popupPos.bottom}px`,
        }"
      >
        <div class="llp-head">
          <span class="llp-title">线路图层</span>
          <button
            type="button"
            class="llp-all"
            :class="{ checked: allChecked }"
            @click="toggleAllLines"
          >
            <span class="llp-check"></span>
            <span>全选</span>
          </button>
        </div>

        <div class="llp-body">
          <p v-if="!lines.length" class="llp-tip">暂无线路数据</p>
          <template v-else>
            <button
              v-for="(line, index) in lines"
              :key="line.id"
              type="button"
              class="llp-item"
              :class="{ checked: line.checked }"
              :style="{ '--i': index }"
              :title="`${line.name} · ${line.length.toFixed(1)}km · ${line.stations.length} 站`"
              @click="toggleLine(line)"
            >
              <span class="llp-chip" :style="{ '--chip': line.color }"></span>
              <span class="llp-name">{{ shortLineName(line.name) }}</span>
            </button>
          </template>
        </div>

        <p class="llp-foot">共 {{ lines.length }} 条 · 点击显示 / 隐藏线路</p>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 齿轮按钮交互 */
.gear-icon-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  outline: none;
  color: rgba(226, 186, 100, 0.7);
  transition:
    color 0.3s,
    transform 0.4s ease;
}

.gear-icon-btn:hover {
  color: var(--color-cyan-glow);
  transform: rotate(90deg);
}

/* 齿轮展开时的激活态（沿用原有 hover 的旋转） */
.gear-icon-btn.gear-active {
  color: var(--color-cyan-glow);
  transform: rotate(90deg);
}

/* ================= 齿轮工具箱 =================
   弹层被 Teleport 到 .hud-canvas，不再是 .foot-page 的后代，
   所以设计令牌要在它身上重新声明一份。 */
.gear-tools {
  position: absolute;
  z-index: 220;
  pointer-events: auto;
  transform-origin: 100% 100%;
  --color-gold: #e2ba64;
  --color-gold-glow: #fce38a;
  --color-cyan-glow: #11efe3;
  --color-text-main: #e2f1ff;
  --color-text-muted: #88a2be;
  --panel-border: rgba(226, 186, 100, 0.45);
  --font-scifi: 'Rajdhani', 'Noto Sans SC', sans-serif;
  --font-sans: 'Noto Sans SC', sans-serif;
  font-family: var(--font-sans);

  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  background: linear-gradient(
    180deg,
    rgba(9, 26, 50, 0.94),
    rgba(5, 11, 20, 0.96)
  );
  border: 1px solid var(--panel-border);
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.65),
    inset 0 0 14px rgba(11, 30, 56, 0.6);
  clip-path: polygon(
    8px 0,
    100% 0,
    100% calc(100% - 8px),
    calc(100% - 8px) 100%,
    0 100%,
    0 8px
  );
}

.gear-tool-btn {
  position: relative;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 22, 40, 0.85);
  border: 1px solid rgba(226, 186, 100, 0.45);
  color: var(--color-gold);
  cursor: pointer;
  outline: none;
  transition: all 0.22s ease;
  /* 逐个弹出的错峰动画，--i 由模板按索引写入 */
  animation: gear-tool-in 0.3s backwards cubic-bezier(0.175, 0.885, 0.32, 1.275);
  animation-delay: calc(var(--i, 0) * 70ms);
}

.gear-tool-btn svg {
  width: 18px;
  height: 18px;
}

.gear-tool-btn:hover {
  color: var(--color-cyan-glow);
  border-color: var(--color-cyan-glow);
  background: rgba(14, 38, 70, 0.92);
  box-shadow: 0 0 12px rgba(17, 239, 227, 0.35);
}

.gear-tool-btn.is-active {
  color: #03070e;
  background: linear-gradient(
    180deg,
    var(--color-gold-glow),
    var(--color-gold)
  );
  border-color: #ffd778;
  box-shadow: 0 0 14px rgba(252, 227, 138, 0.55);
}

/* 未实现的工具：压暗并禁用指针 */
.gear-tool-btn.is-pending {
  opacity: 0.5;
  cursor: not-allowed;
}

.gear-tool-btn.is-pending:hover {
  color: var(--color-gold);
  border-color: rgba(226, 186, 100, 0.45);
  background: rgba(10, 22, 40, 0.85);
  box-shadow: none;
}

@keyframes gear-tool-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.82);
  }
}

/* ---- 弹层出入场动画 ---- */
.gear-pop-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.24s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.gear-pop-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.gear-pop-enter-from,
.gear-pop-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.92);
}

/* ================= 线路图层栏 =================
   与 .gear-tools 一样被 Teleport 到 .hud-canvas，设计令牌需自带一份。 */
.line-layer-panel {
  position: absolute;
  z-index: 220;
  pointer-events: auto;
  transform-origin: 100% 100%;
  --color-gold: #e2ba64;
  --color-gold-glow: #fce38a;
  --color-cyan-glow: #11efe3;
  --color-text-main: #e2f1ff;
  --color-text-muted: #88a2be;
  --panel-border: rgba(226, 186, 100, 0.45);
  --font-scifi: 'Rajdhani', 'Noto Sans SC', sans-serif;
  --font-sans: 'Noto Sans SC', sans-serif;
  font-family: var(--font-sans);

  width: 178px;
  display: flex;
  flex-direction: column;
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
    10px 0,
    100% 0,
    100% calc(100% - 10px),
    calc(100% - 10px) 100%,
    0 100%,
    0 10px
  );
}

.llp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-bottom: 1px solid rgba(226, 186, 100, 0.35);
  background: rgba(226, 186, 100, 0.07);
}

.llp-title {
  font-family: var(--font-scifi);
  font-size: 11px;
  letter-spacing: 0.18em;
  color: var(--color-gold-glow);
}

.llp-all {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 11px;
  cursor: pointer;
  transition: color 0.2s;
}

.llp-all.checked {
  color: var(--color-cyan-glow);
}

.llp-check {
  width: 10px;
  height: 10px;
  border: 1px solid rgba(226, 186, 100, 0.6);
  background: transparent;
  transition: all 0.2s;
}

.llp-all.checked .llp-check {
  background: var(--color-gold);
  box-shadow: 0 0 8px rgba(252, 227, 138, 0.7);
}

.llp-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 268px;
  padding: 6px;
  overflow-y: auto;
}

.llp-body::-webkit-scrollbar {
  width: 4px;
}

.llp-body::-webkit-scrollbar-thumb {
  background: rgba(226, 186, 100, 0.45);
}

.llp-tip {
  margin: 0;
  padding: 10px 4px;
  font-size: 11px;
  text-align: center;
  color: var(--color-text-muted);
}

.llp-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid #885f12;
  color: var(--color-text-main);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
  outline: none;
  transition: all 0.2s ease;
  animation: llp-item-in 0.26s backwards ease-out;
  animation-delay: calc(var(--i, 0) * 26ms);
}

.llp-item:hover {
  border-color: #d8961a;
  background: rgba(255, 255, 255, 0.1);
}

.llp-item.checked {
  border-color: rgba(226, 186, 100, 0.85);
}

.llp-chip {
  flex: none;
  width: 10px;
  height: 10px;
  border: 1px solid var(--chip, #e2ba64);
  background: transparent;
  transition: all 0.2s ease;
}

.llp-item.checked .llp-chip {
  background: var(--chip, #e2ba64);
  box-shadow: 0 0 8px var(--chip, #e2ba64);
}

.llp-name {
  font-family: var(--font-scifi);
  letter-spacing: 0.08em;
}

.llp-foot {
  margin: 0;
  padding: 5px 8px;
  border-top: 1px solid rgba(226, 186, 100, 0.22);
  font-size: 10px;
  color: rgba(136, 162, 190, 0.85);
}

@keyframes llp-item-in {
  from {
    opacity: 0;
    transform: translateX(8px);
  }
}

/* ---- 弹层出入场动画（线路图层栏） ---- */
.gear-panel-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.24s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.gear-panel-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.gear-panel-enter-from,
.gear-panel-leave-to {
  opacity: 0;
  transform: translateX(12px) scale(0.96);
}
</style>
