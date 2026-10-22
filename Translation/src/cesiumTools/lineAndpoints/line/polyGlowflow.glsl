uniform vec4 color;
uniform float glowPower;
uniform float taperPower;
uniform float flowSpeed;
uniform float flowLength;
uniform float flowIntensity;
uniform float flowOffset;
    czm_material czm_getMaterial(czm_materialInput materialInput){
   
    czm_material material =czm_getDefaultMaterial(materialInput);
    

    
    vec2 st =materialInput.st;
    //添加从Cesium源码中 复制的 高亮线效果
    float glow = glowPower / abs(st.t - 0.5) - (glowPower / 0.5);

    if (taperPower <= 0.99999) {
        glow *= min(1.0, taperPower / (0.5 - st.s * 0.5) - (taperPower / 0.5));
    }

    vec4 fragColor;
    fragColor.rgb = max(vec3(glow - 1.0 + color.rgb), color.rgb);
    fragColor.a = clamp(0.0, 1.0, glow) * color.a;
    fragColor = czm_gammaCorrect(fragColor);

    material.emission = fragColor.rgb;
    material.alpha = fragColor.a;

    //将高亮线进行流动处理
     float alpha =fragColor.a*0.3; //根据上面计算的透明 没流动部分就淡 流动部分就正常
    material.diffuse=color.rgb;
    
    // flowOffset 是每条线各自的初相位：
// czm_frameNumber 是全局帧号，所有线共用，只有加上不同的相位偏移，
// 各线的流线头才会错开、不会同时到达终点
    float iTime =czm_frameNumber/300.*flowSpeed + flowOffset;
    iTime =fract(iTime);
    iTime=clamp(iTime,0.,1.); //归一化
    if(st.s>iTime &&st.s<iTime+flowLength){
        alpha=fragColor.a;
        //颜色平缓渐变 开始 结束 方向
        alpha =smoothstep(iTime,iTime+flowLength,st.s);
        material.emission*=flowIntensity;
    }
    material.alpha=alpha;
    
    return material;
}