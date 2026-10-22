/**
 * 列车漫游的内核 ---------- T2 + T3
 *
 * 一个类，四种能力：造实体、配时钟、跟相机、清理。
 *
 * 设计取向（与「重点活动」「发展历程」两个栏目一致）：
 *   · **Cesium 对象不放进 Vue 响应式容器**（这里不碰 store，也不返回 ref）；
 *   · 三维侧的清理不能指望路由，必须由调用方 onBeforeUnmount 显式 destroy；
 *   · 时间轴是唯一真值：位置 = SampledPositionProperty.getValue(clock.currentTime)，
 *     所以拖动时间轴时列车、气泡、面板高亮会自动一起正确 —— 不需要第二套同步逻辑。
 *
 * 三条必须知道的机制（都核过 Cesium 1.97 源码）：
 *
 * 1) `Clock.tick` 里的 `onTick` 是**无条件**抛的（Core/Clock.js）：
 *      if (canAnimate && shouldAnimate) { 推进 currentTime }
 *      this.onTick.raiseEvent(this);
 *    所以暂停状态、以及拖动时间轴的过程中，它照样每帧触发 —— 面板高亮就挂在这里。
 *
 * 2) 拖动时间轴时 Cesium 会把 `shouldAnimate` 置 false（原生 Viewer.js:52-56 同款），
 *    松开鼠标时本项目复制版 timeline.js:800 会把它置回 true，所以**松手自动续播**。
 *    代价是「用户主动暂停后拖一下也会被强制续播」，因此这里用 `intent` 兜底：
 *    暂停状态下每帧把 shouldAnimate 压回 false。
 *
 * 3) `path.leadTime / trailTime` 让引擎按时间裁剪轨迹（PathVisualizer.js:481-486）：
 *    只画 [t - trailTime, t + leadTime]。把 trailTime 设成 ~3km 对应的秒数、
 *    leadTime 设 0，就得到「只显示走过的路」的效果，而且拖动时间轴天然正确。
 */

import * as Cesium from 'cesium';
import {
  buildSchedule,
  locate,
  reversePositions,
  TRAIN_SPEED,
  TRAIN_DWELL,
} from './trainSchedule';

/** 模型放在 src/assets 下；用 URL 构造可以让 Vite 正确产出资源地址（23.56MB，不做内联） */
const MODEL_URL = new URL(
  '../../../assets/trainAndChisa_static.glb',
  import.meta.url,
).href;

/** 演示时希望整条线多少秒跑完（真实速度太慢：11 号线 74km 要 74 分钟）。
 *  这个数字直接决定观感车速：42 秒跑完 1 号线（37km）等于 900m/s，太快；
 *  90 秒约等于 415m/s，仍快但看得清站名切换。想更慢就调大这一个数。 */
const WALL_SECONDS = 90;

/** 轨迹尾巴保留的实际长度（米），换算成秒后传给 trailTime */
const TRAIL_METERS = 3000;

export class TrainRoam {
  constructor(viewer) {
    this.viewer = viewer;
    this.entity = null;
    this.schedule = null;
    this.startTime = null;
    this.endTime = null;
    /** 起跑点在时间表上的秒数（0 = 首站发车）；点站点会改它 */
    this.startOffset = 0;
    /** 'playing' | 'paused' —— 用户意图，用来顶住「拖完时间轴强制续播」 */
    this.intent = 'playing';
    /** 'follow' | 'third' | 'free' */
    this.followMode = 'follow';
    /** 每帧回调：({ t, index, inStation, progress, position }) => void */
    this.onUpdate = null;

    this.heading = undefined;
    this.lastTime = undefined;

    /**
     * 跟车视距（米）。滚轮可调，范围见下面两个常量。
     * 因为每帧都用 `camera.lookAt(pos, HeadingPitchRange(...,range))` 重新摆机位，
     * 只要改这个数，下一帧就生效 —— 这也是放弃 trackedEntity 之后顺带拿到的好处。
     */
    this.range = 190;
    this.minRange = 22;
    this.maxRange = 2420;

    /**
     * 跟车机位的**方向**（弧度）。左键拖动改它，滚轮改 this.range。
     * 因为每帧都用 lookAt 重摆机位，所以这里只记角度、下一帧就生效。
     * 与 applyThirdPerson 用的 this.heading（平滑量）是两套，别混。
     */
    this.viewHeading = Cesium.Math.toRadians(35);
    this.viewPitch = Cesium.Math.toRadians(-22);
    this.minPitch = Cesium.Math.toRadians(-82);
    this.maxPitch = Cesium.Math.toRadians(-4);
    /** 拖动中：{ x, y, heading, pitch }；null 表示没在拖 */
    this._drag = null;
    /** Cesium 自带鼠标交互的开关注快照，退出时原样还原 */
    this._controls = null;

    this.onWheel = this.handleWheel.bind(this);
    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);
    this.onMouseDown = this.handleMouseDownCapture.bind(this);

    this._cameraMatrix = new Cesium.Matrix4();
    this._fieldOfView = new Cesium.HeadingPitchRoll();
    this._position = new Cesium.Cartesian3();

    this.tick = this.handleTick.bind(this);
  }

  /**
   * 载入一条线路并开始漫游。重复调用会自动先清理上一条。
   * @param {Object} options
   * @param {number[]} options.positions 一维经纬度（正向顺序）
   * @param {Array} options.stations 站点数组（按 sort 升序）
   * @param {Cesium.Color|string} [options.color] 线路色
   * @param {'forward'|'reverse'} [options.direction] 行车方向
   */
  load({
    positions,
    stations,
    color,
    direction = 'forward',
    speed,
    dwell,
    startOffset = 0,
  }) {
    if (this.entity) this.destroy();

    // 始终记住**正向**入参，reverse() 才有东西可重建（只翻方向，不翻数据）
    this._raw = { positions, stations, color, speed, dwell };

    const travelPositions =
      direction === 'reverse' ? reversePositions(positions) : positions;
    const travelStations =
      direction === 'reverse' ? stations.slice().reverse() : stations;

    const schedule = buildSchedule({
      positions: travelPositions,
      stations: travelStations,
      speed: speed ?? TRAIN_SPEED,
      dwell: dwell ?? TRAIN_DWELL,
    });
    if (!schedule.samples.length) return null;

    this.schedule = schedule;
    this.direction = direction;

    const vertexCount = schedule.vertexCount;
    const cartesians = Cesium.Cartesian3.fromDegreesArray(travelPositions);
    const startTime = Cesium.JulianDate.fromDate(new Date());
    const endTime = Cesium.JulianDate.addSeconds(
      startTime,
      schedule.total,
      new Cesium.JulianDate(),
    );

    const sampledProperty = new Cesium.SampledPositionProperty();
    const time = new Cesium.JulianDate();
    schedule.samples.forEach((sample) => {
      Cesium.JulianDate.addSeconds(startTime, sample.t, time);
      sampledProperty.addSample(Cesium.JulianDate.clone(time), cartesians[sample.vi]);
    });

    /*
     * 朝向**不能**用 VelocityOrientationProperty。
     *
     * 根因（Cesium 1.97 VelocityVectorProperty.js:184）：它取 time±0.5s 两个位置做差，
     * 两点相等时直接 `return undefined`；而停站那一段的采样位置本来就完全相同，
     * 于是这一刻 entity.orientation 变成 undefined，ModelVisualizer 退回默认 ENU 朝向
     * —— 表现就是「到站车头扭一下（转向正东），出站又转回来」。
     *
     * 解法：自己供给方向向量。按采样点预先算好每个区间的行进方向（停站区间继承
     * 进站方向），得到的方向**永远非零**，再用 Cesium 自己的
     * `rotationMatrixFromPositionVelocity` 换算成四元数 —— 与原来跑动时的观感完全一致，
     * 只是停站期间稳稳保持进站朝向。
     */
    this._sampleTimes = schedule.samples.map((sample) => sample.t);
    const samplePoints = schedule.samples.map((sample) => cartesians[sample.vi]);
    const dirs = [];
    let carry = null;
    for (let k = 0; k < samplePoints.length - 1; k++) {
      const vector = Cesium.Cartesian3.subtract(
        samplePoints[k + 1],
        samplePoints[k],
        new Cesium.Cartesian3(),
      );
      // 1cm 以内视为同一个点（停站）
      if (Cesium.Cartesian3.magnitudeSquared(vector) > 1e-4) {
        Cesium.Cartesian3.normalize(vector, vector);
        carry = vector;
      }
      dirs.push(carry);
    }
    const fallback = dirs.find((dir) => dir !== null) ?? Cesium.Cartesian3.UNIT_X;
    this._dirs = dirs.map((dir) => dir ?? fallback);

    this._orientationPos = new Cesium.Cartesian3();
    this._orientationRot = new Cesium.Matrix3();
    const orientation = new Cesium.CallbackProperty((currentTime, result) => {
      const position = sampledProperty.getValue(currentTime, this._orientationPos);
      const direction = this.directionAt(currentTime);
      if (!position || !direction) return undefined;
      const rotation = Cesium.Transforms.rotationMatrixFromPositionVelocity(
        position,
        direction,
        Cesium.Ellipsoid.WGS84,
        this._orientationRot,
      );
      return Cesium.Quaternion.fromRotationMatrix(rotation, result);
    }, false);

    const trailTime = Math.max(30, Math.round(TRAIL_METERS / schedule.speed));

    this.entity = this.viewer.entities.add({
      name: 'realtime-train',
      availability: new Cesium.TimeIntervalCollection([
        new Cesium.TimeInterval({ start: startTime, stop: endTime }),
      ]),
      position: sampledProperty,
      // 自算朝向：停站期间保持进站方向，不会退回正东（原因见上方注释）
      orientation,
      model: {
        uri: MODEL_URL,
        // 实测：这个 glb 的节点自带 0.01 缩放，Entity 端 scale=1 就是真实车辆尺寸
        // （视距 90m 时车长约 30m、屏幕宽约 600px，观感正确）。
        // 刻意**不设 minimumPixelSize / maximumScale**：那一对组合的「按像素保底缩放」
        // 会在模型的包围球就绪前算出极端倍数，实测导致车要么被放到几十公里长、
        // 要么直接看不见；而我们的相机始终跟在 90m 处，根本不需要像素保底。
        scale: 5,
      },
      path: {
        material: new Cesium.PolylineGlowMaterialProperty({
          color: Cesium.Color.fromCssColorString(
            color || '#e2ba64',
          ).withAlpha(0.9),
          glowPower: 1.0,
          taperPower: 0.4,
        }),
        width: 8,
        leadTime: 0,
        trailTime,
      },
    });

    this.sampled = sampledProperty;
    this.startTime = startTime;
    this.endTime = endTime;
    this.vertexCount = vertexCount;
    this.intent = 'playing';
    this.heading = undefined;
    this.lastTime = undefined;

    const clock = this.viewer.clock;
    // 起跑偏移：点站点时可能要求「从第 8 站和第 7 站之间起跑」。
    // 注意 this.startTime 仍然是**时间表原点**（首站发车），handleTick 里的
    // t = currentTime - startTime 必须带上这个偏移，否则高亮会错到首站去。
    this.startOffset = Cesium.Math.clamp(startOffset, 0, schedule.total);
    const clockStart = Cesium.JulianDate.addSeconds(
      startTime,
      this.startOffset,
      new Cesium.JulianDate(),
    );

    clock.shouldAnimate = true;
    clock.startTime = clockStart;
    clock.stopTime = endTime;
    clock.currentTime = Cesium.JulianDate.clone(clockStart);
    // 演示取景：整条线固定 WALL_SECONDS 秒跑完；真实时刻表不受影响
    clock.multiplier = Math.max(1, schedule.total / WALL_SECONDS);
    // LOOP_STOP：跑到终点自动回起点重播，不会因为 availability 到期而「车消失」
    clock.clockRange = Cesium.ClockRange.LOOP_STOP;

    clock.onTick.addEventListener(this.tick);
    // 滚轮调距离、左键拖动调方向，都挂在 canvas 上。
    // passive:false 才能 preventDefault 掉 Cesium 自己的滚轮缩放。
    const canvas = this.viewer.scene.canvas;
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    // 中键自动滚动：必须在 mousedown 阶段拦，pointerdown 拦不住
    canvas.addEventListener('mousedown', this.onMouseDown);
    this.setFollow(this.followMode);

    return schedule;
  }

  /** 反向：按 E1 策略「停下重建」，等价于换了一列车。相机保持不动，避免闪一帧 */
  reverse() {
    if (!this._raw) return null;
    return this.load({
      ...this._raw,
      direction: this.direction === 'reverse' ? 'forward' : 'reverse',
    });
  }

  /**
   * 'follow' 每帧把相机锁在车后上方；'third' 手动平滑跟车；'free' 放开相机。
   *
   * 这里**没有用 `viewer.trackedEntity`**。原因实测过：
   * trackedEntity 的相机位姿依赖 `dataSourceDisplay.getBoundingSphere()`，
   * 而 24MB 的 glb 加载完成前它一直返回 PENDING，期间相机一动不动；
   * 更麻烦的是它把相机锁成功后，`trackedEntityOffset` 的 range 在实测里没生效
   * （相机贴在车身上，离车 3m）。自己每帧 `lookAt` 反而确定、可控。
   */
  setFollow(mode) {
    this.followMode = mode;
    const viewer = this.viewer;
    if (!viewer) return;

    viewer.trackedEntity = undefined;
    if (mode === 'free') {
      this.restoreCameraControls();
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      return;
    }
    // 'follow' / 'third' 都由 handleTick 每帧接管，先把 Cesium 自带的交互关掉，
    // 否则用户拖一下会被我们的 lookAt 立刻拉回去，看起来像"拖不动"
    this.lockCameraControls();
    this.viewer.scene.requestRender?.();
  }

  /** 跟车机位：方向取用户拖出来的角度，距离取滚轮调出来的 this.range */
  applyFollow(position) {
    this.viewer.camera.lookAt(
      position,
      new Cesium.HeadingPitchRange(
        this.viewHeading,
        this.viewPitch,
        this.range,
      ),
    );
  }

  /**
   * 跟车时把 Cesium 自带的鼠标交互关掉。
   * 相机已经由我们每帧摆位，两套一起动只会互相抢（表现为拖一下弹回去）。
   * 快照存起来，'free' 模式和退出时原样还原，不影响其他栏目。
   */
  lockCameraControls() {
    const c = this.viewer?.scene?.screenSpaceCameraController;
    if (!c || this._controls) return;
    this._controls = {
      enableRotate: c.enableRotate,
      enableTranslate: c.enableTranslate,
      enableZoom: c.enableZoom,
      enableTilt: c.enableTilt,
      enableLook: c.enableLook,
    };
    c.enableRotate = false;
    c.enableTranslate = false;
    c.enableZoom = false;
    c.enableTilt = false;
    c.enableLook = false;
  }

  /** 还原 lockCameraControls 改过的开关 */
  restoreCameraControls() {
    const c = this.viewer?.scene?.screenSpaceCameraController;
    if (!c || !this._controls) return;
    Object.assign(c, this._controls);
    this._controls = null;
  }

  /**
   * 按下：**左键 = 水平转动（heading）**、**中键（按住滚轮）= 俯仰（pitch）**。
   *
   * 这个分工是照抄 Cesium 默认映射的，核过 ScreenSpaceCameraController.js：
   *   :176  rotateEventTypes = LEFT_DRAG
   *   :193  tiltEventTypes = [MIDDLE_DRAG, PINCH, ...]
   * 我们只是接管了「谁来执行」，键位没变。
   */
  handlePointerDown(event) {
    if (!this.entity || this.followMode === 'free') return;
    const mode =
      event.button === 0 ? 'orbit' : event.button === 1 ? 'tilt' : null;
    if (!mode) return;
    this._drag = {
      mode,
      x: event.clientX,
      y: event.clientY,
      heading: this.viewHeading,
      pitch: this.viewPitch,
    };
    // 捕获指针：拖到画布外面也继续跟随，松手不会卡在"拖动中"
    this.viewer.scene.canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  /**
   * 拖动：**左键只改水平角**；**中键同时改水平角与俯角**。
   *
   * 两个轴都从「按下那一刻」的基准算（_drag.heading / _drag.pitch），
   * 所以同一个拖动里 dx 只影响 heading、dy 只影响 pitch，互不干扰、不会累积漂移。
   * 灵敏度 0.35°/px（横）、0.28°/px（纵），俯角夹在 minPitch ~ maxPitch。
   */
  handlePointerMove(event) {
    if (!this._drag) return;
    const DEG = Cesium.Math.toRadians(1);
    const dx = event.clientX - this._drag.x;
    const dy = event.clientY - this._drag.y;

    if (this._drag.mode === 'orbit') {
      // 左键：只管水平，纵向拖动不影响俯角
      this.viewHeading = this._drag.heading - dx * 0.35 * DEG;
    } else {
      // 中键：水平 + 俯仰同时生效
      this.viewHeading = this._drag.heading - dx * 0.35 * DEG;
      this.viewPitch = Cesium.Math.clamp(
        this._drag.pitch - dy * 0.28 * DEG,
        this.minPitch,
        this.maxPitch,
      );
    }
    event.preventDefault();
  }

  handlePointerUp(event) {
    if (!this._drag) return;
    this._drag = null;
    this.viewer.scene.canvas.releasePointerCapture?.(event.pointerId);
  }

  /**
   * 中键按下时压掉浏览器的「自动滚动」光标。
   * 只在 pointerdown 里 preventDefault 是没用的：自动滚动由 mousedown 触发，
   * 而 pointerdown 早于它、取消不了后续事件，所以必须再单独拦一次 mousedown。
   */
  handleMouseDownCapture(event) {
    if (event.button === 1) event.preventDefault();
  }

  /**
   * 滚轮缩放跟车视距。
   *
   * 必须 preventDefault：否则 Cesium 默认的滚轮缩放会同时作用到地球上，
   * 而下一帧我们又用 lookAt 把机位拉回来，画面会「抖一下再回弹」。
   * 顺带一提，这里能动是因为每帧都重新摆机位 —— 所以改完 range 立刻生效。
   */
  handleWheel(event) {
    if (!this.entity || this.followMode === 'free') return;
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.12 : 1 / 1.12;
    this.range = Cesium.Math.clamp(
      this.range * factor,
      this.minRange,
      this.maxRange,
    );
    this.viewer.scene.requestRender?.();
  }

  play() {
    this.intent = 'playing';
    this.viewer.clock.shouldAnimate = true;
  }

  pause() {
    this.intent = 'paused';
    this.viewer.clock.shouldAnimate = false;
  }

  /** 把时钟拨回本次的起跑点（点过站点就是那段折线，否则是首站）—— 面板上的「重播」 */
  restart() {
    if (!this.startTime) return;
    this.intent = 'playing';
    this.jumpTo(this.startOffset);
    this.viewer.clock.shouldAnimate = true;
  }

  /**
   * 拖动面板进度条：只挪**当前时刻**，不动起跑点。
   *
   * 与 jumpTo 的区别：
   *   · jumpTo（点站点）改的是「从哪开始跑」，连带把 clock.startTime 一起挪；
   *   · seek（拖进度条）只是「跳到时间表第 t 秒看一眼」，循环区间保持原样。
   * 两者都不重建实体，所以拖动是零成本的。
   */
  seek(t) {
    if (!this.schedule || !this.startTime) return;
    const seconds = Cesium.Math.clamp(t, 0, this.schedule.total);
    this.viewer.clock.currentTime = Cesium.JulianDate.addSeconds(
      this.startTime,
      seconds,
      new Cesium.JulianDate(),
    );
    this.viewer.scene.requestRender?.();
  }

  /** 开始拖动：先停表，否则时钟推进每帧都在改 currentTime，会和拖动抢 */
  beginScrub() {
    this.viewer.clock.shouldAnimate = false;
  }

  /** 结束拖动：按拖动前的意图决定是否继续播（暂停状态拖完仍然暂停） */
  endScrub() {
    this.viewer.clock.shouldAnimate = this.intent !== 'paused';
  }

  /**
   * 把「起跑点」挪到时间表第 t 秒，并让时钟从那里开始走。
   *
   * 刻意不重建实体：
   *   · 只挪起点，采样表 / 模型 / 相机全都不用动，切换是瞬间的（不会闪、不会重载 24MB glb）；
   *   · clock.startTime 一起挪，所以 LOOP_STOP 循环回的是这个新起点而不是首站；
   *   · this.startTime 保持不动 —— handleTick 里 t = currentTime − startTime 必须带上偏移，
   *     否则高亮会跳回第一站。
   *
   * @param {number} t 相对首站发车的秒数，会被夹到 [0, total]
   */
  jumpTo(t) {
    if (!this.schedule || !this.startTime) return;
    const clock = this.viewer.clock;
    this.startOffset = Cesium.Math.clamp(t, 0, this.schedule.total);

    const clockStart = Cesium.JulianDate.addSeconds(
      this.startTime,
      this.startOffset,
      new Cesium.JulianDate(),
    );
    clock.startTime = clockStart;
    clock.currentTime = Cesium.JulianDate.clone(clockStart);
    clock.shouldAnimate = this.intent !== 'paused';
    this.viewer.scene.requestRender?.();
  }

  /**
   * 取当前时刻应走的**单位方向向量**（ECEF）。
   *
   * 与采样点一一预存：停站区间的方向继承进站方向，所以停着的时候朝向不变；
   * 出站后落到下一个跑动区间即自动换成新方向。
   * 二分查找，采样点最多几百个，每帧一次可忽略。
   */
  directionAt(time) {
    const times = this._sampleTimes;
    const dirs = this._dirs;
    if (!times?.length || !dirs?.length || !this.startTime) return null;

    const t = Cesium.JulianDate.secondsDifference(time, this.startTime);
    if (t <= times[0]) return dirs[0];
    if (t >= times[times.length - 1]) return dirs[dirs.length - 1];

    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      // +1e-3：JulianDate 两次换算回来的秒数会有 1e-9 级误差，
      // 正好落在采样时刻时可能被判成「上一段」，到站那一帧就会多转几度。
      if (times[mid] <= t + 1e-3) lo = mid;
      else hi = mid - 1;
    }
    return dirs[Math.min(lo, dirs.length - 1)];
  }

  /** 每帧：顶住强制续播 → 算当前站 → 跟车 → 回调给面板 */
  handleTick() {
    const clock = this.viewer.clock;
    if (this.intent === 'paused' && clock.shouldAnimate) {
      clock.shouldAnimate = false;
    }
    if (!this.schedule || !this.entity) return;

    const t = Cesium.JulianDate.secondsDifference(clock.currentTime, this.startTime);
    const offset = ((t % this.schedule.total) + this.schedule.total) % this.schedule.total;
    const position = this.entity.position.getValue(
      clock.currentTime,
      this._position,
    );

    if (position) {
      if (this.followMode === 'follow') this.applyFollow(position);
      else if (this.followMode === 'third') {
        this.applyThirdPerson(position, clock.currentTime);
      }
    }

    this.onUpdate?.({
      t: offset,
      raw: t,
      ...locate(this.schedule, offset),
      // 克隆一份：这个向量每帧复用，直接外传的话对面存下来的引用会一直变
      position: position ? Cesium.Cartesian3.clone(position) : null,
    });
  }

  /**
   * 第三人称：相机在车后上方，航向按帧间隔指数平滑，避免过弯甩镜头。
   * 帧间隔用 JulianDate 差值算，保证平滑效果不随帧率变化。
   */
  applyThirdPerson(position, currentTime) {
    const modelMatrix = this.entity.computeModelMatrix(
      currentTime,
      this._cameraMatrix,
    );
    const hpr = Cesium.Transforms.fixedFrameToHeadingPitchRoll(
      modelMatrix,
      undefined,
      undefined,
      this._fieldOfView,
    );
    const target = hpr.heading;

    if (this.heading === undefined) this.heading = target;

    let delta = 1 / 60;
    if (this.lastTime) {
      delta = Cesium.Math.clamp(
        Cesium.JulianDate.secondsDifference(currentTime, this.lastTime),
        0,
        0.1,
      );
    }
    this.lastTime = Cesium.JulianDate.clone(currentTime);

    let diff = target - this.heading;
    if (diff > Math.PI) diff -= Cesium.Math.TWO_PI;
    else if (diff < -Math.PI) diff += Cesium.Math.TWO_PI;
    this.heading += diff * (1 - Math.pow(0.001, delta / 0.3));

    const frame = Cesium.Transforms.headingPitchRollToFixedFrame(
      position,
      new Cesium.HeadingPitchRoll(this.heading, 0, 0),
    );
    this.viewer.camera.lookAtTransform(
      frame,
      new Cesium.Cartesian3(-90, 0, 36),
    );
  }

  /**
   * 清理。keepCamera=true 用于「点反向」这种马上要重建的场合，
   * 避免相机瞬移回原位再被拉回去（会闪一帧）。
   */
  destroy({ keepCamera = false } = {}) {
    const viewer = this.viewer;
    if (!viewer) return;

    viewer.clock.onTick.removeEventListener(this.tick);
    const canvas = viewer.scene.canvas;
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('mousedown', this.onMouseDown);
    this._drag = null;
    // 相机交互开关必须还原，否则离开栏目后其他页面的鼠标拖拽会失效
    this.restoreCameraControls();

    if (!keepCamera) {
      // 先解相机锁再删实体：顺序反了相机会锁在一个已销毁的实体上
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    }
    viewer.trackedEntity = undefined;

    viewer.clock.shouldAnimate = false;

    if (this.entity) {
      this.entity.show = false;
      viewer.entities.remove(this.entity);
    }

    this.entity = null;
    this.sampled = null;
    this._sampleTimes = null;
    this._dirs = null;
    this.schedule = null;
    this.startTime = null;
    this.endTime = null;
    this.heading = undefined;
    this.lastTime = undefined;
  }
}

export default TrainRoam;
