<script setup>
import { onBeforeUnmount } from 'vue';
import { useHeatmap } from './useHeatmap';

/**
 * 「站点拥挤度」这个查询模式的**组件形态**。
 *
 * 它是模式的生命周期边界：外壳用 v-if 挂上它 = 进入热力模式，卸下 = 退出。
 * 和 guideload/RouteDesign.vue 完全对称 —— 外壳里没有任何模式特例代码。
 *
 * 不自己写 onMounted(mount)：useHeatmap 内部那个 immediate 的 watch 已经
 * 覆盖了「viewer 就绪」与「线路数据晚到」两种时机，再挂一次会重复建图。
 * 退出则必须由组件显式接管（销毁热力实例 + 放相机）。
 */
const { destroy, summary, error } = useHeatmap();

onBeforeUnmount(destroy);
</script>

<template>
  <section class="hm-panel">
    <header class="hm-head">
      <span class="hm-title">站点拥挤度</span>
    </header>
    <!-- 报错优先于摘要：静默失败最难查，出错时这一行就是唯一线索 -->
    <p class="hm-body" :class="{ 'is-error': Boolean(error) }">
      {{ error || summary }}
    </p>
  </section>
</template>

<style scoped>
/* 与路径规划面板同一定位基准：24(左) + 186(宽) + 12(间隙) */
.hm-panel {
  position: absolute;
  left: 222px;
  top: 112px;
  z-index: 60;
  width: 210px;
  pointer-events: auto;

  background: linear-gradient(
    180deg,
    rgba(9, 26, 50, 0.95),
    rgba(5, 11, 20, 0.97)
  );
  border: 1px solid var(--panel-border, rgba(226, 186, 100, 0.45));
  box-shadow:
    0 10px 28px rgba(0, 0, 0, 0.7),
    inset 0 0 16px rgba(11, 30, 56, 0.55);
  clip-path: polygon(
    12px 0,
    100% 0,
    100% calc(100% - 12px),
    calc(100% - 12px) 100%,
    0 100%,
    0 12px
  );

  /* 弹层离开了 .foot-page，设计令牌要在这里重新声明一份 */
  --color-gold: #e2ba64;
  --color-gold-glow: #fce38a;
  --color-cyan-glow: #11efe3;
  --color-text-main: #e2f1ff;
  --color-text-muted: #88a2be;
  --panel-border: rgba(226, 186, 100, 0.45);
  --font-scifi: 'Rajdhani', 'Noto Sans SC', sans-serif;
  --font-sans: 'Noto Sans SC', sans-serif;
  font-family: var(--font-sans);
}

.hm-head {
  padding: 6px 10px;
  border-bottom: 1px solid rgba(226, 186, 100, 0.35);
  background: rgba(226, 186, 100, 0.07);
}

.hm-title {
  font-family: var(--font-scifi);
  font-size: 15px;
  letter-spacing: 0.16em;
  color: var(--color-gold-glow);
  white-space: nowrap;
}

.hm-body {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.hm-body.is-error {
  color: #ff8a8a;
}
</style>
