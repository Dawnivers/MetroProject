import * as Cesium from 'cesium';

/** 垂直俯视的俯仰角：-90°（镜头朝正下方） */
const TOP_DOWN_PITCH = -Cesium.Math.PI_OVER_TWO;

/** 俯仰纠正的容差（0.5°）：偏差在容差内就当作还是垂直俯视，不去动相机 */
const PITCH_TOLERANCE = Cesium.Math.toRadians(0.5);

/** 俯仰兜底认的「刚操作过画布」窗口（ms）：足够盖住松手后的惯性滑行 */
const GESTURE_WINDOW = 2500;

/** 中键横向拖动旋转的手感：每像素转多少度 */
const TWIST_DEG_PER_PX = 0.28;

/**
 * 把相机锁成「垂直俯视 + 可平移 + 可缩放 + 可绕视线轴旋转」，但**禁止改变俯仰角**。
 *
 * 为什么需要：热力图是按**当前视野矩形**重画的，而 Cesium 的视野矩形同时受
 * 高度（缩放）和俯仰角影响 —— 调俯仰也会改变视野矩形，于是每转一下视角就重画一张。
 * 站点拥挤度不需要斜视，所以进入该模式时把镜头摆正，只留三种操作：
 *   左键拖 = 平移；滚轮 / 右键拖 = 缩放；**中键横向拖 = 旋转**（竖向不动）。
 * 停稳后各重绘一次（重绘的 220ms 防抖在 cesiumHeatMap 里）。
 *
 * 为什么平移要开 enableRotate（关键，别又改回去）：
 *   3D 场景里 ScreenSpaceCameraController.update3D 只绑了 rotate / tilt / zoom / look，
 *   **压根没绑 translate**（translate 只在 2D 和 Columbus 视图里生效）。左键拖动在 3D
 *   走的是 spin3D → pan3D「抓着地球拖」，而 spin3D 由 enableRotate 控制。
 *   所以「enableRotate = false 想只留缩放」的实际效果是连平移一起关死 ——
 *   之前只能缩放、拖不动画面就是这个原因。
 *   enableRotate 名字叫旋转，但在 3D 顶层视野下这条路径是平移，不会改俯仰
 *   （pan3D 旋转的是相机位置+朝向，相对当地法线的夹角不变，仍是 -90°）。
 *
 * 旋转（不改俯仰）为什么自己写：Cesium 3D 里没有「只转不倾」的内置绑定
 *   （twist 只在 2D 视图里有），而中键本来就是 Cesium 的 tilt 键。
 *   这里就把中键接管过来调 camera.twistLeft：它绕**视线轴**转相机，
 *   direction 一个分量都不动 ⇒ 俯仰天然还是 -90°、位置也不动，
 *   屏幕上表现为整幅图绕中心转。竖向位移**完全忽略**（用户要求：竖向禁用）。
 *   右键不碰，仍是 Cesium 默认的缩放。
 *
 * 俯仰靠两件事守住：
 *   ① controller.enableTilt / enableLook = false —— 中键 / Ctrl+左键 / Shift+左键
 *      这几条改俯仰/自由看的路直接没有绑定；
 *   ② 下面 moveEnd 里的兜底 —— 万一左键从「屏幕上点不到地面」的位置起拖，
 *      Cesium 会退化成 rotate3D 自由旋转把俯仰带偏，停稳时压回 -90°
 *      （只认画布手势后的 2.5s，免得把面板触发的 flyToStation 斜视镜头也掰回来）。
 *
 * @param {Cesium.Viewer} viewer
 * @returns {() => void} 恢复交互的回调（幂等）
 */
export function lockTopDownView(viewer) {
  const scene = viewer?.scene;
  const camera = viewer?.camera;
  if (!scene || !camera) return () => {};

  const controller = scene.screenSpaceCameraController;
  const saved = {
    enableRotate: controller.enableRotate,
    enableTilt: controller.enableTilt,
    enableTranslate: controller.enableTranslate,
    enableLook: controller.enableLook,
    enableZoom: controller.enableZoom,
  };

  // 平移 + 缩放留下；俯仰 / 自由看关掉
  controller.enableRotate = true; // 3D 里的左键拖动 = 平移（见上面注释，不是让用户转视角）
  controller.enableTilt = false; // 俯仰：禁止（中键改用来旋转，见下面）
  controller.enableTranslate = true;
  controller.enableLook = false;
  controller.enableZoom = true;

  // 把镜头摆到「当前视野中心的正上方」，高度不变，俯仰角 -90° = 垂直向下
  const ellipsoid = scene.globe?.ellipsoid ?? Cesium.Ellipsoid.WGS84;
  const rect = camera.computeViewRectangle(ellipsoid);
  const height = camera.positionCartographic?.height;
  const heading = camera.heading;

  if (rect && Number.isFinite(height)) {
    const lon = (rect.west + rect.east) / 2;
    const lat = (rect.south + rect.north) / 2;
    camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(lon, lat, height),
      orientation: { heading, pitch: TOP_DOWN_PITCH, roll: 0 },
      duration: 0.8,
    });
  } else {
    // 视野算不出来（相机看向天空等）：只改姿态，不动位置
    camera.setView({
      orientation: { heading, pitch: TOP_DOWN_PITCH, roll: 0 },
    });
  }

  // 兜底只对「用户自己在画布上操作」生效：记下最后一次画布手势的时间。
  // 为什么要分：面板点站点会 flyToStation 到 -50° 斜视，那是程序驱动的镜头，
  // 不该被这条兜底掰回 -90°（热力图自己会在 moveEnd 后按新视野重画）。
  const canvas = scene.canvas;
  let lastGestureAt = 0;
  const markGesture = () => {
    lastGestureAt = performance.now();
  };
  const gestureTypes = ['pointerdown', 'pointerup', 'pointercancel', 'wheel'];
  gestureTypes.forEach((type) =>
    canvas.addEventListener(type, markGesture, { passive: true }),
  );

  /** 兜底：手势期间俯仰一旦被带偏（见上面 ②），停稳时压回垂直俯视 */
  const enforceTopDownPitch = () => {
    if (performance.now() - lastGestureAt > GESTURE_WINDOW) return;
    if (Math.abs(camera.pitch - TOP_DOWN_PITCH) <= PITCH_TOLERANCE) return;
    // 只改姿态：destination 缺省 = 保持当前相机位置，所以不会把平移的位置弹回去
    camera.setView({
      orientation: { heading: camera.heading, pitch: TOP_DOWN_PITCH, roll: 0 },
    });
  };
  camera.moveEnd.addEventListener(enforceTopDownPitch);

  // ---------------------------------------------------------------- 旋转
  // 中键（按住滚轮）横向拖 = 绕视线轴转（camera.twistLeft）。twist 只改 up/right，
  // direction 一动不动 —— 所以俯仰、位置都不变，屏幕上就是整幅图绕中心转。
  // 竖向位移故意完全不参与：用户要求「按住滚轮竖向禁用」（Cesium 原本中键 = tilt）。
  let twisting = false;
  let twistLastX = 0;
  let twistPointerId = null;

  const onTwistDown = (event) => {
    if (event.button !== 1) return; // 中键
    twisting = true;
    twistPointerId = event.pointerId;
    twistLastX = event.clientX;
    // 拖到画布外面也要继续收 move（否则一出界就断）
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      /* 合成事件/无指针捕获能力时忽略 */
    }
    event.preventDefault();
  };

  const onTwistMove = (event) => {
    if (!twisting || event.pointerId !== twistPointerId) return;
    // 只看横向：竖向（dy）不参与任何计算
    const dx = event.clientX - twistLastX;
    twistLastX = event.clientX;
    if (!dx) return;
    // 往右拖 → 画面顺时针转（heading 变小）；想反向就把 twistLeft 换成 twistRight
    camera.twistLeft(Cesium.Math.toRadians(dx * TWIST_DEG_PER_PX));
    event.preventDefault();
  };

  const onTwistUp = (event) => {
    if (!twisting) return;
    if (event.pointerId !== twistPointerId) return;
    twisting = false;
    twistPointerId = null;
    try {
      canvas.releasePointerCapture?.(event.pointerId);
    } catch {
      /* 同上 */
    }
  };

  /**
   * 中键压下去时浏览器（Windows Chrome）会进「自动滚动」模式，滚动光标会把画面顶掉。
   * pointerdown 上的 preventDefault 拦不住这条默认行为，得在 mousedown 上再拦一次。
   */
  const onMiddleMouseDown = (event) => {
    if (event.button === 1) event.preventDefault();
  };

  /** 中键拖完松手时 Chrome 还会派一个 auxclick（可能会触发自动滚动/粘贴），一并拦掉 */
  const onAuxClick = (event) => {
    if (event.button === 1) event.preventDefault();
  };

  canvas.addEventListener('pointerdown', onTwistDown);
  canvas.addEventListener('pointermove', onTwistMove);
  canvas.addEventListener('pointerup', onTwistUp);
  canvas.addEventListener('pointercancel', onTwistUp);
  canvas.addEventListener('mousedown', onMiddleMouseDown);
  canvas.addEventListener('auxclick', onAuxClick);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    camera.moveEnd.removeEventListener(enforceTopDownPitch);
    gestureTypes.forEach((type) =>
      canvas.removeEventListener(type, markGesture),
    );
    canvas.removeEventListener('pointerdown', onTwistDown);
    canvas.removeEventListener('pointermove', onTwistMove);
    canvas.removeEventListener('pointerup', onTwistUp);
    canvas.removeEventListener('pointercancel', onTwistUp);
    canvas.removeEventListener('mousedown', onMiddleMouseDown);
    canvas.removeEventListener('auxclick', onAuxClick);
    controller.enableRotate = saved.enableRotate;
    controller.enableTilt = saved.enableTilt;
    controller.enableTranslate = saved.enableTranslate;
    controller.enableLook = saved.enableLook;
    controller.enableZoom = saved.enableZoom;
  };
}

export default lockTopDownView;
