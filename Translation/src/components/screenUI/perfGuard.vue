<script setup>
/**
 * 画面卡顿守卫（perfGuard）
 *
 * 背景：本项目在「混合显卡笔记本」上有个共性坑——Windows 默认会把浏览器分给集成显卡，
 * 而 Cesium 这套场景在集显上只有个位数帧率；同一台机器强制走独显则有 50+ FPS。
 * 这不是项目能自己解决的（GPU 选择权在用户系统手里），但项目至少应该做到：
 *   1. 自己发现"现在很卡"，而不是让用户以为项目坏了；
 *   2. 直接告诉用户怎么改（Windows 图形设置 / 换低画质）。
 *
 * 做法：
 *   - 读 WebGL 渲染器字符串，识别集显 / 独显 / 软件渲染；
 *   - 连续两个 2 秒窗口低于阈值才提示（避开瓦片加载期的误判）；
 *   - 提供「低画质」开关（渲染分辨率 + 瓦片细节），可随时还原；
 *   - 用户点「我知道了」后写入 localStorage，不再打扰。
 *
 * 注意：低画质里**不动 bloom** —— 昼夜模块（DayorNight.js）会在夜间主动开它，两边会打架，
 * 而且实测关掉 bloom 的收益本来就在噪声里。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { cesiumStore } from '@/stores/counter';

/** 采样窗口长度（毫秒） */
const SAMPLE_WINDOW_MS = 2000;
/** 低于该帧率视为卡顿 */
const SLOW_FPS = 24;
/** 判断延迟之后，连续多少个采样窗口都低才算卡顿 */
const SLOW_STREAK = 2;
/** 挂载后先照常显示实时帧率，但推迟这么久才"下结论"（避开瓦片加载期的假卡） */
const JUDGE_DELAY_MS = 8000;
/** 低画质：渲染分辨率倍率 */
const LOW_RESOLUTION_SCALE = 0.75;
/** 低画质：瓦片最大屏幕空间误差（越大越省，16 是 Cesium 默认） */
const LOW_TILESET_SSE = 32;

const LOW_QUALITY_KEY = 'dsh-low-quality';

const dataStore = cesiumStore();

/** 每次启动固定弹出；「我知道了」只在本次会话内收起 */
const hintVisible = ref(true);
const renderer = ref('');
const fps = ref(0);
const fpsAfter = ref(null);
const lowQuality = ref(false);
const busy = ref(false);
/** 是否已过判断延迟（过了才开始按帧率给结论） */
const judging = ref(false);
/** 连续偏低窗口计数 */
const slowStreak = ref(0);

let rafId = null;
let frames = 0;
let windowStart = 0;
let dismissed = false;
let judgeTimer = null;
let lowQualityTimer = null;

/* ---------------- GPU 识别 ---------------- */

const detectRenderer = () => {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || '');
  } catch {
    return '';
  }
};

/** 软件渲染 / 集成显卡 / 独立显卡 —— 只用来组织文案，判断"卡不卡"仍以实测帧率为准 */
const gpuKind = computed(() => {
  const s = renderer.value;
  if (!s) return 'unknown';
  if (/swiftshader|llvmpipe|software|basic render/i.test(s)) return 'software';
  if (/intel|iris|uhd graphics|hd graphics|radeon\(tm\) graphics|vega \d+ graphics|apple m\d/i.test(s))
    return 'integrated';
  if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|arc\(tm\)/i.test(s)) return 'discrete';
  return 'unknown';
});

/** 渲染器短名：只留 ANGLE 括号里的厂商 + 型号核心部分 */
const rendererLabel = computed(() => {
  const s = renderer.value;
  if (!s) return '未知';
  const m = s.match(/ANGLE \(([^)]+)\)/i);
  const core = m ? m[1] : s;
  return core.replace(/\s*\(0x[0-9a-f]+.*$/i, '').slice(0, 48);
});

const gpuAdvice = computed(() => {
  if (gpuKind.value === 'software')
    return '当前是软件渲染（没有可用的硬件加速），请检查浏览器「使用硬件加速」开关与显卡驱动。';
  if (gpuKind.value === 'integrated')
    return '当前用的是集成显卡。建议：Windows「设置 → 系统 → 屏幕 → 显示卡」→ 添加本浏览器 → 选择「高性能」。';
  if (!isSlow.value)
    return '当前已在用独立显卡，渲染正常。若后续出现卡顿，可随时点右侧按钮切换低画质。';
  return '建议：Windows「设置 → 系统 → 屏幕 → 显示卡」→ 添加本浏览器 → 选择「高性能」；或直接启用下面的低画质。';
});

/** 判断延迟过后、且连续两个窗口都低，才算"卡"（避免加载期或偶发抖动误报） */
const isSlow = computed(() => slowStreak.value >= SLOW_STREAK);

/** 帧率偏低但还没确认（正在第二个窗口复核） */
const isPendingSlow = computed(
  () => !isSlow.value && judging.value && fps.value > 0 && fps.value < SLOW_FPS,
);

/** 卡片标题随实测结果变化，避免 60FPS 时还写着"检测到卡顿" */
const titleText = computed(() => {
  if (!judging.value || fps.value === 0) return '渲染环境检查';
  if (isSlow.value) return '检测到画面卡顿';
  if (isPendingSlow.value) return '帧率偏低，复核中…';
  return '渲染环境正常';
});

/** 帧率行：还没测出来时显示"测量中" */
const fpsText = computed(() => (fps.value > 0 ? `${fps.value} FPS` : '测量中…'));

/* ---------------- 帧率采样 ---------------- */

const stopSampling = () => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
};

const onSample = (value) => {
  fps.value = value;
  // 判断延迟之后才开始统计"连续偏低"，避免把加载期算成卡顿
  if (judging.value && !dismissed) {
    slowStreak.value = value > 0 && value < SLOW_FPS ? slowStreak.value + 1 : 0;
  }
  if (dismissed) stopSampling();
};

const tick = (now) => {
  frames += 1;
  if (windowStart === 0) windowStart = now;
  if (now - windowStart >= SAMPLE_WINDOW_MS) {
    onSample(Math.round((frames * 1000) / (now - windowStart)));
    frames = 0;
    windowStart = now;
  }
  rafId = requestAnimationFrame(tick);
};

const startSampling = () => {
  stopSampling();
  frames = 0;
  windowStart = 0;
  rafId = requestAnimationFrame(tick);
};

/* ---------------- 低画质开关 ---------------- */

/** 记录改动前的值，关闭低画质时原样还回去 */
let saved = null;

const collectTilesets = () => {
  const viewer = dataStore.viewer;
  const list = [];
  if (!viewer) return list;
  const primitives = viewer.scene.primitives;
  for (let i = 0; i < primitives.length; i += 1) {
    const p = primitives.get(i);
    if (p && p.isCesium3DTileset) list.push(p);
  }
  return list;
};

const applyLowQuality = () => {
  const viewer = dataStore.viewer;
  if (!viewer) return false;
  const tilesets = collectTilesets();
  saved = {
    resolutionScale: viewer.resolutionScale,
    tilesets: tilesets.map((t) => ({
      target: t,
      sse: t.maximumScreenSpaceError,
      memory: t.maximumMemoryUsage,
    })),
  };
  viewer.resolutionScale = LOW_RESOLUTION_SCALE;
  saved.tilesets.forEach(({ target }) => {
    target.maximumScreenSpaceError = LOW_TILESET_SSE;
    target.maximumMemoryUsage = 512;
  });
  return true;
};

const restoreQuality = () => {
  const viewer = dataStore.viewer;
  if (!viewer || !saved) return;
  viewer.resolutionScale = saved.resolutionScale;
  saved.tilesets.forEach(({ target, sse, memory }) => {
    target.maximumScreenSpaceError = sse;
    target.maximumMemoryUsage = memory;
  });
  saved = null;
};

const toggleLowQuality = () => {
  if (busy.value) return;
  busy.value = true;
  if (lowQuality.value) {
    restoreQuality();
    lowQuality.value = false;
    fpsAfter.value = null;
    localStorage.setItem(LOW_QUALITY_KEY, '0');
  } else if (applyLowQuality()) {
    lowQuality.value = true;
    localStorage.setItem(LOW_QUALITY_KEY, '1');
    // 重新采样，几秒后把"开启后帧率"填进卡片，给个真实反馈
    startSampling();
    if (lowQualityTimer) clearTimeout(lowQualityTimer);
    lowQualityTimer = setTimeout(() => {
      fpsAfter.value = fps.value;
    }, 4000);
  }
  busy.value = false;
};

/** 只在本次会话收起：下次启动仍然弹出（用户要求"每次启动固定弹出"） */
const dismiss = () => {
  dismissed = true;
  hintVisible.value = false;
  stopSampling();
};

/* ---------------- 生命周期 ---------------- */

onMounted(() => {
  renderer.value = detectRenderer();

  // 每次启动固定弹出：hintVisible 初值就是 true，这里不再读任何"已忽略"标记
  hintVisible.value = true;
  // 帧率从挂载就开始采样（期间卡片显示"测量中"以及实时数字）
  startSampling();

  // 上次选过低画质的，静默恢复（等 viewer 建好）
  const wantLowQuality = localStorage.getItem(LOW_QUALITY_KEY) === '1';

  // 推迟"下结论"：加载期的低帧率不算卡
  judgeTimer = setTimeout(() => {
    judging.value = true;
    slowStreak.value = 0;
    if (wantLowQuality && !lowQuality.value && applyLowQuality()) {
      lowQuality.value = true;
    }
  }, JUDGE_DELAY_MS);
});

onBeforeUnmount(() => {
  stopSampling();
  if (judgeTimer) clearTimeout(judgeTimer);
  if (lowQualityTimer) clearTimeout(lowQualityTimer);
  // 组件卸载时把画质还原，避免把改动留在场景里
  if (lowQuality.value) restoreQuality();
});
</script>

<template>
  <Teleport to="body">
    <!-- 显式绑定过渡时长：默认时长要靠浏览器反馈，在"卡到只有 1 FPS"的机器上
         移除会拖到好几秒；给了 duration 之后走定时器，慢机器上也能干脆收起 -->
    <Transition name="perf-guard" :duration="{ enter: 280, leave: 160 }">
      <div
        v-if="hintVisible"
        class="perf-guard"
        :class="{ 'is-slow': isSlow }"
        role="alert"
      >
        <div class="pg-head">
          <i class="pg-mark"></i>{{ titleText }}
        </div>

        <p class="pg-row">
          渲染器：<b>{{ rendererLabel }}</b>
        </p>
        <p class="pg-row">
          实测帧率：<b>{{ fpsText }}</b>
          <template v-if="fpsAfter !== null">
            <span class="pg-arrow">→ 开启低画质后</span>
            <b class="is-good">{{ fpsAfter }} FPS</b>
          </template>
        </p>
        <p class="pg-tip">{{ gpuAdvice }}</p>

        <div class="pg-actions">
          <button
            type="button"
            class="pg-btn is-primary"
            :disabled="busy"
            @click="toggleLowQuality"
          >
            {{ lowQuality ? '关闭低画质' : '启用低画质' }}
          </button>
          <button type="button" class="pg-btn" @click="dismiss">我知道了</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.perf-guard {
  position: fixed;
  left: 50%;
  top: 16%;
  transform: translateX(-50%);
  z-index: 9600;
  width: min(560px, 88vw);
  padding: 14px 18px 12px;
  font-family: 'Rajdhani', 'Noto Sans SC', sans-serif;
  color: #e2f1ff;
  background: linear-gradient(
    180deg,
    rgba(9, 26, 50, 0.96),
    rgba(5, 11, 20, 0.97)
  );
  border: 1px solid rgba(226, 186, 100, 0.55);
  border-left: 3px solid #e2ba64;
  box-shadow:
    0 14px 36px rgba(0, 0, 0, 0.65),
    inset 0 0 20px rgba(11, 30, 56, 0.6);
  clip-path: polygon(
    14px 0,
    100% 0,
    100% calc(100% - 14px),
    calc(100% - 14px) 100%,
    0 100%,
    0 14px
  );
  pointer-events: auto;
}

/* 卡顿态换警示色；正常态保持金色科技风（同一张卡，两种语义） */
.perf-guard.is-slow {
  border-color: rgba(255, 138, 76, 0.55);
  border-left-color: #ff8a4c;
}

.perf-guard.is-slow .pg-head {
  color: #ffb27a;
  border-bottom-color: rgba(255, 138, 76, 0.35);
}

.perf-guard.is-slow .pg-mark {
  background: #ff8a4c;
  box-shadow: 0 0 8px rgba(255, 138, 76, 0.9);
}

.perf-guard.is-slow .pg-tip {
  background: rgba(255, 138, 76, 0.08);
  border-left-color: rgba(255, 138, 76, 0.6);
}

.pg-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 7px;
  border-bottom: 1px solid rgba(226, 186, 100, 0.3);
  font-size: 14px;
  letter-spacing: 0.16em;
  color: #fce38a;
}

.pg-mark {
  width: 7px;
  height: 7px;
  background: #e2ba64;
  transform: rotate(45deg);
  box-shadow: 0 0 8px rgba(252, 227, 138, 0.9);
}

.pg-row {
  margin: 0 0 4px;
  font-size: 12.5px;
  letter-spacing: 0.06em;
  color: #b9cbe0;
}

.pg-row b {
  color: #fce38a;
  font-weight: 600;
}

.pg-row b.is-good {
  color: #11efe3;
}

.pg-arrow {
  margin: 0 4px;
  color: #88a2be;
}

.pg-tip {
  margin: 8px 0 10px;
  padding: 7px 10px;
  font-size: 12.5px;
  line-height: 1.55;
  letter-spacing: 0.04em;
  color: #cfe3f5;
  background: rgba(17, 239, 227, 0.07);
  border-left: 2px solid rgba(17, 239, 227, 0.55);
}

.pg-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.pg-btn {
  padding: 5px 16px;
  font-family: inherit;
  font-size: 12.5px;
  letter-spacing: 0.1em;
  color: #b9cbe0;
  background: rgba(10, 22, 40, 0.9);
  border: 1px solid rgba(226, 186, 100, 0.5);
  cursor: pointer;
  transition: all 0.2s ease;
}

.pg-btn:hover {
  color: #11efe3;
  border-color: #11efe3;
}

.pg-btn.is-primary {
  color: #03070e;
  background: linear-gradient(180deg, #fce38a, #e2ba64);
  border-color: #ffd778;
  font-weight: 600;
}

.pg-btn.is-primary:hover {
  box-shadow: 0 0 14px rgba(252, 227, 138, 0.55);
}

.pg-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

/* 出入场：注意保留 translateX(-50%) 居中，否则会横向跳位 */
.perf-guard-enter-active {
  transition:
    opacity 0.24s ease,
    transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.perf-guard-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.perf-guard-enter-from,
.perf-guard-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-12px);
}
</style>
