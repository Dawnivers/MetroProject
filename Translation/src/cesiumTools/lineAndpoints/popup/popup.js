/*
 * @Description:
 * @Author: your name
 * @version:
 * @Date: 2024-05-14 09:35:39
 * @LastEditors: your name
 * @LastEditTime: 2025-04-18 11:38:26
 */
import { render, createVNode } from 'vue';
import { getStationInfo } from '@/api/request';
import * as Cesium from 'cesium';

/**
 * 当前打开着详情卡的那个标记。
 * 同一时刻只允许存在一张详情卡：打开新的就收掉上一张，
 * 否则连点几个站会在屏幕上叠一堆卡片。
 */
let activeQueryOwner = null;

/**
 * html简单文本标注类
 */
class SimpleLabel {
  constructor(viewer, options) {
    this.viewer = viewer;
    this.position = Cesium.defaultValue(
      options.position,
      Cesium.Cartesian3.ZERO,
    );
    this.label = Cesium.defaultValue(options.label, 'label');
    this.isShow = Cesium.defaultValue(options.isShow, true);
    this.color = Cesium.defaultValue(options.color, '#ff0000');
    this.fields = Cesium.defaultValue(options.fields, []);
    this.values = Cesium.defaultValue(options.values, []);
    this.scaleByDistance = Cesium.defaultValue(
      options.scaleByDistance,
      new Cesium.NearFarScalar(1000, 1, 20000, 0.4),
    );
    this.needOptimize = Cesium.defaultValue(options.needOptimize, true);
    // 气泡框优化逻辑，按照相机与气泡框距离(一些特殊场景会有问题)或者相机高度
    this.filterStructage = Cesium.defaultValue(
      options.filterStructage,
      'distance',
    );
    this.attr = Cesium.defaultValue(options.attr, {});
    this.popupType = Cesium.defaultValue(options.type, 'marker');
    this.offset = Cesium.defaultValue(options.offset, [0, 0]);
    // 徽标文字覆盖：路径规划给起终点传「起 / 终」，不传就是换乘站的「换」
    this.badge = Cesium.defaultValue(options.badge, '');
    // 是否由管理器管理，如果是，则不添加自己的postRender监听器
    this.managedByManager = Cesium.defaultValue(
      options.managedByManager,
      false,
    );
    // 距离相机的最大可见距离（米）：超过则由 postRender 隐藏。
    // 默认 12000 只适合街区级视角；城市级俯瞰（相机高几万米）需要放宽。
    this.maxDistance = Cesium.defaultValue(options.maxDistance, 12000);
    // 点击是否弹出「查询气泡」（type='queryPopup' 那张详情卡）。默认开；
    // 站点标签由 Toolbar 显式传 true，详情卡自己传 false 防止无限套娃。
    // 这是一个**运行时开关**：标签只挂一次，但这个值会被栏目按路由改写
    // （「重点活动」栏目要把所有站点标签的点击关掉），所以真正判定在 clickCallback 里现取。
    this.clickable = Cesium.defaultValue(options.clickable, true);
    // 支持多种vue模板，一码多用
    // 注意：模板已迁到 components/bottom/StationPanel/ 下，且文件名是 Marker
    this.popupRoutes = {
      marker: () =>
        import('@/components/bottom/StationPanel/MarkerTemplate.vue'),
      queryPopup: () =>
        import('@/components/bottom/StationPanel/queryTemplate.vue'),
      // 线路轨迹的列车气泡：跟着列车每帧移动，不吃点击、不按距离剔除
      carPopup: () => import('@/components/bottom/RealtimePanel/CarPopup.vue'),
    };
    this.queryPopup = null;

    this.isDisplay = true;
  }

  // 外部修改坐标
  changePosition(position) {
    this.position = position;
  }

  removeQueryPopup() {
    if (activeQueryOwner === this) activeQueryOwner = null;
    if (!this.queryPopup) return;
    this.queryPopup.removeMarker();
    this.queryPopup = null;
  }

  // 展示查询气泡框
  async showQueryPopup() {
    // 调用自己，展示新的气泡框
    // 从服务获取站点详细数据：getStationInfo 的入参是「站名字符串」而不是对象
    const { code, data } = await getStationInfo(this.attr.name);
    if (code === 200) {
      const address = data.address;
      const peopleFlow = data.peopleFlow;
      const fields = ['名称', '客流量状态', '所属线路', '是否换乘站'];
      const values = [
        this.attr.name,
        peopleFlow,
        address,
        this.attr.isChange ? '是' : '否',
      ];
      // 同时只允许存在一张详情卡：先收掉「别的站点」已经打开的那张，
      // 再收掉自己上一次的（连点同一个站也不会叠出两个框）。
      // 都放在 await 之后，这样连点（两次请求竞态返回）也只会剩最后一个。
      if (activeQueryOwner && activeQueryOwner !== this) {
        activeQueryOwner.removeQueryPopup();
      }
      this.removeQueryPopup();
      // 调用自己，展示查询气泡框
      this.queryPopup = new SimpleLabel(this.viewer, {
        position: this.position,
        label: this.attr.name,
        isShow: true,
        color: this.color,
        scaleByDistance: this.scaleByDistance,
        attr: this.attr,
        fields: fields,
        values: values,
        type: 'queryPopup',
        offset: [150, 150],
        // 详情卡自己不可再点开查询，否则会无限套娃
        clickable: false,
        // 可见距离跟随父标签：不传的话是默认的 12000 米，
        // 城市级俯瞰视角下详情卡会刚弹出来就被 postRender 判成「太远」而隐藏
        maxDistance: this.maxDistance,
      });
      this.queryPopup.addLabel();
      activeQueryOwner = this;
    }
  }

  async addLabel() {
    // 如果在模板中找不到对应的，直接返回
    if (!this.popupRoutes[this.popupType]) {
      return null;
    }
    // res就是vue组件
    const res = await this.popupRoutes[this.popupType]();
    //创建模板 label: this.properties.attr.label
    // vmInstance就是一个vue的实例，传入vue的模板，以及props
    this.vmInstance = createVNode(res.default, {
      label: this.label,
      color: this.color,
      position: this.position,
      attr: this.attr,
      // 换乘站标记：MarkerTemplate 靠它决定标记与徽标
      isChange: this.attr?.isChange ?? 0,
      // 起终点：把徽标从「换」换成「起 / 终」（空串时仍按 isChange 走「换」）
      badge: this.badge,
      // 查询气泡（queryTemplate）靠这两个渲染详情，必须传下去，
      // 否则 showQueryPopup 里算好的 fields/values 到不了模板，卡片是空的
      fields: this.fields,
      values: this.values,
      // 点击查询：**每次点击现判一次 this.clickable**，不能在这里就二选一。
      // 标签的方法只在 addLabel 时挂一次，而 clickable 是会被栏目按路由改写的运行时开关
      // （「重点活动」栏目进入时把所有站点标签关掉、离开时再打开）；
      // 若在此处定死成空函数，之后改 this.clickable 就再也影响不到已挂载的标签了。
      // 无论开关如何都给一个真函数，模板里的调用不会报错。
      clickCallback: () => {
        if (!this.clickable) return;
        this.showQueryPopup();
      },
      closePopup: () => this.removeMarker(),
    }); //根据模板创建一个面板
    this.mountNode = document.createElement('div');
    render(this.vmInstance, this.mountNode);
    this.viewer.cesiumWidget.container.appendChild(this.mountNode); //将字符串模板生成的内容添加到DOM上
    this.addPostRender();

    this.vmInstance.el.style.display = this.isShow ? 'block' : 'none';
    return this.vmInstance.el;
  }

  // 根据相机的高度，以及近大远小参数，计算当前气泡框的大小比例scale
  calcaluteGrade(curValue, stdNearFar) {
    let curPara = -1;
    if (curValue <= stdNearFar.near) {
      curPara = stdNearFar.nearValue;
    } else if (curValue >= stdNearFar.far) {
      curPara = stdNearFar.farValue;
    } else {
      const totalGrade = Math.ceil(
        Math.log(stdNearFar.far / stdNearFar.near) / Math.log(2),
      );
      const curGrade = Math.round(
        Math.log(curValue / stdNearFar.near) / Math.log(2),
      );
      curPara =
        stdNearFar.nearValue +
        ((stdNearFar.farValue - stdNearFar.nearValue) * curGrade) / totalGrade;
    }
    return curPara;
  }

  //添加场景事件
  addPostRender() {
    // 如果由管理器管理，则不添加自己的监听器
    if (this.managedByManager) {
      return;
    }
    this.viewer.scene.postRender.addEventListener(this.postRender, this);
  }

  //场景渲染事件 实时更新标签的位置 使其与笛卡尔坐标一致
  postRender() {
    if (!this.vmInstance.el || !this.vmInstance.el.style) return;
    // 显隐以 isDisplay 为唯一开关：关掉时直接隐藏后返回，
    // 不再往下算位置与缩放（也避免元素保持上一次的 display 值而「关不掉」）
    if (!this.isDisplay) {
      this.vmInstance.el.style.display = 'none';
      return;
    }
    /*
     * 必须用 clientHeight / clientWidth（CSS 布局尺寸），不能用 canvas.height / width。
     * canvas.height 是**绘制缓冲区**尺寸 = CSS 尺寸 × pixelRatio × resolutionScale，
     * 而下面 wgs84ToWindowCoordinates 返回的是 CSS 像素坐标（Cesium 内部就是按
     * canvas.clientWidth / clientHeight 换算的，见 SceneTransforms.js）。
     * 两者单位不一致时，气泡会整体偏移「(1 − resolutionScale) × 画布高度」：
     * 实测 resolutionScale 0.75 + 900px 画布，气泡下移 225px，且右下角气泡被误判出屏。
     * 低画质（0.75）和 HiDPI（devicePixelRatio ≠ 1）都会踩到。
     */
    const canvasHeight = this.viewer.scene.canvas.clientHeight;
    const canvasWidth = this.viewer.scene.canvas.clientWidth;
    const windowPosition = new Cesium.Cartesian2();
    // 获取站牌坐标点的屏幕坐标位置
    Cesium.SceneTransforms.wgs84ToWindowCoordinates(
      this.viewer.scene,
      this.position,
      windowPosition,
    );
    // 1.通过修改定位元素的方式，修改popup的位置
    // 2.通过transform的方式，修改popup的位置
    const elWidth = this.vmInstance.el.offsetWidth;
    let popupBottom = canvasHeight - windowPosition.y + this.offset[1];
    let popupLeft = windowPosition.x - elWidth / 2 + this.offset[0];

    /*
     * 详情卡（queryPopup）比站名标签宽得多（560px），还带一个 150px 的固定右偏移：
     *   · 靠屏幕右缘的站点会把卡片顶出画布 —— 实测 1600px 画布、380px 卡片时
     *     右边缘到 1638px，连右上角的关闭按钮都落在屏幕外，点都点不到；
     *   · 屏幕右半边则会一律贴边，还正好压住站点本身。
     * 所以详情卡分两步摆位：右边放不下、左边放得下就整体镜像到站点左侧；
     * 两边都放不下（窄屏 + 超大卡片）才退化成贴边。
     * 站名标签保持原来的居中行为不动。
     */
    if (this.popupType === 'queryPopup') {
      const elHeight = this.vmInstance.el.offsetHeight || 0;
      const offsetX = this.offset[0];
      const mirroredLeft = windowPosition.x - elWidth / 2 - offsetX;
      if (popupLeft + elWidth > canvasWidth && mirroredLeft >= 0) {
        popupLeft = mirroredLeft;
      }
      popupLeft = Math.min(
        Math.max(popupLeft, 0),
        Math.max(0, canvasWidth - elWidth),
      );
      popupBottom = Math.min(
        Math.max(popupBottom, 0),
        Math.max(0, canvasHeight - elHeight),
      );
    }

    this.vmInstance.el.style.bottom = popupBottom + 'px';
    this.vmInstance.el.style.left = popupLeft + 'px';

    if (this.needOptimize) {
      // 处理近大远小效果
      let filterFactor;
      if (this.filterStructage === 'distance') {
        // positionWC：camera.position 是当前参考系下的坐标，相机被 lookAt 绑到
        // 局部坐标系后（线路轨迹跟车）它是个小向量，量出来的距离是错的
        filterFactor = Cesium.Cartesian3.distance(
          this.viewer.camera.positionWC,
          this.position,
        );
      } else {
        filterFactor = Math.ceil(
          this.viewer.camera.positionCartographic.height,
        );
      }

      // 通过计算近截面大小与远截面大小，计算transform scale的比例
      const scaleSize = this.calcaluteGrade(filterFactor, this.scaleByDistance);
      // new Cesium.NearFarScalar()
      this.vmInstance.el.style.transform = `scale(${scaleSize},${scaleSize})`;

      // 抽吸：只显示当前窗口下的标牌
      // condition1 condition3 限制，只加载当前窗口下的气泡框
      // condition2 限制气泡框与相机的距离（阈值可由 maxDistance 覆盖）
      const condition1 =
        windowPosition.y < 0 || windowPosition.y > canvasHeight;
      const condition2 = filterFactor > this.maxDistance;
      const condition3 = windowPosition.x < 0 || windowPosition.x > canvasWidth;
      if (condition1 || condition2 || condition3) {
        this.vmInstance.el.style.display = 'none';
      } else {
        this.vmInstance.el.style.display = 'block';
      }
    }
  }

  removeMarker() {
    // 连带收掉自己弹出的查询气泡：父标签没了、详情卡还挂在半空是纯 DOM 泄漏。
    // 查询气泡本身是 clickable:false，不会再往下生成，所以不会递归。
    this.removeQueryPopup();
    this.mountNode &&
      this.viewer.cesiumWidget.container.removeChild(this.mountNode); //删除DOM
    // 如果不是由管理器管理，才移除自己的监听器
    if (!this.managedByManager) {
      this.viewer.scene.postRender.removeEventListener(this.postRender, this);
    }
    this.mountNode = null;
  }
}
export default SimpleLabel;
