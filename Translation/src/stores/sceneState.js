import { ref, shallowRef } from 'vue';
import CesiumView from '@/views/cesiumView.vue';

/**
 * 三维场景的「组件句柄 + 显隐开关」，专门给 App.vue 的 <KeepAlive> 用。
 *
 * 为什么需要它：
 *   <KeepAlive> 只对**会被切走**的动态子组件生效。如果模板里写死
 *   `<CesiumView />`，它永远不 deactivate，套 KeepAlive 等于没套；
 *   所以场景必须走 `<component :is="...">`，由本模块提供组件与显隐状态。
 *
 * 语义：
 *   - sceneVisible = true  → 组件挂载 / 重新挂回 DOM（KeepAlive 触发 activated）
 *   - sceneVisible = false → 组件**不销毁**，只是移出 DOM 并缓存（触发 deactivated）
 *     实例、ref 状态、Cesium Viewer、WebGL 上下文、相机位姿全部保留，
 *     再次置 true 时复用同一个实例，不会重跑 onMounted / initViewer。
 *
 * 用 shallowRef 存组件对象：组件定义不需要深层响应式，避免无谓的代理开销。
 */
const sceneComponent = shallowRef(CesiumView);
const sceneVisible = ref(true);

const showScene = () => {
  sceneVisible.value = true;
};
const hideScene = () => {
  sceneVisible.value = false;
};
const toggleScene = () => {
  sceneVisible.value = !sceneVisible.value;
};

export function useSceneState() {
  return {
    sceneComponent,
    sceneVisible,
    showScene,
    hideScene,
    toggleScene,
  };
}

/**
 * 开发期调试句柄：浏览器控制台直接 `__scene.hideScene()` / `__scene.showScene()`
 * 就能观察 KeepAlive 的 deactivated / activated 行为（生产构建不会挂载）。
 * 不需要的话删掉这个 if 块即可。
 */
if (import.meta.env.DEV) {
  globalThis.__scene = useSceneState();
}
