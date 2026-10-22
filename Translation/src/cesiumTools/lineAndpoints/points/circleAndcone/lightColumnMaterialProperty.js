// 重点活动「光柱」材质
//
// 与同目录 circleBottomGlowMaterialProperty.js 是同一套路子：
//   1. 一个自定义 Property 类（Entity 的材质必须是 Property 才被识别）；
//   2. 一张贴图，用 canvas 现场画出来（省掉一个 png 资源文件，也免得配 public 路径）；
//   3. 把材质注册进 Cesium.Material._materialCache，之后就能按 type 引用。
//
// 与参考项目 WallGradientsMaterialProperty 的差别（有意为之）：
//   · 参考项目把 isConstant 写死成 false，且贴图是外链 png；这里跟本项目
//     PolylineFlowMaterialProperty 保持一致——isConstant 交给 color 决定，
//     动画相位全部由着色器里的 czm_frameNumber 驱动，因此常量材质只编译一次
//     也能持续流动，省掉每帧回传 uniform 的开销。
//   · 参考项目的 time uniform 一直是 0，所以那条 `fract(st.t - time)` 其实
//     从来没有滚动过；这里的流动是真的在滚。

import * as Cesium from 'cesium';
// 必须加 ?raw：让 Vite 把 .glsl 的源码文本当字符串导入，Material 的 source 需要的是 GLSL 源码
import lightcolumn from './lightcolumn.glsl?raw';

// 默认材质颜色（未传 color 时使用）：琥珀金，和面板的描边色同一族
const defaultMaterialColor = new Cesium.Color(1.0, 0.72, 0.2, 0.85);

/**
 * 默认整体透明度倍率。
 *
 * 必须明显小于 1：着色器里 alpha = 贴图a × color.a × 顶部渐隐 × 呼吸 × opacity，
 * 其中呼吸峰值 1.3、贴图峰值 0.95，两者相乘已经超过 1。opacity 给 1.0 的话
 * 柱子中段会有一大截被 clamp 成完全不透明，看起来是一块实心色板而不是一根光柱。
 * 0.55 之后峰值 alpha 约 0.6，半透明发光感才对。
 */
const defaultOpacity = 0.55;

/**
 * 光柱贴图：一维竖直剖面，几道柔和的亮带。
 *
 * 只做 4px 宽 —— 着色器固定按 texture2D(image, vec2(0.5, ...)) 采样，
 * 横向内容用不上，做宽了纯属浪费显存。
 *
 * 首尾 alpha 必须相等（这里都是 0.22），否则 fract() 回卷的那一帧会闪出一条接缝。
 */
function createLightColumnTexture() {
  const width = 4;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0.0, 'rgba(255, 255, 255, 0.22)');
  gradient.addColorStop(0.16, 'rgba(255, 255, 255, 0.95)');
  gradient.addColorStop(0.34, 'rgba(255, 255, 255, 0.22)');
  gradient.addColorStop(0.52, 'rgba(255, 255, 255, 0.85)');
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.26)');
  gradient.addColorStop(0.86, 'rgba(255, 255, 255, 0.9)');
  gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.22)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  return canvas
    .toDataURL('image/png')
    .replace('image/png', 'image/octet-stream');
}

// 贴图只在模块加载时生成一次，之后所有光柱共用（避免每根柱子都重画 canvas）
const lightColumnImage = createLightColumnTexture();

class LightColumnMaterialProperty {
  /**
   * @param {Cesium.Color} color 光柱颜色
   * @param {object} [options]
   * @param {number} [options.opacity] 整体透明度倍率
   * @param {number} [options.flowSpeed] 光带向上流动的速度倍率
   * @param {number} [options.breatheSpeed] 明暗呼吸的速度倍率
   */
  constructor(color, options = {}) {
    this._definitionChanged = new Cesium.Event();
    this._color = undefined;
    this._colorSubscription = undefined;

    this._opacity = undefined;
    this._flowSpeed = undefined;
    this._breatheSpeed = undefined;

    this.color = color;
    this.opacity = Cesium.defaultValue(options.opacity, defaultOpacity);
    this.flowSpeed = Cesium.defaultValue(options.flowSpeed, 1.0);
    this.breatheSpeed = Cesium.defaultValue(options.breatheSpeed, 1.0);
  }

  // 三个表现参数都是普通数字（常量属性），因此整个材质是常量，Cesium 只编译一次
  get isConstant() {
    return (
      Cesium.Property.isConstant(this._color) &&
      Cesium.Property.isConstant(this._opacity) &&
      Cesium.Property.isConstant(this._flowSpeed) &&
      Cesium.Property.isConstant(this._breatheSpeed)
    );
  }

  get definitionChanged() {
    return this._definitionChanged;
  }

  getType() {
    return 'LightColumn';
  }

  getValue(time, result) {
    const timeScratch = new Cesium.JulianDate();
    if (!Cesium.defined(time)) {
      time = Cesium.JulianDate.now(timeScratch);
    }
    if (!Cesium.defined(result)) {
      result = {};
    }

    result.color = Cesium.Property.getValueOrClonedDefault(
      this._color,
      time,
      Cesium.Color.WHITE,
      result.color,
    );
    // 贴图固定不变，直接引用模块级常量
    result.image = lightColumnImage;
    result.opacity = Cesium.Property.getValueOrDefault(
      this._opacity,
      time,
      defaultOpacity,
      result.opacity,
    );
    result.flowSpeed = Cesium.Property.getValueOrDefault(
      this._flowSpeed,
      time,
      1.0,
      result.flowSpeed,
    );
    result.breatheSpeed = Cesium.Property.getValueOrDefault(
      this._breatheSpeed,
      time,
      1.0,
      result.breatheSpeed,
    );
    return result;
  }

  equals(other) {
    return (
      this === other ||
      (other instanceof LightColumnMaterialProperty &&
        Cesium.Property.equals(this._color, other._color) &&
        Cesium.Property.equals(this._opacity, other._opacity) &&
        Cesium.Property.equals(this._flowSpeed, other._flowSpeed) &&
        Cesium.Property.equals(this._breatheSpeed, other._breatheSpeed))
    );
  }
}

// 把四个参数都变成 Property，让 Entity 系统能统一管理并监听变化
Object.defineProperties(LightColumnMaterialProperty.prototype, {
  color: Cesium.createPropertyDescriptor('color'),
  opacity: Cesium.createPropertyDescriptor('opacity'),
  flowSpeed: Cesium.createPropertyDescriptor('flowSpeed'),
  breatheSpeed: Cesium.createPropertyDescriptor('breatheSpeed'),
});

// 将材质添加进 Material 大类的材质缓存中
Cesium.Material.LightColumnType = 'LightColumn';
Cesium.Material.LightColumnImage = lightColumnImage;
Cesium.Material.LightColumnSource = lightcolumn;

Cesium.Material._materialCache.addMaterial(Cesium.Material.LightColumnType, {
  fabric: {
    type: Cesium.Material.LightColumnType,
    uniforms: {
      color: defaultMaterialColor,
      image: lightColumnImage,
      opacity: defaultOpacity,
      flowSpeed: 1.0,
      breatheSpeed: 1.0,
    },
    source: lightcolumn,
  },
  translucent: true,
});

export default LightColumnMaterialProperty;
