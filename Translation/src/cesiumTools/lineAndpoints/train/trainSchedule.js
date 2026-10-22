/**
 * 列车漫游的时间表 ---------- T1
 *
 * 职责：把「一条折线 + 一串站点」算成「第几秒在哪个顶点」，供上层构造
 * Cesium.SampledPositionProperty。**本模块不碰 viewer，也不 import cesium。**
 *
 * ------------------------------------------------------------------
 * 契约（两个数组必须都是「行车方向」的顺序，本模块不再排序）
 * ------------------------------------------------------------------
 *   positions : 一维经纬度 [lng1, lat1, lng2, lat2, ...]
 *               —— 与 line1to18_2.json 的 geometry.coordinates 拍平后一致
 *   stations  : [{ name, xy_coords }]，按行车方向排好
 *
 * 反向行车（右上角 ⇄ 按钮）**不改本模块**：调用方把 positions 成对翻转、
 * stations 倒序，再调一次即可。一份算法两种输入，不写第二套逻辑。
 *
 * ------------------------------------------------------------------
 * 为什么不用 Cesium 的坐标工具
 * ------------------------------------------------------------------
 * 这里的 WGS84 地理→地心直角换算与 Cesium.Cartesian3.fromDegrees /
 * Cartesian3.distance 完全等价（同一条椭球公式、同样的三维欧氏距离）。
 * 自己写出来是为了让这个模块**能在 node 里直接跑**——时间表是整个功能的地基，
 * 它错了后面所有「跟手 / 高亮 / 进度」都会看起来像别处的 bug，所以它必须可离线验证。
 *
 * ------------------------------------------------------------------
 * 对齐方式（2026-10-17 在真实数据上核过，18/18 条线通过）
 * ------------------------------------------------------------------
 * 站点的 xy_coords 恰好就是折线顶点：17/18 条线的站点→顶点距离为 0，
 * 最差 14 号线 122m、16 号线 95m（相对 39km/59km 的线路可忽略）。
 * 所以用「严格单调前扫」就能精确落位：
 *   第 1 个站点全表搜索，之后每个站点都从上一个命中顶点的**下一个**开始搜。
 * 严格 +1 是为了避免两站抢到同一个顶点（14 号线裸单调时会撞车）。
 *
 * ------------------------------------------------------------------
 * 停站停顿烘焙进时间轴（不是 setTimeout）
 * ------------------------------------------------------------------
 * 「到站停 2 秒」表现为同一顶点上的两个采样点：(arrive, P) 与 (leave, P)。
 * 两者位置相同，列车就在这一段时间里静止；同时 arrive/leave 也是面板判断
 * 「当前是否在站」的依据。这样拖动时间轴时「停站」是可见、可回看的刻度，
 * 完全不用第二套计时器。
 */

/** 60 km/h。地铁旅行速度大致这个量级，真实时刻表也是这个范围 */
export const TRAIN_SPEED = 16.7;
/** 每站停顿秒数 */
export const TRAIN_DWELL = 4;

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const D2R = Math.PI / 180;

/** 经纬度（度）→ 地心直角坐标 [x, y, z]，与 Cartesian3.fromDegrees(lng, lat, 0) 等价 */
const toCartesian = (lng, lat) => {
  const rl = lng * D2R;
  const rb = lat * D2R;
  const sinB = Math.sin(rb);
  const cosB = Math.cos(rb);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinB * sinB);
  return [N * cosB * Math.cos(rl), N * cosB * Math.sin(rl), N * (1 - WGS84_E2) * sinB];
};

/** 三维欧氏距离，与 Cartesian3.distance 等价 */
const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** "121.355833,31.220052" → [lng, lat]；解析失败返回 null */
const parseCoord = (xyCoords) => {
  const [lng, lat] = String(xyCoords ?? '')
    .split(',')
    .map((token) => Number(token.trim()));
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
};

/**
 * 生成时间表。
 *
 * @param {Object} options
 * @param {number[]} options.positions 一维经纬度数组（行车方向）
 * @param {Array<{name: string, xy_coords: string}>} options.stations 站点（行车方向）
 * @param {number} [options.speed] 米/秒
 * @param {number} [options.dwell] 每站停车秒数
 * @returns {{
 *   samples: Array<{ t: number, vi: number }>,
 *   stationTimes: Array<{ name: string, arrive: number, leave: number, vi: number, km: number }>,
 *   total: number, speed: number, dwell: number,
 *   from: number, to: number,
 *   vertexCount: number, maxGap: number
 * }}
 *   samples 的 vi 是**原 positions 的顶点下标**（可除以 2 直接用），
 *   上层据此从 Cartesian3.fromDegreesArray 的结果里取值。
 */
export const buildSchedule = ({
  positions = [],
  stations = [],
  speed = TRAIN_SPEED,
  dwell = TRAIN_DWELL,
} = {}) => {
  const empty = {
    samples: [],
    stationTimes: [],
    total: 0,
    speed,
    dwell,
    from: 0,
    to: 0,
    vertexCount: 0,
    maxGap: 0,
  };

  // 少于 2 个点（4 个数字）构不成线
  if (positions.length < 4 || stations.length < 2) return empty;

  const vertexCount = Math.floor(positions.length / 2);
  const points = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    points[i] = toCartesian(positions[i * 2], positions[i * 2 + 1]);
  }

  // 累计弧长（相对第一个顶点）
  const cumulative = new Array(vertexCount);
  cumulative[0] = 0;
  for (let i = 1; i < vertexCount; i++) {
    cumulative[i] = cumulative[i - 1] + distance(points[i - 1], points[i]);
  }

  // ---- 站点 → 顶点：严格单调前扫 ----
  const matched = [];
  let cursor = 0;
  let maxGap = 0;

  for (let i = 0; i < stations.length; i++) {
    const coord = parseCoord(stations[i].xy_coords);
    if (!coord) {
      // 坐标坏掉的站点不参与铺表：宁可少一站，也不要静默错位
      continue;
    }
    const target = toCartesian(coord[0], coord[1]);
    // 第一个站点全表搜；之后必须严格往后，避免两站抢同一顶点
    const from = matched.length === 0 ? 0 : cursor + 1;
    let bestIndex = Math.min(from, vertexCount - 1);
    let bestDistance = Infinity;

    for (let k = from; k < vertexCount; k++) {
      const d = distance(points[k], target);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = k;
      }
    }

    cursor = bestIndex;
    if (bestDistance > maxGap) maxGap = bestDistance;
    matched.push({ name: stations[i].name, vi: bestIndex, gap: bestDistance });
  }

  if (matched.length < 2) return { ...empty, maxGap };

  // 以**首站顶点**为基准，把折线在首站之前/末站之后的部分丢掉：
  // 这样 t=0 就是首站发车，进度条 0~1 也正好对应首站→末站
  const base = cumulative[matched[0].vi];
  const s = (vi) => cumulative[vi] - base;

  const stationTimes = matched.map((item) => ({
    name: item.name,
    vi: item.vi,
    km: +(s(item.vi) / 1000).toFixed(3),
    arrive: 0,
    leave: 0,
  }));

  // ---- 到发时刻：首站 t=0 发车，之后「上一站发车 + 区间运行 + 停站」 ----
  stationTimes[0].arrive = 0;
  stationTimes[0].leave = 0;
  for (let i = 1; i < stationTimes.length; i++) {
    const run = (s(stationTimes[i].vi) - s(stationTimes[i - 1].vi)) / speed;
    stationTimes[i].arrive = stationTimes[i - 1].leave + run;
    stationTimes[i].leave = stationTimes[i].arrive + dwell;
  }
  const total = stationTimes[stationTimes.length - 1].leave;

  // ---- 采样点：站点处一对（到/发），站间每个顶点一个 ----
  //[340s,(111,22)] 
  const samples = [];
  for (let i = 0; i < stationTimes.length; i++) {
    const current = stationTimes[i];

    if (i > 0) samples.push({ t: current.arrive, vi: current.vi });
    samples.push({ t: current.leave, vi: current.vi });

    if (i + 1 >= stationTimes.length) break;

    const next = stationTimes[i + 1];
    for (let k = current.vi + 1; k < next.vi; k++) {
      samples.push({
        t: current.leave + (s(k) - s(current.vi)) / speed,
        vi: k,
      });
    }
  }

  return {
    samples,
    stationTimes,
    total,
    speed,
    dwell,
    from: matched[0].vi,
    to: matched[matched.length - 1].vi,
    vertexCount,
    maxGap,
  };
};

/**
 * 当前时刻在时间表里的位置 —— 面板的高亮/进度全靠它。
 *
 * 二分查找最后一个 `arrive <= t` 的站点。t 落在任何区间之外时
 * 返回 clamped 的结果，保证拖动时间轴拖到两端也不会拿到 -1 这种空值。
 *
 * @param {ReturnType<typeof buildSchedule>} schedule
 * @param {number} t 相对首站发车的秒数
 * @returns {{ index: number, inStation: boolean, progress: number, stationName: string }}
 */
export const locate = (schedule, t) => {
  const list = schedule?.stationTimes ?? [];
  if (!list.length) {
    return { index: -1, inStation: false, progress: 0, stationName: '' };
  }

  const total = schedule.total || 1;
  const progress = Math.min(1, Math.max(0, t / total));

  if (t <= 0) {
    return { index: 0, inStation: list[0].arrive <= t, progress, stationName: list[0].name };
  }
  if (t >= total) {
    const last = list.length - 1;
    return { index: last, inStation: true, progress: 1, stationName: list[last].name };
  }

  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].arrive <= t) lo = mid;
    else hi = mid - 1;
  }

  const current = list[lo];
  return {
    index: lo,
    inStation: t <= current.leave,
    progress,
    stationName: current.name,
  };
};

/**
 * 一维经纬度数组「成对翻转」——反向行车专用。
 *
 * 注意不能整体 Array.reverse()：那会把每个点的经纬度也翻位，
 * 结果是一串落在海里的坐标。
 */
export const reversePositions = (positions = []) => {
  const out = [];
  for (let i = positions.length - 2; i >= 0; i -= 2) {
    out.push(positions[i], positions[i + 1]);
  }
  return out;
};

/**
 * 「点某站就从这一站与上一站之间起跑」用到的时刻查询。
 *
 * 返回第 index 站与它上一站之间、**中间那个折线顶点**的时刻（相对首站发车的秒数）。
 * 取正中而不是随机取，是为了每次点同一站都停在同一位置，且确实落在两站之间。
 *
 * 边界：
 *   · index <= 0（首站）或越界 → 0，即从首站正常发车；
 *   · 两站之间紧邻、没有多余折点（to - from < 2）→ 退化成从这一站到站时刻起。
 *
 * @param {ReturnType<typeof buildSchedule>} schedule
 * @param {number} index 目标站在 stationTimes 中的下标
 * @returns {number} 出发时刻（秒）
 */
export const startTimeBetweenStations = (schedule, index) => {
  const list = schedule?.stationTimes ?? [];
  if (!list.length) return 0;
  if (index <= 0 || index >= list.length) return 0;

  const from = list[index - 1].vi;
  const to = list[index].vi;
  if (to - from < 2) return list[index].arrive;

  const vi = from + Math.floor((to - from) / 2);
  // 中间顶点在 samples 里恰好只有一条（只有站点顶点才有 arrive/leave 两条）
  const sample = schedule.samples.find((item) => item.vi === vi);
  return sample ? sample.t : list[index].arrive;
};
