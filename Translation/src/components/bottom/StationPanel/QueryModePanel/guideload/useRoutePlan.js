import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getLinePlan } from '@/api/request';
import { cesiumStore } from '@/stores/counter';
import { useStationState } from '@/stores/stationState';
import { LINE_COLORS } from '@/config/lineAndStationStyle';
import { useStationSnapshot } from '../useStationSnapshot';
import { buildStationOptions, normalizePlan, stationQueryCoord } from './planModel';
import { drawRoute, frameRoute } from './renderRoute';

/**
 * 「路径规划」这个查询模式的运行逻辑：请求接口 → 归一化 → 画到三维 → 退出时还原。
 *
 * 和 heatmap/useHeatmap.js 同一层职责：外壳 QueryModePanel.vue 不参与这里任何细节，
 * 面板组件 RouteDesign.vue 只管把这里的状态渲染成表单和结果卡。
 *
 * 生命周期跟着面板挂载走（v-if）：挂载 = 进入规划模式（藏全局 18 条线），
 * 卸载 = 退出（删自己画的实体 + 逐条还原进入前的显隐）。
 * 每次点「开始规划」还会把全局站点（光锥/底圈/站名气泡）先整片清掉，见 hideAllStations。
 */
export function useRoutePlan() {
  const dataStore = cesiumStore();
  const { lineEnts } = useStationState();

  /** 下拉框数据：18 条线 400 个去重站点 */
  const options = computed(() => buildStationOptions(dataStore.Lines || []));

  const origin = ref('');
  const destination = ref('');
  const loading = ref(false);
  const error = ref('');

  /** 归一化后的方案；null = 还没查 / 已作废 */
  const result = ref(null);

  /** 起终点都选了、且不是同一个站，才允许发起规划 */
  const stationNames = computed(() => new Set(options.value.map((item) => item.name)));

  /**
   * 站名是用户手输的（datalist 联想），所以「非空」不等于「有效」——
   * 必须两个都命中真实站名，否则后端会因为坐标是空串直接回 400。
   */
  const ready = computed(
    () =>
      stationNames.value.has(origin.value) &&
      stationNames.value.has(destination.value) &&
      origin.value !== destination.value,
  );

  /** 当前画在三维里的那一份（drawRoute 的句柄） */
  let route = null;

  /**
   * 全局 18 条线路进入前的显隐快照。
   * 不能一律还原成 true：用户可能先在「线路图层」里关掉了两条，那样会被我们打开。
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
      if (!savedLineShow.has(entity)) return;
      entity.show = savedLineShow.get(entity);
      savedLineShow.delete(entity);
    });
  };

  /**
   * 撤掉路线：删掉自己画的实体 + 把全局站点按快照还原。
   * 每次查询前、改起终点、退出规划模式都走这里，保证「有路线时是干净的，
   * 没路线时回到用户原来的站点状态」。
   */
  const clearRoute = () => {
    route?.clear();
    route = null;
    restoreAllStations();
  };

  /**
   * 全局站点（光锥 + 底圈 + 站名气泡）的「清场 / 还原」。
   *
   * 为什么要整片清掉：站点管理里用户可能点了「全部显示」或某几条线，
   * 满屏光锥和站名气泡会跟路径的起终/换乘标记、路线本身糊在一起，
   * 分不清哪个是「规划出来的」。所以每次点「开始规划」先清场。
   *
   * 用快照而不是一律隐藏：站点显隐是 checked + lineStationOn + forced 三个开关
   * 组合算出来的（见 StationPanel.vue），这里只动三维对象的 show，
   * 退出/改起终点时按快照逐条还原，不能碰那套状态机。
   * 这段逻辑与站控措施共用，落在 QueryModePanel/useStationSnapshot.js。
   */
  const { stationObjs, hideAll: hideAllStations, restore: restoreAllStations } =
    useStationSnapshot();

  /**
   * 站名 → 发给高德的 "lng,lat"。
   *
   * **必须转成 GCJ-02**：库里的坐标是 WGS-84（跟 Cesium 底图一致），
   * 高德吃的是 GCJ-02，上海一带恒差约 430 m 东 / 215 m 南。不转的话
   * 高德会拿偏移后的点去吸附最近的站 —— 实测「富锦路 → 人民广场」
   * 会被送达成「新闸路」（人民广场的上一站），末段还报 710 m 假步行。
   */
  const coordOf = (name) => stationQueryCoord(options.value.find((item) => item.name === name));

  /**
   * 线路名 → 颜色，**必须与全局 18 条线同一套取法**：
   * Toolbar / StationPanel / 发展历程都是「按 dataStore.Lines 的下标取 LINE_COLORS」，
   * 这里照抄同一条规则，路径高亮的颜色才和线路图层、站点光锥里的那条线对得上。
   */
  const colorOfLine = (lineName) => {
    const index = (dataStore.Lines || []).findIndex((line) => line.name === lineName);
    if (index < 0) return LINE_COLORS[0];
    return LINE_COLORS[index % LINE_COLORS.length];
  };

  /**
   * 拦截器有两种返回形状，这里统一成后端 body：
   *   code === 200 → 拦截器直接把 { code, message, data } 抛出来；
   *   code !== 200 → 拦截器 resolve 的是整个 axios response（body 在 .data 里）。
   */
  const unwrap = (raw) => {
    if (raw && typeof raw === 'object' && typeof raw.code === 'number') return raw;
    return raw?.data && typeof raw.data === 'object' ? raw.data : null;
  };

  const search = async () => {
    if (!ready.value || loading.value) return;

    loading.value = true;
    error.value = '';
    // 先撤掉上一次的结果：否则请求失败时，面板上留着旧数字、三维里却是空的
    clearRoute();
    result.value = null;
    // 再清场：全局站点光锥/底圈/站名气泡全收掉，屏幕上只剩这次的路线标记
    hideAllStations();

    try {
      const raw = await getLinePlan(coordOf(origin.value), coordOf(destination.value));
      const body = unwrap(raw);
      if (!body || body.code !== 200 || !body.data) {
        error.value = body?.message || '路径规划失败';
        return;
      }

      // 颜色跟着全局线路的色板走，与线路图层/站点光锥里的同一条线一致
      const plan = normalizePlan(body.data, dataStore.Lines || [], colorOfLine);
      result.value = plan;

      if (!plan.segments.length) {
        error.value = '方案里没有可乘坐的地铁段';
        return;
      }

      const viewer = dataStore.Viewer;
      if (!viewer) {
        // 数据（面板文字）照样显示，只是画不出来；比整块静默失败好查
        error.value = '三维场景还没就绪，暂时只能在面板上查看方案';
        return;
      }

      route = drawRoute(viewer, plan);
      frameRoute(viewer, plan);
    } catch (err) {
      error.value = err?.message ?? String(err);
      console.error('[useRoutePlan] 路径规划失败', err);
    } finally {
      loading.value = false;
    }
  };

  const swap = () => {
    const temp = origin.value;
    origin.value = destination.value;
    destination.value = temp;
  };

  /**
   * 起终点一改，旧方案立刻作废并撤掉三维里的线。
   * 不做这一步的话，面板数字会停在旧查询上，看起来像「改了终点但路线没变」。
   */
  watch([origin, destination], () => {
    if (!result.value) return;
    result.value = null;
    error.value = '';
    clearRoute();
  });

  // 进入规划模式：先把 18 条全局线路藏起来（语雀流程第 2 步）。
  // 站点先不动 —— 用户还没点「开始规划」，此时仍按 StationPanel 的开关组合显示；
  // 一点查询就整片清掉（见 search 里的 hideAllStations）。
  onMounted(hideGlobalLines);

  // 直接刷 /nodes 时，线路实体可能比面板晚渲染出来，跟长度变化补藏一次
  watch(() => lineEnts.length, hideGlobalLines);

  // 站点的光锥/底圈也是 Toolbar 后渲染出来的：清场之后如果实体才到位，
  // 新出现的那批还是「亮着」的，这里按当前是否有方案补清一次
  watch(
    () => stationObjs.length,
    () => {
      if (result.value) hideAllStations();
    },
  );

  onBeforeUnmount(() => {
    clearRoute();
    restoreGlobalLines();
  });

  return {
    origin,
    destination,
    options,
    stationNames,
    loading,
    error,
    result,
    ready,
    search,
    swap,
  };
}

export default useRoutePlan;
