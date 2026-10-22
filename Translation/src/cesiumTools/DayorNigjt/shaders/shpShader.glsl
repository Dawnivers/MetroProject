  vec3 getIBLReflection(vec3 positionEC,vec3 normalEC){
              //positionEC 的E是eye 代表眼坐标系
              //normalEC 是眼坐标系下的法线向量
              // 计算视点到表面的向量 先归一化，
              vec3 eyeToSurfaceDir=normalize(positionEC);
              // 根据视点到表面的向量 和 法线向量 生成一个反射向量
              vec3 direction=reflect(eyeToSurfaceDir,normalEC);
              // 计算反射向量在视图坐标系下的坐标
              // 这里的czm_inverseViewRotation 是视图坐标系的逆矩阵，用于将反射向量从视图坐标系转换到世界坐标系
              // coord 是反射向量在世界坐标系下的坐标 把反射图案锚定到世界
              vec3 coord = normalize(vec3(czm_inverseViewRotation * direction));
              // uv 是反射向量在世界坐标系下的uv坐标
              vec2 uv=vec2(coord.x,(coord.z - coord.y) / 3.0);//伪uv坐标，因为反射图案锚定到世界坐标系，所以需要根据世界坐标系下的坐标来计算uv坐标
              vec3 resCol=vec3(0.);
              // 如果是夜晚，使用夜间的反射贴图
              if(u_isDark){
                resCol=texture2D(u_TextureNight,uv).rgb;
              }else{
                resCol=texture2D(u_TextureDay,uv).rgb;
              }
              return resCol;
            }

            // 夜景下，再添加光带特效
            // h：世界高度（米）  e：世界东向水平坐标（米）  czm_h：归一化高度
 vec3 getColorStripe(float h,float e,float czm_h){
              vec3 col=vec3(0.1,0.2,0.2);
              float heightInterval=50.; //条纹周期
              float lineWidth=5.;//条带高度
              // 高度对周期取模，得到 0~50 的锯齿波，落在亮宽内即高亮
              float modRes=mod(h,heightInterval);
              // 条纹滚动：用「秒」而不是 czm_frameNumber（帧序号）。
              // 原来写 czm_frameNumber/120.，帧率一变速度就变：6FPS 时慢 9 倍、60FPS 时快 9 倍。
              // 现在由 JS 每帧写入 u_time（秒），u_stripePeriod 是滚动一个周期的秒数（越大越慢）。
              float iTime=u_time/u_stripePeriod;
              // 构造uv坐标：横向按世界东向平铺，纵向按世界高度平铺并随时间滚动
              // 用世界坐标而非 positionMC，保证不同瓦片的条纹能对齐
              float textureX=fract(e/50.);
              float textureY=fract(h/50.)-iTime;
             
              vec2 uv = vec2(textureX,textureY);
              vec3 highLightCol=texture2D(u_colorTexture,uv).rgb;
              // modRes小于lineWidth的时候，就说明要高亮
              if(modRes<lineWidth){
                  col=highLightCol;
              }else{
                  col*=czm_h;
              }
              return col;
            }

void fragmentMain(FragmentInput fsInput,inout czm_modelMaterial material) {
                vec3 positionEC=fsInput.attributes.positionEC;
                vec3 normalEC=fsInput.attributes.normalEC;
                // 环境光强度因子
                float ambientCoefficient = 0.3;
                // 漫反射光照因子
                float diffuseCoefficient = max(0.0, dot(normalEC, czm_sunDirectionEC));
               
                float _heightRange = maxHeight; // 高亮的范围(_baseHeight ~ _baseHeight + _heightRange)
               
                // —— 世界坐标高度：跨瓦片统一的"同一把尺子" ——
                vec3 positionWC = fsInput.attributes.positionWC;
                // 沿地理"上"方向的高度（米），以参考地面点为 0
                float worldH = dot(positionWC - u_refWC, u_upWC);
                // 沿地理"东"方向的水平坐标（米），供光带横向平铺使用
                float worldE = dot(positionWC - u_refWC, u_eastWC);
                // 建筑基础色（高度，单位米）
                float czm_height = worldH;
                // 得到取值范围0-1的高度
                float czm_h=clamp((worldH - minHeight) / (maxHeight - minHeight), 0.0 , 1.0 );
                float bottomColor= czm_height / _heightRange*2.0;
               
                vec3 resCol=material.diffuse;
                // 夜间效果
                if(u_isDark){
                  // 房顶给固定颜色增加立体感
                  if(czm_height<29.0) {
                    resCol *= vec3(bottomColor);
                  }else{
                    resCol *= vec3(czm_h); // 渐变
                  }
                 
                  // 动态光环：单向 楼顶 → 楼底（1 → 0）
                  // 同样改为按秒推进：u_sweepPeriod 是走完一趟的秒数（越大越慢）。
                  // 原写法 czm_frameNumber / 240.0 在 60FPS 下约 4 秒一趟，帧率一降就慢得几乎不动。
                  float sweepT = 1.0 - fract(u_time / u_sweepPeriod);
                  // 扫光当前所在的物理高度（米）
                  float sweepZ = mix(minHeight, maxHeight, sweepT);
                  // 用物理距离（米）判定光带，保证高楼矮楼宽度一致
                  float dZ = abs(worldH - sweepZ);
                  float birghtness = (1.0 - smoothstep(0.0, 3.0, dZ)) * 10.0;
                  // 获取IBL反射贴图(夜景)
                  vec3 IBLCol=getIBLReflection(positionEC,normalEC);
                  resCol=mix(resCol,IBLCol,0.5);
                  vec3 colorStripe=getColorStripe(worldH,worldE,czm_h);
                  // 给到一个动态光环
                  resCol += (resCol * birghtness);
                  resCol +=colorStripe*3.;
                }else{
                  // 白天，添加一个phong光照模型
                  vec3 IBLCol=getIBLReflection(positionEC,normalEC); 
                  resCol *= vec3(czm_h);
                  resCol=mix(resCol,IBLCol,0.5);
                  // 添加上基本的光照模型
                  resCol *= min(diffuseCoefficient + ambientCoefficient, 1.0);
                }
                material.diffuse=resCol;
                material.alpha=1.0;
            }