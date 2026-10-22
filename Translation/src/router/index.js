import { createRouter, createWebHistory } from 'vue-router';

/**
 * 空组件：只表示「这个路由没有面板」，不渲染任何 DOM。
 * 首页 CORE 与三个纯高亮的中阶按钮都指向它。
 */
const EmptyView = { render: () => null };

/**
 * 路由只负责**面板层**，不负责三维场景。
 *
 * 三维场景（views/cesiumView.vue）挂在 App.vue 里、位于 <RouterView> 之外，
 * 由 <KeepAlive> 缓存：路由怎么跳都不会卸载它，Viewer / WebGL 上下文 /
 * 相机位姿 / 已加载的 tileset 全部原地保留，不会重新 initViewer。
 *
 * 这是参考项目（分层分户项目/Project）App.vue 的做法：
 *   <RouterView /> 与 <CesiumView /> 是兄弟节点，前者换页、后者常驻。
 * 注意反例：把三维组件写进 <RouterView> 里，每次换路由都会卸载重建整个场景，
 * 那才是「用路由会刷新 Cesium」的真正原因。
 */
const routes = [
  { path: '/', component: EmptyView }, // 首页 CORE
  {
    // 线路轨迹：左侧 18 条线路，右侧该线的站点序列 + 当前到站高亮。
    // 列车按折线漫游，位置由 clock.currentTime 唯一决定；
    // 三维侧全部由 cesiumTools/lineAndpoints/train/ 承担。
    // 懒加载：这条线只在真的进入栏目时才拉组件代码（列车的 glb 也一起按需加载）。
    path: '/realtime',
    component: () =>
      import('@/components/bottom/RealtimePanel/RealtimePanel.vue'),
  },
  {
    // 重点活动（重保活动）：左侧线路、右侧该线的重点保障活动，点线路立光柱。
    // 与发展历程一样自己 Teleport 到 .hud-canvas，不占布局；
    // 左右两组侧栏同样**不收起**（panel.vue 只对 /nodes 收起）。
    // 懒加载：这条线只在真的进入栏目时才拉组件代码。
    path: '/experiment',
    component: () => import('@/components/bottom/ActivePanel/ActivePanel.vue'),
  },
  {
    // 发展历程：左侧线路、右侧该线建设历程时间轴。
    // 面板自己 Teleport 到 .hud-canvas，所以这一层不占布局。
    // 注意它与 /nodes 的区别：左右两组侧栏**不收起**（panel.vue 只对 /nodes 收起）。
    path: '/strategy',
    component: () =>
      import('@/components/bottom/HistoryPanel/historyPanel.vue'),
  },
  {
    // 站点管理：左侧线路、右侧站点的控制栏。
    // 懒加载，只在真的进入这个栏目时才拉取组件代码。
    path: '/nodes',
    component: () =>
      import('@/components/bottom/StationPanel/StationPanel.vue'),
  },
  // 未匹配的一律回首页，避免控制台刷 "No match found for location" 警告
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

export default router;
