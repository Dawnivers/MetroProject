// =============================================================================
// flowShader.glsl —— ShaderToy 流体/分形光带特效，转换为 Cesium CustomShader 片段
//
// 原始入口：void mainImage(out vec4 fragColor, vec2 fragCoord)
// 变量对应关系：
//   iResolution.xy  -> u_resolution   （JS 传入的视口分辨率，设备像素）
//   iTime           -> u_time（JS 每帧写入的秒数；早期版本误用 czm_frameNumber/60.0，
//                      导致动画速度随帧率变化，现已改为真正的时间驱动）
//   fragCoord       -> gl_FragCoord.xy（屏幕像素坐标，原点左下）
//   fragColor       -> 局部变量 o，最终写入 material.diffuse
// 配套使用：mode = MODIFY_MATERIAL + lightingModel = PBR（保留原材质，特效做加法叠加）
// =============================================================================

// 自研 vec2 版 tanh：GLSL ES 1.00 没有内置 tanh（ShaderToy 桌面 GLSL 才有），
// WebGL1 回退时会编译失败。这里用数值更稳定的等价形式 1 - 2/(exp(2x)+1) 替代。
vec2 stTanh(vec2 x) {
  return 1.0 - 2.0 / (exp(2.0 * x) + 1.0);
}

void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  // ---------- 输入准备 ----------
  vec2 u = gl_FragCoord.xy;       // 当前片元的屏幕像素坐标
  vec2 v = u_resolution;          // 视口分辨率（设备像素）
  u = 0.4 * (u + u - v) / v.y;    // 归一化到以屏高为基准的坐标；系数越大，光带越密集

  // ---------- 迭代状态 ----------
  vec4 o = vec4(1.0, 2.0, 3.0, 0.0); // 颜色累加器（等价原 fragColor）
  vec4 z = o;                        // 参与迭代的中间量

  float a = 0.5;                     // 随迭代逐渐增大的漂移/缩放参数
  // 时间：由 JS 每帧写入的「秒」，不再用 czm_frameNumber —— 帧序号会让动画速度随帧率浮动
  // （原来 czm_frameNumber / 60.0 假设 60FPS，换 GPU 后帧率从 6→57 就快了近 10 倍）
  float t = u_time;
  // ---------- 主迭代 ----------
  // GLSL ES 1.00（WebGL1）只允许「标准 for 循环」，不允许 while/do-while，且：
  //   1. 循环索引必须是 int；
  //   2. init 必须是简单声明；
  //   3. condition 必须是「索引 < 常量」这类比较；
  //   4. increment 只能是索引自增/自减（++i / --i）。
  // 因此把原 ShaderToy 的 while 改写为标准 for，迭代 i = 1..18 共 18 次。
  for (int i = 1; i < 19; ++i) {
    // 原代码的 ++t 先拆出来，在每轮开始时自增一次
    ++t;
    // 更新漂移向量 v
    v = cos(t - 7.0 * u * pow(a += 0.03, float(i))) - 5.0 * u;

    // 更新坐标 u：矩阵旋转 * 非线性扭曲 * 小步位移
    // 原 ShaderToy 用 mat2(cos(vec4)) 按列主序填充矩阵；
    // 为兼容 GLSL ES 1.00，这里显式用两个 vec2 列构造 mat2
    vec4 mr = cos(float(i) + 0.02 * t - z.wxzw * 11.0);
    u += stTanh(40.0 * dot(u *= mat2(mr.xy, mr.zw), u)
                * cos(100.0 * u.yx + t)) / 200.0
       + 0.2 * a * u
       + cos(4.0 / exp(dot(o, o) / 100.0) + t) / 300.0;

    // 累加光带（对应原循环里的 o += 部分）
    o += (1.0 + cos(z + t))
       / length((1.0 + float(i) * dot(v, v))
              * sin(1.5 * u / (0.5 - dot(u, u)) - 9.0 * u.yx + t));
  }

  // ---------- 最终调色（生成特效颜色，仅作为叠加层） ----------
  o = 25.6 / (min(o, 13.0) + 164.0 / o) - dot(u, u) / 250.0;

  // 用分形的亮度作为遮罩权重，而非直接使用其原始多色输出（原色偏白、不可控）
  vec3 flowColor = clamp(o.rgb, 0.0, 1.0);
  float lum = dot(flowColor, vec3(0.3333));      // 平均亮度，作为空间分布遮罩

  // ---------- 粉紫魔幻调色盘 ----------
  // 暗部 -> 深紫，高亮 -> 亮粉，形成粉紫渐变，营造魔幻氛围
  vec3 purpleDeep = vec3(0.4, 0.08, 0.6);        // 深紫
  vec3 pinkLight  = vec3(0.9, 0.25, 0.7);        // 亮粉
  // 按亮度混合得到特效色，再乘亮度平方做权，只在高亮纹路处明显
  vec3 glow = mix(purpleDeep, pinkLight, lum) * (lum * lum) * u_intensity;

  // ---------- 叠加到材质：分昼夜 ----------
  if (u_isDark) {
    // 夜间自发光：太阳落到地平线下，PBR 光照项≈0，若写进 diffuse 会被整体乘黑导致特效消失。
    // 改为写入 material.emissive —— Cesium 在 LightingStageFS 中是 `color += emissive`
    // （加在光照之后），完全不依赖光源，即"自发光"；再配合夜间开启的 bloom 形成光晕。
    // 乘 3.0 是为了让光带在无光环境下足够醒目（emissive 为线性空间，>1 会被 ACES 压回）。
    material.emissive += glow * 1.2;
  } else {
    // 白天：Screen 混合叠加，保留原材质质感
    // Screen 混合：1-(1-base)*(1-glow)，比直接加法更接近"发光"，不易过曝成纯白
    material.diffuse = clamp(1.0 - (1.0 - material.diffuse) * (1.0 - glow), 0.0, 1.0);
  }
  material.alpha = 1.0;
}