import * as Cesium from 'cesium';
// Vite 默认不把 .glsl 当资源，必须加 ?raw 才会以字符串形式导入
import shpShader from './shaders/shpShader.glsl?raw';
import waterShader from './shaders/waterShader.glsl?raw';
import flowShaderSource from './shaders/flowShader.glsl?raw';
// 水面区域 GeoJSON：用 import 交给 Vite 处理，得到已解析的 GeoJSON 对象
// 不能用 "@/assets/water.json" 这种字符串，别名只在静态导入时才会被替换
import waterGeoJson from '@/assets/water.json';
import waterNormals from '@/assets/waterNormals.jpg';

/**
 * 默认模型效果：建筑白膜的分层渐变 + 昼夜材质 + 夜景光带特效
 * @param {Cesium.Cesium3DTileset} tile 需要着色的3d瓦片
 */
export const handleshpModelEffect = (tile) => {
  // —— 全局一致的高度基准 ——
  // positionMC 是每个瓦片各自的局部坐标，跨瓦片原点不同，用它算高度会导致扫光/光带断裂。
  // 改为取世界坐标投影到该区域的地理 ENU 方向上，得到全局统一的高度与水平坐标。
  const _center = tile.boundingSphere.center;
  // 该点的地理"上"方向（椭球面法线）
  const upDir = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(
    _center,
    new Cesium.Cartesian3(),
  );
  // 该点的地理"东"方向 = normalize(Z × up)
  const eastDir = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.cross(
      Cesium.Cartesian3.UNIT_Z,
      upDir,
      new Cesium.Cartesian3(),
    ),
    new Cesium.Cartesian3(),
  );
  // 参考点：把瓦片中心降到椭球面，作为高度 0 的地面基准
  const _carto = Cesium.Cartographic.fromCartesian(_center);
  const refPoint = Cesium.Cartesian3.fromRadians(
    _carto.longitude,
    _carto.latitude,
    0.0,
  );

  // 处理模型着色
  tile.style = new Cesium.Cesium3DTileStyle({
    color: {
      conditions: [
        ['Number(${Elevation})<20', "color('rgb(25, 211, 226)',0.0)"],

        ['Number(${Elevation})>20', "color('rgb(25, 211, 226)',1)"],
        //['true', "color('rgb(42, 122, 237)',1)"]
      ],
      show: false,
    },
  });

  const customShader = new Cesium.CustomShader({
    uniforms: {
      maxHeight: {
        type: Cesium.UniformType.FLOAT,
        value: 267.0,
      },
      minHeight: {
        type: Cesium.UniformType.FLOAT,
        value: 3.0,
      },
      u_isDark: {
        type: Cesium.UniformType.BOOL,
        value: false,
      },
      // —— 时间驱动（不要再退回 czm_frameNumber：那是帧序号，帧率一变特效速度就跟着变）——
      // 由 DayorNight.js 的逐帧钩子写入「秒」
      u_time: {
        type: Cesium.UniformType.FLOAT,
        value: 0,
      },
      // 扫描光带从楼顶走到楼底所需秒数，越大越慢。
      // 原实现按帧算：czm_frameNumber/240 在 60FPS 下约等于 4 秒一趟；这里放宽到 12 秒
      u_sweepPeriod: {
        type: Cesium.UniformType.FLOAT,
        value: 12.0,
      },
      // 条纹贴图滚动一个周期的秒数，越大越慢。
      // 原实现 czm_frameNumber/120 在 60FPS 下约等于 2 秒一个周期；这里放宽到 6 秒
      u_stripePeriod: {
        type: Cesium.UniformType.FLOAT,
        value: 6.0,
      },
      u_TextureNight: {
        type: Cesium.UniformType.SAMPLER_2D,
        value: new Cesium.TextureUniform({
          url: '@/assets/night.jpg',
        }),
      },
      u_TextureDay: {
        type: Cesium.UniformType.SAMPLER_2D,
        value: new Cesium.TextureUniform({
          url: '@/assets/sky.jpg',
        }),
      },
      u_colorTexture: {
        type: Cesium.UniformType.SAMPLER_2D,
        value: new Cesium.TextureUniform({
          url: '@/assets/color.png',
        }),
      },
      // 全局高度基准：参考点世界坐标 + 地理上方向 + 地理东方向
      u_refWC: {
        type: Cesium.UniformType.VEC3,
        value: refPoint,
      },
      u_upWC: {
        type: Cesium.UniformType.VEC3,
        value: upDir,
      },
      u_eastWC: {
        type: Cesium.UniformType.VEC3,
        value: eastDir,
      },
    },
    mode: Cesium.CustomShaderMode.MODIFY_MATERIAL,
    lightingModel: Cesium.LightingModel.PBR,
    vertexShaderText: /*glsl*/ `
            void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) {

            }
       `,
    fragmentShaderText: shpShader,
  });
  tile.customShader = customShader;
};

/**
 * 外滩模型（tilesets[1]）的流体/分形光带特效，由 ShaderToy 的 mainImage 转换而来
 * @param {Cesium.Cesium3DTileset} tile 需要叠加特效的 3D 瓦片
 * @param {Cesium.Viewer} viewer 用于读取画布分辨率（u_resolution 的取值来源）
 */
export const handleFlowEffect = (tile, viewer) => {
  const flowShader = new Cesium.CustomShader({
    uniforms: {
      // 视口分辨率（canvas 内部缓冲尺寸，含 devicePixelRatio），
      // 与 gl_FragCoord.xy 的设备像素坐标空间保持一致
      u_resolution: {
        type: Cesium.UniformType.VEC2,
        value: new Cesium.Cartesian2(viewer.canvas.width, viewer.canvas.height),
      },
      // 特效叠加强度：控制光带亮度，越小越接近原材质
      u_intensity: {
        type: Cesium.UniformType.FLOAT,
        value: 0.5,
      },
      // 昼夜开关：夜间时特效写入 material.emissive 实现自发光（详见 flowShader.glsl）
      u_isDark: {
        type: Cesium.UniformType.BOOL,
        value: false,
      },
      // 时间驱动（秒），同样由 DayorNight.js 每帧写入；
      // 原来是 czm_frameNumber/60.0 —— 换 GPU 后帧率 6→57，流光速度跟着快了近 10 倍
      u_time: {
        type: Cesium.UniformType.FLOAT,
        value: 0,
      },
    },
    mode: Cesium.CustomShaderMode.MODIFY_MATERIAL,
    // 保留原材质的 PBR 光照（不用 UNLIT）；白天叠加 diffuse，夜间叠加自发光 emissive
    lightingModel: Cesium.LightingModel.PBR,
    fragmentShaderText: flowShaderSource,
  });
  tile.customShader = flowShader;
};

export const hanleWaterEffect = async (viewer) => {
  // 直接传入 GeoJSON 对象，Cesium 会跳过 fetch + JSON.parse
  const data = await new Cesium.GeoJsonDataSource().load(waterGeoJson);
  //data 是一个entity实例 源
  //由于水体没有实例 ，所以将entity中的坐标提取出，用于构建primitive
  console.log(data, '水体数据');
  const entities = data.entities.values;

  const instances = [];
  entities.forEach((entity) => {
    //获取每个水面多边形的坐标
    const hierarchy = entity.polygon.hierarchy.getValue();

    //构建primitive
    const instance = new Cesium.GeometryInstance({
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: hierarchy,
        extrudedHeight: 5,
        height: 1,
      }),
    });
    instances.push(instance); //将每个instance添加到数组中
  });

  const appearance = new Cesium.MaterialAppearance({
    material: new Cesium.Material({
      fabric: {
        type: 'WaterSelf',
        uniforms: {
          baseWaterColor: new Cesium.Color(0.0, 0.5, 0.9, 0.8),
          blendColor: new Cesium.Color(0.0, 1.0, 0.699, 1.0),
          specularMap: Cesium.Material.DefaultImageId,
          normalMap: waterNormals,
          frequency: 3000.0,
          animationSpeed: 0.05,
          amplitude: 1.0,
          specularIntensity: 0.7,
          fadeFactor: 1.0,
          u_isDark: false,
          // 时间（秒），由 DayorNight.js 每帧写入；替代原先按帧推进的 czm_frameNumber
          u_time: 0,
        },
        source: waterShader,
      },
    }),
  });
  return viewer.scene.primitives.add(
    new Cesium.GroundPrimitive({
      geometryInstances: instances,
      appearance,
    }),
  );
};
