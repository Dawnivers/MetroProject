/**
 * 线路与站点的统一视觉令牌。
 *
 * 抽出来的原因：「站点管理」栏目（StationPanel.vue）和图层面板（Toolbar.vue）
 * 必须用完全一致的色板 —— 左边列表里 3 号线是什么颜色，三维里 3 号线的光锥
 * 就得是什么颜色，否则用户会对不上号。之前 LINE_COLORS 写死在 Toolbar 里，
 * 复制一份就会立刻出现两套配色，所以改成单一来源。
 */

/**
 * 线路色块调色板，按顺序分配给各线路（想换成官方线路色改这里即可）。
 */
export const LINE_COLORS = [
  '#3aa0ff',
  '#ff7fb0',
  '#ffd178',
  '#b6e26b',
  '#f2f2f2',
  '#2e7d32',
  '#ff9f1c',
  '#9ad0ff',
  '#c084fc',
  '#22d3ee',
  '#fb7185',
  '#a3e635',
];

/**
 * 换乘站色（洋红 #ff2bd1）。
 * LINE_COLORS 里是蓝/橙金/黄绿/绿/青/紫/粉，色相都不落在洋红这一段，
 * 饱和度和亮度也拉得更满，因此换乘站在一堆普通站里一眼可辨。
 */
export const TRANSFER_COLOR = '#ff2bd1';

/** 「上海地铁1号线」→「1号线」：面板和图例里只留线号 */
export const shortLineName = (name) => String(name ?? '').replace(/^上海地铁/, '');
