import * as Cesium from 'cesium';
import ConeGlowBottomCircleMaterialProperty from './circleBottomGlowMaterialProperty.js';
// 站点底部圆环
export const bottomCircle = (viewer, options) => {
  const position = Cesium.defaultValue(
    options.position,
    Cesium.Cartesian3.ZERO,
  );
  const color = Cesium.defaultValue(options.color, Cesium.Color.AQUA);
  const bottomRadius = Cesium.defaultValue(options.bottomRadius, 100);

  return viewer.entities.add({
    position: position,
    ellipse: {
      semiMinorAxis: bottomRadius * 2,
      semiMajorAxis: bottomRadius * 2,
      height: 0.0,
      material: new ConeGlowBottomCircleMaterialProperty(color),
    },
  });
};
