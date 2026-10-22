import { defineStore } from 'pinia';

/**
 * 开场加载状态 —— 只服务开屏动画，不参与业务逻辑。
 *
 * 设计原则：**闸门盯功能，不盯瓦片**。
 *
 * 参加闸门（blocking: true）：
 *   data      线路基础数据    ← left1.vue 的 /getLine 返回并写入仓库
 *   entities  线路/站点实体    ← Toolbar.vue 的 renderLineEntities + renderStationMarkers 跑完
 *   train     列车模型        ← 不是"HTTP 200"，而是 Cesium 真的把这个 glb 解析成功
 *
 * 不参加闸门（blocking: false）：
 *   city      城市三维模型    ← 2.2GB，慢慢流式加载，不该挡住任何功能
 *   bund      外滩场景
 *
 * 这样"加载完成"才等于"进项目立刻能点开线路轨迹/站点/气泡"，
 * 而不是"瓦片下了一部分但功能还在等"。
 */

/** 各项资源占总进度的权重（相加 = 1） */
const WEIGHTS = {
  data: 0.2,
  entities: 0.25,
  train: 0.35,
  city: 0.12,
  bund: 0.08,
};

/** 首屏最少停留，避免本地秒开时闪一下就没 */
const MIN_SHOW_MS = 1800;

const initialAssets = () => [
  {
    key: 'data',
    label: '线路基础数据',
    status: 'pending',
    detail: '等待接口',
    ratio: 0,
    blocking: true,
  },
  {
    key: 'entities',
    label: '线路与站点实体',
    status: 'pending',
    detail: '等待数据',
    ratio: 0,
    blocking: true,
  },
  {
    key: 'train',
    label: '列车模型',
    status: 'pending',
    detail: '等待预载',
    ratio: 0,
    blocking: true,
  },
  {
    key: 'city',
    label: '城市三维模型',
    status: 'pending',
    detail: '后台加载',
    ratio: 0,
    blocking: false,
  },
  {
    key: 'bund',
    label: '外滩场景',
    status: 'pending',
    detail: '后台加载',
    ratio: 0,
    blocking: false,
  },
];

export const useLoadingState = defineStore('loadingState', {
  state: () => ({
    visible: true,
    done: false,
    finishing: false,
    /** 阶段进度（引擎 / 底图 / 模型解析），0~0.35 */
    base: 0.03,
    phase: '系统启动',
    startedAt: Date.now(),
    assets: initialAssets(),
  }),

  getters: {
    /** 只看 blocking 项：功能齐了就算"加载完成" */
    blockingAssets: (state) => state.assets.filter((a) => a.blocking),

    allSettled() {
      return this.blockingAssets.every(
        (a) => a.status === 'ok' || a.status === 'fail',
      );
    },

    failedList: (state) =>
      state.assets.filter((a) => a.status === 'fail'),

    /**
     * 总进度 = 阶段进度 + 剩余区间按权重分摊。
     * 收尾时（finishing）直接返回 100，进度条不会卡在 80%。
     */
    percent(state) {
      if (state.finishing) return 100;
      let ratio = 0;
      for (const a of state.assets) {
        const settled = a.status === 'ok' || a.status === 'fail';
        ratio += (WEIGHTS[a.key] || 0) * (settled ? 1 : a.ratio);
      }
      return Math.round(Math.min(1, state.base + (1 - state.base) * ratio) * 100);
    },
  },

  actions: {
    setBase(p, phase) {
      if (p > this.base) this.base = Math.min(0.35, p);
      if (phase) this.phase = phase;
    },

    asset(key, patch) {
      const a = this.assets.find((x) => x.key === key);
      if (a) Object.assign(a, patch);
    },

    startAsset(key, detail) {
      this.asset(key, { status: 'loading', detail: detail || '加载中' });
    },

    progressAsset(key, ratio, detail) {
      const a = this.assets.find((x) => x.key === key);
      if (!a) return;
      a.status = 'loading';
      a.ratio = Math.max(a.ratio, Math.min(0.99, ratio));
      if (detail) a.detail = detail;
    },

    /** 瓦片类资源：每来一块 +1，用饱和曲线换算成 ratio */
    addTile(key, n = 1) {
      const a = this.assets.find((x) => x.key === key);
      if (!a) return;
      a.tiles = (a.tiles || 0) + n;
      a.status = 'loading';
      a.ratio = Math.max(a.ratio, 1 - Math.exp(-a.tiles / 25));
      a.detail = `${a.tiles} 块瓦片`;
    },

    doneAsset(key, detail) {
      this.asset(key, { status: 'ok', ratio: 1, detail: detail || '已就绪' });
      this.maybeFinish();
    },

    failAsset(key, detail) {
      this.asset(key, { status: 'fail', ratio: 1, detail: detail || '加载失败' });
      this.maybeFinish();
    },

    /** 所有 blocking 项到终态 → 收尾（city / bund 不参与） */
    maybeFinish() {
      if (this.done || this.finishing) return;
      if (this.allSettled) this.finish();
    },

    finish(reason) {
      if (this.done || this.finishing) return;
      this.finishing = true;
      const failed = this.failedList.length;
      this.phase = reason || (failed ? `${failed} 项异常，其余就绪` : '系统就绪');
      const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - this.startedAt));
      setTimeout(() => {
        this.done = true;
        setTimeout(() => {
          this.visible = false;
        }, 420);
      }, wait + 320);
    },

    /** 异常兜底：把没完成的标成 fail，然后照常退场 */
    fail(reason) {
      for (const a of this.blockingAssets) {
        if (a.status !== 'ok') a.status = 'fail';
      }
      this.finish(reason || '部分功能加载失败');
    },
  },
});
