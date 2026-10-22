/**
 * 路径规划的三维呈现：把归一化后的方案画成「逐段高亮线 + 起终点/换乘点标记」。
 *
 * 实体全部归本模块私有：用完自己 remove，绝不改 Toolbar 里那 18 条全局线路的实体本身
 * （进入规划模式时只是把它们整体藏起来，还原由 useRoutePlan 的显隐快照负责）。
 * 这条边界和「发展历程」栏目一致 —— 私有实体 + 进场藏全局，是项目里已经验证过的写法。
 */

import * as Cesium from 'cesium';
import { renderLines } from '@/cesiumTools/lineAndpoints/line/setlines';
import { renderStation } from '@/cesiumTools/lineAndpoints/points/setpoints';
import SimpleLabel from '@/cesiumTools/lineAndpoints/popup/popup';

/**
 * 高亮线的样式。想调「白不白 / 粗不粗 / 匀不匀」只改这里，别去动公用材质。
 *
 * glowPower —— 发白的唯一主因。着色器里
 *   glow = glowPower / |st.t - 0.5| - glowPower / 0.5
 * 线中心 st.t=0.5 时分母趋 0，glow 爆掉，emission 被截断成纯白。
 * 白芯占线宽的比例 ≈ glowPower / (2 + 2·glowPower)：
 *   1.2 → 54%   0.5 → 33%（全局线观感）   0.3 → 23%   0.1 → 8%
 * 别写 0：中心会变成 0/0 的 NaN。
 *
 * taperPower —— **「同一条线粗细/明暗不一」的主因**。
 * 只要 < 0.99999，着色器就会再乘一个沿长度方向的衰减：
 *   glow *= min(1, taperPower/(0.5 - 0.5·st.s) - taperPower/0.5)
 * 这个式子在 s=0 处恰好为 0、s=1 处为 1，也就是「起始端完全透明、末端最亮」。
 * alpha 低的那一端会和背景混在一起，看起来又细又暗 —— 静态高亮线一眼就露馅。
 * 全局线路用 0.05，但它们有流动光带盖着，缺陷被流线遮住了。
 * 所以路径高亮必须取 1（>= 0.99999 时着色器整段跳过这个衰减）。
 *
 * width 是**屏幕像素**，与远近无关；但它越大，拐角越难看：
 * Cesium 的折线是屏幕空间四边形 + 斜接(miter)拼接，急转弯时外侧会溢出成胖疙瘩。
 * 18 这种宽度在 70° 以上的转角就会明显鼓包，10 以内基本看不出来。
 *
 * flowLength: 0 关掉流动（注意是 flowLength 而不是 flowIntensity ——
 * 后者置 0 会把 alpha 拉满成黑带）。
 */
const ROUTE_STYLE = {
  width: 30,
  glowPower: 0.05,
  taperPower: 1,
  flowLength: 0,
};

/** 标记尺寸/配色。起终点比换乘点更高更粗，一眼分得出哪是一趟车的两头 */
const MARKERS = {
  start: { color: '#11efe3', height: 1100, radius: 190 },
  end: { color: '#fce38a', height: 1100, radius: 190 },
  transfer: { color: '#ff2bd1', height: 900, radius: 160 },
};

const alive = (viewer) => viewer && !(viewer.isDestroyed && viewer.isDestroyed());

/** 一个站点标记 = 光锥(Primitive) + 底圈(Entity)，两者容器不同，必须分开登记、分开移除 */
const addMarker = (viewer, coord, conf, bucket) => {
  if (!coord) return;
  const result = renderStation(viewer, {
    positions: { lng: coord[0], lat: coord[1] },
    color: conf.color,
    height: conf.height,
    bottomRadius: conf.radius,
    name: '',
  });
  if (result) bucket.push(result);
};

/**
 * 站名气泡的取景参数，与 Toolbar 的 POPUP_CONF 保持一致。
 * 路径规划时相机常在万米级（整条线取景），150000 才不会把气泡剔掉。
 */
const LABEL_CONF = {
  offset: [0, 120],
  maxDistance: 150000,
  near: 2000,
  nearScale: 1.0,
  far: 80000,
  farScale: 0.6,
};

/**
 * 挂一个站名气泡（复用的就是站点图层那套 DOM 标签，样式与站点管理里一致）。
 *
 * 一个方案最多挂 5 个（起、终、0~2 个换乘），各自挂自己的 postRender 就够了
 * —— 不值得为几个标签再起一个 HtmlMarkerManager（那是给 400 个站点分摊开销用的）。
 *
 * clickable: true —— 点气泡走 popup.js 的 showQueryPopup()，拉 /getStationInfo
 * 后弹出 queryTemplate 详情卡，与「站点管理」里点站名标签是同一套逻辑。
 * 详情卡自己会做「同时只存在一张」和贴边镜像，这里不用重复处理。
 * 注意详情卡比气泡大得多，用户点的时候会盖住左侧规划面板，这是既有组件的取舍。
 */
const addLabel = (viewer, coord, name, color, isChange, bucket, extra = {}) => {
  if (!coord || !name) return;
  const label = new SimpleLabel(viewer, {
    position: Cesium.Cartesian3.fromDegrees(coord[0], coord[1]),
    label: name,
    color,
    // attr 是详情卡的数据源：showQueryPopup 拿 attr.name 求接口、拿 attr.isChange 填「是否换乘站」
    attr: { name, isChange },
    type: 'marker',
    // 起终点传「起 / 终」把徽标从「换」换掉；换乘站不传，仍显示「换」
    badge: extra.badge ?? '',
    offset: extra.offset ?? LABEL_CONF.offset,
    maxDistance: LABEL_CONF.maxDistance,
    scaleByDistance: new Cesium.NearFarScalar(
      LABEL_CONF.near,
      LABEL_CONF.nearScale,
      LABEL_CONF.far,
      LABEL_CONF.farScale,
    ),
    isShow: true,
    clickable: extra.clickable ?? true,
    managedByManager: false,
  });
  bucket.push(label);
};

/**
 * 画一条方案。
 * @returns {{ clear: () => void }} 句柄；再次查询前先调 clear()
 */
export const drawRoute = (viewer, plan) => {
  const entities = [];
  const markers = [];
  const labels = [];
  /** 防止「标签模板还没加载完就被 clear」时把 DOM 漏在画布上 */
  let disposed = false;

  if (!alive(viewer) || !plan?.segments?.length) {
    return { clear: () => {} };
  }
  //画线
  plan.segments.forEach((segment, index) => {
    if (!segment.geometry) return;
    const entity = renderLines(viewer, {
      name: `route-${index}`,
      positions: segment.geometry,
      color: segment.color,
      ...ROUTE_STYLE,
    });
    if (entity) entities.push(entity);
  });

  const first = plan.segments[0];
  const last = plan.segments[plan.segments.length - 1];
  addMarker(viewer, first?.fromCoord, MARKERS.start, markers);
  addMarker(viewer, last?.toCoord, MARKERS.end, markers);
  plan.transfers.forEach((transfer) => {
    addMarker(viewer, transfer.coord, MARKERS.transfer, markers);
  });

  // 三类气泡：起点、终点、换乘站。
  // 起终点气泡的徽标换成「起 / 终」—— 即使这一站本身是换乘站也照样显示「起 / 终」，
  // 因为用户在这一步最需要知道的是「从哪出发、到哪结束」，而不是它换不换乘
  // （换乘信息在名字旁边的线路与详情卡里都有）。
  addLabel(viewer, first?.fromCoord, first?.from, MARKERS.start.color, first?.fromIsChange, labels, {
    badge: '起',
  });
  addLabel(viewer, last?.toCoord, last?.to, MARKERS.end.color, last?.toIsChange, labels, {
    badge: '终',
  });

  
  plan.transfers.forEach((transfer) => {
    addLabel(viewer, transfer.coord, transfer.name, MARKERS.transfer.color, 1, labels);
  });

  // addLabel 内部是异步加载模板（动态 import），这里不等它：
  // 等它回来时若已被 clear，就自己收掉，避免留下一个没人管的 DOM 气泡
  labels.forEach((label) => {
    label.addLabel().then((el) => {
      if (disposed && el) label.removeMarker();
    });
  });

  const clear = () => {
    disposed = true;
    entities.forEach((entity) => {
      if (alive(viewer)) viewer.entities.remove(entity);
    });
    markers.forEach((marker) => {
      if (!alive(viewer)) return;
      if (marker.conePrimitve) viewer.scene.primitives.remove(marker.conePrimitve);
      if (marker.bottomCircleEntity) {
        viewer.entities.remove(marker.bottomCircleEntity);
      }
    });
    labels.forEach((label) => label.removeMarker());
    entities.length = 0;
    markers.length = 0;
    labels.length = 0;
  };

  return { clear };
};

/**
 * 把相机拉到能看全整条路径的高度。
 *
 * 直接用整条路径的外接矩形，不再按「段」飞：一次查询就把全程摆在眼前，
 * 用户点哪一段再自己缩放到细节（本 MVP 不做逐段跳转）。
 */
export const frameRoute = (viewer, plan) => {
  if (!alive(viewer) || !plan) return;

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  plan.segments.forEach((segment) => {
    const positions = segment.geometry ?? [];
    for (let i = 0; i < positions.length; i += 2) {
      west = Math.min(west, positions[i]);
      east = Math.max(east, positions[i]);
      south = Math.min(south, positions[i + 1]);
      north = Math.max(north, positions[i + 1]);
    }
  });

  if (!Number.isFinite(west) || east <= west || north <= south) return;

  // 单站/极短路径的矩形会退化成一条线，补一个最小跨度，否则 flyTo 会算出离谱高度
  const padX = Math.max((east - west) * 0.12, 0.004);
  const padY = Math.max((north - south) * 0.12, 0.004);

  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(
      west - padX,
      south - padY,
      east + padX,
      north + padY,
    ),
    duration: 1.4,
  });
};
