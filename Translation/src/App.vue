<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import Panel from './components/screenUI/panel.vue';
import PerfGuard from './components/screenUI/perfGuard.vue';
import SciFiLoader from './components/loading/SciFiLoader.vue';
import { useSceneState } from '@/stores/sceneState';
import { useScreenState } from '@/stores/screenState';

/**
 * 三维场景用 <KeepAlive> 包起来（见 stores/sceneState.js）：
 * 场景被切走时 CesiumView 只走 deactivated，Viewer / WebGL 上下文 / 相机位姿
 * 全部留在内存里，切回来直接复用，不再重新 initViewer + 重新加载 tileset。
 *
 * 注意：KeepAlive 要求子节点是**动态组件**，所以这里用 <component :is>，
 * 而不是写死的 <CesiumView />；写死的话组件永不 deactivate，KeepAlive 形同虚设。
 */
const { sceneComponent, sceneVisible } = useSceneState();

/* ---------------- 全屏（沉浸）模式 ---------------- */

const { immersive, exitAnchor } = useScreenState();

/** 退出按钮的定位：贴住进入全屏时那个工具按钮所在的位置 */
const exitStyle = computed(() => {
  const anchor = exitAnchor.value;
  if (!anchor) return { right: '24px', bottom: '24px', width: '34px', height: '34px' };
  return {
    right: `${anchor.right}px`,
    bottom: `${anchor.bottom}px`,
    width: `${anchor.size}px`,
    height: `${anchor.size}px`,
  };
});

/** 退出全屏：恢复 HUD，并退出浏览器全屏（如果确实进了） */
const exitImmersive = () => {
  immersive.value = false;
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
};

/**
 * ESC 兜底退出。
 * HUD 被隐藏后 foot.vue 的键盘监听仍挂着，但全屏状态由 App 管，
 * 所以这里必须自己接一份 —— 用户按 ESC 时无论焦点在哪都能退出。
 */
const onKeydown = (event) => {
  if (event.key === 'Escape' && immersive.value) exitImmersive();
};

/** 浏览器侧全屏被退出（例如系统 ESC）时同步内部状态，避免两边不一致 */
const onFullscreenChange = () => {
  if (!document.fullscreenElement && immersive.value) immersive.value = false;
};

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  document.addEventListener('fullscreenchange', onFullscreenChange);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
});
</script>

<template>
  <div class="screen-shell">
    <!-- 三维底图层：铺满整屏，层级最低 -->
    <div class="scene-layer">
      <KeepAlive>
        <component :is="sceneComponent" v-if="sceneVisible" />
      </KeepAlive>
    </div>

    <!-- 大屏 HUD 覆盖层：head / 左右侧栏 / foot 全部收纳在 Panel 内部。
         全屏（沉浸）模式整体隐藏，只留三维场景。
         用 v-show 而不是 v-if：Panel 里的 foot.vue 挂着一堆全局监听
         （光标皮肤、齿轮工具栏、ESC 等），卸载会把这些一并带走。
         注：进入「站点管理」时只收左右侧栏，head / foot 保留，
         那是在 panel.vue 内部处理的，不在这里整体隐藏。 -->
    <Panel v-show="!immersive" />

    <!-- 路由面板层：目前只有 /nodes 的站点控制栏（它自身 Teleport 到 .hud-canvas，
         所以这一层不占布局、也不影响任何定位）。
         ⚠ 它必须与上面的 .scene-layer 是**兄弟节点**：三维场景被放在 RouterView
         之外，切路由只会换掉这一层，Cesium 的 Viewer / WebGL 上下文 / 相机位姿
         全部原地不动。反过来把三维组件塞进 RouterView，换页就会重建整个场景。
         参考项目（分层分户项目/Project）的 App.vue 就是这个结构。 -->
    <RouterView />

    <!-- 全屏模式下的退出按钮：与进入时那个工具按钮同一位置 -->
    <Teleport to="body">
      <button
        v-if="immersive"
        type="button"
        class="immersive-exit"
        :style="exitStyle"
        title="退出全屏（ESC）"
        aria-label="退出全屏"
        @click="exitImmersive"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M9.5 4.5v5h-5M14.5 4.5v5h5" />
          <path d="M9.5 19.5v-5h-5M14.5 19.5v-5h5" />
        </svg>
      </button>
    </Teleport>

    <!-- 全屏提示浮窗 -->
    <Teleport to="body">
      <Transition name="immersive-hint">
        <div v-if="immersive" class="immersive-hint" role="status">
          <i class="ih-mark"></i>
          <span>已进入全屏模式</span>
          <kbd class="ih-key">ESC</kbd>
          <span>退出全屏</span>
        </div>
      </Transition>
    </Teleport>

    <!-- 画面卡顿守卫：实测帧率过低（多为集显机器）时提示并给一键低画质 -->
    <PerfGuard />

    <!-- 开屏加载动画：铺在一切之上（z-index 9900），由真实加载事件驱动，
         全部就绪后淡出。它是覆盖层，不阻塞下面 Cesium 的初始化。 -->
    <SciFiLoader />
  </div>
</template>

<style scoped>
.screen-shell {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

/* 三维场景铺底 */
.scene-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
}

/* ---- 退出全屏按钮：与齿轮工具栏的按钮同一套视觉语言 ---- */
.immersive-exit {
  position: fixed;
  z-index: 9500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: #e2ba64;
  background: rgba(10, 22, 40, 0.9);
  border: 1px solid rgba(226, 186, 100, 0.6);
  cursor: pointer;
  outline: none;
  transition: all 0.22s ease;
  clip-path: polygon(
    8px 0,
    100% 0,
    100% calc(100% - 8px),
    calc(100% - 8px) 100%,
    0 100%,
    0 8px
  );
  animation: immersive-exit-in 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.immersive-exit svg {
  width: 60%;
  height: 60%;
}

.immersive-exit:hover {
  color: #11efe3;
  border-color: #11efe3;
  background: rgba(14, 38, 70, 0.92);
  box-shadow: 0 0 14px rgba(17, 239, 227, 0.45);
}

@keyframes immersive-exit-in {
  from {
    opacity: 0;
    transform: scale(0.82);
  }
}

/* ---- 全屏提示浮窗 ---- */
.immersive-hint {
  position: fixed;
  left: 50%;
  bottom: 10%;
  transform: translateX(-50%);
  z-index: 9501;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 18px;
  pointer-events: none;
  color: #e2f1ff;
  font-family: 'Rajdhani', 'Noto Sans SC', sans-serif;
  font-size: 13px;
  letter-spacing: 0.06em;
  background: linear-gradient(
    180deg,
    rgba(9, 26, 50, 0.94),
    rgba(5, 11, 20, 0.96)
  );
  border: 1px solid rgba(226, 186, 100, 0.5);
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.6),
    inset 0 0 18px rgba(11, 30, 56, 0.6);
  clip-path: polygon(
    12px 0,
    100% 0,
    100% calc(100% - 12px),
    calc(100% - 12px) 100%,
    0 100%,
    0 12px
  );
}

/* 呼吸动画放伪元素上：Vue 的 <Transition> 会按元素自身 animation 时长
   决定移除时机，挂根元素上会把离场拖长到动画时长 */
.immersive-hint::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  animation: immersive-breathe 2.6s ease-in-out infinite;
}

.ih-mark {
  width: 6px;
  height: 6px;
  border: 1px solid #11efe3;
  transform: rotate(45deg);
  box-shadow: 0 0 6px rgba(17, 239, 227, 0.8);
}

.ih-key {
  padding: 2px 8px;
  font-family: 'Rajdhani', sans-serif;
  font-size: 12px;
  letter-spacing: 0.12em;
  color: #03070e;
  background: linear-gradient(180deg, #fce38a, #e2ba64);
  border-radius: 2px;
  box-shadow: 0 0 12px rgba(252, 227, 138, 0.6);
  animation: immersive-blink 1.4s steps(2, end) infinite;
}

@keyframes immersive-breathe {
  0%,
  100% {
    box-shadow: inset 0 0 18px rgba(11, 30, 56, 0.6);
  }
  50% {
    box-shadow: inset 0 0 26px rgba(17, 239, 227, 0.3);
  }
}

@keyframes immersive-blink {
  50% {
    opacity: 0.55;
  }
}

/* 提示浮窗自己的出入场：必须带上 translateX(-50%)，否则会和居中定位打架 */
.immersive-hint-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.24s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.immersive-hint-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}

.immersive-hint-enter-from,
.immersive-hint-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}
</style>

<style>
/* 全局重置，避免 body 默认 margin 使 100vw/100vh 出现滚动条 */
html,
body,
#app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
