<script setup>
import { computed, ref, watch } from 'vue';
import { useRoutePlan } from './useRoutePlan';

/**
 * 「路径规划」面板：起终点输入（datalist 联想）+ 方案概况 + 逐段乘车信息。
 *
 * 只做呈现，所有请求与三维绘制都在 useRoutePlan.js / renderRoute.js 里。
 * 由 QueryModePanel.vue 用 v-if 控制挂载 —— 挂上即进入规划模式，
 * 卸下即退出并还原全局线路（见 useRoutePlan 的 onMounted / onBeforeUnmount）。
 */

const { origin, destination, options, stationNames, loading, error, result, ready, search, swap } =
  useRoutePlan();

/** 输入了但不在 18 条线里（手输时的常见情况），只提示不拦截 */
const unknownName = computed(
  () =>
    [origin.value, destination.value].find(
      (name) => name && !stationNames.value.has(name),
    ) ?? '',
);

/** 秒 → 分钟（接口的 duration 是秒，含候车与步行，不是纯乘车时间） */
const minutes = (seconds) => Math.max(1, Math.round(Number(seconds || 0) / 60));

const km = (meters) => (Number(meters || 0) / 1000).toFixed(1);

/**
 * 展开状态：键是行程里的下标，值是「是否展开」。
 * 用普通对象而不是 Set：Vue 3 对 Set 的增删也能响应，但对象写起来不用每次新建，
 * 而且模板里读 `expanded[index]` 比 `has()` 更直观。
 */
const expanded = ref({});

const isOpen = (index) => expanded.value[index] === true;

const toggle = (index) => {
  expanded.value[index] = !expanded.value[index];
};

/** 换一次方案，旧的展开下标就失效了，直接清空 */
watch(result, () => {
  expanded.value = {};
});
</script>

<template>
  <section class="rd-panel">
    <header class="rd-head">
      <span class="rd-title">路径规划</span>
      <span class="rd-tag">{{ options.length }} 站</span>
    </header>

    <div class="rd-body">
      <label class="rd-field">
        <span class="rd-label">起点</span>
        <input
          v-model.trim="origin"
          class="rd-input"
          list="rd-stations"
          placeholder="输入站名，如 莘庄"
          autocomplete="off"
        />
      </label>

      <label class="rd-field">
        <span class="rd-label">终点</span>
        <input
          v-model.trim="destination"
          class="rd-input"
          list="rd-stations"
          placeholder="输入站名，如 五角场"
          autocomplete="off"
        />
      </label>

      <!-- 400 个站名做原生下拉体验很差，改用 datalist 联想：边输边筛，回车即选 -->
      <datalist id="rd-stations">
        <option v-for="item in options" :key="`d-${item.name}`" :value="item.name" />
      </datalist>

      <div class="rd-actions">
        <button
          type="button"
          class="rd-btn"
          :disabled="!ready || loading"
          @click="search"
        >
          {{ loading ? '规划中…' : '开始规划' }}
        </button>
        <button
          type="button"
          class="rd-btn is-ghost"
          :disabled="!origin && !destination"
          @click="swap"
        >
          交换
        </button>
      </div>

      <p v-if="error" class="rd-status is-error">{{ error }}</p>
      <p v-else-if="origin && origin === destination" class="rd-status is-error">
        起点与终点相同
      </p>
      <p v-else-if="unknownName" class="rd-status is-error">
        「{{ unknownName }}」不在 18 条线路的站点里
      </p>
      <p v-else-if="!result" class="rd-status">输入起终点后开始规划</p>

      <template v-else>
        <div class="rd-summary">
          <span>{{ result.cost }} 元</span>
          <span>{{ minutes(result.duration) }} 分钟</span>
          <span>{{ km(result.distance) }} km</span>
          <span>换乘 {{ result.transfers.length }} 次</span>
        </div>

        <!-- 线路概览：一眼看清「坐哪几条线、按什么顺序换」，颜色与三维高亮、线段列表同源 -->
        <div v-if="result.segments.length" class="rd-chain">
          <span class="rd-chain-label">线路概览</span>
          <span class="rd-chain-list">
            <template v-for="(segment, index) in result.segments" :key="segment.lineName || index">
              <span class="rd-chain-item">
                <i class="rd-dot" :style="{ '--c': segment.color }"></i>
                地铁{{ segment.short }}
              </span>
              <span
                v-if="index < result.segments.length - 1"
                class="rd-chain-arrow"
              >
                →
              </span>
            </template>
          </span>
        </div>

        <p v-if="result.walking" class="rd-walk">
          换乘步行合计 {{ Math.round(result.walking) }} m
        </p>

        <ol class="rd-steps">
          <li v-for="(leg, index) in result.legs" :key="index" class="rd-row">
            <!-- 地铁段：展开看途经站 -->
            <template v-if="leg.type === 'metro'">
              <button type="button" class="rd-row-head" @click="toggle(index)">
                <i class="rd-chip" :style="{ '--c': leg.segment.color }"></i>
                <span class="rd-step-main">
                  <span class="rd-step-title">
                    {{ leg.segment.short }} · {{ leg.segment.from }} →
                    {{ leg.segment.to }}
                  </span>
                  <span class="rd-step-meta">
                    <span v-if="leg.segment.stopCount">
                      {{ leg.segment.stopCount }} 站 ·
                    </span>
                    {{ minutes(leg.segment.duration) }} 分钟 ·
                    {{ km(leg.segment.distance) }} km
                    <span v-if="!leg.segment.geometry" class="rd-warn">
                      （未在三维中绘制）
                    </span>
                  </span>
                </span>
                <i class="rd-caret" :class="{ open: isOpen(index) }"></i>
              </button>

              <div v-if="isOpen(index)" class="rd-detail">
                <p class="rd-detail-label">
                  途经 {{ leg.segment.viaStops.length }} 站
                </p>
                <p class="rd-via">
                  {{ [leg.segment.from, ...leg.segment.viaStops, leg.segment.to].join(' → ') }}
                </p>
              </div>
            </template>

            <!-- 换乘：站内步行的指引也在这里展开 -->
            <template v-else-if="leg.type === 'transfer'">
              <button
                type="button"
                class="rd-row-head"
                :disabled="!leg.steps.length"
                @click="toggle(index)"
              >
                <i class="rd-chip is-transfer"></i>
                <span class="rd-step-main">
                  <span class="rd-step-title">换乘 {{ leg.station }}</span>
                  <span class="rd-step-meta">
                    {{
                      leg.distance
                        ? `站内步行 ${Math.round(leg.distance)} m`
                        : '站内换乘，无需出站'
                    }}
                  </span>
                </span>
                <i
                  v-if="leg.steps.length"
                  class="rd-caret"
                  :class="{ open: isOpen(index) }"
                ></i>
              </button>

              <div v-if="isOpen(index)" class="rd-detail">
                <!-- 只用接口的 instruction：它本身已经带了「步行360米」这类距离，
                     再补一个 step.distance 会和行首的合计（walking.distance）打架 -->
                <ul class="rd-walk-steps">
                  <li v-for="(step, i) in leg.steps" :key="i">
                    {{ step.instruction }}
                  </li>
                </ul>
              </div>
            </template>
          </li>
        </ol>
      </template>
    </div>
  </section>
</template>

<style scoped>
/* 贴着「查询模式选择」那一列的右边：24(左) + 186(宽) + 12(间隙) */
.rd-panel {
  position: absolute;
  left: 222px;
  top: 112px;
  z-index: 60;
  width: 322px;
  max-height: 640px;
  display: flex;
  flex-direction: column;
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

.rd-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid rgba(226, 186, 100, 0.35);
  background: rgba(226, 186, 100, 0.07);
}

.rd-title {
  font-family: var(--font-scifi);
  font-size: 15px;
  letter-spacing: 0.16em;
  color: var(--color-gold-glow);
  white-space: nowrap;
}

.rd-tag {
  font-size: 12px;
  color: var(--color-text-muted);
}

.rd-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

.rd-body::-webkit-scrollbar {
  width: 5px;
}

.rd-body::-webkit-scrollbar-thumb {
  background: rgba(226, 186, 100, 0.45);
}

.rd-field {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.rd-label {
  flex: none;
  width: 28px;
  font-size: 13px;
  color: var(--color-text-muted);
}

.rd-input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  background: rgba(10, 22, 40, 0.9);
  border: 1px solid rgba(226, 186, 100, 0.4);
  color: var(--color-text-main);
  font-family: inherit;
  font-size: 13px;
}

.rd-input::placeholder {
  color: rgba(136, 162, 190, 0.7);
}

.rd-input:focus {
  outline: none;
  border-color: var(--color-cyan-glow);
}

.rd-actions {
  display: flex;
  gap: 6px;
  margin: 8px 0;
}

.rd-btn {
  flex: 1;
  padding: 5px 8px;
  background: rgba(226, 186, 100, 0.16);
  border: 1px solid var(--color-gold);
  color: var(--color-gold-glow);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.rd-btn:hover:not(:disabled) {
  background: rgba(17, 239, 227, 0.12);
  border-color: var(--color-cyan-glow);
  color: var(--color-cyan-glow);
}

.rd-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.rd-btn.is-ghost {
  flex: none;
  background: transparent;
  border-color: rgba(226, 186, 100, 0.4);
  color: var(--color-text-muted);
}

.rd-status {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.rd-status.is-error {
  color: #ff8a8a;
}

.rd-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin: 2px 0 6px;
  padding: 6px 8px;
  background: rgba(17, 239, 227, 0.08);
  border-left: 2px solid var(--color-cyan-glow);
  font-family: var(--font-scifi);
  font-size: 14px;
  color: var(--color-cyan-glow);
}

/* ---- 线路概览：地铁1号线 → 地铁3号线 → 地铁7号线 ---- */
.rd-chain {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 6px;
  margin: 0 0 6px;
  padding: 5px 8px;
  background: rgba(10, 22, 40, 0.72);
  border-left: 2px solid rgba(226, 186, 100, 0.55);
}

.rd-chain-label {
  flex: none;
  font-size: 12px;
  color: var(--color-text-muted);
}

.rd-chain-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.rd-chain-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--color-text-main);
  white-space: nowrap;
}

/* 小色点：与线段列表的色条、三维高亮线同色 */
.rd-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c, #e2ba64);
  box-shadow: 0 0 6px var(--c, #e2ba64);
}

.rd-chain-arrow {
  flex: none;
  font-size: 12px;
  color: var(--color-gold);
  letter-spacing: 1px;
}

.rd-walk {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.rd-steps {
  margin: 0;
  padding: 0;
  list-style: none;
}

.rd-row {
  padding: 2px 0;
}

/* 一行 = 可点击的头部（色条 + 文案 + 箭头）+ 可选的展开区 */
.rd-row-head {
  display: flex;
  align-items: stretch;
  gap: 6px;
  width: 100%;
  padding: 3px 0;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.rd-row-head:disabled {
  cursor: default;
}

.rd-row-head:not(:disabled):hover .rd-step-title {
  color: var(--color-cyan-glow);
}

.rd-chip {
  flex: none;
  width: 4px;
  min-height: 24px;
  background: var(--c, #e2ba64);
  box-shadow: 0 0 6px var(--c, #e2ba64);
}

/* 换乘点用洋红斜块，与三维里换乘站标记同色 */
.rd-chip.is-transfer {
  background: repeating-linear-gradient(
    45deg,
    #ff2bd1 0 2px,
    transparent 2px 4px
  );
  box-shadow: none;
}

.rd-step-main {
  flex: 1;
  min-width: 0;
}

.rd-step-title {
  display: block;
  font-size: 13px;
  line-height: 1.4;
  color: var(--color-text-main);
}

.rd-step-meta {
  display: block;
  font-size: 12px;
  color: var(--color-text-muted);
}

.rd-warn {
  color: #ff8a8a;
}

/* 展开箭头：默认朝右，展开后翻 180° */
.rd-caret {
  flex: none;
  width: 0;
  height: 0;
  margin: 7px 2px 0 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid rgba(226, 186, 100, 0.75);
  transition: transform 0.18s ease;
}

.rd-caret.open {
  transform: rotate(180deg);
  border-top-color: var(--color-cyan-glow);
}

.rd-detail {
  margin: 0 0 4px 10px;
  padding: 4px 8px;
  background: rgba(10, 22, 40, 0.7);
  border-left: 1px solid rgba(226, 186, 100, 0.35);
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-muted);
}

.rd-detail-label {
  margin: 0 0 2px;
  color: var(--color-gold);
}

.rd-via {
  margin: 0;
  word-break: break-all;
}

.rd-walk-steps {
  margin: 0;
  padding-left: 14px;
}

.rd-walk-steps li {
  margin: 1px 0;
}
</style>
