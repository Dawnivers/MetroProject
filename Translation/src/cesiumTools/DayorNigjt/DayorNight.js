import * as Cesium from 'cesium';
/**
 * 实现早晚变化效果
 * @param {Cesium.Viewer} viewer - viewer对象。
 * @param {Cesium.Cesium3DTileset[]} tilesets 所有3d瓦片（凡带 u_isDark 的 CustomShader 都会同步昼夜，如建筑shpShader、外滩flowShader）
 * @param {Cesium.Primitive} waterPrimitive 水面的primitive
 */
export const handleUpdateScene = (viewer, tilesets, waterPrimitive) => {
  let _angle = 0;

  /**
   * 特效的统一时间基准（秒）。
   * 三个着色器（白模 shpShader、外滩 flowShader、水面 waterShader）原先都用 czm_frameNumber
   * —— 那是「帧序号」不是时间，帧率一变动画速度就跟着变：集显 6FPS 时慢约 9 倍，
   * 换到 4070 后 57FPS 又快约 9 倍。这里改成真实时间驱动，速度与帧率彻底解耦。
   */
  const _timeOrigin = performance.now();

  /** 把当前秒数写进所有时间驱动的着色器 */
  const syncShaderTime = () => {
    const seconds = (performance.now() - _timeOrigin) / 1000;
    tilesets.forEach((tileset) => {
      const uniforms = tileset.customShader && tileset.customShader.uniforms;
      if (uniforms && uniforms.u_time) uniforms.u_time.value = seconds;
    });
    if (waterPrimitive) {
      const material = waterPrimitive.appearance.material;
      if (
        material &&
        material.uniforms &&
        material.uniforms.u_time !== undefined
      ) {
        material.uniforms.u_time = seconds;
      }
    }
  };

  // 把昼夜状态同步给所有带 u_isDark 的 CustomShader
  // 外滩的 flowShader 夜间据此切换到 material.emissive 自发光
  const setTilesetsDark = (isDark) => {
    tilesets.forEach((tileset) => {
      const uniforms = tileset.customShader && tileset.customShader.uniforms;
      if (uniforms && uniforms.u_isDark) uniforms.u_isDark.value = isDark;
    });
  };
  // 更新场景
  const updateScene = () => {
    // 时间必须每帧都写：下面按角度判断的早退只影响昼夜切换，不能影响动画推进
    syncShaderTime();

    // 从世界坐标原点到太阳的单位向量
    const sunDirection = Cesium.Cartesian3.normalize(
      viewer.scene.sun._boundingVolume.center,
      new Cesium.Cartesian3(),
    );
    // 世界坐标到相机的单位向量
    // 必须用 positionWC（世界坐标）：camera.position 是**当前参考系下**的坐标，
    // 一旦相机被 lookAt/lookAtTransform 绑到某个局部坐标系（线路轨迹的跟车视角就是这样），
    // 它就是个小向量，归一化后方向完全乱掉，昼夜判定会随机翻到夜间。
    const cameraDirection = Cesium.Cartesian3.normalize(
      viewer.camera.positionWC,
      new Cesium.Cartesian3(),
    );
    // 点乘相机到太阳光两个向量，确定夹角,如果夹角余弦小于0，说明到了晚上，渲染夜间效果
    const angle = parseFloat(
      Cesium.Cartesian3.dot(cameraDirection, sunDirection).toFixed(3),
    );
    //角度没变化，说明时间也没变，不更新
    if (angle === _angle) return false;

    if (waterPrimitive) {
      waterPrimitive.appearance.material.uniforms.u_isDark =
        angle < 0 ? true : false;
    }
    if (angle >= 0) {
      //白天的逻辑，取消bloom等后处理效果
      viewer.postProcessStages.bloom.enabled = false;
      viewer.scene.postProcessStages.ambientOcclusion.enabled = true;
      setTilesetsDark(false);

      //value 是0-1之间的值，0表示白天，1表示晚上 白天调高亮度，晚上调低亮度
      const value = Cesium.Math.clamp(angle, 0, 1);
      const imageryLayer = viewer.imageryLayers.get(0);
      if (imageryLayer) {
        imageryLayer.brightness = value + 0.3;
      }
    }
    if (angle < 0) {
      // 夜晚的逻辑，开启bloom,并设置customShader和water
      viewer.postProcessStages.bloom.enabled = true;
      viewer.scene.postProcessStages.ambientOcclusion.enabled = false;
      setTilesetsDark(true);
    }
    _angle = angle;
  };
  viewer.scene.postRender.addEventListener(() => updateScene());
};
