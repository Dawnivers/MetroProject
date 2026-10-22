<!--
  站点查询气泡框（queryTemplate）
  ================================================================
  点「站点管理」里的站名标签（MarkerTemplate）后弹出的站点详情卡。

  它与简单气泡框是【同一套托管机制】，只是长得不一样：
    · 由 popup/popup.js 的 SimpleLabel.addLabel() 动态 import + createVNode 挂载；
    · 根元素被 SimpleLabel.postRender 逐帧写 style.left / style.bottom / style.transform；
    · 关闭走 closePopup 这个 prop（popup.js 传进来的是 () => this.removeMarker()）。

  因此这里必须遵守和 MarkerTemplate 相同的三条约定：
    1. 根元素 position:absolute + left:0/bottom:0 —— 定位完全交给外部；
    2. 根元素不要自己写 transform —— 会被 postRender 的 scale() 内联样式覆盖
       （所以所有动效都放在子元素上，根元素保持「干净」）；
    3. 组件挂在 viewer.cesiumWidget.container 下（不是 .hud-canvas），
       所以这里的 px 是普通 CSS px，不参与 HUD 设计画布的缩放。

  尺寸：620 × 约 286（原来 380 × 约 160）。卡片会被相机距离缩放，
  默认俯瞰视角下 scale ≈ 0.87，所以实际渲染约 537 × 249。
  宽度取 620 是为了让「所属线路」在两条线时能并排（信息列约 270px）；
  摆位由 popup.js 负责：右边放不下会整体镜像到站点左侧，两边都放不下才贴边。

  字体（实测结论，改前请先看这里）：
    项目真正加载的只有 left1.vue 里 @import 的那三款 —— Chakra Petch(12 张脸) /
    JetBrains Mono(24) / Noto Sans SC(404)；而 --font-scifi 里排第一的 Rajdhani
    **一张脸都没有**（它只写在没被任何组件引用的 baseUI/*.html 里），
    所以全项目一直想要的「科幻字体」其实一直在静默回退成系统字体。
    这里直接用已经加载好的两款，把原设计想要的效果做出来，
    并且只用 500 及以上的字重（Chakra Petch 声明的就是 500/600/700）。

  字段与取值由 popup.js 的 showQueryPopup() 组装后经 fields / values 传入
  （values 与 fields 一一对应）。「所属线路」这一项是特例：
  后端 /getStationInfo 的 address 字段是「去重后用 ; 拼接」的全部线路，
  换乘站天然就是多条，所以这里拆开逐条上色展示。
-->
<template>
  <div class="query-popup">
    <!-- HUD 角括号（右上那枚会和关闭按钮重叠，已去掉）+ 扫描光带，纯装饰、不参与交互 -->
    <i class="qp-corner qp-corner-tl"></i>
    <i class="qp-corner qp-corner-bl"></i>
    <i class="qp-corner qp-corner-br"></i>
    <div class="qp-scan-layer"><div class="qp-scan"></div></div>

    <!-- 标题栏：旋转徽标 + 站名 + 状态灯 + 关闭 -->
    <header class="qp-head">
      <span class="qp-badge"></span>
      <span class="qp-head-name">{{ label }}</span>
      <span class="qp-status"><i class="qp-dot"></i>ONLINE</span>
      <button class="qp-close" type="button" title="关闭" @click="onClose">
        ✕
      </button>
    </header>

    <div class="qp-body">
      <!-- 左：字段列表 -->
      <dl class="qp-info">
        <template v-for="(field, index) in fields" :key="field">
          <dt class="qp-key">{{ field }}</dt>

          <!-- 所属线路：换乘站会带多条，逐条上色 -->
          <dd v-if="isLineField(field)" class="qp-val qp-val-lines">
            <span
              v-for="line in lineChips"
              :key="line.name"
              class="qp-line"
              :style="{ '--c': line.color }"
              >{{ line.short }}</span
            >
            <span v-if="!lineChips.length" class="qp-val-text">—</span>
          </dd>

          <dd v-else class="qp-val qp-val-text">{{ values[index] ?? '—' }}</dd>
        </template>
      </dl>

      <!-- 右：图片区（300 × 210）
           图片来源三级回退：
             1. 外部传入：popup.js 若给了具名插槽 image，就用插槽内容；
             2. 内置：按站名到 assets/stationImg/ 里找同名图片（见下方 stationImage）；
             3. 都没有：显示占位框。
           插槽用法（popup.js 的 addLabel 里）：
             createVNode(Comp, props, { image: () => h('img', { src }) }) -->
      <div class="qp-media">
        <slot name="image">
          <template v-if="stationImage">
            <img
              class="qp-photo"
              :src="stationImage"
              :alt="`${label} 站点照片`"
            />
            <span class="qp-photo-tint"></span>
          </template>
          <div v-else class="qp-media-empty">
            <span class="qp-media-empty-icon"></span>
            <span class="qp-media-empty-title">暂无图片</span>
            <span class="qp-media-empty-hint">{{ label || '—' }}</span>
          </div>
        </slot>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { cesiumStore } from '@/stores/counter';
import { LINE_COLORS, shortLineName } from '@/config/lineAndStationStyle';

/** 命中这个字段名就渲染成线路色块列表，其余字段按纯文本渲染 */
const LINE_FIELD = '所属线路';

const props = defineProps({
  label: {
    type: String,
    default: '',
  },
  color: {
    type: String,
    default: '',
  },
  position: {
    type: Object,
    default: () => ({}),
  },
  attr: {
    type: Object,
    default: () => ({}),
  },
  isChange: {
    type: Number,
    default: 0,
  },
  /** 字段名数组，与 values 一一对应 */
  fields: {
    type: Array,
    default: () => ['名称', '客流量状态', '所属线路', '是否换乘站'],
  },
  /** 字段值数组 */
  values: {
    type: Array,
    default: () => [],
  },
  clickCallback: {
    type: Function,
    default: () => {},
  },
  closePopup: {
    type: Function,
    default: () => {},
  },
});

const dataStore = cesiumStore();

/**
 * 站点照片索引：assets/stationImg/<站名>.jpg
 *
 * 图片由脚本从 Wikimedia Commons 抓取（站名即文件名），同目录 CREDITS.md 是出处与许可。
 * 这里用 eager glob 一次性把所有图片的 URL 收进来 —— 收的只是字符串，
 * 400 条约几十 KB，不会多下载一张图；Vite 会把这些资源登记进产物。
 * 加 ?url 是为了拿到资源 URL 而不是把图片转成 base64 内联。
 *
 * 路径要点：本文件在 src/components/bottom/StationPanel/ 下，要退三级才到 src/，
 * 所以是 ../../../assets/stationImg/。少退一级（写成 ../assets/）glob 会静默匹配到
 * 0 个文件——不报错、也不警告，只表现为「图片明明在，浮窗却还是占位框」，很难查。
 *
 * 新增图片后 Vite 会自动重新求值（实测目录里加 3 个文件，展开条目 392 → 395，
 * 无需改动本文件）。万一哪次没生效，改一下本文件或重启 dev server 即可。
 */
const stationImageModules = import.meta.glob(
  '../../../assets/stationImg/*.{jpg,jpeg,png,webp}',
  { eager: true, query: '?url', import: 'default' },
);

const stationImageMap = new Map(
  Object.entries(stationImageModules).map(([filePath, url]) => [
    // '.../assets/stationImg/人民广场.jpg' -> '人民广场'
    filePath
      .split('/')
      .pop()
      .replace(/\.[^.]+$/, ''),
    url,
  ]),
);

/** 当前站点的照片；没有同名文件就返回 null，模板里退回占位框 */
const stationImage = computed(() => {
  const name = props.attr?.name || props.label;
  return name ? (stationImageMap.get(name) ?? null) : null;
});

/**
 * 线路名 → 颜色。
 * 取色规则与 StationPanel.vue / Toolbar.vue 完全一致（按 Lines 的下标取色板），
 * 这样气泡框里的色块、左侧线路列表、三维里的光锥才是同一个颜色。
 * 同时按「全名」和「简称」两个键存，兼容后端 address 给的是哪一种写法。
 */
const lineColorMap = computed(() => {
  const map = new Map();
  (dataStore.Lines || []).forEach((item, index) => {
    const color = LINE_COLORS[index % LINE_COLORS.length];
    map.set(item.name, color);
    map.set(shortLineName(item.name), color);
  });
  return map;
});

const colorForLine = (name) => {
  return (
    lineColorMap.value.get(name) ??
    lineColorMap.value.get(shortLineName(name)) ??
    'var(--color-gold)'
  );
};

const isLineField = (field) => field === LINE_FIELD;

/** 「上海地铁14号线」→ 14，用于按线路号升序排列（与左侧面板 1,2,3… 的顺序一致） */
const lineNumberOf = (name) => {
  const matched = String(name ?? '').match(/\d+/);
  return matched ? Number(matched[0]) : Infinity;
};

/** 所属线路的全部线路（换乘站是多条，后端用 ; 拼接） */
const lineChips = computed(() => {
  const index = props.fields.indexOf(LINE_FIELD);
  if (index < 0) return [];

  return (
    String(props.values[index] ?? '')
      .split(';')
      .map((name) => name.trim())
      .filter(Boolean)
      // 后端按站点行顺序返回，不是按线路号，这里排一下才好读
      .sort((a, b) => lineNumberOf(a) - lineNumberOf(b))
      .map((name) => ({
        name,
        short: shortLineName(name),
        color: colorForLine(name),
      }))
  );
});

const onClose = () => {
  props.closePopup && props.closePopup();
};
</script>

<style scoped>
/* 设计令牌与 StationPanel.vue 同源；组件在 Cesium 容器下，
   不继承 .hud-canvas 上的变量，所以在这儿重新声明一份 */
.query-popup {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 620px;
  color: var(--color-text-main);

  /* 地图在卡片下方依然可以拖拽：整卡不接管鼠标事件，
     只有关闭按钮单独打开 pointer-events。插槽内容若需要交互，
     在自己的样式里补一行 pointer-events: auto 即可。 */
  pointer-events: none;
  user-select: none;

  --color-gold: #e2ba64;
  --color-gold-glow: #fce38a;
  --color-cyan: #11efe3;
  --color-text-main: #e2f1ff;
  --color-text-muted: #88a2be;
  --font-sans: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
  /* 展示字体：数字/拉丁走 Chakra Petch，中文自动落到 Noto Sans SC。
     只用 500 及以上字重（Chakra Petch 声明的是 500/600/700）。 */
  --font-display: 'Chakra Petch', 'Noto Sans SC', sans-serif;
  /* 状态/数据读数用等宽 */
  --font-mono:
    'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  font-family: var(--font-sans);

  /* 三层背景：左上青光晕 + 右下金光晕 + 深蓝底 */
  background:
    radial-gradient(
      120% 90% at 0% 0%,
      rgba(17, 239, 227, 0.12),
      transparent 58%
    ),
    radial-gradient(
      90% 80% at 100% 100%,
      rgba(226, 186, 100, 0.09),
      transparent 55%
    ),
    linear-gradient(180deg, rgba(7, 22, 42, 0.96), rgba(3, 8, 16, 0.98));

  border: 1px solid rgba(17, 239, 227, 0.45);
  box-shadow:
    0 18px 48px rgba(0, 0, 0, 0.75),
    0 0 0 1px rgba(17, 239, 227, 0.1),
    inset 0 0 28px rgba(17, 239, 227, 0.1);
  clip-path: polygon(
    18px 0,
    100% 0,
    100% calc(100% - 18px),
    calc(100% - 18px) 100%,
    0 100%,
    0 18px
  );
}

/* ---- HUD 四角括号 ---- */
.qp-corner {
  position: absolute;
  z-index: 3;
  width: 16px;
  height: 16px;
  border: 2px solid var(--color-cyan);
  box-shadow: 0 0 6px rgba(17, 239, 227, 0.7);
  pointer-events: none;
}

.qp-corner-tl {
  top: 7px;
  left: 7px;
  border-right: 0;
  border-bottom: 0;
}

/* 右上角那枚不画：关闭按钮就在那个位置，两者实测重叠 7.8 × 6.4 px，
   而且角括号 z-index 更高，青色会盖在橙色按钮上，很难看。
   要恢复它的话，得先把关闭按钮往左挪开至少 8px。 */

.qp-corner-bl {
  bottom: 7px;
  left: 7px;
  border-right: 0;
  border-top: 0;
}

.qp-corner-br {
  bottom: 7px;
  right: 7px;
  border-left: 0;
  border-top: 0;
}

/* ---- 扫描光带：只动 transform，交给合成层，不触发布局 ---- */
.qp-scan-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.qp-scan {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 90px;
  background: linear-gradient(
    180deg,
    transparent,
    rgba(17, 239, 227, 0.13),
    transparent
  );
  animation: qp-scan 4.6s linear infinite;
}

@keyframes qp-scan {
  0% {
    transform: translateY(-100%);
  }
  100% {
    transform: translateY(360px);
  }
}

/* ---- 标题栏 ---- */
.qp-head {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 14px 9px 18px;
  border-bottom: 1px solid rgba(17, 239, 227, 0.28);
  background: linear-gradient(
    90deg,
    rgba(17, 239, 227, 0.16),
    rgba(17, 239, 227, 0.02) 55%,
    transparent
  );
}

/* 旋转菱形徽标 */
.qp-badge {
  flex: none;
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--color-cyan);
  box-shadow:
    0 0 8px rgba(17, 239, 227, 0.9),
    inset 0 0 6px rgba(17, 239, 227, 0.6);
  transform: rotate(45deg);
  animation: qp-spin 6s linear infinite;
}

@keyframes qp-spin {
  to {
    transform: rotate(405deg);
  }
}

.qp-head-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #ffffff;
  text-shadow:
    0 0 10px rgba(17, 239, 227, 0.75),
    0 0 26px rgba(17, 239, 227, 0.35);
}

.qp-status {
  margin-left: auto;
  flex: none;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid rgba(17, 239, 227, 0.4);
  background: rgba(17, 239, 227, 0.08);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  color: var(--color-cyan);
}

.qp-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-cyan);
  box-shadow: 0 0 8px var(--color-cyan);
  animation: qp-pulse 1.6s ease-in-out infinite;
}

@keyframes qp-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.22;
  }
}

.qp-close {
  margin-left: 10px;
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 176, 32, 0.12);
  border: 1px solid #ffb020;
  color: #ffb020;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.18s ease;
  clip-path: polygon(
    0 0,
    100% 0,
    100% calc(100% - 7px),
    calc(100% - 7px) 100%,
    0 100%
  );
  /* 全卡只有它接管鼠标事件 */
  pointer-events: auto;
}

.qp-close:hover {
  color: #04121c;
  background: #ffb020;
  box-shadow: 0 0 14px rgba(255, 176, 32, 0.9);
}

/* ---- 主体：左字段 / 右图片 ---- */
.qp-body {
  position: relative;
  z-index: 2;
  display: flex;
  gap: 16px;
  padding: 14px 16px 16px 18px;
}

.qp-info {
  flex: 1;
  min-width: 0;
  margin: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  /* 信息列的高度由右侧图片区撑开（210px），字段只有 4 行，
     用 space-between 在竖直方向铺开，左下角才不留一大块空白 */
  align-content: space-between;
  gap: 10px 10px;
  font-size: 14px;
}

/* 字段名前的菱形小点 */
.qp-key {
  position: relative;
  padding-left: 12px;
  color: var(--color-text-muted);
  letter-spacing: 0.1em;
  white-space: nowrap;
}

.qp-key::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 4px;
  height: 4px;
  margin-top: -2px;
  background: var(--color-cyan);
  box-shadow: 0 0 6px var(--color-cyan);
  transform: rotate(45deg);
}

.qp-val {
  margin: 0;
  min-width: 0;
}

.qp-val-text {
  color: #ffffff;
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 500;
  letter-spacing: 0.05em;
  word-break: break-all;
}

.qp-val-lines {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 线路色块：颜色由内联的 --c 提供，取值与左侧面板同源 */
.qp-line {
  flex: none;
  padding: 1px 9px;
  border: 1px solid var(--c, var(--color-gold));
  color: var(--c, var(--color-gold));
  background: rgba(255, 255, 255, 0.05);
  box-shadow:
    0 0 9px -2px var(--c, var(--color-gold)),
    inset 0 0 9px -4px var(--c, var(--color-gold));
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

/* ---- 图片插槽 ---- */
.qp-media {
  position: relative;
  flex: none;
  width: 300px;
  height: 210px;
  display: flex;
  overflow: hidden;
  border: 1px solid rgba(17, 239, 227, 0.35);
  background:
    repeating-linear-gradient(
      0deg,
      rgba(17, 239, 227, 0.055) 0 1px,
      transparent 1px 22px
    ),
    repeating-linear-gradient(
      90deg,
      rgba(17, 239, 227, 0.055) 0 1px,
      transparent 1px 22px
    ),
    rgba(2, 8, 16, 0.9);
  box-shadow: inset 0 0 26px rgba(17, 239, 227, 0.12);
}

/* 图片框内的两个角标 */
.qp-media::before,
.qp-media::after {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  border: 2px solid rgba(17, 239, 227, 0.6);
  pointer-events: none;
}

.qp-media::before {
  top: 5px;
  left: 5px;
  border-right: 0;
  border-bottom: 0;
}

.qp-media::after {
  bottom: 5px;
  right: 5px;
  border-left: 0;
  border-top: 0;
}

/* 站点照片：铺满整个图片区。
   .qp-media 的两个角标和下面的色调层都是 position:absolute，
   按绘制顺序会盖在图片之上，所以照片自带 HUD 质感。 */
.qp-photo {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

/* 色调覆盖层：顶部青色微光 + 底部压暗，让照片和卡片风格统一 */
.qp-photo-tint {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(
      180deg,
      rgba(17, 239, 227, 0.14),
      transparent 32%,
      rgba(2, 8, 16, 0.62)
    ),
    radial-gradient(120% 110% at 50% 0%, transparent 45%, rgba(2, 8, 16, 0.5));
}

.qp-media-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  text-align: center;
  color: var(--color-text-muted);
}

/* 纯 CSS 画的「图片」图标：外框 + 小山 */
.qp-media-empty-icon {
  position: relative;
  width: 38px;
  height: 28px;
  border: 1.5px solid rgba(17, 239, 227, 0.55);
}

.qp-media-empty-icon::before {
  content: '';
  position: absolute;
  left: 5px;
  bottom: 3px;
  width: 20px;
  height: 12px;
  background: rgba(17, 239, 227, 0.45);
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
}

.qp-media-empty-title {
  font-size: 14px;
  letter-spacing: 0.3em;
  color: rgba(226, 241, 255, 0.55);
}

.qp-media-empty-hint {
  padding: 2px 9px;
  border: 1px dashed rgba(17, 239, 227, 0.32);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.16em;
  color: rgba(17, 239, 227, 0.6);
}
</style>
