# 自制时间轴（resetTimeline）实现说明

## 目的

Cesium 默认时间轴起止时间跨度大、样式固定、位置被约束在三维容器底部，不适合直接嵌入大屏 HUD。本方案用一份精简的 `Timeline` 实现替换默认时间轴，并把它挂载到 [head.vue](../../components/screenUI/head.vue) 顶部栏最右侧。

## 文件结构

```
src/cesiumTools/Time/
├── resetTimeline.js          # 入口：设置时钟范围并挂载时间轴
├── timeline.js               # 自制 Timeline 组件（刻度、游标、事件）
├── TimelineTrack.js          # 轨道（timeline.js 引用，本项目未使用）
└── TimelineHighlightRange.js # 高亮区间（timeline.js 引用，本项目未使用）
```

- `timeline.js` 是 Cesium 官方 `Timeline` widget 的裁剪版，内部用 `import * as Cesium from 'cesium'` 计算儒略日、刻度与游标位置。
- `resetTimeline.js` 是业务入口，负责把时钟范围收敛、把时间轴实例化并挂到指定容器。

## 核心流程

### 1. 收敛时钟范围（[resetTimeline.js#L10-L18](resetTimeline.js#L10-L18)）

```js
const startTime = Cesium.JulianDate.fromDate(new Date());
const stopTime = Cesium.JulianDate.addDays(startTime, 2, new Cesium.JulianDate());
viewer.clock.startTime = startTime;
viewer.clock.stopTime = stopTime;
```

把默认很长的起止区间缩为「当前时刻 ~ 2 天后」，让刻度显示在可读的时间分辨率上。

### 2. 单例挂载（[resetTimeline.js#L20-L43](resetTimeline.js#L20-L43)）

用挂在 `viewer` 上的自定义属性 `viewer.timelineSelf` 做幂等判断：

- 首次调用：创建 `Timeline` 实例并赋值给 `viewer.timelineSelf`；
- 再次调用：走 `else` 分支，只 `zoomTo` 重设范围，避免重复创建多个时间轴。

若传入 `container` 参数，时间轴挂到该元素；不传则退回原逻辑，创建 `.cesium-viewer-timelineContainer` 挂到 cesium 容器底部。

### 3. 拖动事件联动（[resetTimeline.js#L30-L40](resetTimeline.js#L30-L40)）

```js
timeline.addEventListener('settime', onTimelineScrubfunction, false);

function onTimelineScrubfunction(e) {
  const clock = e.clock;
  clock.currentTime = e.timeJulian; // 把拖动位置换算成的时间写回 clock
  clock.shouldAnimate = false;       // 拖动期间暂停时间推进
  viewer.scene.requestRender();      // 手动请求一帧，让画面刷新
}
```

`timeline.js` 在拖动游标时通过 `_setTimeBarTime` 派发 `settime` 事件，携带 `timeJulian` 与 `clock`。这里再把时间写回时钟并暂停动画。

## 与按需渲染（requestRenderMode）的关系

场景开启了 `requestRenderMode: true` 且 `maximumRenderTimeChange: Infinity`（见 [sceneManager.js](../sceneManager.js#L22-L23)），意味着**时间变化不会自动触发重绘**。

因此拖动时间轴只改 `clock.currentTime` 并不会刷新画面，必须在 `settime` 回调里显式调用 `viewer.scene.requestRender()`，这是时间轴能和三维画面联动的关键一步。`settime` 在拖动过程中连续触发，所以画面会随拖动实时刷新。

## head.vue 挂载方式

在 [head.vue](../../components/screenUI/head.vue) 中：

1. `import { resetTimeLine } from '@/cesiumTools/Time/resetTimeline'`；
2. 通过 `cesiumStore` 取 `viewer`；
3. 模板右侧区域放置容器 `<div ref="timelineBoxRef" class="timeline-box" />`；
4. `onMounted` 里调用 `resetTimeLine(viewer, timelineBoxRef.value)`；
5. 用 `watch(() => dataStore.Viewer, ...)` 兜底，防止 head 挂载早于 viewer 就绪导致拿不到实例。

## 样式说明

项目**未引入 Cesium 的 widgets.css**，`timeline.js` 动态创建的 DOM（`.cesium-timeline-bar`、`.cesium-timeline-needle`、刻度等）没有默认样式，需要在 head.vue 里补齐。

又因为这些元素是 JS 动态创建的、不带 Vue 的 `data-v` 属性，`scoped` 样式必须用 `:deep()` 穿透命中：

```css
.timeline-box :deep(.cesium-timeline-needle) {
  background: var(--hud-cyan);
  /* ... */
}
```

配色沿用 HUD 设计令牌（青色游标、暗色玻璃背板、金色辉光），使时间轴与整屏风格统一。未使用的轨道层 `.cesium-timeline-trackContainer` 直接 `display: none`。

## 待扩展

当前时间轴是**纯可视化控件**，只是改 `clock.currentTime` 并触发重绘，尚未绑定任何 3D Tiles 的时间属性。若要「拖动时间轴驱动模型动态效果」，需在 `settime` 回调里增加业务逻辑，例如根据当前时间切换建筑状态、高亮某条线路等。