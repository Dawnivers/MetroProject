// 站点标记：光锥（体）+ 底部圆环（面）的组合
import * as Cesium from 'cesium';
import { coneWithLight } from './circleAndcone/setcone';
import { bottomCircle } from './circleAndcone/setcircle';

/**
 * @param {Cesium.Viewer} viewer
 * @param {object} options
 * @param {{lng:number, lat:number}} options.positions 站点经纬度
 * @param {string|Cesium.Color} [options.color] 站点颜色（十六进制字符串或 Color）
 * @param {string} [options.name] 站点名
 * @param {number} [options.height] 光锥高度
 * @param {number} [options.bottomRadius] 光锥底半径 / 底圈半径
 * @param {number} [options.opacity] 光锥整体强度倍率
 * @param {number} [options.flowSpeed] 能量带向上跑的速度
 * @param {number} [options.bandCount] 能量带数量（普通站 1，换乘站 2）
 * @param {number} [options.beatSpeed] 呼吸节拍倍率
 * @param {number} [options.energy] 发光增益（换乘站可调高）
 * @param {boolean} [options.translucent] 光锥是否半透明
 */
export const renderStation = (viewer, options = {}) => {
  const { lng = 0, lat = 0 } = options.positions ?? {};
  // 两个特效都以「世界坐标」为锚点，算一次共用，避免重复换算
  const position = Cesium.Cartesian3.fromDegrees(lng, lat);

  // 颜色统一转成 Color 实例：两个材质的 uniforms 都不接受十六进制字符串
  const color =
    typeof options.color === 'string'
      ? Cesium.Color.fromCssColorString(options.color) || Cesium.Color.AQUA
      : Cesium.defaultValue(options.color, Cesium.Color.AQUA);

  // 尺寸与表现参数：不传则用各自函数内的默认值
  const height = Cesium.defaultValue(options.height, 500);
  const bottomRadius = Cesium.defaultValue(options.bottomRadius, 100);

  // 光锥：Primitive 体，向上发光
  const conePrimitve = coneWithLight(viewer, {
    position,
    height,
    bottomRadius,
    color,
    opacity: Cesium.defaultValue(options.opacity, 1.0),
    flowSpeed: options.flowSpeed,
    bandCount: options.bandCount,
    beatSpeed: options.beatSpeed,
    energy: options.energy,
    translucent: Cesium.defaultValue(options.translucent, true),
  });

  // 底部圆环：Entity 面，贴地光圈
  const bottomCircleEntity = bottomCircle(viewer, {
    position,
    bottomRadius,
    color,
  });

  const target = {
    conePrimitve,
    bottomCircleEntity,
    position, // 悬浮窗复用同一个世界坐标，避免二次换算
    name: options.name,
  };

  return target;
};

/**
 * 通过站名控制显示 / 隐藏 —— 与 setlines.js 的 hideLineByName 完全对称。
 *
 * 单个站点特效由三部分组成：光锥 Primitive（scene.primitives）、底圈 Entity
 *（viewer.entities）、悬浮窗 DOM（popupManager）。三者容器/类型都不同，
 * 所以统一在这里一起切，面板只需要调这一个函数。
 *
 * 只改 show / isDisplay，不销毁对象：再次显示是瞬时的，
 * 不会重新编译着色器、不重建几何体，也不会重新请求站点接口。
 *
 * @param {object[]} stations renderStation 的返回值集合，每项含 name / conePrimitve / bottomCircleEntity / popup
 * @param {string[]} names 站点名集合，命中即生效
 * @param {boolean} isShow true 显示 / false 隐藏
 */
export const hideStationByName = (stations, names, isShow) => {
  if (!stations || !names) return;
  stations.forEach((station) => {
    if (!names.includes(station.name)) return;
    if (station.conePrimitve) station.conePrimitve.show = isShow;
    if (station.bottomCircleEntity) station.bottomCircleEntity.show = isShow;
    // 悬浮窗不是 Cesium 对象，用 isDisplay 开关；
    // popupManager 的 postRender 会读它，并对关闭的标记强制 display:none
    if (station.popup) station.popup.isDisplay = isShow;
  });
};
