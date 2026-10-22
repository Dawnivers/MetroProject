// 创建地铁线路
// positions: 一维经纬度数组 [lng1, lat1, lng2, lat2, ...]，
//            与 Cesium.Cartesian3.fromDegreesArray 的入参格式一致
// color: 十六进制颜色字符串（如 '#3aa0ff'），Cesium 的材质属性会自动转成 Color
// name: 线路名称

import * as Cesium from 'cesium';
import PolylineFlowMaterialProperty from './PolylineFlowMaterialProperty';

export const renderLines = (viewer, options = {}) => {
  // viewer 可能还没创建（组件 setup 阶段），或已销毁：直接返回 null 交由调用方稍后重试
  if (!viewer || (viewer.isDestroyed && viewer.isDestroyed())) return null;

  const positions = Cesium.defaultValue(options.positions, []);
  // 少于 2 个点（4 个数字）构不成线，Cesium 会抛 DeveloperError，这里提前拦掉
  if (positions.length < 4) return null;

  const color = Cesium.defaultValue(options.color, Cesium.Color.AQUA);
  const name = Cesium.defaultValue(options.name, 'line');
  const positionRes = Cesium.Cartesian3.fromDegreesArray(positions);

  /*
   * 自定义流动材质的 color uniform 只接受 Cesium.Color 实例。
   * 每条线路的颜色是十六进制字符串（LINE_COLORS），
   * 必须先用 fromCssColorString 转成 Color，否则会触发非法 vec4 导致场景停止渲染。
   */
  const materialColor =
    typeof color === 'string'
      ? Cesium.Color.fromCssColorString(color) || Cesium.Color.AQUA
      : color;

  // 泛光功率：控制线路横截面中心亮带的亮度与向两侧的衰减快慢，越大中心越亮
  const glowPower = Cesium.defaultValue(options.glowPower, 0.5);

  // 衰减功率：控制线路沿长度方向两端的锥形淡出，<1.0 两端渐隐，>=1.0 不衰减
  const taperPower = Cesium.defaultValue(options.taperPower, 0.05);

  // 流线速度倍率：1.0 为原速，>1 加快、<1 减慢（可随线路单独调节）
  const flowSpeed = Cesium.defaultValue(options.flowSpeed, 0.3);

  // 流线高亮段长度：占整条线长度的比例（0~1），越大高亮段越长
  const flowLength = Cesium.defaultValue(options.flowLength, 0.1);

  // 流线高亮段亮度倍率：越大越亮（默认 6.0，觉得太亮就调小）
  const flowIntensity = Cesium.defaultValue(options.flowIntensity, 1.0);

  // 流线初相位（0~1）：默认随机，让各条线的流线错开，不会同时到达终点；
  // 传固定值可让某条线的流线从指定位置起步
  const flowOffset = Cesium.defaultValue(options.flowOffset, Math.random());

  // 线路是否显示：重渲染（数据更新）时用它恢复「已隐藏」状态
  const show = Cesium.defaultValue(options.show, true);

  // 线宽：默认沿用原来的 3。「重点活动」栏目要拿它画一条更粗的高亮叠线
  // （见同目录 lineHighlight.js），所以抽成可配项；不传时行为与以前完全一致。
  const width = Cesium.defaultValue(options.width, 3);

  return viewer.entities.add({
    name,
    show,
    polyline: {
      positions: positionRes,
      width,
      // 自定义流动发光材质：把每条线路自己的颜色传入着色器，
      // 线路底色与流动高亮段都会跟着这条线路的色块变化（不再固定 ORANGERED）
      material: new PolylineFlowMaterialProperty(
        materialColor,
        glowPower,
        taperPower,
        flowSpeed,
        flowLength,
        flowIntensity,
        flowOffset,
      ),
    },
  });
};

/**
 * 通过线路名控制显示 / 隐藏。
 * 直接改 entity.show 开关，不销毁、不重建实体，切换开销极小。
 * @param {Cesium.Entity[]} entities 要控制的实体集合（如 Toolbar 里收集的 linesEnts）
 * @param {string[]} names 线路名集合，命中即生效
 * @param {boolean} isShow true 显示 / false 隐藏
 */
export const hideLineByName = (entities, names, isShow) => {
  if (!entities || !names) return;
  entities.forEach((line) => {
    if (names.includes(line.name)) {
      line.show = isShow;
    }
  });
};
