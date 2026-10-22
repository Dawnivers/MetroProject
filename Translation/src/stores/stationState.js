import { computed, reactive, ref } from 'vue';
import router from '@/router';

/**
 * 底部栏目面板与三维场景之间的共享状态。
 *
 * 为什么需要共享：站点特效 / 线路实体都在 Toolbar.vue 里创建，控制它们的面板却由
 * 路由渲染（/nodes → StationPanel.vue、/strategy → historyPanel.vue）。
 * 两边要读写同一份对象，所以把它们提到这里，两边都从 useStationState() 取。
 *
 * 这里只存对象本身，不存显隐规则：
 *   · 站点显隐由 setpoints.js 的 hideStationByName(stations, names, isShow) 落到对象上；
 *   · 线路显隐由 setlines.js 的 hideLineByName(entities, names, isShow) 落到对象上。
 * 两者是同一套写法。
 */

/** 当前路由。三个开关都从它推导，避免各自维护布尔量导致「路由跳走了、开关还开着」 */
const routePath = computed(() => router.currentRoute.value.path);

/**
 * 「站点管理」栏目是否展开 = 当前路由是不是 /nodes。
 * 它管的是**收不收左右大屏侧栏**和底栏罗盘的位置，与站点显不显示是两件事
 * （见下面的 stationMarkerMode）：这样「重点活动」栏目才能做到
 * 「站点照常显示、但侧栏不收」。
 */
const stationPanelOpen = computed(() => routePath.value === '/nodes');

/**
 * 站点标记（光锥 + 底圈 + 站名标签）的显示模式。三个值：
 *
 *   'panel' —— 在「站点管理」栏目里：显隐归 StationPanel 的开关组合
 *              （checked + lineStationOn + forced）管，Toolbar 不插手；
 *   'all'   —— 在「重点活动」栏目里：**只显示 focusedStationLine 这一条线的站点**，
 *              给重点保障光柱当落点参照；有重点活动的站让位给光柱，不点亮；
 *   'line'  —— 在「线路轨迹」栏目里：同样只显示 focusedStationLine 这一条线，
 *              但**不做让位**（那个栏目没有光柱，减掉几个站会让面板的
 *              站点栏高亮在三维里找不到对照）；
 *   'none'  —— 其余路由：全灭。
 *
 * 为什么是「一条线」而不是「全部站点」：全部 400 站在城视下是 346 个彩色标签铺满全屏，
 * 光柱直接被淹没；实测同一路由帧率还从 69 掉到 30 FPS（大头是 400 个光锥 Primitive
 * 的绘制开销，不是标签 DOM）。收窄到一条线之后两个问题一起没了。
 *
 * 为什么不让「重点活动」直接复用 stationPanelOpen：那会连坐把左右大屏侧栏收起来，
 * 而这两个栏目对侧栏的要求正好相反（站点管理收起、重点活动保留）。
 */
const stationMarkerMode = computed(() => {
  if (routePath.value === '/nodes') return 'panel';
  if (routePath.value === '/experiment') return 'all';
  if (routePath.value === '/realtime') return 'line';
  return 'none';
});

/**
 * 「重点活动」栏目当前聚焦的线路**全名**（如 '上海地铁11号线'）。
 *
 * 由 ActivePanel 在切线路时写、Toolbar 读：'all' 模式下只点亮这条线的站点。
 * 空串 = 还没选（此时一个站都不点，避免刚进栏目先闪一下别条线的站点）。
 *
 * 放在 store 而不是留在面板里，是因为**显示的唯一执行者是 Toolbar** ——
 * 面板负责「说要看哪条线」，Toolbar 负责落 show，这样才不会出现两个组件
 * 各写一半、互相覆盖的情况（StationPanel 退场与新面板挂载的先后顺序问题就是这么来的）。
 */
const focusedStationLine = ref('');

/**
 * 站点标签点击是否弹 queryTemplate 详情卡。
 *
 * 只有「站点管理」栏目要：那个栏目里站是用户逐个挑出来看的，点了就该出详情。
 * 「重点活动」栏目里站点是背景图层，几百个标签全可点只会误触，所以关掉。
 */
const stationPopupOn = computed(() => routePath.value === '/nodes');

/**
 * 站点特效开关列表，由 Toolbar.vue 渲染时写入，每项形如：
 *   { name, checked, conePrimitve, bottomCircleEntity }
 *
 * 用 reactive 数组是为了让 checked 的变化能驱动面板重渲染；
 * 但里面装的两个 Cesium 对象必须先 markRaw —— 否则它们会被包成响应式代理，
 * 而 Cesium 的 remove() 是按引用查找的，传代理进去会静默返回 false，
 * 造成「删不掉、每次重渲染多堆 400 个幽灵特效」。这一点已实测确认过。
 */
const stationObjs = reactive([]);

/**
 * 线路级开关：线路名 → 该线路的站点是否亮着（**缺省视为灭**）。
 *
 * 「缺省灭」就是站控措施的初始状态：进入栏目时一个站点都不显示，
 * 由用户逐个点亮，或点「全部显示」（它会把它们写成 true）。
 * 因此判断必须写 `=== true`，不能写 `!== false`，否则没设过的键会被当成亮。
 *
 * 为什么必须单独存一份，而不能用「这条线的站点里还有亮的」反推行状态：
 * 换乘站只有一份开关，被多条线路共享。全部熄灭时点亮 1 号线，会同时把
 * 人民广场这类共站置亮，于是 2/3/8 号线的「还有亮的站」也成立，行跟着亮起来
 * —— 实测 18 行里会跟着亮一大片，而那几条线用户根本没点。
 * 行状态只认这份线路自己的开关，就能做到「只亮被点的那一条」。
 *
 * 它同时也决定了点击行为：亮着 → 整条熄灭，灭着 → 整条亮起。
 */
const lineStationOn = reactive({});

/**
 * 已渲染的线路实体集合，由 Toolbar.vue 在每次重渲染线路时同步进来。
 *
 * 「发展历程」（/strategy）需要它做两件事：进入栏目时把 18 条全局线路全部藏起来
 * （否则底下还压着一条完整的线，看不出线路在生长），离开时逐条还原成进入前的状态。
 *
 * 用 reactive 容器 + 元素必须 markRaw：
 *   · 容器响应式，面板才能「等 Toolbar 把实体渲染出来之后再补藏一次」——
 *     直接打开 /strategy 时，viewer 就绪、线路数据到位、面板挂载三者的先后是不定的，
 *     只在 onMounted 里藏一次会漏掉后渲染出来的实体；
 *   · 元素必须 markRaw，否则 EntityCollection.remove() 按引用查找会静默失败
 *     —— 与 stationObjs 里那些 Cesium 对象是同一个坑。
 */
const lineEnts = reactive([]);

export function useStationState() {
  return {
    stationPanelOpen,
    stationMarkerMode,
    stationPopupOn,
    focusedStationLine,
    stationObjs,
    lineStationOn,
    lineEnts,
  };
}
