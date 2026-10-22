import * as Cesium from 'cesium';
import * as dat from 'dat.gui';

/**
 * 模型位姿变换工具
 * 将 3D Tiles 模型定位到指定经纬度，并在 ENU(东北天) 局部坐标系上叠加平移 / 旋转 / 缩放。
 * 矩阵以“覆盖根变换”(tileset.root.transform) 的方式应用，等效于忽略 tileset.json 自带的根变换。
 */

// 默认定位锚点（经度、纬度）—— 地铁项目模型基准点
const DEFAULT_LOCATION = { lon: 121.4997, lat: 31.2397 };

/**
 * 构建模型变换矩阵（纯函数，不依赖 viewer）
 * @param {Object} params 变换参数
 * @param {number} params.tx    X 轴平移（米）
 * @param {number} params.ty    Y 轴平移（米）
 * @param {number} params.tz    Z 轴平移（米，高程方向）
 * @param {number} params.rx    绕 X 轴旋转（度）
 * @param {number} params.ry    绕 Y 轴旋转（度）
 * @param {number} params.rz    绕 Z 轴旋转（度）
 * @param {number} params.scale 整体缩放
 * @param {{lon:number, lat:number}} [location] 定位锚点，默认 DEFAULT_LOCATION
 * @returns {Cesium.Matrix4} 4x4 变换矩阵
 */

//根据传入的坐标 构建模型矩阵
export const buildModelMatrix = (params, location = DEFAULT_LOCATION) => {
  const { tx, ty, tz, rx, ry, rz, scale } = params;

  // 锚点处的 ENU(东北天) 矩阵，作为变换的基准坐标系
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(location.lon, location.lat),
  );

  // 平移矩阵
  const translation = Cesium.Matrix4.fromTranslation(
    new Cesium.Cartesian3(tx, ty, tz),
    new Cesium.Matrix4(),
  );

  // 旋转矩阵：Cesium 只能先建三阶(fromRotationX/Y/Z)再转四阶(fromRotation)
  const rotX = Cesium.Matrix4.fromRotation(
    Cesium.Matrix3.fromRotationX(Cesium.Math.toRadians(rx)),
    new Cesium.Matrix4(),
  );
  const rotY = Cesium.Matrix4.fromRotation(
    Cesium.Matrix3.fromRotationY(Cesium.Math.toRadians(ry)),
    new Cesium.Matrix4(),
  );
  const rotZ = Cesium.Matrix4.fromRotation(
    Cesium.Matrix3.fromRotationZ(Cesium.Math.toRadians(rz)),
    new Cesium.Matrix4(),
  );

  // 缩放矩阵
  const scaleMatrix = Cesium.Matrix4.fromUniformScale(
    scale,
    new Cesium.Matrix4(),
  );

  // 依次右乘：ENU * 平移 * 旋转X * 旋转Y * 旋转Z * 缩放
  Cesium.Matrix4.multiply(transform, translation, transform);
  Cesium.Matrix4.multiply(transform, rotX, transform);
  Cesium.Matrix4.multiply(transform, rotY, transform);
  Cesium.Matrix4.multiply(transform, rotZ, transform);
  Cesium.Matrix4.multiply(transform, scaleMatrix, transform);

  return transform;
};

/**
 * 应用模型变换：构建矩阵并覆盖到 tileset 根变换，随后主动请求重绘。
 * @param {Cesium.Cesium3DTileset} tileset 3D Tiles 模型实例
 * @param {Object} params 变换参数（同 buildModelMatrix）
 * @param {Cesium.Viewer} viewer 用于 requestRenderMode 下手动触发重绘
 * @param {{lon:number, lat:number}} [location] 定位锚点，默认 DEFAULT_LOCATION
 */

//传入3dtiles 将模型矩阵赋值给3dtils
export const applyModelTransform = (tileset, params, viewer, location) => {
  if (!tileset) return;

  const matrix = buildModelMatrix(params, location);
  tileset.root.transform = matrix; // 覆盖式设置根变换，等价于原先的 _root.transform

  // requestRenderMode=true 下，单纯改矩阵不会自动触发重绘，需主动请求一次
  viewer && viewer.scene && viewer.scene.requestRender();
};

// 默认滑块区间（min/max），供 bindModelTransformGUI 使用；step 可选，缺省时由 dat.GUI 自动推断
export const DEFAULT_TRANSFORM_RANGES = {
  tx: { min: -200, max: 200 },
  ty: { min: -200, max: 200 },
  tz: { min: -100, max: 100 },
  rx: { min: 0, max: 360 },
  ry: { min: 0, max: 360 },
  rz: { min: 0, max: 360 },
  scale: { min: 1, max: 10 },
};

/**
 * 批量注册模型变换滑块：按 ranges 遍历字段，逐个 gui.add 并绑定 onChange。
 * @param {Object} opts
 * @param {dat.GUI} opts.gui        dat.GUI 实例
 * @param {Object} opts.params      参数对象（tx/ty/tz/rx/ry/rz/scale）
 * @param {Function} opts.getTileset 返回当前模型实例的函数（异步加载完成后才有值）
 * @param {Function} opts.getViewer   返回当前 viewer 的函数
 * @param {Object} [opts.ranges]      每个字段的 { min, max, step? } 区间，默认 DEFAULT_TRANSFORM_RANGES
 */
//根据param 和 range 逐个 gui.add 并绑定 onChange。
export const bindModelTransformGUI = ({
  gui,
  params,
  getTileset,
  getViewer,
  ranges = DEFAULT_TRANSFORM_RANGES,
}) => {
  Object.entries(ranges).forEach(([key, { min, max, step }]) => {
    const onValueChange = () => {
      applyModelTransform(getTileset(), params, getViewer());
    };
    // 提供 step 时作为精调步长，否则交由 dat.GUI 自动推断
    if (step !== undefined) {
      gui.add(params, key, min, max, step).onChange(onValueChange);
    } else {
      gui.add(params, key, min, max).onChange(onValueChange);
    }
  });
};

/**
 * 创建模型变换调试面板：内部 new dat.GUI + 注册滑块，返回 gui 实例。
 * @param {Object} opts
 * @param {Object} opts.params      参数对象（tx/ty/tz/rx/ry/rz/scale）
 * @param {Function} opts.getTileset 返回当前模型实例的函数
 * @param {Function} opts.getViewer   返回当前 viewer 的函数
 * @param {Object} [opts.ranges]      每个字段的 { min, max, step? } 区间，默认 DEFAULT_TRANSFORM_RANGES
 * @param {Object} [opts.guiOptions]  dat.GUI 构造参数（如 { autoPlace: false }）
 * @returns {dat.GUI} gui 实例
 */
export const createModelTransformGUI = ({
  params,
  getTileset,
  getViewer,
  ranges = DEFAULT_TRANSFORM_RANGES,
  guiOptions,
}) => {
  const gui = new dat.GUI(guiOptions);
  bindModelTransformGUI({ gui, params, getTileset, getViewer, ranges });
  return gui;
};
