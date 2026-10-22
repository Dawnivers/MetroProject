/*
 * @Description: HtmlMarker管理器，统一管理多个htmlMarker的位置更新
 * @Author: your name
 * @version:
 * @Date: 2025-01-30
 * @LastEditors: your name
 * @LastEditTime: 2025-01-30
 */
import * as Cesium from 'cesium';

/**
 * HtmlMarker管理器类
 * 使用统一的postRender监听器来更新所有htmlMarker的位置，提高性能
 */
class HtmlMarkerManager {
  /**
   * @param {Object} viewer - Cesium viewer实例
   */
  constructor(viewer) {
    this.viewer = viewer;
    this.markers = []; // 存储所有SimpleLabel实例
    this.isListening = false; // 是否已添加监听器
    this.postRenderBound = this.postRender.bind(this); // 绑定this的postRender方法
  }

  /**
   * 添加一个htmlMarker到管理器
   * @param {SimpleLabel} marker - SimpleLabel实例
   */
  addMarker(marker) {
    if (!marker) return;

    // 检查是否已存在
    if (this.markers.indexOf(marker) === -1) {
      this.markers.push(marker);

      // 如果还没有监听器，添加统一的监听器
      if (!this.isListening) {
        //等价于
        //this.viewer.scene.postRender.addEventListener(this.postRender, this);                                               
        this.viewer.scene.postRender.addEventListener(this.postRenderBound);
        this.isListening = true;
      }
    }
  }

  /**
   * 批量添加多个htmlMarker到管理器
   * @param {Array<SimpleLabel>} markers - SimpleLabel实例数组
   */
  addMarkers(markers) {
    if (!Array.isArray(markers)) return;

    markers.forEach((marker) => this.addMarker(marker));
  }

  /**
   * 从管理器中移除一个htmlMarker
   * @param {SimpleLabel} marker - SimpleLabel实例
   */
  removeMarker(marker) {
    const index = this.markers.indexOf(marker);
    if (index > -1) {
      this.markers.splice(index, 1);

      // 如果没有标记了，移除监听器
      if (this.markers.length === 0 && this.isListening) {
        this.viewer.scene.postRender.removeEventListener(this.postRenderBound);
        this.isListening = false;
      }
    }
  }

  /**
   * 批量移除多个htmlMarker
   * @param {Array<SimpleLabel>} markers - SimpleLabel实例数组
   */
  removeMarkers(markers) {
    if (!Array.isArray(markers)) return;

    markers.forEach((marker) => this.removeMarker(marker));
  }

  /**
   * 统一的postRender方法，更新所有标记的位置
   * 这是核心优化点：用一个监听器更新所有标记，而不是每个标记一个监听器
   */
  postRender() {
    /*
     * 用 clientHeight / clientWidth（CSS 布局尺寸），不要用 canvas.height / width。
     * 后者是绘制缓冲区尺寸 = CSS 尺寸 × pixelRatio × resolutionScale，
     * 而 wgs84ToWindowCoordinates 返回的是 CSS 像素坐标（Cesium 内部按
     * canvas.clientWidth / clientHeight 换算）。单位不一致会让气泡整体偏移
     * 「(1 − resolutionScale) × 画布高度」——实测 resolutionScale 0.75 时下移 225px，
     * 右下角的气泡还会被 condition1/3 误判出屏而隐藏。
     * 低画质（0.75）与 HiDPI（devicePixelRatio ≠ 1）都会踩到这个坑。
     */
    const canvasHeight = this.viewer.scene.canvas.clientHeight;
    const canvasWidth = this.viewer.scene.canvas.clientWidth;

    // 遍历所有标记，更新位置
    for (let i = 0; i < this.markers.length; i++) {
      const marker = this.markers[i];

      // 如果标记的DOM元素不存在，跳过
      if (
        !marker.vmInstance ||
        !marker.vmInstance.el ||
        !marker.vmInstance.el.style
      ) {
        continue;
      }

      // 显隐以 isDisplay 为唯一开关：关掉时直接隐藏后跳过后续计算。
      // 必须显式写 display:none —— 否则元素会保持上一次的 display 值，
      // 表现为「面板里关了站点，悬浮窗还挂在半空」。
      if (!marker.isDisplay) {
        marker.vmInstance.el.style.display = 'none';
        continue;
      }

      const windowPosition = new Cesium.Cartesian2();

      // 获取标记坐标点的屏幕坐标位置
      const success = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
        this.viewer.scene,
        marker.position,
        windowPosition,
      );

      // 如果坐标转换失败，跳过
      if (!success) continue;

      // 更新标记位置
      marker.vmInstance.el.style.bottom =
        canvasHeight - windowPosition.y + (marker.offset?.[1] || 0) + 'px';
      const elWidth = marker.vmInstance.el.offsetWidth;
      marker.vmInstance.el.style.left =
        windowPosition.x - elWidth / 2 + (marker.offset?.[0] || 0) + 'px';

      // 处理近大远小效果
      let filterFactor;
      if (marker.filterStructage === 'distance') {
        // 用 positionWC：相机被 lookAt 绑到局部坐标系时 camera.position 不是世界坐标
        filterFactor = Cesium.Cartesian3.distance(
          this.viewer.camera.positionWC,
          marker.position,
        );
      } else {
        filterFactor = Math.ceil(
          this.viewer.camera.positionCartographic.height,
        );
      }

      // 计算缩放比例
      const scaleSize = marker.calcaluteGrade(
        filterFactor,
        marker.scaleByDistance,
      );
      marker.vmInstance.el.style.transform = `scale(${scaleSize},${scaleSize})`;

      // 处理显示/隐藏逻辑：超出可视范围或相机太远时隐藏。
      // 阈值可由 marker.maxDistance 覆盖（默认 12000 米，只够街区级视角）。
      const maxDistance = marker.maxDistance ?? 12000;
      const condition1 =
        windowPosition.y < 0 || windowPosition.y > canvasHeight;
      const condition2 = filterFactor > maxDistance;
      const condition3 = windowPosition.x < 0 || windowPosition.x > canvasWidth;

      if (condition1 || condition2 || condition3) {
        marker.vmInstance.el.style.display = 'none';
      } else {
        marker.vmInstance.el.style.display = 'block';
      }
    }
  }

  /**
   * 清除所有标记
   */
  removeAll() {
    // 移除所有标记的DOM和事件
    this.markers.forEach((marker) => {
      if (marker.removeMarker) {
        marker.removeMarker();
      }
    });

    // 清空标记数组
    this.markers = [];

    // 移除监听器
    if (this.isListening) {
      this.viewer.scene.postRender.removeEventListener(this.postRenderBound);
      this.isListening = false;
    }
  }

  /**
   * 根据名称显示/隐藏标记
   * @param {Array<string>} names - 标记名称数组
   * @param {boolean} isShow - 是否显示
   */
  showByName(names, isShow) {
    if (!Array.isArray(names)) return;

    this.markers.forEach((marker) => {
      if (names.includes(marker.label)) {
        marker.isDisplay = isShow;
        if (marker.vmInstance && marker.vmInstance.el) {
          marker.vmInstance.el.style.display = isShow ? 'block' : 'none';
        }
      }
    });
  }

  /**
   * 根据名称查找标记
   * @param {string} name - 标记名称
   * @returns {SimpleLabel|null} 找到的标记，未找到返回null
   */
  findByName(name) {
    return this.markers.find((marker) => marker.label === name) || null;
  }

  /**
   * 根据名称查找多个标记
   * @param {Array<string>} names - 标记名称数组
   * @returns {Array<SimpleLabel>} 找到的标记数组
   */
  findByNames(names) {
    if (!Array.isArray(names)) return [];
    return this.markers.filter((marker) => names.includes(marker.label));
  }

  /**
   * 更新标记的位置
   * @param {string} name - 标记名称
   * @param {Cesium.Cartesian3} position - 新的位置
   */
  updatePositionByName(name, position) {
    const marker = this.findByName(name);
    if (marker && marker.changePosition) {
      marker.changePosition(position);
    }
  }

  /**
   * 获取所有标记
   * @returns {Array<SimpleLabel>} 所有标记数组
   */
  getAllMarkers() {
    return [...this.markers];
  }

  /**
   * 获取标记数量
   * @returns {number} 标记数量
   */
  getMarkerCount() {
    return this.markers.length;
  }

  /**
   * 销毁管理器，清理所有资源
   */
  destroy() {
    this.removeAll();
    this.viewer = null;
    this.markers = null;
    this.postRenderBound = null;
  }
}

export default HtmlMarkerManager;
