import { computed, ref, watch } from 'vue';
import { cesiumStore } from '@/stores/counter';
import CesiumHeat from './cesiumHeatMap';
import { buildHeatSource } from './heatSource';
import { lockTopDownView } from './lockTopDownView';

/**
 * 「站点拥挤度」这个查询模式的运行逻辑：数据准备 + 引擎生死。
 *
 * 外壳 QueryModePanel.vue 只管「三个模式按钮 + 选中谁」，不知道热力图怎么画。
 * 本文件只被 HeatMode.vue 使用，生命周期由那个组件的挂载/卸载驱动
 * （mount 在内部 watch 的 immediate 里完成，destroy 在组件卸载时调用）——
 * 和 guideload/useRoutePlan.js 完全对称：外壳里没有任何模式特例。
 *
 * 不写进 Pinia：没有第二个组件需要控制它，多一个 owner 只会多一条「谁负责关」的歧义。
 */
export function useHeatmap() {
  const dataStore = cesiumStore();

  /** 热力图实例。普通变量而非 ref —— 里面装的是 Cesium 对象，不需要响应式 */
  let heat = null;

  /** 初始化失败的原因。静默失败最难查，所以把它显示在面板上 */
  const error = ref('');

  /** 数据源：18 条线全部站点按站名去重 + 真实客流值 + 现算的 bbox */
  const source = computed(() => buildHeatSource(dataStore.Lines || []));

  /** 面板底部的数据摘要，用来确认「真的读到数据了」 */
  const summary = computed(() => {
    //min max 是客流
    //points: Array<{name:string,lng:number,lat:number,value:number,isChange:boolean}>,
    const { points, min, max } = source.value
    if (!points.length) return '等待线路数据…';
    return `${points.length} 站 · 客流 ${min}–${max}`;
  });

  /** 进入模式时锁定的相机交互，退出时恢复 */
  let releaseCamera = null;

  const destroy = () => {
    // 先放相机：即使下面没有热力实例，也不能把交互留在锁定状态
    if (releaseCamera) {
      releaseCamera();
      releaseCamera = null;
    }
    if (!heat) return;
    heat.destroy();
    heat = null;
  };

  const mount = () => {
    destroy();
    error.value = '';

    const viewer = dataStore.Viewer;
    const { points, bbox } = source.value;
    if (!viewer || !bbox || !points.length) return;

    try {
      heat = new CesiumHeat(viewer, {
        // heatmap.js 只认 {x, y, value}：x 是经度、y 是纬度
        points: points.map(({ lng, lat, value }) => ({ x: lng, y: lat, value })),
        bbox,
        // 相机停稳后的异步重绘失败也要落到面板上，否则只会「热力图突然没了」
        onError: (err) => {
          error.value = err?.message ?? String(err);
          console.error('[useHeatmap] 热力图重绘失败', err);
        },
      });
    } catch (err) {
      error.value = err?.message ?? String(err);
      console.error('[useHeatmap] 热力图初始化失败', err);
    }

    // 视野矩形同时受高度和俯仰角影响，斜着看每转一下视角就重画一张。
    // 拥挤度不需要斜视：摆正到正上方，保留平移/缩放/绕视线轴旋转、锁死俯仰
    // （详见 lockTopDownView）。
    if (heat) releaseCamera = lockTopDownView(viewer);
  };

  /**
   * viewer 或线路数据可能比组件晚就绪（尤其首屏直接刷 /nodes）：
   * 已经进入热力模式、但实例没挂上时补挂一次。
   * mount() 内部先 destroy()，所以这个 watch 反复触发也不会挂出两层。
   *
   * immediate 顺便承担了「进入模式」的那次挂载 —— 组件不必再 onMounted(mount)，
   * 否则会建两遍图。
   */
  watch(
    [() => dataStore.Viewer, source],
    () => {
      if (!heat) mount();
    },
    { immediate: true },
  );

  // 退出（销毁实例 + 放相机）由使用它的模式组件在 onBeforeUnmount 里调 destroy()
  return { mount, destroy, summary, error };
}

export default useHeatmap;
