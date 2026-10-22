import * as Cesium from 'cesium';
// 必须显式指到 build/ 下的文件：heatmap.js-fixed@2.0.2 的 package.json 写的是
// "main": "heatmap.min.js"，但包里根本没有这个文件（构建产物在 build/ 里）。
// 而且**不能用 build/heatmap.min.js**：压缩版 _colorize 给只读的 ImageData.data
// 整体赋值，ESM 严格模式下会抛 TypeError，热力图直接画不出来。
import * as heatmapPkg from 'heatmap.js-fixed/build/heatmap.js';

/**
 * 站点拥挤度热力图 —— 贴在地面上的影像层。
 *
 * 流程：heatmap.js 在离屏 canvas 上按点位叠径向渐变 → getDataURL() 得到 PNG
 * → 当 SingleTileImageryProvider 铺到一块矩形上。它是一层「影像」，盖在底图之上、
 * 三维实体之下，与站点光锥 / 线路 / 列车互不干扰。
 *
 * 更新时机：**相机停稳后**（moveEnd + 220ms 防抖）按当前视野重画一张。
 * 拖动/缩放过程中不重画，只有停稳后一次换图；画面不跟着抖，也不连续编码 PNG。
 *
 * 换图方式：新层先加入但 alpha=0，等「图片解码完 + 纹理真正 READY」后一帧内
 * 置 alpha=1 并移除旧层 —— 反过来先删再加的话，中间会有 1~2 帧没热力层（就是闪）。
 */

/** 热团半径，单位是**屏幕像素**（不随视高变，否则相邻两张图密度差太大） */
const RADIUS_SCREEN_PX = 70;

/**
 * 贴图在地面上比视野外扩的倍数：拖到松手（停稳 220ms 后重画）这一小段时间里，
 * 画面靠这张图的余量顶着，所以外扩要够拖一小段。1.18 只留 9% 边距，手一拖就露白，
 * 现在允许平移了改成 1.45（约每边 22%）。代价是同像素预算下纹理稀一点 —— 热团本来
 * 就是软渐变，看不太出来。
 */
const VIEW_PAD = 1.45;

/** 贴图画布的总像素预算。约 100 万，兼顾清晰度与 PNG 编码开销 */
const CANVAS_AREA = 1000 * 1000;

/** 画布单边上限，防止极端长宽比画出超宽图 */
const CANVAS_MAX_SIDE = 1400;

/** 半径下限：视野极大时也至少要有 2.5px，否则热点会彻底消失 */
const MIN_RADIUS_PX = 2.5;

/** 相机停稳后等这么久再重画（ms）。拖动过程中不重画 */
const UPDATE_DELAY = 220;

/** 1° 纬度 ≈ 111.32 km（经度要再乘 cos(纬度)） */
const METERS_PER_DEGREE = 111320;

/** heatmap.js-fixed 是 CJS 包，Vite 下 create 可能挂在 default 上 */
const h337 =
  heatmapPkg && typeof heatmapPkg.create === 'function'
    ? heatmapPkg
    : heatmapPkg?.default;

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/** 造一个带内联样式的 div，数字自动补 px（与课程版 newDiv 同义） */
function makeDiv(style, parent) {
  const div = document.createElement('div');
  if (parent) parent.append(div);
  Object.keys(style).forEach((key) => {
    const value = style[key];
    div.style[key] = typeof value === 'number' ? `${value}px` : value;
  });
  return div;
}

export default class CesiumHeat {
  /**
   * @param {Cesium.Viewer} viewer 三维场景
   * @param {Object} options
   * @param {Array<{x:number,y:number,value:number}>} options.points x=经度、y=纬度、value=拥挤度
   * @param {number[]} options.bbox [left, bottom, right, top]，数据地理范围，用于裁剪视野
   * @param {number} [options.radiusScreenPx] 热团半径（屏幕像素）
   * @param {number} [options.maxOpacity] 热点中心最大不透明度
   * @param {(err: Error) => void} [options.onError] 异步重绘失败回调
   */
  constructor(viewer, options = {}) { 
    const {
      points = [],
      bbox,
      radiusScreenPx = RADIUS_SCREEN_PX,
      maxOpacity = 0.75,
      onError = null,
    } = options;

    if (!viewer || (viewer.isDestroyed && viewer.isDestroyed())) {
      throw new Error('[CesiumHeat] 需要一个可用的 viewer');
    }
    if (!Array.isArray(bbox) || bbox.length !== 4) {
      throw new Error('[CesiumHeat] bbox 需要 [minLng, minLat, maxLng, maxLat]');
    }
    if (!h337 || typeof h337.create !== 'function') {
      throw new Error('[CesiumHeat] heatmap.js-fixed 没能加载出 create()');
    }

    this.viewer = viewer;
    this.radiusScreenPx = radiusScreenPx;
    this.maxOpacity = maxOpacity;
    this.onError = typeof onError === 'function' ? onError : null;

    // 数据地理范围 [西, 南, 东, 北]：视野比它大时裁到它
    this.dataBbox = bbox.map(Number);
    const [west, south, east, north] = this.dataBbox;
    if (!(east > west) || !(north > south)) {
      throw new Error('[CesiumHeat] bbox 的宽高必须大于 0');
    }

    // 只留合法点；lng/lat 单独存，每次重绘按新视野重新投影
    this.points = [];
    let max = -Infinity;
    let min = Infinity;
    points.forEach((point) => {
      const lng = Number(point.x);
      const lat = Number(point.y);
      const value = Number(point.value);
      if (![lng, lat, value].every(Number.isFinite)) return;
      this.points.push({ lng, lat, value });
      if (value > max) max = value;
      if (value < min) min = value;
    });
    // 颜色标尺用**全量**数据：否则每次换视野颜色都会跳
    this.max = this.points.length ? max : 0;
    this.min = this.points.length ? min : 0;

    // 固定的离屏挂载点；每次重绘只换它内部那一层容器（画布尺寸随视野变）
    this.mountPoint = makeDiv(
      {
        position: 'absolute',
        top: 0,
        left: 0,
        overflow: 'hidden',
        width: 0,
        height: 0,
        'z-index': -100,
        'pointer-events': 'none',
      },
      document.body,
    );
    this.container = null;
    this.heatmap = null;

    /** 当前正在显示的热力层 */
    this.layer = null;
    /** 正在等纹理就绪、尚未显示的新层 */
    this.pending = null;
    /** 停稳后的重画定时器 */
    this.timer = null;
    /** 未裁剪的视野范围（度），用于把屏幕像素换算成画布像素 */
    this.viewRect = null;

    // 相机停稳 → 按新视野重画。拖动/缩放过程中不重画。
    this.onMoveEnd = () => this.scheduleUpdate();
    viewer.camera.moveEnd.addEventListener(this.onMoveEnd);

    this.refresh();
  }

  // ---------------------------------------------------------------- 调度

  /** 防抖：连续触发只留最后一次 */
  scheduleUpdate() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, UPDATE_DELAY);
  }

  // ---------------------------------------------------------------- 视野

  /**
   * 本次贴图要覆盖的矩形（度）：视野外扩一圈，再与数据范围求交
   * （数据之外没有点，多画的都是空白）。
   */
  coverageRect() {
    const camera = this.viewer?.camera;
    if (!camera) return null;

    const raw = camera.computeViewRectangle(this.viewer.scene?.globe?.ellipsoid);
    if (!raw || !(raw.east > raw.west)) return null;

    const view = {
      west: Cesium.Math.toDegrees(raw.west),
      south: Cesium.Math.toDegrees(raw.south),
      east: Cesium.Math.toDegrees(raw.east),
      north: Cesium.Math.toDegrees(raw.north),
    };
    this.viewRect = view;

    const padW = ((view.east - view.west) * (VIEW_PAD - 1)) / 2;
    const padH = ((view.north - view.south) * (VIEW_PAD - 1)) / 2;
    const [bWest, bSouth, bEast, bNorth] = this.dataBbox;

    const rect = {
      west: Math.max(view.west - padW, bWest),
      south: Math.max(view.south - padH, bSouth),
      east: Math.min(view.east + padW, bEast),
      north: Math.min(view.north + padH, bNorth),
    };
    if (!(rect.east > rect.west) || !(rect.north > rect.south)) return null;
    return rect;
  }

  /** 按地面长宽比分配画布尺寸（1° 经度 ≈ 111km×cos 纬度，不能直接当像素） */
  canvasSizeFor(rect) {
    const midLat = (((rect.south + rect.north) / 2) * Math.PI) / 180;
    const aspect =
      ((rect.east - rect.west) * Math.cos(midLat)) / (rect.north - rect.south);
    let height = Math.round(Math.sqrt(CANVAS_AREA / aspect));
    height = clamp(height, 128, CANVAS_MAX_SIDE);
    let width = Math.round(height * aspect);
    width = clamp(width, 128, CANVAS_MAX_SIDE);
    return { width, height };
  }

  /** 恒定屏幕半径 → 本次画布的像素半径（屏幕米/px ÷ 画布米/px = 放大倍数） */
  radiusInCanvasPx(rect, canvasWidth) {
    const midLat = (((rect.south + rect.north) / 2) * Math.PI) / 180;
    const cosLat = Math.cos(midLat);
    const canvasMetersPerPx =
      ((rect.east - rect.west) * METERS_PER_DEGREE * cosLat) / canvasWidth;
    if (!(canvasMetersPerPx > 0)) return MIN_RADIUS_PX;

    const view = this.viewRect ?? rect;
    const viewportWidth = this.viewer?.canvas?.clientWidth || canvasWidth;
    const screenMetersPerPx =
      ((view.east - view.west) * METERS_PER_DEGREE * cosLat) / viewportWidth;
    if (!(screenMetersPerPx > 0)) return MIN_RADIUS_PX;

    const px = (this.radiusScreenPx * screenMetersPerPx) / canvasMetersPerPx;
    return Math.max(MIN_RADIUS_PX, px);
  }

  // ---------------------------------------------------------------- 绘制

  refresh() {
    if (!this.viewer) return;
    try {
      this.render();
    } catch (err) {
      if (this.onError) this.onError(err);
      else console.error('[CesiumHeat] 重绘失败', err);
    }
  }

  render() {
    const rect = this.coverageRect();
    if (!rect) {
      this.dropLayer();
      return;
    }

    const { width, height } = this.canvasSizeFor(rect);
    const radius = this.radiusInCanvasPx(rect, width);
    this.rebuildCanvas(width, height);

    const data = this.projectPoints(rect, width, height, radius);
    // 视野里没有站点时也走同一套换层流程：换一张全透明贴图，不会"啪"地清空
    this.heatmap.setData({ max: this.max, min: this.min, data });
    this.syncLayer(rect);
  }

  /** 重建画布：heatmap.js 的容器尺寸在 create 时固定，换尺寸就换一个实例 */
  rebuildCanvas(width, height) {
    if (this.container) {
      this.container.remove();
      this.container = null;
      this.heatmap = null;
    }
    this.container = makeDiv({ width, height }, this.mountPoint);
    this.heatmap = h337.create({
      maxOpacity: this.maxOpacity,
      container: this.container,
    });
  }

  /**
   * 把点投影到本次视野的画布上，顺手丢掉视野外的点。
   * 注意 y 是反的（纬度越大越靠上），且 heatmap.js 用 x/y 当数组下标，必须取整。
   */
  projectPoints(rect, width, height, radius) {
    const spanLng = rect.east - rect.west;
    const spanLat = rect.north - rect.south;
    const margin = radius * 2; // 圆心在图外、但光晕还在图内的点不能丢
    const data = [];

    this.points.forEach(({ lng, lat, value }) => {
      const x = ((lng - rect.west) / spanLng) * width;
      const y = ((rect.north - lat) / spanLat) * height;
      if (x < -margin || x > width + margin) return;
      if (y < -margin || y > height + margin) return;
      data.push({ x: Math.round(x), y: Math.round(y), value, radius });
    });
    return data;
  }

  // ---------------------------------------------------------------- 换层

  /**
   * 换成新的一层影像。新层先以 alpha=0 加入，等「图片解码完 + 纹理 READY」
   * 再一帧内切过去（见 waitForLayer）。
   */
  syncLayer(rect) {
    const scene = this.viewer?.scene;
    if (!scene || !this.heatmap) return;

    // 上一张还没换上就被顶掉：丢掉它，别让它半途出现在屏幕上
    if (this.pending) {
      scene.imageryLayers.remove(this.pending.layer, true);
      this.pending = null;
    }

    const provider = new Cesium.SingleTileImageryProvider({
      url: this.heatmap.getDataURL(),
      rectangle: Cesium.Rectangle.fromDegrees(
        rect.west,
        rect.south,
        rect.east,
        rect.north,
      ),
    });
    const layer = scene.imageryLayers.addImageryProvider(provider);
    layer.alpha = 0;

    const pending = {
      layer,
      previous: this.layer,
      providerReady: false,
      createdAt: performance.now(),
    };
    this.pending = pending;

    const markReady = () => {
      if (this.pending === pending) pending.providerReady = true;
    };
    if (provider.readyPromise && typeof provider.readyPromise.then === 'function') {
      provider.readyPromise.then(markReady, markReady);
    } else {
      pending.providerReady = true;
    }
    this.waitForLayer(pending, 0);
  }

  /** 等这张纹理真的可画了再切显隐、移除旧层（最多等约 1s，之后强制切） */
  waitForLayer(pending, attempt) {
    if (this.pending !== pending) return; // 已被更新的请求取代
    const scene = this.viewer?.scene;
    if (!scene) return;

    const ready = pending.providerReady && this.layerIsRenderable(pending.layer);
    const timeout = performance.now() - pending.createdAt > 1000;
    if (!ready && !timeout && attempt < 60) {
      requestAnimationFrame(() => this.waitForLayer(pending, attempt + 1));
      return;
    }

    pending.layer.alpha = 1;
    if (pending.previous) {
      scene.imageryLayers.remove(pending.previous, true);
    }
    this.layer = pending.layer;
    this.pending = null;
  }

  /** 纹理是否真的可画（Cesium 内部 tile 状态 READY）。取不到就当作可用，绝不阻塞 */
  layerIsRenderable(layer) {
    if (!layer) return true;
    try {
      const cache = layer._imageryCache;
      if (!cache) return true;
      const tiles = Object.keys(cache).map((key) => cache[key]);
      if (!tiles.length) return false;
      return tiles.some(
        (tile) => tile && tile.state === Cesium.ImageryState.READY,
      );
    } catch (err) {
      return true;
    }
  }

  dropLayer() {
    const scene = this.viewer?.scene;
    if (!scene) return;
    if (this.pending) {
      scene.imageryLayers.remove(this.pending.layer, true);
      this.pending = null;
    }
    if (this.layer) {
      scene.imageryLayers.remove(this.layer, true);
      this.layer = null;
    }
  }

  /** 只切显隐，不重建（用于临时开关热力层） */
  setVisible(show) {
    if (this.layer) this.layer.show = Boolean(show);
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    const camera = this.viewer?.camera;
    if (camera && this.onMoveEnd) {
      camera.moveEnd.removeEventListener(this.onMoveEnd);
    }
    this.onMoveEnd = null;

    this.dropLayer();
    if (this.mountPoint) {
      this.mountPoint.remove();
      this.mountPoint = null;
    }
    this.container = null;
    this.heatmap = null;
    this.points = [];
    this.viewer = null;
  }
}
