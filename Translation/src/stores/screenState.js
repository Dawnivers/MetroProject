import { ref } from 'vue';

/**
 * 全屏（沉浸）模式状态，供三处共用：
 *   - foot.vue 的「全屏模型」工具：进入该模式；
 *   - App.vue：隐藏整个 HUD Panel、并渲染退出按钮；
 *   - App.vue 的 ESC / fullscreenchange 兜底：退出该模式。
 */
const immersive = ref(false);

/**
 * 退出按钮的定位锚点。
 * 进入全屏时把「全屏模型」按钮当时的实际位置换算成「距离视口右下角多远」，
 * 这样即使进入浏览器全屏后视口尺寸变化，退出按钮依旧停在同一相对位置
 * （也就是原来那个按钮所在的地方）。
 * 形如 { right: number, bottom: number, size: number }，单位 px。
 */
const exitAnchor = ref(null);

export function useScreenState() {
  return { immersive, exitAnchor };
}

/* ---------------- 齿轮工具栏共享状态（foot.vue 与 Toolbar.vue 双向读写） ---------------- */

/** 当前选中的工具：null | 'mouse' | 'layers' | 'fullscreen' */
const activeTool = ref(null);
/** 「显示鼠标位置」开关：true 显示鼠标皮肤，false 隐藏 */
const mouseToolOn = ref(true);
/** 鼠标是否停在「齿轮 + 工具栏」这片热区里 */
const gearHover = ref(false);
/** 弹层位置：以 1920×1080 设计画布为坐标系，由齿轮按钮真实位置反算 */
const popupPos = ref({ right: 220, bottom: 270 });

export function useToolbarState() {
  return { activeTool, mouseToolOn, gearHover, popupPos };
}
