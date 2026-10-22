// 重点活动「光柱」着色器
//
// 与同目录 cone.glsl / circleglow.glsl 同一套写法：
//   · 只声明 uniform，入口固定为 czm_getMaterial；
//   · 不写 #version / precision，由 Cesium 的材质系统拼接；
//   · 时间相位一律用 czm_frameNumber 推，**不需要外部每帧推 time uniform**
//     —— 这一点和 PolylineFlowMaterialProperty 的做法一致，好处是
//     材质可以被当成 isConstant 只编译一次，动画依然在跑。
//
// 墙面几何的 st 语义（Cesium WallGeometry）：
//   · st.s —— 沿柱周长方向（positions 数组从头走到尾，0 是起点、1 是终点）
//   · st.t —— 沿柱高方向（minimumHeights 处为 0，maximumHeights 处为 1）
//
// 注意：**不要拿 st.s 做任何明暗**。墙是一个绕一圈的条带，s=0 和 s=1 是同一条缝，
// 任何以 s 为自变量的非周期函数都会在柱面上留下一道竖向暗缝。
// 所以横向一律给常数，明暗只由 t 决定。

uniform vec4 color;
uniform float opacity; // 整体透明度倍率
uniform float flowSpeed; // 光带向上流动的速度倍率
uniform float breatheSpeed; // 明暗呼吸的速度倍率

czm_material czm_getMaterial(czm_materialInput materialInput)
{
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;

    // 贴图是一维竖直剖面（只有高度方向有内容），沿 t 循环滚动 → 亮带自下而上跑
    float flow = fract(czm_frameNumber / 60.0 * flowSpeed);
    vec4 colorImage = texture2D(image, vec2(0.5, fract(st.t - flow)));

    // 顶部渐隐：否则柱子会在半空被整齐切断，看着像一个悬空的圆柱
    float tip = 1.0 - smoothstep(0.40, 1.0, st.t);

    // 明暗呼吸：每 10 帧翻转一次，两个系数交替。
    // 峰值不要给太大 —— alpha 会直接被 clamp 到 1，柱子就从「光」变成一块实心的板。
    float breathe = mix(
        0.90,
        1.30,
        step(0.5, fract(czm_frameNumber / 10.0 * breatheSpeed))
    );

    material.diffuse = 2.0 * color.rgb;
    material.alpha = colorImage.a * color.a * tip * breathe * opacity;
    return material;
}
