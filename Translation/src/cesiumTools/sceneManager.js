import * as Cesium from 'cesium';

// Cesium ion 令牌走环境变量（VITE_CESIUM_ION_TOKEN，见 .env.local / .env.example）。
//
// 本项目的底图是 ArcGIS UrlTemplate、地形用默认椭球，**完全不经过 ion**，
// 所以留空也能跑 —— 保留这一行只是为了将来要用 ion 资产（world terrain / 3D Tiles 等）
// 时不用改代码。
//
// 必须说清的一件事：VITE_ 前缀的变量会被 Vite 内联进 dist 的 js 里，浏览器里
// 直接就能读到，**它不是秘密**。真要保护，只能在 ion 控制台给这个 token
// 限制可用资产（Assets）和允许的来源（Allowed URLs），而不是指望前端藏住它。
Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? '';

// 初始化地图场景
export const initViewer = (container) => {
  // 初始化cesium地图对象viewer
  const viewer = new Cesium.Viewer(container, {
    timeline: false, // 是否显示时间线控件
    animation: false, // 是否显示动画控件
    baseLayerPicker: false, // 避免token
    infoBox: false, // 是否显示点击要素之后显示的信息
    selectionIndicator: false, //选中元素显示,默认true
    skyAtmosphere: false, //关闭地球光环
    homeButton: false,
    fullscreenButton: false,
    geocoder: false,
    sceneModePicker: false,
    shouldAnimate: true,
    navigationHelpButton: false,
    //项目无时间变化时使用
    // requestRenderMode: true, // 只在画面变化时渲染
    // maximumRenderTimeChange: 1 / 60, // 最大渲染时间间隔，避免无限循环

    //terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    // 使用本地椭球地形，避免初始化时请求 Cesium Ion
    //terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    //使用离线地形
    /*  terrainProvider: new Cesium.CesiumTerrainProvider({
            url: 'http://localhost:666/model/PengJiang_Terrian',
            requestVertexNormals: true, // 请求照明
            requestWaterMask: true // 请求水波纹效果
 }), */
    // 使用 ArcGIS 影像服务作为底图，不依赖 Cesium Ion Token
    imageryProvider: new Cesium.UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    }),
    //使用自制底图
    /*   imageryProvider:new Cesium.UrlTemplateImageryProvider({
    url: 'http://localhost:666/model/PenJiang/{z}/{x}/{y}.png',
    minimumLevel: 10,
    maximumLevel: 16,
    tilingScheme: new Cesium.WebMercatorTilingScheme(), // 瓦片方案 墨卡托投影，和Cesium World terrain默认投影一致
    rectangle: Cesium.Rectangle.fromDegrees(112.7321, 22.361, 113.3954, 22.898),// 自定义请求影像范围
  }) , */
  });
  viewer.scene.debugShowFramesPerSecond = true; //显示帧率
  return viewer;
};

// 设置后处理效果
export const setScene = (viewer) => {
  //隐藏太阳
  viewer.scene.sun.show = false;
  //隐藏月亮
  viewer.scene.moon.show = false;
  viewer.scene.globe.enableLighting = true; // 开启全球光照

  // 泛光设置
  const bloom = viewer.scene.postProcessStages.bloom;
  bloom.enabled = false;

  // 亮度设置
  // 亮度设置
  var stages = viewer.scene.postProcessStages;
  // 是否支持图像渲染像素化处理
  if (Cesium.FeatureDetection.supportsImageRenderingPixelated()) {
    viewer.resolutionScale = window.devicePixelRatio;
  }

  // 开启抗锯齿
  viewer.scene.postProcessStages.fxaa.enabled = true;

  viewer.scene.brightness =
    viewer.scene.brightness ||
    stages.add(Cesium.PostProcessStageLibrary.createBrightnessStage());
  viewer.scene.brightness.enabled = true;
  viewer.scene.brightness.uniforms.brightness = 1.2;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer._cesiumWidget._creditContainer.style.display = 'none';

  viewer.shadows = false; //开启阴影效果
  viewer.shadowMap.darkness = 0.8; //阴影透明度--越大越透明
  //去cesium logo水印 或 css
  viewer.cesiumWidget.creditContainer.style.display = 'none'; //去cesium logo水印

  // 场景设置
  viewer.scene.highDynamicRange = true;
  viewer.scene.postProcessStages.bloom.enabled = true;
  viewer.scene.postProcessStages.bloom.uniforms.contrast = 255;
  viewer.scene.postProcessStages.bloom.uniforms.brightness = 0.02;
  viewer.scene.postProcessStages.bloom.uniforms.glowOnly = false;
  viewer.scene.postProcessStages.bloom.uniforms.delta = 3.1;
  viewer.scene.postProcessStages.bloom.uniforms.sigma = 5;
  viewer.scene.postProcessStages.bloom.uniforms.stepSize = 0.6;
  viewer.scene.postProcessStages.bloom.uniforms.isSelected = false;
  viewer.scene.postProcessStages.bloom.uniforms.selectedBloom = 10;
  viewer.scene.postProcessStages.bloom.uniforms.bloomColor =
    Cesium.Color.fromCssColorString('#fafafa');
  viewer.scene.sun.show = false;
  viewer.scene.moon.show = false;
  viewer.scene.undergroundMode = false;
  viewer.scene.terrainProvider.isCreateSkirt = false;
  viewer.scene.globe.showGroundAtmosphere = false;
  viewer.scene.globe.enableLighting = true;
  viewer.scene.fog.enabled = false;
};

// 多个3dtiles模型加载
// urls 多个3dtiles模型地址  loadCb 加载完成的回调
// urls<{url,options}>
/* 
 const modelUrls = [{
      url:"http://localhost:666/model/model/tileset.json",
      options:{}
    }] */
export const loadTilesets = async (viewer, urls, loadCb) => {
  const tilesets = urls.map((item) => {
    const { url, options } = item;
    let params = { url };

    //如果选项里有参数 就将其整合到params
    /*
    const tileset = new Cesium.Cesium3DTileset({
      url: 'http://localhost:666/model/model/tileset.json',
      ...defaultOpts,
}); 
*/
    const defaultOpts = {
      // ================= 加载优化参数 =================
      skipLevelOfDetail: true, // 启用LOD层级跳过优化（建议true）
      baseScreenSpaceError: 512, // 基础屏幕空间误差阈值（值越大加载越激进）
      skipScreenSpaceErrorFactor: 16, // LOD跳过的误差乘数（值越大跳过越多层级）
      skipLevels: 1, // 最小跳过的层级数
      immediatelyLoadDesiredLevelOfDetail: false, // 是否仅加载满足误差要求的层级
      loadSiblings: false, // 是否加载相邻瓦片（关闭可提升中心区域加载优先级）

      // ================= 渲染性能参数 =================
      maximumMemoryUsage: 2048, // 最大内存使用(MB)，根据设备配置调整512 1024
      progressiveResolutionHeightFraction: 0.5, // 渐进加载分辨率比例（0-1，值越小初始越模糊）

      // ================= 动态加载优化 =================
      dynamicScreenSpaceError: true, // 启用动态屏幕空间误差优化（根据视距调整细节）
      dynamicScreenSpaceErrorDensity: 10, // 动态误差密度（值越大周边加载越快）

      // ================= 视觉焦点优化 =================
      foveatedScreenSpaceError: true, // 启用中心焦点区域优先加载
      foveatedConeSize: 0.1, // 焦点区域锥形角度（0-1，值越小中心区域越优先）

      // ================= 调试选项 =====================
      debugShowContentBoundingVolume: false, // 显示内容包围盒
      debugShowBoundingVolume: false, // 显示瓦片包围盒
      debugShowViewerRequestVolume: false, // 显示请求范围体积
      debugColorizeTiles: false, // 随机颜色区分瓦片
      cullWithChildrenBounds: false, // ---优化选项。是否使用子边界体积的并集来剔除瓦片（默认true）
      cullRequestsWhileMoving: false, // ---优化选项。不要请求由于相机移动而在返回时可能未使用的图块。这种优化只适用于静止的瓦片集(默认true)
      cullRequestsWhileMovingMultiplier: 10, // 值越小能够更快的剔除 ---优化选项。移动时用于剔除请求的乘数。较大的是更积极的剔除，较小的较不积极的剔除(默认60)原10
      preloadWhenHidden: true, // ---tileset.show时 预加载瓷砖false。加载图块，就好像图块集可见但不渲染它们(默认false)
      preloadFlightDestinations: true, // ---优化选项。在相机飞行时在相机的飞行目的地预加载图块(默认true)
      preferLeaves: true, // ---优化选项。最好先装载叶子(默认false)
      dynamicScreenSpaceErrorHeightFalloff: 0.25, // --- 密度开始下降的瓦片集高度的比率(默认0.25)
      foveatedMinimumScreenSpaceErrorRelaxation: 0.0, // --- 优化选项。当Cesium3DTileset#foveatedScreenSpaceError为 true 时使用以控制中央凹锥之外的图块的起始屏幕空间误差松弛。屏幕空间错误将从 tileset 值开始Cesium3DTileset#maximumScreenSpaceError根据提供的Cesium3DTileset#foveatedInterpolationCallback.(默认0.0)
      luminanceAtZenith: 0.2, // --- 用于此模型的程序环境贴图的天顶处的太阳亮度（以千坎德拉每平方米为单位）(默认0.2)
      backFaceCulling: true, // --- 是否剔除背面几何体。当为 true 时，背面剔除由 glTF 材质的 doubleSided 属性确定；如果为 false，则禁用背面剔除(默认true)
      debugFreezeFrame: false, // --- 仅用于调试。确定是否应仅使用最后一帧的图块进行渲染(默认false)
      debugShowGeometricError: false, // --- 仅用于调试。如果为 true，则绘制标签以指示每个图块的几何误差(默认false)
      debugShowRenderingStatistics: false, // --- 仅用于调试。如果为 true，则绘制标签以指示每个图块的命令、点、三角形和特征的数量(默认false)
      debugShowMemoryUsage: false, // --- 仅用于调试。如果为 true，则绘制标签以指示每个图块使用的纹理和几何内存（以兆字节为单位）(默认false)
      debugShowUrl: false, // --- 仅用于调试。如果为 true，则绘制标签以指示每个图块的 url(默认false)
    };

    Object.assign(params, defaultOpts);
    if (typeof options === 'object') {
      Object.assign(params, options);
    }
    const tile = viewer.scene.primitives.add(
      new Cesium.Cesium3DTileset(params),
    );
    return tile.readyPromise; //tilesets是 Promise数组
  });
  //result是一个数组，每个元素是一个 Promise，Promise 解析后是一个 Cesium3DTileset 实例
  let result = await Promise.all(tilesets); //`Promise.all` 接收一个 Promise 数组，**并行等待所有 Promise 都完成**：
  loadCb && loadCb(result); //如果传了 `loadCb` 回调函数，就调用它，把加载好的瓦片数组传过去。
};

// 视角飞到全局 （位置 速度 相机参数）
export const flyToDefaultView = (viewer) => {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(113.95, 30.19, 34000),
    duration: 2,
    orientation: {
      heading: Cesium.Math.toRadians(35.0),
      pitch: Cesium.Math.toRadians(-37.0),
      roll: 0.0,
    },
  });
};

/**
 * 项目默认视角（2026-10-07 从浏览器里实际调好的画面采样固化而来）。
 *
 * 与下面那个 flyToDefaultView 的区别：那份是早期写死的"全局俯瞰"占位视角，
 * 现在项目每次进入都停在这里，不再依赖 zoomTo 让 Cesium 自己算包围球。
 *
 * 想换默认视角：在浏览器里把画面调到满意，F12 执行
 *   (() => { const c = __cesiumViewer.camera; const p = c.positionCartographic; const d = 180/Math.PI;
 *     return { lon:+(p.longitude*d).toFixed(6), lat:+(p.latitude*d).toFixed(6), height:+p.height.toFixed(2),
 *              heading:+(c.heading*d).toFixed(4), pitch:+(c.pitch*d).toFixed(4), roll:+(c.roll*d).toFixed(4) }; })()
 * 把结果填到下面的数字里即可。
 */
export const DEFAULT_VIEW = {
  longitude: 121.458201,
  latitude: 31.270543,
  height: 4821.76,
  heading: 131.1964,
  pitch: -45.3461,
  roll: 0.0108,
};

/** DEFAULT_VIEW → camera.setView / flyTo 的参数 */
const defaultViewOptions = () => ({
  destination: Cesium.Cartesian3.fromDegrees(
    DEFAULT_VIEW.longitude,
    DEFAULT_VIEW.latitude,
    DEFAULT_VIEW.height,
  ),
  orientation: {
    heading: Cesium.Math.toRadians(DEFAULT_VIEW.heading),
    pitch: Cesium.Math.toRadians(DEFAULT_VIEW.pitch),
    roll: Cesium.Math.toRadians(DEFAULT_VIEW.roll),
  },
});

/** 立即把相机切到默认视角（setView 无飞行动画，进项目即到位） */
export const applyDefaultView = (viewer) => {
  viewer.camera.setView(defaultViewOptions());
};

/**
 * 飞回默认视角 —— 点「首页」时用。
 *
 * 必须先解绑相机：实时轨迹的跟车视角会把相机绑进 lookAtTransform 的局部坐标系，
 * 那时 camera.position 是个几十米的小向量，直接 flyTo 会把落点算到错误的地方。
 * 顺序与 TrainRoam.destroy() 一致：先清 trackedEntity，再恢复单位变换。
 *
 * @param {Cesium.Viewer} viewer
 * @param {number} [duration] 飞行动画秒数；传 0 则瞬移（等价 applyDefaultView）
 */
export const flyToHome = (viewer, duration = 1.2) => {
  if (!viewer || viewer.isDestroyed?.()) return;

  viewer.trackedEntity = undefined;
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

  const options = defaultViewOptions();
  if (duration > 0) viewer.camera.flyTo({ ...options, duration });
  else viewer.camera.setView(options);
};


