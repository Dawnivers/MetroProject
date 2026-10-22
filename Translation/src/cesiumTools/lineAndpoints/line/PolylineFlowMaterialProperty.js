//实体的材质需要Property才能被识别
//1.编译类 2.添加进大类中 最终也是被编译成material

import * as Cesium from 'cesium';
// 必须加 ?raw：让 Vite 把 .glsl 的源码文本当字符串导入，Material 的 source 需要的是 GLSL 源码
import polylineFlow from './polyGlowflow.glsl?raw';

const defaultGlowPower = 0.25; //默认泛光功率
const defaultTaperPower = 1.0; //默认衰减功率 线路明显度 和流线无关
const defaultFlowSpeed = 1.0; //默认流线速度倍率
const defaultFlowLength = 0.03; //默认流线高亮段长度（占整条线长度的比例 0~1）
const defaultFlowIntensity = 6.0; //默认流线高亮段亮度倍率（越大越亮）
const defaultFlowOffset = 0.0; //默认流线初相位（0~1），用于让各条线的流线错开

class PolylineFlowMaterialProperty {
  constructor(
    color,
    glowPower,
    taperPower,
    flowSpeed,
    flowLength,
    flowIntensity,
    flowOffset,
  ) {
    this._definitionChanged = new Cesium.Event();
    this._color = undefined;
    this._colorSubscription = undefined;

    this._taperPower = undefined;
    this._glowPower = undefined;
    this._flowSpeed = undefined;
    this._flowLength = undefined;
    this._flowIntensity = undefined;
    this._flowOffset = undefined;

    this.color = color;
    this.glowPower = glowPower;
    this.taperPower = taperPower;
    this.flowSpeed = flowSpeed;
    this.flowLength = flowLength;
    this.flowIntensity = flowIntensity;
    this.flowOffset = flowOffset;
  }
  //复现各种方法

  //get 是 JavaScript 类里的访问器属性，
  // 也叫 getter。它允许你像读取普通属性一样读取一个方法的返回值。 const value = materialProperty.isConstant;
  get isConstant() {
    return (
      Cesium.Property.isConstant(this._color) ||
      Cesium.Property.isConstant(this._glowPower) ||
      Cesium.Property.isConstant(this._taperPower) ||
      Cesium.Property.isConstant(this._flowSpeed) ||
      Cesium.Property.isConstant(this._flowLength) ||
      Cesium.Property.isConstant(this._flowIntensity) ||
      Cesium.Property.isConstant(this._flowOffset)
    );
  }

  get definitionChanged() {
    return this._definitionChanged;
  }

  getType() {
    return 'PolylineFlow';
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
      Cesium.Color.ORANGERED,
      result.color,
    );
    result.glowPower = Cesium.Property.getValueOrDefault(
      this._glowPower,
      time,
      defaultGlowPower,
      result.glowPower,
    );
    result.taperPower = Cesium.Property.getValueOrDefault(
      this._taperPower,
      time,
      defaultTaperPower,
      result.taperPower,
    );
    result.flowSpeed = Cesium.Property.getValueOrDefault(
      this._flowSpeed,
      time,
      defaultFlowSpeed,
      result.flowSpeed,
    );
    result.flowLength = Cesium.Property.getValueOrDefault(
      this._flowLength,
      time,
      defaultFlowLength,
      result.flowLength,
    );
    result.flowIntensity = Cesium.Property.getValueOrDefault(
      this._flowIntensity,
      time,
      defaultFlowIntensity,
      result.flowIntensity,
    );
    result.flowOffset = Cesium.Property.getValueOrDefault(
      this._flowOffset,
      time,
      defaultFlowOffset,
      result.flowOffset,
    );
    return result;
  }

  equals(other) {
    return (
      this === other ||
      (other instanceof PolylineFlowMaterialProperty && //
        Cesium.Property.equals(this._color, other._color) &&
        Cesium.Property.equals(this._taperPower, other._taperPower) &&
        Cesium.Property.equals(this._glowPower, other._glowPower) &&
        Cesium.Property.equals(this._flowSpeed, other._flowSpeed) &&
        Cesium.Property.equals(this._flowLength, other._flowLength) &&
        Cesium.Property.equals(this._flowIntensity, other._flowIntensity) &&
        Cesium.Property.equals(this._flowOffset, other._flowOffset))
    );
  }
}

// Entity 的属性可能随时间变化 ，把 color、glowPower、taperPower 变成 Property，主要是为了让它们能够被 Entity 系统统一管理。
//因此 Cesium 不直接假设 color 是普通颜色，而是统一按照 Property 读取：
//可以使用get set 来获取 definitionChanged 通知 Cesium 监听属性变化
// 设定属性 材质既可以使用固定值，也可以使用动态值。
Object.defineProperties(PolylineFlowMaterialProperty.prototype, {
  color: Cesium.createPropertyDescriptor('color'),
  glowPower: Cesium.createPropertyDescriptor('glowPower'),
  taperPower: Cesium.createPropertyDescriptor('taperPower'),
  flowSpeed: Cesium.createPropertyDescriptor('flowSpeed'),
  flowLength: Cesium.createPropertyDescriptor('flowLength'),
  flowIntensity: Cesium.createPropertyDescriptor('flowIntensity'),
  flowOffset: Cesium.createPropertyDescriptor('flowOffset'),
});

//将材质添加进Material大类的 材质缓存中
Cesium.Material.PolylineFlowType = 'PolylineFlow'; //自定义类型

Cesium.Material._materialCache.addMaterial(Cesium.Material.PolylineFlowType, {
  fabric: {
    type: Cesium.Material.PolylineFlowType,
    uniforms: {
      color: Cesium.Color.ORANGERED,
      glowPower: 0.25,
      taperPower: 1.0,
      flowSpeed: 1.0,
      flowLength: 0.03,
      flowIntensity: 6.0,
      flowOffset: 0.0,
    },
    source: polylineFlow,
  },
  translucent: true,
});

export default PolylineFlowMaterialProperty;
