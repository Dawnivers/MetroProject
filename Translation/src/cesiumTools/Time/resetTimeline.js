import * as Cesium from 'cesium';
import Timeline from './timeline';

/**
 * 设置自制时间轴控件：用自定义 Timeline 代替 Cesium 默认时间轴。
 * @param {Cesium.Viewer} viewer - viewer 对象。
 * @param {HTMLElement} [container] - 时间轴挂载容器；不传则创建容器并挂到 cesium 容器底部。
 */
export const resetTimeLine = (viewer, container) => {
  // 之前 timeline 的起止时间间隔很长，这里把范围缩短为「现在 ~ 2 天后」
  const startTime = Cesium.JulianDate.fromDate(new Date());
  const stopTime = Cesium.JulianDate.addDays(
    startTime,
    2,
    new Cesium.JulianDate(),
  );
  viewer.clock.startTime = startTime;
  viewer.clock.stopTime = stopTime;

  if (!viewer.timelineSelf) {
    // 重新给 timeline 一个容器，便于用 CSS 控制样式
    const target = container || document.createElement('div');
    if (!container) {
      target.className = 'cesium-viewer-timelineContainer';
      viewer.cesiumWidget.container.appendChild(target);
    }

    const timeline = new Timeline(viewer, target, viewer.clock);

    // 添加事件，不添加这个事件的话，时间拖动是无效的
    timeline.addEventListener('settime', onTimelineScrubfunction, false);

    // 绑定事件线控件需要先将 shouldAnimate 暂停
    function onTimelineScrubfunction(e) {
      const clock = e.clock;
      clock.currentTime = e.timeJulian;
      clock.shouldAnimate = false;
      // requestRenderMode 下时间变化不会自动触发重绘，这里手动请求一帧
      viewer.scene.requestRender();
    }

    timeline.zoomTo(viewer.clock.startTime, viewer.clock.stopTime);
    viewer.timelineSelf = timeline;
  } else {
    // 已创建过则重设时间轴的范围
    viewer.clock.shouldAnimate = false;
    viewer.timelineSelf.zoomTo(viewer.clock.startTime, viewer.clock.stopTime);
  }
};
