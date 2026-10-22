<template>
  <div id="cesium-viewer"></div>
</template>

<script setup>
import { onMounted, onActivated, onDeactivated, markRaw, watch } from 'vue'; //markRaw取消入库的响应式包装 避免性能损耗
import { useRoute } from 'vue-router';
import { cesiumStore } from '@/stores/counter';
import {
  initViewer,
  setScene,
  loadTilesets,
  applyDefaultView,
  flyToHome,
} from '@/cesiumTools/sceneManager';
import {
  handleshpModelEffect,
  hanleWaterEffect,
  handleFlowEffect,
} from '@/cesiumTools/DayorNigjt/ModelShaders';
import {
  applyModelTransform,
  createModelTransformGUI,
} from '@/cesiumTools/modelTransform';
import { TencentImageryProvider } from '@cesium-china/cesium-map';
import * as Cesium from 'cesium';
import ToPlane from '@/cesiumTools/toPlane';
import { handleUpdateScene } from '@/cesiumTools/DayorNigjt/DayorNight';
import { useLoadingState } from '@/stores/loadingState';

const dataStore = cesiumStore();
const loading = useLoadingState();
let viewer; // 模块级 viewer 引用，供 applyModelTransform 主动请求重绘使用
let tileset;
let waterPrimitive;

/**
 * 单个 tileset 的加载校验。
 *
 * 判定「这项资源真的可用」用的是 initialTilesLoaded —— 初始视角所需的瓦片
 * 全部到手才算完成，而不是仅凭根 tileset.json 200。
 *
 * 两个兜底：
 *   · 浏览器缓存命中时 initialTilesLoaded 可能在监听挂上之前就发过了，
 *     1.2s 后检查 tilesLoaded 补一次；
 *   · 20s 硬超时，模型再大也不把用户锁在加载页（标记为「超时放行」）。
 */
const trackTileset = (key, target) => {
  if (!target) {
    loading.failAsset(key, '未创建');
    return;
  }

  loading.startAsset(key, '0 块瓦片');
  target.tileLoad.addEventListener(() => loading.addTile(key, 1));

  let settled = false;
  const done = (detail) => {
    if (settled) return;
    settled = true;
    loading.doneAsset(key, detail || '首屏已就绪');
  };

  target.initialTilesLoaded.addEventListener(() => done());
  setTimeout(() => {
    if (!settled && target.tilesLoaded) done();
  }, 1200);
  setTimeout(() => done('后台继续加载'), 20000);
};

/**
 * 列车模型预载。
 *
 * 它本来是 RealtimePanel 懒加载时才去要的（23.5MB），不提前拉的话，观众点进
 * 「实时轨迹」会先黑屏十几秒。这里在开屏阶段就把它读完：
 *   · 顺带验证文件完整（能读到 EOF 就是完整的）；
 *   · 读完后浏览器缓存里就有它，后面 Cesium 再取是秒开。
 *
 * 注意：开发环境 Vite 给静态资源的是 no-cache，预载不会真正命中缓存（会读两次，
 * 本地局域网无所谓）；生产环境配了 immutable 才有收益。
 */
/** 开屏阶段是否预载列车模型（23.5MB）。 */
const PRELOAD_TRAIN = true;

const TRAIN_MODEL_URL = new URL(
  '../assets/trainAndChisa_static.glb',
  import.meta.url,
).href;

const preloadTrainModel = async () => {
  loading.startAsset('train', '预载中');
  try {
    const res = await fetch(TRAIN_MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const total = Number(res.headers.get('content-length')) || 0;
    const allMb = total ? (total / 1048576).toFixed(1) : '?';
    let received = 0;

    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        loading.progressAsset(
          'train',
          total ? received / total : 0,
          `${(received / 1048576).toFixed(1)} / ${allMb} MB`,
        );
      }
    } else {
      // 老浏览器没有 ReadableStream，退化成一次性读完
      const blob = await res.blob();
      received = blob.size;
    }

    const mb = (received / 1048576).toFixed(1);

    // 光下载到浏览器缓存不算数：Cesium 还得解析几何、解码贴图、编译 shader。
    // 这一步不预热的话，观众点进「线路轨迹」时模型还要再等一两秒才出现，
    // 看起来就像"加载完成了但列车不见了"。
    loading.progressAsset('train', 0.99, 'Cesium 解析中');
    let parsed = false;
    try {
      const model = Cesium.Model.fromGltf({
        url: TRAIN_MODEL_URL,
        show: false,
      });
      await model.readyPromise;
      model.destroy();
      parsed = true;
    } catch (e) {
      console.warn('[loading] 列车模型预解析失败（文件已下载）', e);
    }

    loading.doneAsset(
      'train',
      parsed ? `${mb} MB · 已解析` : `${mb} MB · 已下载`,
    );
  } catch (err) {
    // 列车模型挂了不该拦住整个场景，只标红这一项
    console.warn('[loading] 列车模型预载失败', err);
    loading.failAsset('train', '预载失败');
  }
};

onMounted(async () => {
  viewer = initViewer('cesium-viewer'); //创建viewer 进行默认配置（赋值给模块级变量，避免被局部 const 遮蔽）
  loading.setBase(0.12, '三维引擎已启动');

  addTecenMap(viewer); //添加腾讯地图
  // 进项目即切到固定默认视角（在加载瓦片之前就位，LOD 也按这个视角来选）
  applyDefaultView(viewer);
  loading.setBase(0.18, '底图已挂载');

  // 开发期调试句柄：F12 里可直接 __cesiumViewer 访问 Viewer（生产构建不会挂载）
  if (import.meta.env.DEV) globalThis.__cesiumViewer = viewer;

  await dataStore.setViewer(markRaw(viewer)); //将viewer存储到store中

  // 列车模型与场景并行预载，互不阻塞。
  // 如果不想让它在开屏阶段抢带宽，把它设为 false —— 那样它会退回
  // RealtimePanel 的懒加载路径，只是第一次进「实时轨迹」会慢一点。
  if (PRELOAD_TRAIN) preloadTrainModel();
  else loading.doneAsset('train', '按需加载');

  try {
    await loadTilesets(viewer, modelUrls, async (tilesets) => {
      // 两个 tileset 的 readyPromise 都 resolve 了才会走到这里
      loading.setBase(0.28, '三维模型已解析');

      handleshpModelEffect(tilesets[0]); //处理默认模型效果
      // hanleWaterEffect 是 async，必须 await 才能拿到 GroundPrimitive 实例
      waterPrimitive = await hanleWaterEffect(viewer); //添加水体模型效果

      dataStore.setTilesets(tilesets); //将存储所有模型的数组存储到store中
      tileset = tilesets[1];
      // toPlane.flatten(polygon, tilesets[0]); //压平与外滩模型重合的白膜
      applyModelTransform(tilesets[1], params, viewer); //添加外滩模型
      handleFlowEffect(tilesets[1], viewer); //给外滩模型叠加流体光带特效

      // 放在各特效挂载之后：首次昼夜判定即可把 u_isDark 同步到 flowShader（夜间自发光）
      handleUpdateScene(viewer, tilesets, waterPrimitive); //添加白天/夜晚切换功能
      loading.setBase(0.35, '场景特效已合成');

      // 相机已在 initViewer 之后由 applyDefaultView 固定，
      // 这里不再用 viewer.zoomTo(tilesets[1])（那会让 Cesium 按包围球自己算一个视角，覆盖默认值）

      // 逐项校验：城市模型、外滩场景各自等首屏瓦片到位
      trackTileset('city', tilesets[0]);
      trackTileset('bund', tilesets[1]);
    });
  } catch (err) {
    // 模型 404 / 网络断开时别把用户永久锁在加载页
    console.error('[loading] 三维场景初始化失败', err);
    loading.fail('三维场景加载失败');
  }
});

/**
 * KeepAlive 缓存期间（切走 → 组件被 deactivated，DOM 移出文档，实例不销毁）：
 * 必须主动停掉 Cesium 的渲染循环，否则看不见的场景会继续空转 GPU。
 * 本项目昼夜/流光特效都挂在 viewer.scene.postRender 上，循环一停它们自然不再计算，
 * 没有 setInterval 需要额外清理。
 */
onDeactivated(() => {
  if (!viewer || viewer.isDestroyed()) return;
  viewer.clock.shouldAnimate = false; // 暂停时钟（时间轴/动画不再推进）
  viewer.useDefaultRenderLoop = false; // 停掉渲染帧循环
});

/**
 * 切回时（activated）：复用同一个 Viewer 实例，只需恢复循环与时钟，
 * 并补一次 resize —— 缓存期间容器尺寸可能已经变了。
 * 首次挂载也会走这里（mounted → activated），此时 viewer 已由 onMounted 创建。
 */
onActivated(() => {
  if (!viewer || viewer.isDestroyed()) return;
  viewer.resize(); // 容器尺寸可能变化，重新同步画布分辨率
  viewer.useDefaultRenderLoop = true; // 恢复渲染循环
  viewer.clock.shouldAnimate = true; // 恢复时钟
  viewer.scene.requestRender?.(); // 若将来开启 requestRenderMode，也能立刻出一帧
});

/**
 * 点「首页」回主控中心时，把相机飞回首次进入项目时的位置与姿态
 * （就是 sceneManager.js 里固化的 DEFAULT_VIEW，和进项目时用的是同一份）。
 *
 * 两个要点：
 *   · flush:'post' —— 必须等旧栏目的 onBeforeUnmount 跑完。实时轨迹在那里
 *     调 lookAtTransform(IDENTITY) 解相机锁，而 lookAtTransform 会**取消正在飞的相机**，
 *     早一步出发的飞行会被它打断；
 *   · 只在「从别的路由回到 /」时触发。首次进项目不重复飞 —— 那时 applyDefaultView
 *     已经把相机摆好，再飞一次只会白闪一下。
 */
const route = useRoute();
watch(
  () => route.path,
  (path, previous) => {
    if (path === '/' && previous !== '/') flyToHome(viewer, 1.2);
  },
  { flush: 'post' },
);

const modelUrls = [
  {
    url: 'http://localhost:666/model/shangHaiBuilds_new_toPlane/tileset-L11.json',
    option: {},
  },
  {
    url: 'http://localhost:666/model/EastProject/tileset.json',
    option: {},
  },
];

const addTecenMap = (viewer) => {
  var options = {
    style: 4, //style: img、1：经典
    crs: 'WGS84', // 使用84坐标系，默认为：GCJ02,
  };
  viewer.imageryLayers.add(
    new Cesium.ImageryLayer(new TencentImageryProvider(options)),
  );
};

//移动外滩模型的参数
const params = {
  tx: 71, //模型中心X轴坐标
  ty: -100, //模型中心Y轴坐标
  tz: 0, //模型中心Z轴坐标（高程，单位：米）
  rx: 0, //X轴（经度）方向旋转角度（单位：度）
  ry: 0, //Y轴（纬度）方向旋转角度（单位：度）
  rz: 0, //Z轴（高程）方向旋转角度（单位：度）
  scale: 1,
};

// 城市模型（tilesets[1]）位姿调试面板：getter 惰性取值，
// 滑动滑块时才读取 onMounted 中已加载的 viewer / tileset，故无需写在 onMounted 内
// createModelTransformGUI({
//   params,
//   getTileset: () => tileset,
//   getViewer: () => viewer,
// });

//压平与外滩模型重合的白膜
const toPlane = new ToPlane(viewer);

const polygon = [
  {
    x: -2853122.2194843255,
    y: 4654588.7318019355,
    z: 3286689.3196257846,
  },
  {
    x: -2853481.330501116,
    y: 4654312.055604184,
    z: 3286768.840048868,
  },
  {
    x: -2853350.2049001837,
    y: 4654191.874683676,
    z: 3287050.946621472,
  },
  {
    x: -2853014.0289565893,
    y: 4654049.670441442,
    z: 3287540.7581091616,
  },
  {
    x: -2852770.8058502316,
    y: 4653969.977244541,
    z: 3287862.458295495,
  },
  {
    x: -2852576.880132637,
    y: 4653923.324156006,
    z: 3288095.1760174423,
  },
  {
    x: -2852441.3596870634,
    y: 4653878.031411866,
    z: 3288275.6288215993,
  },
  {
    x: -2852537.8982364694,
    y: 4653814.4034964545,
    z: 3288281.8936449555,
  },
  {
    x: -2852547.277834983,
    y: 4653756.250360578,
    z: 3288355.561657181,
  },
  {
    x: -2852667.8660088475,
    y: 4653655.630620498,
    z: 3288393.0975523856,
  },
  {
    x: -2852540.716746463,
    y: 4653614.18625138,
    z: 3288560.9120979994,
  },
  {
    x: -2852407.61675176,
    y: 4653601.072468036,
    z: 3288694.019466427,
  },
  {
    x: -2852480.3955124863,
    y: 4653546.360515188,
    z: 3288708.217798751,
  },
  {
    x: -2852402.012337124,
    y: 4653509.324488016,
    z: 3288827.8008964765,
  },
  {
    x: -2852338.256549134,
    y: 4653516.001792277,
    z: 3288873.340451759,
  },
  {
    x: -2852389.8143545478,
    y: 4653460.246117558,
    z: 3288907.2863432625,
  },
  {
    x: -2852335.2843430815,
    y: 4653388.1651551705,
    z: 3289055.5620262716,
  },
  {
    x: -2852402.5575565416,
    y: 4653222.798812259,
    z: 3289229.998154552,
  },
  {
    x: -2852392.0098531335,
    y: 4653111.237451236,
    z: 3289395.8453531647,
  },
  {
    x: -2851783.5017113565,
    y: 4653526.625379727,
    z: 3289336.2313347845,
  },
  {
    x: -2851455.4043196184,
    y: 4653825.399244188,
    z: 3289198.8927540514,
  },
  {
    x: -2851226.216620899,
    y: 4654075.315311809,
    z: 3289044.993550982,
  },
  {
    x: -2851061.4725800445,
    y: 4654280.156136655,
    z: 3288898.9239362255,
  },
  {
    x: -2851083.7017736053,
    y: 4654449.650931825,
    z: 3288641.5139591303,
  },
  {
    x: -2851265.7945873416,
    y: 4654500.073623554,
    z: 3288413.8063126006,
  },
  {
    x: -2851592.157148349,
    y: 4654486.707630636,
    z: 3288151.4887102633,
  },
  {
    x: -2852078.408143981,
    y: 4654421.654935287,
    z: 3287824.0340961698,
  },
];
</script>
<style>
#cesium-viewer {
  width: 100%;
  height: 100%;
  pointer-events: all;
}
</style>
