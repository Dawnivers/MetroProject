import HtmlMarkerManager from './popupManager';

/**
 * 站点/气泡管理器（当前**不共享实例**，每个使用方各建一个）。
 *
 * 背景：气泡（SimpleLabel）现在有多个来源 —— 站点管理的 400 个站名标签（Toolbar 建）、
 * 路径规划的起终气泡、站控措施的几百个措施气泡。每个气泡各挂一个 postRender 时
 * 400 个标签实测会把帧率从 69 拖到 30，所以同一批气泡必须共用一个 postRender。
 *
 * 试过做「全项目共享一个实例」：Toolbar 与站控措施登记到同一个 manager 上。
 * 实测在浏览器里出现「站点管理的标签不再定位/面板点击无响应」，
 * 而浏览器桥看不到 console，无法判断是 HMR 双实例还是真 bug，因此回退为：
 *   · Toolbar 仍用自己内部的 manager（保持原行为）；
 *   · 站控措施自己 new 一个 manager（一个 postRender 管它那几百个气泡）。
 * 两者互不干扰，性能同档（每个来源 1 个 postRender，而不是每气泡 1 个）。
 *
 * 注意：manager 的 removeMarker 在标记清空时会摘掉 postRender 监听器，
 * 所以「清空又重建」的流程必须重新 addMarker，不要缓存 isListening 的判断。
 */
export default HtmlMarkerManager;
