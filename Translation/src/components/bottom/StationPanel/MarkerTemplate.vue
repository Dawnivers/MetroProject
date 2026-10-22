<!--标绘简单的文本-->
<template>
  <div
    class="LabelPlot-container"
    :style="{ backgroundColor: resColor }"
    @click="onClick"
    :class="{ 'is-selected': isSelected }"
  >
    <!-- 站控措施：一排小方框贴在气泡上方。数据来自 measureStore（站控措施模式灌入），
         气泡本身就是站点的显隐载体，所以站点一隐藏，方框跟着消失，不需要额外联动 -->
    <div v-if="measureTiles.length" class="measure-tiles">
      <span
        v-for="tile in measureTiles"
        :key="tile.code"
        class="measure-tile"
        :style="{ '--c': tile.color }"
        :title="tile.title"
      >
        <MeasureIcon :code="tile.code" />
      </span>
    </div>
    <!-- 徽标：起终点传「起 / 终」，普通换乘站回落到「换」，都没有就不显示 -->
    <span v-if="badgeText" class="transfer-badge" :style="badgeStyle">
      {{ badgeText }}
    </span>
    <span class="info-item">{{ label }}</span>
  </div>
</template>
<script setup>
import { ref, computed } from 'vue';
import MeasureIcon from './QueryModePanel/stationcontrol/MeasureIcon.vue';
import { measureState, metaOf } from './QueryModePanel/stationcontrol/measureStore';

const props = defineProps({
  label: {
    type: String,
    default: '',
  },
  color: {
    type: String,
    default: '',
  },
  isChange: {
    type: Number,
    default: 0,
  },
  position: {
    type: Object,
    default: {},
  },
  attr: {
    type: Object,
    default: {},
  },
  clickCallback: {
    type: Function,
    default: () => {},
  },
  /**
   * 徽标文字覆盖。路径规划用它把起终点标成「起 / 终」——
   * 不填就沿用原来的「换」（换乘站）。
   * 注意这是**纯呈现**：详情卡里的「是否换乘站」仍读 attr.isChange，不受影响。
   */
  badge: {
    type: String,
    default: '',
  },
});
const isSelected = ref(false);

/**
 * 站控措施小方框：代码 → { code, title, color }。
 *
 * 数据在 measureStore 里（站控措施模式开启时才灌入），这里按站名现取：
 *   · 气泡是站点显隐的唯一载体 —— 站点被隐藏，气泡连同方框一起不显示，
 *     所以「措施随站点显隐」是天然成立的，不需要另建一套气泡或额外联动；
 *   · 用 computed 订阅 store，灌入/清空时同一个气泡实例会自己更新，
 *     这也正是文档里「pinia + 发布订阅」要解决的问题，只是这里省掉了 pinia。
 */
const measureTiles = computed(() =>
  (measureState.byName[props.label] ?? []).map((code) => ({
    code,
    ...metaOf(code),
  })),
);

/** 徽标文字：起终点 > 换乘站 > 无 */
const badgeText = computed(() => props.badge || (props.isChange ? '换' : ''));

/**
 * 角色徽标：深底 + 本线色字。
 * 不能用线路色做底 —— 气泡本身就是这个颜色（80% 透明度），同色底会和气泡糊成一片。
 */
const badgeStyle = computed(() =>
  props.badge ? { background: '#0a1c30', color: props.color || '#e2ba64' } : null,
);

const resColor = computed(() => {
  // 起了 badge 的（起终点）按自己的线路色显示，不再被换乘站的红色盖掉
  if (props.isChange && !props.badge) {
    return 'rgba(255, 0, 0,.4)';
  } else {
    return getHexOpacityColor({ color: props.color, opacity: 0.8 });
  }
});

const getHexOpacityColor = ({ color = '#000', opacity = 0.5 }) => {
  opacity = Math.max(opacity, 0);
  opacity = Math.min(opacity, 1);
  color = color.replace(/\#/g, '').toUpperCase();
  if (color.length === 3) {
    let arr = color.split('');
    color = '';
    for (let i = 0; i < arr.length; i++) {
      color += arr[i] + arr[i]; //将简写的3位字符补全到6位字符
    }
  }
  let num = Math.round(255 * opacity); //四舍五入
  let str = '';
  let arrHex = [
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    'A',
    'B',
    'C',
    'D',
    'E',
    'F',
  ]; //十六进制数组
  while (num > 0) {
    let mod = num % 16;
    num = (num - mod) / 16;
    str = arrHex[mod] + str;
  }
  if (str.length == 1) str = '0' + str;
  if (str.length == 0) str = '00';
  return `#${color + str}`;
};

const onClick = () => {
  // 原来这里传的是未定义的 measures.value，一点击就 ReferenceError
  props.clickCallback && props.clickCallback();
};
</script>

<style scoped>
/* ---- 站控措施：贴在气泡正上方的一排小方框 ----
   方框绝对定位在气泡顶部之外（bottom:100%），不参与气泡自身的 flex 布局，
   所以不会把站名撑宽、也不会改变气泡的居中位置。 */
.measure-tiles {
  position: absolute;
  left: 50%;
  bottom: 100%;
  transform: translateX(-50%);
  display: flex;
  gap: 3px;
  margin-bottom: 4px;
  pointer-events: none;
}

.measure-tile {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 3px;
  color: var(--c, #e2ba64);
  background: rgba(6, 16, 30, 0.92);
  border: 1px solid var(--c, #e2ba64);
  box-shadow: 0 0 6px color-mix(in srgb, var(--c, #e2ba64) 45%, transparent);
}

.LabelPlot-container {
  position: absolute;
  left: 0px;
  bottom: 0px;
  cursor: default;
  padding: 5px;
  border: 1px solid #9c9944d3;
  color: #fff;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  cursor: pointer;
  user-select: none;
}

.info-item {
  margin-left: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 换乘站徽标 */
.transfer-badge {
  flex: none;
  padding: 0 4px;
  background: #ff2bd1;
  color: #fff;
  font-size: 12px;
  line-height: 16px;
}

.LabelPlot-container:hover {
  border: 1px solid rgb(9, 255, 0);
}
</style>
