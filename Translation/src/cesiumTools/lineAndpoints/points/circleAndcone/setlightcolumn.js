// 重点活动「光柱」：创建 / 清除 / 相机飞到
//
// 为什么是 wall 而不是 cylinder：
//   光柱需要「上端渐隐、面上有自下而上流动的光带」，这些都得自己写着色器。
//   wall 图元按 positions 给一圈底面点、再用 minimumHeights / maximumHeights
//   拉出竖直面，正好能把任意自定义材质挂上去；cylinder 图元的 st 语义与
//   顶点顺序都由 Cesium 内部决定，反而不好控。
//
// 和同目录 setcone.js 的分工：
//   · setcone.js     —— 站点标记用的**光锥**（CylinderGeometry + Primitive），矮、上尖
//   · setlightcolumn.js —— 重点活动用的**光柱**（Wall + Entity），高、等宽、会流动
//   两者外观和用途都不同，不要互相替代。

import * as Cesium from 'cesium';
import LightColumnMaterialProperty from './lightColumnMaterialProperty';

/**
 * 已创建的光柱登记表（模块级，不进 Vue 响应式）。
 *
 * 不放进 store 的原因：光柱的生命周期完全由「重点活动」面板的挂载与线路切换决定，
 * 不像站点特效那样要和图层面板共享状态。放模块级的好处是 create / remove / flyTo
 * 三个方法都不用额外传集合，调用方（面板）只需要认得站名。
 *
 * 元素形如 { name, entity, lng, lat, height, radius, color }
 */
const columns = [];

/** 绕柱一圈的采样段数。64 段在城视高度下已经看不出多边形棱角 */
const SEGMENTS = 64;

/** 每度纬度对应的米数。经度方向再按 cos(lat) 收缩 */
const METERS_PER_DEGREE_LAT = 111320;

/**
 * 生成绕 (lng, lat) 一圈、半径 radius 米的闭合点列。
 *
 * 注意末尾要补一个与首点重合的点（i <= segments）：WallGeometry 不会自动闭合，
 * 少这一个点柱面上就会留一道竖缝。
 *
 * 用等距圆柱近似而不是大地线：半径只有几百米，误差远小于屏幕像素。
 */

const buildCirclePositions = (lng, lat, radius, segments) => {
  const cosLat = Math.cos(Cesium.Math.toRadians(lat));
  const dLatPerMeter = 1 / METERS_PER_DEGREE_LAT;
  const dLonPerMeter = 1 / (METERS_PER_DEGREE_LAT * cosLat || METERS_PER_DEGREE_LAT);

  const positions = [];
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Cesium.Math.TWO_PI;
    const dLat = radius * Math.cos(theta) * dLatPerMeter;
    const dLon = radius * Math.sin(theta) * dLonPerMeter;
    positions.push(Cesium.Cartesian3.fromDegrees(lng + dLon, lat + dLat));
  }
  return positions; //
};

/** 十六进制字符串 / Color 统一转成 Color —— 材质的 uniforms 不接受字符串 */
const toColor = (color) =>
  typeof color === 'string'
    ? Cesium.Color.fromCssColorString(color) || Cesium.Color.AQUA
    : Cesium.defaultValue(color, Cesium.Color.AQUA);

/**
 * 在指定经纬度立一根光柱。
 *
 * @param {Cesium.Viewer} viewer
 * @param {object} options
 * @param {number} options.lng 经度
 * @param {number} options.lat 纬度
 * @param {number} [options.height=3000] 柱高（米）
 * @param {number} [options.radius=160] 柱半径（米）
 * @param {number} [options.baseHeight=0] 柱底高度（米），贴地就是 0
 * @param {string|Cesium.Color} [options.color] 柱色，一般传线路色
 * @param {string} [options.name] 柱名，默认用「经度,纬度」；飞到某一根时按它查
 * @param {number} [options.opacity] 整体透明度倍率
 * @param {number} [options.flowSpeed] 光带流动速度倍率
 * @param {number} [options.breatheSpeed] 明暗呼吸速度倍率
 * @returns {object|null} 登记项（含 entity），viewer 不可用或坐标非法时返回 null
 */
export const lightColumn = (viewer, options = {}) => {
  if (!viewer || (viewer.isDestroyed && viewer.isDestroyed())) return null;

  const lng = Number(options.lng);
  const lat = Number(options.lat);
  // 解析失败就跳过，避免把 (0,0) 之类的脏点画到几内亚湾
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  const height = Cesium.defaultValue(options.height, 3000);
  const baseHeight = Cesium.defaultValue(options.baseHeight, 0);

  const radius = Cesium.defaultValue(options.radius, 160);
  const name = Cesium.defaultValue(options.name, `${lng},${lat}`);
  const color = toColor(options.color);

  const positions = buildCirclePositions(lng, lat, radius, SEGMENTS);
  // 每根柱子上下各一个常数高度：min 全是柱底、max 全是柱顶，
  // 于是 st.t 就是干净的「0 底 1 顶」，顶点顺序不会干扰着色器
  const minimumHeights = new Array(positions.length).fill(baseHeight);
  const maximumHeights = new Array(positions.length).fill(baseHeight + height);

  const entity = viewer.entities.add({
    name,
    wall: {
      positions,
      minimumHeights,
      maximumHeights,
     
      material: new LightColumnMaterialProperty(color, {
        opacity: options.opacity,
        flowSpeed: options.flowSpeed,
        breatheSpeed: options.breatheSpeed,
      }),
    },
  });

  const record = { name, entity, lng, lat, height, radius, color };
  columns.push(record);
  return record;
};

/**
 * 清掉所有光柱（**只清本模块创建的，不动场景里其它实体**）。
 *
 * 面板每次切换线路、以及离开栏目时都要调它：光柱挂在 Cesium 的 entities 上、
 * 不在 Vue 的树里，路由切走不会自动回收。
 */
export const removeAllLightColumns = (viewer) => {
  const alive = viewer && !(viewer.isDestroyed && viewer.isDestroyed());
  columns.forEach((item) => {
    if (alive && item.entity) viewer.entities.remove(item.entity);
  });
  // 无论 viewer 是否可用都把登记表清空：留着只会累积幽灵引用
  columns.length = 0;
};

/**
 * 相机飞到某根光柱。
 *
 * 这里**不用 `viewer.flyTo(entity)`**：EntityView 对 wall 图元能不能算出包围球
 * 没有保证，一旦算不出来 flyTo 会静默失败。改成自己造一个点包围球 + 显式
 * HeadingPitchRange，完全走 `flyToBoundingSphere`，结果可预期。
 *
 * pitch 必须给：默认 -90° 是正俯视，一根竖直的柱子会缩成一个圆点。
 *
 * @returns {boolean} 是否找到了目标并起飞
 */
export const flyToLightColumn = (viewer, name, options = {}) => {
  if (!viewer || (viewer.isDestroyed && viewer.isDestroyed())) return false;

  const target = columns.find((item) => item.name === name);
  if (!target) return false;

  const offset = new Cesium.HeadingPitchRange(
    Cesium.Math.toRadians(Cesium.defaultValue(options.heading, 40)),
    Cesium.Math.toRadians(Cesium.defaultValue(options.pitch, -40)),
    Cesium.defaultValue(options.range, 6000),
  );

  viewer.camera.flyToBoundingSphere(
    new Cesium.BoundingSphere(
      Cesium.Cartesian3.fromDegrees(target.lng, target.lat, target.height * 0.2),
      1,
    ),
    { offset, duration: Cesium.defaultValue(options.duration, 1.5) },
  );
  return true;
};

/** 当前登记的光柱（只读快照，供面板/自检查询用） */
export const getLightColumns = () => columns.slice();
