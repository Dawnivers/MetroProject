// 线路高亮：给「重点活动」栏目用的一条加粗叠线
//
// 为什么不做「把原线路的 glowPower 调大再调回来」：
//   PolylineFlowMaterialProperty 的 isConstant 在参数都是普通数字时返回 true，
//   Cesium 会把它当常量材质只编译一次。运行时改它的属性能不能可靠地触发重编译，
//   本项目之前做过一次像素级 A/B，结论是没测出差别（远景瓦片 LOD 漂移比信号还大），
//   也就是说这条路**没有被证实可用**。既然不确定，就不赌它。
//
// 改成「在同一条线上再画一条更粗、更亮的线」：
//   · 复用 setlines.js 的 renderLines，配色与线型天然一致，不引入第二套线路观感；
//   · 是新增实体，能不能显示当场看得出来，不存在「改了没生效」的模糊地带；
//   · 切换线路时把旧的删掉即可，原线路实体自始至终没被碰过。
//
// 不放进 setlines.js 的原因：那是「所有线路的创建与显隐」这一层的基础设施，
// 高亮只服务于重点活动一个栏目，属于栏目级的呈现手段，混进去会把职责搅在一起。

import * as Cesium from 'cesium';
import { renderLines } from './setlines';

/**
 * 当前的高亮叠线（模块级单例：同时只高亮一条线）
 * @type {Cesium.Entity|null}
 */
let highlightEntity = null;

/**
 * 高亮一条线路。
 *
 * 会先清掉上一根高亮叠线 —— 传进来的 positions / name 每次都覆盖，
 * 不做增量，避免「切了三条线留下三条叠线」。
 *
 * @param {Cesium.Viewer} viewer
 * @param {object} options
 * @param {string} options.name 线路名（与 renderLines 一致，如「上海地铁1号线」）
 * @param {number[]} options.positions 一维坐标 [lng1,lat1,lng2,lat2,...]
 * @param {string|Cesium.Color} [options.color] 线路色
 * @param {number} [options.width=8] 叠线线宽
 * @returns {Cesium.Entity|null}
 */
export const highlightLine = (viewer, options = {}) => {
  clearLineHighlight(viewer);

  if (!viewer || (viewer.isDestroyed && viewer.isDestroyed())) return null;

  const entity = renderLines(viewer, {
    name: options.name,
    positions: options.positions,
    color: options.color,
    width: Cesium.defaultValue(options.width, 8),
    // 关掉流动：高亮要的是「这条线被选中」的静态信号，
    // 再叠一层跑动的光带会和原线路自己的流线打架。
    // 注意必须用 flowLength: 0 来关 —— 置 flowIntensity: 0 会把 alpha 拉满成黑带。
    flowLength: 0,
    // 关掉流动后线会变细变暗，把泛光与两端衰减补回来（这个配比在发展历程里实测过）
    glowPower: Cesium.defaultValue(options.glowPower, 1.2),
    taperPower: Cesium.defaultValue(options.taperPower, 0.5),
  });

  highlightEntity = entity;
  return entity;
};

/**
 * 清掉高亮叠线。离开栏目、切换线路时都要调。
 * 只删自己创建的那一条，原线路实体不受影响。
 */
export const clearLineHighlight = (viewer) => {
  const alive = viewer && !(viewer.isDestroyed && viewer.isDestroyed());
  if (alive && highlightEntity) {
    viewer.entities.remove(highlightEntity);
  }
  highlightEntity = null;
};

/** 当前高亮叠线（供自检） */
export const getLineHighlight = () => highlightEntity;
