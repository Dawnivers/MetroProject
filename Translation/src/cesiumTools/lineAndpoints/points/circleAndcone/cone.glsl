// 站点「光锥」着色器 —— 科幻脉冲型
//
// 与同目录 lightcolumn.glsl 同一套约定：
//   · 只声明 uniform，入口固定为 czm_getMaterial，不写 #version / precision；
//   · 时间一律用 czm_frameNumber / 60.0 推（= 秒），不接收外部每帧回传的 time
//     uniform，材质因此可以是 isConstant、只编译一次，动画照跑。
//
// 几何语义（容易踩坑，别按「u 是角度、v 是高度」去理解）：
//   CylinderGeometry 的 st 是 **XY 平面投影**，不是角度+高度：
//       st = ((x + rad) / 2rad, (y + rad) / 2rad)，rad = max(topRadius, bottomRadius)
//   （见 cesium/Source/Core/CylinderGeometry.js 的纹理坐标生成）
//   本光锥 topRadius = 0，于是：
//     · 锥底一圈 → st 落在以 (0.5,0.5) 为心、半径 0.5 的圆上 → dis = 0.5
//     · 锥尖顶点 → st = (0.5,0.5)                              → dis = 0
//   所以 h = 1 - dis*2 就是「0 在底、1 在尖」的归一化高度，竖向动画全靠它。
//
// 视觉由三层叠出来：
//   ① 底座（ground）：底亮上暗，让锥体像「光源在脚下」而不是一整片渐变
//   ② 能量带（pulse）：向上流动，fract 循环 + sin 收口，回卷处天然为 0，不留横向接缝
//   ③ 呼吸（breathe）：0.3~0.6Hz 慢节拍。旧版是 12Hz 的 step() 方波，
//      人眼读不出周期、只剩抖动感 —— 这是「缺乏动感」的主因
//
// 混合方式见 setcone.js：flat（不参与光照）+ ADDITIVE_BLEND（越叠越亮），
// 所以这里的 alpha 就是「亮度」，最终叠加到帧缓冲的贡献是 diffuse × alpha。

uniform vec4 color;
uniform float opacity; // 整体强度倍率
uniform float flowSpeed; // 能量带向上跑的速度（每秒走几个完整锥高）
uniform float bandCount; // 同时存在的能量带数量（普通站 1，换乘站 2）
uniform float beatSpeed; // 呼吸节拍速度倍率
uniform float energy; // 发光增益（换乘站 > 1）

czm_material czm_getMaterial(czm_materialInput materialInput)
{
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;

    // 秒。旧版是 /10.0（60fps 下等于 12Hz 方波），与 lightcolumn.glsl 的 /60 也不一致
    float t = czm_frameNumber / 60.0;

    // 归一化高度：0 在锥底，1 在锥尖（推导见文件头）
    float dis = length(st - vec2(0.5));
    float h = clamp(1.0 - dis * 2.0, 0.0, 1.0);

    // ① 底座：底部最亮，往上衰减；指数 >1 让亮区收在脚下，不至于糊满整根锥子
    float ground = pow(1.0 - h, 1.8);

    // ② 能量带：h*bandCount - t*flowSpeed 做循环相位，减 t 表示带子向上跑；
    //    sin 收口（取 6 次幂收窄）保证 fract 回卷处为 0，接缝看不出来
    float phase = fract(h * bandCount - t * flowSpeed);
    float pulse = pow(sin(phase * 3.14159265359), 6.0);

    // ③ 呼吸：慢、幅度小（±14%）。幅度大 + 频率高就会退回「抖」的观感
    float breathe = 0.86 + 0.14 * sin(t * 6.28318530718 * 0.42 * beatSpeed);

    // 锥尖收口渐隐：加色混合下锥尖的像素会聚成一个刺眼白点，必须压掉
    float tip = 1.0 - smoothstep(0.72, 1.0, h);

    float intensity = (ground * 0.28 + pulse * 0.52) * tip * breathe * energy;

    // 加色混合下最终亮度 = diffuse × alpha：带心轻微偏白即可，
    // 系数给大了会整根过曝成一块白板
    material.diffuse = color.rgb * (1.0 + 0.45 * pulse);
    material.alpha = clamp(color.a * intensity * opacity, 0.0, 1.0);
    return material;
}
