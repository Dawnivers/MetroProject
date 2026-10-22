// 注意：本文件作为 Cesium.Material 的 fabric.source 使用。
// Material 会把 "uniform xxx;" 不以换行地前插到整段 source 最前面，
// 因此 source 首行不能是 #define 之类的预处理指令，否则 '#' 会落在行中间导致编译失败。

          uniform sampler2D specularMap;
          uniform sampler2D normalMap;
          uniform vec4 baseWaterColor;
          uniform vec4 blendColor;
          uniform float frequency;
          uniform float animationSpeed;
          uniform float amplitude;
          uniform float specularIntensity;
          uniform float fadeFactor;

          struct Water{
            vec3 waterCol;
            float alpha;
            vec3 normal;
            float specular;
            float shininess;
          };
          // cesium源码中的water.glsl
          Water getWaterNormalCol(czm_materialInput materialInput){
            Water water;
            // 时间由 JS 每帧写入 u_time（秒）。原写法 czm_frameNumber * animationSpeed 是帧序号驱动，
            // 换到独显后帧率从 6→57，水面波纹也跟着快了近 10 倍。×60 是为了与原节奏（按 60FPS 设计）对齐。
            float time = u_time * animationSpeed * 60.0;
            // fade is a function of the distance from the fragment and the frequency of the waves
            float fade = max(1.0, (length(materialInput.positionToEyeEC) / 10000000000.0) * frequency * fadeFactor);
            float specularMapValue = texture2D(specularMap, materialInput.st).r;
            // note: not using directional motion at this time, just set the angle to 0.0;
            vec4 noise = czm_getWaterNoise(normalMap, materialInput.st * frequency, time, 0.0);
            vec3 normalTangentSpace = noise.xyz * vec3(1.0, 1.0, (1.0 / amplitude));
            // fade out the normal perturbation as we move further from the water surface
            normalTangentSpace.xy /= fade;
            // attempt to fade out the normal perturbation as we approach non water areas (low specular map value)
            normalTangentSpace = mix(vec3(0.0, 0.0, 50.0), normalTangentSpace, specularMapValue);

            normalTangentSpace = normalize(normalTangentSpace);

            // get ratios for alignment of the new normal vector with a vector perpendicular to the tangent plane
            float tsPerturbationRatio = clamp(dot(normalTangentSpace, vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
            float alpha=mix(blendColor.a, baseWaterColor.a, specularMapValue) * specularMapValue;
            vec3 col=mix(blendColor.rgb, baseWaterColor.rgb, specularMapValue);
            col+= (0.1 * tsPerturbationRatio);
            water.waterCol=col;
            water.alpha=alpha;
            water.normal= normalize(materialInput.tangentToEyeMatrix * normalTangentSpace);
            water.specular=specularIntensity;
            water.shininess=10.0;
            return water;
          }


    
          // ============ 夜晚水面特效：改进版分形水花 ============
          // 搬运自 ShaderToy（k-mouse 2016 / David Hoskins 2013 / joltz0r 2013）
          // 原 #define 改为 const，避免与 Cesium 前插的 uniform 声明冲突
          const float TAU = 6.28318530718;
          const float TILING_FACTOR = 18.0;
          const int MAX_ITER = 8;

          // 分形水花高光：根据坐标和时间迭代出波纹亮度
          float waterHighlight(vec2 p, float time, float foaminess)
          {
            vec2 i = vec2(p);
            float c = 0.0;
            // foaminess 越大，波峰越密集尖锐
            float foaminess_factor = mix(1.0, 6.0, foaminess);
            float inten = 0.005 * foaminess_factor;

            // 标准 for 循环（GLSL ES 1.00 只允许该形式）
            for (int n = 0; n < MAX_ITER; n++)
            {
              float t = time * (1.0 - (3.5 / float(n + 1)));
              i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
              c += 1.0 / length(vec2(p.x / sin(i.x + t), p.y / cos(i.y + t)));
            }
            c = 0.2 + c / (inten * float(MAX_ITER));
            c = 1.17 - pow(c, 1.4);
            c = pow(abs(c), 8.0);
            return c / sqrt(foaminess_factor);
          }

          // 夜晚水面：分形水花 + 沿河一维明暗渐变
          vec3 getNightWaterCol(czm_materialInput materialInput)
          {
            float time = u_time * animationSpeed * 60.0 * 0.1 + 23.0;
            // 归一化：把可能超出 [0,1] 的 st 映射到 [0,1)，使径向泡沫/清晰度计算有意义
            vec2 uv = fract(materialInput.st);
            // 方形纹样修正：等价 ShaderToy 的 uv.x * iResolution.x / iResolution.y
            vec2 uv_square = vec2(uv.x * czm_viewport.z / czm_viewport.w, uv.y);

            // 沿河一维渐变：用河流长轴方向的一维坐标（0~1）代替径向距离，
            // 明暗沿水流方向线性展开。默认取 uv.x（横向长河）；纵向长河把下面改成 uv.y。
            float dist_center = uv.x;
            float foaminess = smoothstep(0.0, 1.0, dist_center);
            float clearness = 0.1 + 0.9 * dist_center;

            vec2 p = mod(uv_square * TAU * TILING_FACTOR, TAU) - 250.0;
            float c = waterHighlight(p, time, foaminess);

            vec3 water_color = vec3(0.0, 0.35, 0.5);
            vec3 colour = vec3(c);
            colour = clamp(colour + water_color, 0.0, 1.0);
            colour = mix(water_color, colour, clearness);
            return colour;
          }

          czm_material czm_getMaterial(czm_materialInput materialInput)
          {
              czm_material material = czm_getDefaultMaterial(materialInput);
              // 获取cesium官方提供的水面材质
              Water water=getWaterNormalCol(materialInput);
              vec3 waterNight=getNightWaterCol(materialInput);
              if(u_isDark){
                material.diffuse = waterNight;
                material.alpha=1.0;
              }else{
                // fade out water effect as specular map value decreases
                material.alpha = water.alpha;
                material.diffuse=water.waterCol;
                material.normal =water.normal;
                material.specular = water.specular;
                material.shininess = water.shininess;
              }
              return material;
          }