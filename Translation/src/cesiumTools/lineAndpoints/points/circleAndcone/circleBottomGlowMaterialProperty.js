// 底部圆形泛光材质（地面光圈）
// 实体的材质需要Property才能被识别
// 1.编译类 2.添加进大类中 最终也是被编译成material

import * as Cesium from 'cesium';
// 必须加 ?raw：让 Vite 把 .glsl 的源码文本当字符串导入，Material 的 source 需要的是 GLSL 源码
import circleglow from './circleglow.glsl?raw';

// 默认材质颜色（未传 color 时使用）
const defaultMaterialColor = new Cesium.Color(1.0, 0.0, 0.0, 0.5);

// 底部圆材质图片：用 canvas 画一张径向渐变的圆环贴图，
// 供材质的 image uniform 采样（呼吸/光晕感来自这张贴图的透明度分布）
function createBottomCircleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
  gradient.addColorStop(0.1, 'rgba(255, 255, 255, 1.0)');
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.0)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.9)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.0)');
  gradient.addColorStop(0.9, 'rgba(255, 255, 255, 0.2)');
  gradient.addColorStop(1.0, 'rgba(255, 255, 255, 1.0)');

  ctx.clearRect(0, 0, 512, 512);
  ctx.beginPath();
  ctx.arc(256, 256, 256, 0, Math.PI * 2, true);
  ctx.fillStyle = gradient;
  ctx.fill();

  return canvas
    .toDataURL('image/png')
    .replace('image/png', 'image/octet-stream');
}

// 贴图只在模块加载时生成一次，之后复用（避免每个实体都重画 canvas）
const bottomCircleImage = createBottomCircleTexture();

class ConeGlowBottomCircleMaterialProperty {
  constructor(color) {
    this._definitionChanged = new Cesium.Event();
    this._color = undefined;
    this._colorSubscription = undefined;

    this.color = color;
  }

  // color 是常量属性时整个材质就是常量，Cesium 只需编译一次
  get isConstant() {
    return Cesium.Property.isConstant(this._color);
  }

  get definitionChanged() {
    return this._definitionChanged;
  }

  getType() {
    return 'ConeGlowBottomCircle';
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
    result.image = bottomCircleImage;
    return result;
  }

  equals(other) {
    return (
      this === other ||
      (other instanceof ConeGlowBottomCircleMaterialProperty &&
        Cesium.Property.equals(this._color, other._color))
    );
  }
}

// 把 color 变成 Property，让 Entity 系统能统一管理并监听变化
Object.defineProperties(ConeGlowBottomCircleMaterialProperty.prototype, {
  color: Cesium.createPropertyDescriptor('color'),
});

// 将材质添加进Material大类的 材质缓存中
Cesium.Material.ConeGlowBottomCircleType = 'ConeGlowBottomCircle'; //自定义类型
Cesium.Material.ConeGlowBottomCircleImage = bottomCircleImage;
Cesium.Material.ConeGlowBottomCircleSource = circleglow;

Cesium.Material._materialCache.addMaterial(
  Cesium.Material.ConeGlowBottomCircleType,
  {
    fabric: {
      type: Cesium.Material.ConeGlowBottomCircleType,
      uniforms: {
        color: defaultMaterialColor,
        image: bottomCircleImage,
      },
      source: circleglow,
    },
    translucent: true,
  },
);

export default ConeGlowBottomCircleMaterialProperty;
