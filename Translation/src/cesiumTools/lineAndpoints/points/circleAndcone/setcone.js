// 光锥（站点标记的竖直发光体）
//
// 三个关键点，缺一个观感就废：
//   ① flat: true —— 光锥是自发光体，不能参与光照。MaterialAppearance 的 flat 默认
//      false，会走 czm_phong 的 Lambert 光照；锥面法线朝外，被太阳方向切出一圈明暗面，
//      看起来就是「一个塑料锥」。flat 之后走 FLAT 分支，直接用 material.diffuse。
//   ② ADDITIVE_BLEND —— 发光体要「越叠越亮」，alpha 混合下两个锥子重叠时会互相压暗。
//      注意 Cesium 的 Appearance.getRenderState 在 translucent 时会把 blending
//      强制改回 ALPHA_BLEND（cesium/Source/Scene/Appearance.js），所以只能在实例上
//      盖掉 getRenderState，光传 renderState 是没用的。
//   ③ 锥高/半径以外的一切观感都在 cone.glsl 里（流动、呼吸、底亮），改那边。
//
// 1.97 的 ADDITIVE_BLEND 是 (SRC_ALPHA, ONE)，即 rgb×alpha 累加到帧缓冲 ——
// 着色器输出的 alpha 仍然当「亮度」用，不需要把 alpha 乘进 diffuse。

import * as Cesium from 'cesium';
// 必须加 ?raw：让 Vite 把 .glsl 的源码文本当字符串导入，Material 的 source 需要的是 GLSL 源码
import coneShader from './cone.glsl?raw';

export const coneWithLight = (viewer, options = {}) => {
  const position = Cesium.defaultValue(
    options.position,
    Cesium.Cartesian3.ZERO,
  );
  const height = Cesium.defaultValue(options.height, 700);
  const bottomRadius = Cesium.defaultValue(options.bottomRadius, 100);
  const color = Cesium.defaultValue(options.color, Cesium.Color.AQUA);

  // 可调的表现参数（具体观感见 cone.glsl）
  const opacity = Cesium.defaultValue(options.opacity, 1.0); // 整体强度倍率
  const flowSpeed = Cesium.defaultValue(options.flowSpeed, 0.55); // 能量带向上跑的速度
  const bandCount = Cesium.defaultValue(options.bandCount, 1.0); // 能量带数量
  const beatSpeed = Cesium.defaultValue(options.beatSpeed, 1.0); // 呼吸节拍
  const energy = Cesium.defaultValue(options.energy, 1.0); // 发光增益
  const translucent = Cesium.defaultValue(options.translucent, true); // 半透明才看得到 alpha

  const modelMatrix = Cesium.Matrix4.multiplyByTranslation(
    Cesium.Transforms.eastNorthUpToFixedFrame(position),
    new Cesium.Cartesian3(0.0, 0.0, height * 0.5),
    new Cesium.Matrix4(),
  );

  const cylinderGeometry = new Cesium.CylinderGeometry({
    length: height,
    topRadius: 0.0,
    bottomRadius: bottomRadius * 0.7,
    vertexFormat:
      Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
  });

  const cone = new Cesium.GeometryInstance({
    geometry: cylinderGeometry,
    modelMatrix: modelMatrix,
  });

  const appearance = new Cesium.MaterialAppearance({
    material: new Cesium.Material({
      fabric: {
        type: 'VtxfShader1',
        uniforms: {
          color: color,
          opacity: opacity,
          flowSpeed: flowSpeed,
          bandCount: bandCount,
          beatSpeed: beatSpeed,
          energy: energy,
        },
        source: coneShader,
      },
      translucent: translucent,
    }),
    // 自发光：不参与光照计算（否则会被太阳方向切出明暗面）
    flat: true,
    // 决定混合与否的是 appearance 的 renderState，这里同样跟随 translucent
    translucent: translucent,
    faceForward: false, // 三角面法向不能朝向视点时自动翻转，避免背面发黑
    closed: true, // 封闭体 → 背面裁剪
  });

  // 加色混合只能在这一层改：getRenderState 是 Appearance 原型上的方法，
  // 在实例上覆盖即生效（Primitive 里就是 appearance.getRenderState()）。
  //
  // 覆盖之后默认的 renderState 也被一并替掉了，所以这两项必须自己写回来：
  //   · depthMask: false —— 否则这根锥子会写深度、把身后的东西挡掉
  //   · cull: BACK —— 对应 closed: true。留空会变成双面渲染（fill 翻倍）；
  //     如果你想让锥子看起来更像"实心光柱"，把 cull 去掉即可（代价是每个锥子的
  //     片元数翻倍，400 个站要留意大屏上的 fill rate）
  if (translucent) {
    appearance.getRenderState = () => ({
      depthTest: { enabled: true },
      depthMask: false,
      cull: { enabled: true, face: Cesium.CullFace.BACK },
      blending: Cesium.BlendingState.ADDITIVE_BLEND,
    });
  }

  return viewer.scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: [cone],
      appearance: appearance,
    }),
  );
};
