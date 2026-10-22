import * as Cesium from 'cesium';

/**
 * 倾斜摄影模型压平工具。
 *
 * 工具将绘制区域和模型顶点都转换到同一个 ENU 局部坐标系，
 * 在 shader 中判断顶点是否位于绘制多边形内，并将命中顶点压到指定高度。
 */
class ToPlane {
  /**
   * 创建压平工具。
   *
   * @param {Cesium.Viewer} viewer 输入：Cesium Viewer 实例。
   * @returns {ToPlane} 输出：保存 viewer、压平高度和 shader 状态的工具实例。
   */
  constructor(viewer) {
    // 输入 viewer；输出工具实例的运行环境。
    this.viewer = viewer;
    // 输出初始状态：高度为 0，尚未创建 shader 或矩阵。
    this.flattenHeight = 0.0;
    this.customShader = null;
    this.inverse = null;
    this.modelMatrix = null;
  }

  /**
   * 为 tileset 添加或更新压平 shader。
   *
   * 调用步骤：
   * 1. 接收绘制工具输出的世界坐标多边形和目标 tileset。
   * 2. 以 tileset 包围球中心创建统一 ENU 局部坐标系。
   * 3. 将多边形顶点转换到统一坐标系，并计算默认压平高度。
   * 4. 生成点在多边形内判断函数和顶点变换 shader。
   * 5. 将 CustomShader 绑定到 tileset 并返回。
   *
   * @param {Cesium.Cartesian3[]} positions 输入：世界坐标系中的绘制多边形顶点，至少 3 个。
   * @param {Cesium.Cesium3DTileset} tileset 输入：待压平的 3D Tileset。
   * @returns {Cesium.CustomShader} 输出：已绑定到 tileset.customShader 的 CustomShader。
   */
  flatten(positions, tileset) {
    // 输入检查：没有有效多边形或 tileset 时无法生成压平 shader。
    if (!positions || positions.length < 3) {
      throw new Error('压平区域至少需要三个顶点');
    }
    if (!tileset) {
      throw new Error('压平工具需要传入 tileset');
    }

    // 步骤 1：读取 tileset 包围球中心，作为统一局部坐标系原点。
    // 输入：tileset.boundingSphere.center；输出：世界坐标系中的中心点。
    const center = tileset.boundingSphere.center.clone();
    // 步骤 2：创建世界坐标 -> 统一 ENU 坐标的正向矩阵和逆矩阵。
    // 输出：modelMatrix 用于回转，inverse 用于绘制点转换。
    this.modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(center);
    this.inverse = Cesium.Matrix4.inverse(
      this.modelMatrix,
      new Cesium.Matrix4(),
    );

    // 步骤 3：将绘制多边形从世界坐标转换到统一 ENU 坐标。
    // 输入：positions；输出：modelPositions 的水平坐标和 modelHeights 的高度。
    const modelPositions = [];
    const modelHeights = [];
    positions.forEach((position) => {
      const modelPosition = Cesium.Matrix4.multiplyByPoint(
        this.inverse,
        position,
        new Cesium.Cartesian3(),
      );
      modelPositions.push([modelPosition.x, modelPosition.y]);
      modelHeights.push(modelPosition.z);
    });
    // 步骤 4：取绘制点最低高度作为默认压平高度。
    // 输入：modelHeights；输出：相对于统一 ENU 原点的 flattenHeight，单位为米。
    // this.flattenHeight = Math.min(...modelHeights);
    this.flattenHeight = -1; //智慧地铁专属

    // 步骤 5：生成多边形判断 GLSL，并创建 CustomShader。
    // 输入：统一坐标系中的二维多边形；输出：顶点着色器和三个 uniform。
    const polygonCode = this.createPolygonCode(modelPositions);
    this.customShader = new Cesium.CustomShader({
      uniforms: {
        flattenHeight: {
          type: Cesium.UniformType.FLOAT,
          value: this.flattenHeight,
        },
        inverse: {
          type: Cesium.UniformType.MAT4,
          value: this.inverse,
        },
        modelMatrix: {
          type: Cesium.UniformType.MAT4,
          value: this.modelMatrix,
        },
      },
      vertexShaderText: this.createVertexShader(modelPositions, polygonCode),
    });

    // 步骤 6：将 shader 绑定到 tileset。
    // 输入：this.customShader；输出：tileset.customShader 和当前 shader 实例。
    tileset.customShader = this.customShader;
    return this.customShader;
  }

  /**
   * 修改当前压平高度并更新 shader uniform。
   *
   * 调用步骤：接收 GUI 输入，保存新高度，再把新高度写入 CustomShader。
   *
   * @param {number} flattenHeight 输入：相对于工具 ENU 原点的压平高度，单位为米。
   * @returns {void} 输出：无返回值；CustomShader.uniforms.flattenHeight 被更新。
   */
  setFlattenHeight(flattenHeight) {
    this.flattenHeight = flattenHeight;
    if (this.customShader) {
      this.customShader.setUniform('flattenHeight', flattenHeight);
    }
  }

  /**
   * 生成 GLSL 多边形顶点数组和点在多边形内判断函数。
   *
   * 输入统一 ENU 坐标中的二维多边形，输出 GLSL 射线法判断函数。
   *
   * @param {number[][]} modelPositions 输入：ENU 局部坐标中的二维多边形顶点。
   * @returns {string} 输出：GLSL pointInPolygon 函数字符串。
   */
  createPolygonCode(modelPositions) {
    const pointInPolygon = /* glsl */ `
			bool pointInPolygon(vec2 p, vec2 vs[${modelPositions.length}]) {
				bool inside = false;
				const int len = ${modelPositions.length};
				const int j = ${modelPositions.length - 1};
				for (int i = 0; i < len; i++) {
					if (i == 0) {
						if ((vs[i].y >= p.y && p.y > vs[j].y) ||
								(vs[j].y >= p.y && p.y > vs[i].y)) {
							if (p.x < (vs[j].x - vs[i].x) *
									(p.y - vs[i].y) / (vs[j].y - vs[i].y) + vs[i].x) {
								inside = !inside;
							}
						}
					} else {
						if ((vs[i].y >= p.y && p.y > vs[i - 1].y) ||
								(vs[i - 1].y >= p.y && p.y > vs[i].y)) {
							if (p.x < (vs[i - 1].x - vs[i].x) *
									(p.y - vs[i].y) / (vs[i - 1].y - vs[i].y) + vs[i].x) {
								inside = !inside;
							}
						}
					}
				}
				return inside;
			}
		`;

    return pointInPolygon;
  }

  /**
   * 生成 CustomShader 顶点着色器。
   *
   * 输入多边形坐标和判断函数，输出完成坐标转换、区域判断、压平和回转的 GLSL。
   *
   * @param {number[][]} modelPositions 输入：ENU 局部坐标中的二维多边形顶点。
   * @param {string} polygonCode 输入：pointInPolygon GLSL 函数代码。
   * @returns {string} 输出：CustomShader.vertexShaderText 顶点着色器代码。
   */
  createVertexShader(modelPositions, polygonCode) {
    return (
      polygonCode +
      /* glsl */ `
				void vertexMain(
					VertexInput vsInput,
					inout czm_modelVertexOutput vsOutput
				) {
					// 输入：Cesium 当前模型顶点 positionMC。
					vec2 vs[${modelPositions.length}];
					${modelPositions
            .map(
              (position, index) =>
                `vs[${index}] = vec2(${position[0]}, ${position[1]});`,
            )
            .join('\n')}
					// 输出中间结果 1：模型局部坐标转换为统一 ENU 坐标。
					vec4 positionMC4 = vec4(vsInput.attributes.positionMC, 1.0);
					vec4 modelPositionMC = inverse * czm_model * positionMC4;
					// 输出中间结果 2：判断顶点是否位于用户绘制多边形内。
					bool isInPolygon = pointInPolygon(modelPositionMC.xy, vs);
					vec4 transformedPosition = modelPositionMC;
					if (isInPolygon) {
						// 输出中间结果 3：命中区域的顶点高度替换为 flattenHeight。
						transformedPosition = vec4(
							modelPositionMC.x,
							modelPositionMC.y,
							flattenHeight,
							1.0
						);
					}
					// 输出：将统一 ENU 坐标转换回当前模型局部坐标（压平部分已经在统一坐标系中完成 这里纯属是转换回Cesium可以识别的格式--》坐标表示 转换），交给 Cesium 渲染。
          //不同 tile 的 czm_model /czm_inverseModel 只负责把各自的局部顶点送到世界坐标  / 送回
          vec4 transformedPositionMC =
						czm_inverseModel * modelMatrix * transformedPosition;
					vsOutput.positionMC = transformedPositionMC.xyz;
				}
			`
    );
  }
}

export default ToPlane;
