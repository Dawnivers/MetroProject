<script setup>
import { computed, ref } from 'vue';
import HeatMode from './heatmap/HeatMode.vue';
import RouteDesign from './guideload/RouteDesign.vue';
import StationControl from './stationcontrol/StationControl.vue';

/**
 * 「站点管理」栏目左上角的查询模式选择 —— **纯声明式外壳**。
 *
 * 它只做两件事：画三个按钮、记当前选中谁。效果的生死完全不在这里：
 * 每个模式是一个组件，`<component :is>` 挂上就等于「进入模式」，卸下就是「退出」，
 * 进入/退出所需的一切（藏全局线路、清场、锁相机、删实体、还原快照）都在组件自己的
 * onMounted / onBeforeUnmount 里，由 Vue 的生命周期统一兜住。
 *
 *   heatmap/HeatMode.vue      站点拥挤度（热力影像层 + 自有状态卡）
 *   guideload/RouteDesign.vue 路径规划（起终点查询 + 三维高亮 + 概览表）
 *   stationcontrol/StationControl.vue 站控措施（站点状态气泡 + 措施图例）
 *
 * 为什么不用「外壳调 mount()/destroy()」：
 *   · 那会让同一件事有两个 owner —— 外壳负责关、组件卸载也可能关，
 *     一旦两边都写了就是重复初始化或提前销毁，顺序还得靠人工约定；
 *   · 现在新增一个模式 = 新建目录 + 在 MODES 里加一行 `component`，
 *     外壳一行都不用改，也不存在「忘了 destroy」的可能。
 */

const MODES = [
  {
    id: 'heat',
    label: '站点拥挤度',
    note: '按站点客流生成热力图',
    component: HeatMode,
  },
  {
    id: 'guideload',
    label: '路径规划',
    note: '选择起终点查询换乘方案',
    component: RouteDesign,
  },
  {
    id: 'stationcontrol',
    label: '站控措施',
    note: '在站点上显示当前执行的封站 / 安检等措施',
    component: StationControl,
  },
];

/** 当前选中的模式 id，空串＝都没选（对应的模式组件随之卸载） */
const active = ref('');

/** 当前模式的定义；同时驱动按钮高亮、底部提示、以及下方要挂哪个组件 */
const current = computed(() => MODES.find((mode) => mode.id === active.value) ?? null);

/** 再点一次当前模式 = 关掉。除改这一个 ref 之外没有别的副作用 */
const choose = (mode) => {
  active.value = active.value === mode.id ? '' : mode.id;
};
</script>

<template>
  <Teleport to=".hud-canvas" defer>
    <!-- 进栏目时有一小段入场动画，和站点控制栏的 sp-pop 节奏对齐 -->
    <Transition name="qm-pop">
      <section class="qm-panel">
        <header class="qm-head">
          <span class="qm-title">查询模式选择</span>
        </header>

        <div class="qm-body">
          <button
            v-for="mode in MODES"
            :key="mode.id"
            type="button"
            class="qm-item"
            :class="{ active: active === mode.id }"
            :title="mode.note"
            @click="choose(mode)"
          >
            <i class="qm-icon" :class="`is-${mode.id}`">
              <!-- 拥挤度：三根上升的柱 -->
              <svg v-if="mode.id === 'heat'" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1" y="9" width="3" height="6" rx="1" />
                <rect x="6.5" y="5" width="3" height="10" rx="1" />
                <rect x="12" y="1" width="3" height="14" rx="1" />
              </svg>
              <!-- 路径规划：两站 + 连线 -->
              <svg
                v-else-if="mode.id === 'guideload'"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <circle cx="3" cy="12.5" r="2.2" />
                <circle cx="13" cy="3.5" r="2.2" />
                <path
                  d="M4.8 11.1 6.5 9.2M8 7.6l1.7-1.9"
                  fill="none"
                  stroke-width="1.6"
                  stroke-linecap="round"
                />
              </svg>
              <!-- 站控措施：盾牌 -->
              <svg v-else viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M8 1.2 13.4 3v5.1c0 3.2-2.2 5.6-5.4 6.7C4.8 13.7 2.6 11.3 2.6 8.1V3L8 1.2Z"
                  fill="none"
                  stroke-width="1.5"
                  stroke-linejoin="round"
                />
              </svg>
            </i>
            <span class="qm-label">{{ mode.label }}</span>
          </button>
        </div>

        <!-- 底部只放当前模式的**静态说明**：动态状态（客流摘要、报错、方案数字）
             归各模式自己的卡片，外壳不掺和 -->
        <p class="qm-foot">
          <span>{{ current?.note ?? '选择一个模式查看效果' }}</span>
        </p>
      </section>
    </Transition>

    <!-- 当前模式的效果 + 自己的面板：挂上 = 进入模式，卸下 = 退出并还原。
         `:is` 指向组件本身，外壳不需要知道任何模式的存在方式。 -->
    <component :is="current.component" v-if="current?.component" />
    
  </Teleport>
</template>

<style scoped>
/* 位置：站点管理栏目会收起左右侧栏（panel.vue:63 起），左侧整片空出来了，
   所以贴左上角摆放，顶边避开 96px 高的 head 区域。 */
.qm-panel {
  position: absolute;
  left: 24px;
  top: 112px;
  z-index: 60;
  width: 186px;
  pointer-events: auto;

  background: linear-gradient(
    180deg,
    rgba(9, 26, 50, 0.95),
    rgba(5, 11, 20, 0.97)
  );
  border: 1px solid var(--panel-border);
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

.qm-head {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid rgba(226, 186, 100, 0.35);
  background: rgba(226, 186, 100, 0.07);
}

.qm-title {
  font-family: var(--font-scifi);
  font-size: 15px;
  letter-spacing: 0.16em;
  color: var(--color-gold-glow);
  white-space: nowrap;
}

.qm-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
}

/* 一行一个模式：左图标、右文字，与课程版「查询模式选择」的竖排一致 */
.qm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(226, 186, 100, 0.32);
  color: var(--color-text-main);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: all 0.18s ease;
}

.qm-item:hover {
  border-color: rgba(17, 239, 227, 0.75);
  background: rgba(17, 239, 227, 0.1);
  color: var(--color-cyan-glow);
}

/* 选中态用金色（与站点面板的「已亮」一致），避免和悬停色混淆 */
.qm-item.active {
  border-color: var(--color-gold);
  background: rgba(226, 186, 100, 0.16);
  color: var(--color-gold-glow);
  box-shadow: inset 0 0 12px rgba(226, 186, 100, 0.22);
}

.qm-icon {
  flex: none;
  display: flex;
  width: 16px;
  height: 16px;
  color: var(--color-gold);
}

.qm-item:hover .qm-icon {
  color: var(--color-cyan-glow);
}

.qm-item.active .qm-icon {
  color: var(--color-gold-glow);
}

.qm-icon svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

/* 拥挤度图标用 fill，另外两个是描边 —— 各自上色 */
.qm-icon svg rect {
  fill: currentColor;
}

.qm-icon svg circle {
  fill: currentColor;
}

.qm-icon svg path {
  stroke: currentColor;
}

.qm-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.qm-foot {
  margin: 0;
  padding: 0 10px 8px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-text-muted);
}

.qm-pop-enter-active {
  transition:
    opacity 0.22s ease,
    transform 0.26s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.qm-pop-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.qm-pop-enter-from,
.qm-pop-leave-to {
  opacity: 0;
  transform: translateX(-14px) scale(0.97);
}
</style>
