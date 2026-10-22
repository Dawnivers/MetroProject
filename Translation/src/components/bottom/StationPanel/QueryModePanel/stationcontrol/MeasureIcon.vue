<script setup>
import { computed } from 'vue';

/**
 * 站控措施图标（内联 SVG，不依赖 iconfont）。
 *
 * 项目里没有引入 iconfont，参考项目那套 `metro-*` 图标类名在本项目里是空的，
 * 所以这里按「语义 → 图形」自己画：全部 24×24 网格、描边取 currentColor，
 * 颜色由外层方框的 --c 变量决定（与图例同色）。
 *
 * 语义对照：
 *   封 封站        —— 禁止圈（斜杠）
 *   检 安检        —— 盾牌 + 对勾
 *   保 重保        —— 双线盾牌 + 星
 *   放 分批放行    —— 人 + 向右箭头
 *   围 导流围栏    —— 围栏（三柱两横）
 *   闸 关闭闸机    —— 三叶闸机
 *   售 减缓售票    —— 车票 + 暂停双杠
 *   梯 电梯换向    —— 阶梯 + 上下箭头
 *   导 引导分流    —— 分叉箭头
 */
const props = defineProps({
  code: { type: String, default: '' },
});

/** 每个代码的路径；filled 的项用 currentColor 填充（用于小三角/方块） */
const SHAPES = {
  封: [
    { d: 'M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2z' },
    { d: 'M6.1 17.9 17.9 6.1' },
  ],
  检: [
    { d: 'M12 3.2 19 6v5.2c0 4.3-2.9 7.5-7 8.8-4.1-1.3-7-4.5-7-8.8V6z' },
    { d: 'M8.6 12.1l2.3 2.3 4.5-4.6' },
  ],
  保: [
    { d: 'M12 2.8 20 6v5.6c0 4.6-3.3 8.1-8 9.6-4.7-1.5-8-5-8-9.6V6z' },
    { d: 'M12 8.2l1.2 2.4 2.6.4-1.9 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7L8.2 11l2.6-.4z' },
  ],
  放: [
    { d: 'M9 5.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z' },
    { d: 'M4 19.6v-2.2a5 5 0 0 1 10 0v2.2' },
    { d: 'M15.2 12.4h5.6' },
    { d: 'M18.1 9.6 20.9 12.4 18.1 15.2' },
  ],
  围: [
    { d: 'M5 7.2v12.4' },
    { d: 'M11 7.2v12.4' },
    { d: 'M17 7.2v12.4' },
    { d: 'M3.6 11h16.8' },
    { d: 'M3.6 15.8h16.8' },
  ],
  闸: [
    { d: 'M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z' },
    { d: 'M12 9.4V3.4' },
    { d: 'M9.8 13.2 4.6 16.2' },
    { d: 'M14.2 13.2 19.4 16.2' },
  ],
  售: [
    { d: 'M3.4 8.2h11.2v7.6H3.4z' },
    { d: 'M3.4 12h11.2' },
    { d: 'M17.6 9.2v5.6' },
    { d: 'M20.6 9.2v5.6' },
  ],
  梯: [
    { d: 'M4 19.4h4v-4h4v-4h4v-4h4' },
    { d: 'M17.4 4.6 20.6 7.4 17.4 10.2' },
    { d: 'M6.6 13 3.4 15.8 6.6 18.6' },
  ],
  导: [
    { d: 'M12 20.6V12' },
    { d: 'M12 12 5.4 5.4' },
    { d: 'M12 12l6.6-6.6' },
    { d: 'M4.6 4.6h1.6v1.6H4.6z', filled: true },
    { d: 'M17.8 4.6h1.6v1.6h-1.6z', filled: true },
    { d: 'M11.2 20.6h1.6v1.6h-1.6z', filled: true },
  ],
};

const paths = computed(() => SHAPES[props.code] ?? SHAPES.检);
</script>

<template>
  <svg class="measure-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path
      v-for="(item, index) in paths"
      :key="index"
      :d="item.d"
      :fill="item.filled ? 'currentColor' : 'none'"
      :stroke="item.filled ? 'none' : 'currentColor'"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
.measure-icon {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}
</style>
