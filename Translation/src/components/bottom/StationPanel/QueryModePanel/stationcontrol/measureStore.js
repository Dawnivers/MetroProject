import { reactive } from 'vue';
import { MEASURE_META, STATION_MEASURES } from './stationMeasures';

/**
 * 站控措施的**共享响应式数据**。
 *
 * 为什么需要共享：措施要画在「站点自己的气泡」里（站点隐藏时它必须跟着消失），
 * 而气泡是 Toolbar 在启动时一次性建好的（MarkerTemplate），站控措施组件事先
 * 拿不到那些实例。所以数据放在这里，模板按 `props.label`（站名）自己去读：
 *
 *   进模式 → enableMeasures() 把静态数据灌进来 → 已建好的气泡自动长出小方框；
 *   退模式 → disableMeasures() 清空 → 方框自动消失，气泡回到普通样式。
 *
 * 只读数据也用 reactive 包一层，是为了「同一个气泡实例」能被通知到 ——
 * 这跟文档里用 pinia + 发布订阅是同一件事，只是这里不需要 pinia（只有一个消费者）。
 */
const state = reactive({
  /** 是否处于「站控措施」模式（数据是否灌入） */
  active: false,
  /** 站名 → 措施代码数组 */
  byName: {},
});

/** 模板里按站名取措施（无措施返回空数组，调用方不必判空） */
export const measuresOf = (name) => state.byName[name] ?? [];

/** 取某个代码的完整信息：{ title, color } */
export const metaOf = (code) => MEASURE_META[code] ?? { title: code, color: '#e2ba64' };

export const enableMeasures = () => {
  state.byName = STATION_MEASURES;
  state.active = true;
};

export const disableMeasures = () => {
  state.byName = {};
  state.active = false;
};

/** 只读快照，给面板做统计/图例用 */
export const measureSnapshot = () => state.byName;

export const measureState = state;
