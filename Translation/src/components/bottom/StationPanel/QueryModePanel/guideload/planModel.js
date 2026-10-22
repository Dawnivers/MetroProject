/**
 * 路径规划的数据层：把高德返回的 segments 归一化成「可渲染的乘车段 + 换乘点」。
 *
 * 纯函数、零依赖（不 import cesium，也不碰 viewer），所以能直接丢进 node 里跑。
 * 站点匹配和折线切片是整个功能的地基 —— 这里错了，现象是「线画歪了 / 点在空地上」，
 * 那种毛病很难从画面上倒查，所以它必须能脱离浏览器验证。
 *
 * 接口实测形状（GET /getLinePlan?origin=lng,lat&destination=lng,lat）：
 *   { cost:'4', duration:'3215', distance:'12528', segments:[
 *       { walking:{distance:'723', steps:[...]} },
 *       { bus:{ buslines:[{
 *           name:'地铁1号线(莘庄--富锦路)',
 *           departure_stop:{name,location}, arrival_stop:{name,location},
 *           via_stops:[{name,location}...], distance:'10740',
 *           cost:{duration:'1170'},
 *           polyline:{polyline:'lng,lat;lng,lat;...'}   // ← 注意是对象，不是字符串
 *       }] } },
 *     ... ] }
 * 换乘在一段里就是一条 busline；两段 busline 之间会夹一段纯 walking。
 */

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** "121.355833,31.220052" → [lng, lat]；解析失败返回 null */
export const parseCoord = (text) => {
  const [lng, lat] = String(text ?? '')
    .split(',')
    .map((token) => Number(token.trim()));
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
};

/** '地铁1号线(莘庄--富锦路)' → '上海地铁1号线'；认不出来（磁浮 / 金山铁路）返回 '' */
export const ourLineName = (buslineName) => {
  const no = String(buslineName ?? '').match(/地铁(\d+)号线/)?.[1];
  return no ? `上海地铁${no}号线` : '';
};

/**
 * 两个下拉框的选项：18 条线的站点按站名去重（换乘站会在多条线的 stationList 里各出现一次）。
 * xy 保留后端原始文本 "lng,lat"（这是库里的 WGS-84，发请求前要转 GCJ-02，见 wgs84ToGcj02）。
 */
export const buildStationOptions = (lines = []) => {
  const map = new Map();
  lines.forEach((line) => {
    (line?.stationList ?? []).forEach((station) => {
      if (!station?.name || map.has(station.name)) return;
      const coord = parseCoord(station.xy_coords);
      if (!coord) return;
      map.set(station.name, {
        name: station.name,
        xy: station.xy_coords,
        lng: coord[0],
        lat: coord[1],
        isChange: Number(station.isChange) === 1,
      });
    });
  });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
};

/* ================= 坐标系：WGS-84 → GCJ-02 =================
 *
 * 库里的站点 / 线路坐标是 **WGS-84**（与 Cesium 的 ArcGIS World Imagery 底图一致，
 * 站点光锥才能压在马路上）。
 *
 * 但高德的全部 Web 服务接口吃的是 **GCJ-02（火星坐标）**。上海一带两者恒差
 * 约 +0.0045° 经度、-0.0018° 纬度 ≈ 东 430 m、南 215 m。
 *
 * 不转换的后果实测（富锦路 → 人民广场）：
 *   直接传 WGS-84 → 高德把终点吸附到**新闸路**（人民广场的上一站），
 *                   还给出「末段步行 710 m」这种假距离；
 *   转成 GCJ-02  → 正确送达**人民广场**，末段步行 134 m。
 * 这不是接口抽风，是「把另一个坐标系的点当成自己的点」找最近的 POI。
 *
 * 换算公式是公开的标准实现（与 gcoord / coordtransform 等库一致），
 * 放在这里是为了让它能脱离浏览器跑测试 —— 请求错了比渲染错了更难查。
 */
const PI = Math.PI;
const GCJ_A = 6378245.0; // 克拉索夫斯基椭球长半轴
const GCJ_EE = 0.00669342162296594323; // 第一偏心率平方

const outOfChina = (lng, lat) =>
  !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);

const transformLat = (x, y) => {
  let ret =
    -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  return ret;
};

const transformLng = (x, y) => {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
  return ret;
};

/**
 * WGS-84 → GCJ-02。境外直接原样返回（高德在境外不做偏移）。
 * @returns {[number, number]} [lng, lat]
 */
export const wgs84ToGcj02 = (lng, lat) => {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [lng, lat];
  if (outOfChina(lng, lat)) return [lng, lat];

  let dLat = transformLat(lng - 105, lat - 35);
  let dLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
};

/**
 * 站名 → 发给高德的 "lng,lat"（GCJ-02，6 位小数）。
 * 三维里的渲染仍用库里的 WGS-84 坐标，只有「发给高德的那一份」需要转。
 */
export const stationQueryCoord = (station) => {
  const coord = parseCoord(station?.xy);
  if (!coord) return '';
  const [lng, lat] = wgs84ToGcj02(coord[0], coord[1]);
  return `${lng.toFixed(6)},${lat.toFixed(6)}`;
};

/** 站名 → 本地站点记录（要坐标，也要 isChange —— 气泡的「换」徽标和详情卡都靠它） */
const stationOf = (lines, name) => {
  for (const line of lines) {
    const hit = (line?.stationList ?? []).find((item) => item.name === name);
    if (hit) return hit;
  }
  return null;
};

/** 折线上离目标经纬度最近的顶点下标（站点 xy_coords 就是折线顶点，误差可忽略） */
const nearestVertex = (positions, lng, lat) => {
  const count = Math.floor(positions.length / 2);
  let best = -1;
  let bestSq = Infinity;
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 2] - lng;
    const dy = positions[i * 2 + 1] - lat;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      bestSq = sq;
      best = i;
    }
  }
  return best;
};

/**
 * 用**本地线路几何**切出这一段的折线。
 *
 * 优先本地几何而不是接口自带的 polyline：三维里的 18 条线就是这份坐标画的，
 * 切出来才能严丝合缝地压在原线上；高德的 polyline 是另一套数字化结果，
 * 会与已有线路错开几十米（两条线并排、像画歪了）。只有匹配不到本地线路时（磁浮等）
 * 才退回用接口的 polyline。
 */
const localGeometry = (line, fromName, toName) => {
  const positions = line?.positions ?? [];
  const stations = line?.stationList ?? [];
  if (positions.length < 4 || stations.length < 2) return null;

  const coords = [fromName, toName].map((name) => {
    const hit = stations.find((item) => item.name === name);
    return hit ? parseCoord(hit.xy_coords) : null;
  });
  if (coords.some((coord) => !coord)) return null;

  const [a, b] = coords.map((coord) => nearestVertex(positions, coord[0], coord[1]));
  if (a < 0 || b < 0 || a === b) return null;

  // 取两个顶点之间的整段。方向（先过谁）对静态高亮线没有影响，
  // 所以直接按折线的先后来切，不在这里处理「反向乘车」
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const slice = [];
  for (let i = lo; i <= hi; i++) slice.push(positions[i * 2], positions[i * 2 + 1]);
  return slice.length >= 4 ? slice : null;
};

/**
 * GCJ-02 → WGS-84（反算）。
 *
 * 网络流传的都是「WGS → GCJ」的正算，反算没有闭式解。这里用一次迭代逼近：
 * 偏移量在几百米尺度上近似常数，`gcj - (gcj(wgs) - wgs)` 的误差在 1 m 量级，
 * 对「把高德返回的规划线画到 WGS 底图上」这件事足够了。
 */
export const gcj02ToWgs84 = (lng, lat) => {
  const [gLng, gLat] = wgs84ToGcj02(lng, lat);
  return [lng * 2 - gLng, lat * 2 - gLat];
};

/**
 * 接口自带的 polyline（"lng,lat;lng,lat..."，也可能是 { polyline: "..." }）→ 一维坐标数组。
 *
 * **注意要转回 WGS-84**：高德给的折线是 GCJ-02，直接画到 WGS 底图上会整体偏移
 * 约 480 m（一条线平行着压在真线旁边）。只有本地线路匹配不上时才走这里，
 * 但正是这种兜底最容易成为「画歪了」的现场。
 */
export const parseAmapPolyline = (polyline) => {
  const text = typeof polyline === 'string' ? polyline : polyline?.polyline;
  const out = [];
  String(text ?? '')
    .split(';')
    .forEach((pair) => {
      const coord = parseCoord(pair);
      if (!coord) return;
      const [lng, lat] = gcj02ToWgs84(coord[0], coord[1]);
      out.push(lng, lat);
    });
  return out.length >= 4 ? out : null;
};

/** 这一段的站数（含起终点）；本地对不上时返回 0，面板就不显示「N 站」 */
const countStations = (line, fromName, toName) => {
  const stations = (line?.stationList ?? [])
    .slice()
    .sort((a, b) => num(a.sort) - num(b.sort));
  const a = stations.findIndex((item) => item.name === fromName);
  const b = stations.findIndex((item) => item.name === toName);
  return a >= 0 && b >= 0 ? Math.abs(a - b) + 1 : 0;
};

/**
 * 归一化一条方案。
 *
 * 输出三份东西，各给一个消费者：
 *   segments —— 只有地铁段，renderRoute 用它画高亮线与起终点标记；
 *   transfers —— 相邻两段的交点（换乘站），renderRoute 用它立换乘标记；
 *   legs     —— 面板用的**完整行程**：进站步行 / 地铁段 / 换乘 / 出站步行，
 *               顺序与接口返回一致，每项都可展开看细节。
 *
 * @param {object} plan 接口 data 字段
 * @param {Array} lines dataStore.Lines（拿本地折线与站点）
 * @param {(lineName: string) => string} colorOf 线路色解析（传 metroLineColor）
 */
export const normalizePlan = (plan, lines = [], colorOf = () => '#3aa0ff') => {
  const byName = new Map(lines.map((line) => [line.name, line]));

  const segments = [];
  /** walkBefore[i] = 进入第 i 个地铁段之前累积的步行 */
  const walkBefore = [];
  /** 正在累积的步行块 */
  let pending = null;

  const takeWalk = () => {
    const value = pending ?? { distance: 0, steps: [] };
    pending = null;
    return value;
  };

  (plan?.segments ?? []).forEach((item) => {
    const walkDistance = num(item?.walking?.distance);
    const walkSteps = item?.walking?.steps ?? [];

    // 纯步行的一段：可能很长（换乘通道），也可能只有 1 米，都先攒起来
    if (walkDistance || walkSteps.length) {
      if (!pending) pending = { distance: 0, steps: [] };
      pending.distance += walkDistance;
      walkSteps.forEach((step) => {
        pending.steps.push({
          instruction: step?.instruction ?? '',
          distance: num(step?.distance),
        });
      });
    }

    const busline = item?.bus?.buslines?.[0];
    if (!busline) return;

    // 这一段之前的步行，就是「进站步行」或「换乘步行」
    walkBefore[segments.length] = takeWalk();

    const lineName = ourLineName(busline.name);
    const local = byName.get(lineName) ?? null;
    const from = busline.departure_stop?.name ?? '';
    const to = busline.arrival_stop?.name ?? '';
    const geometry =
      (local ? localGeometry(local, from, to) : null) ??
      parseAmapPolyline(busline.polyline);

    // 途经站：接口的 via_stops 有时把到达站也塞在末尾（10 号线实测），去掉起终点避免重复
    const viaStops = (busline.via_stops ?? [])
      .map((stop) => stop?.name)
      .filter((name) => name && name !== from && name !== to);

    const fromStation = stationOf(lines, from);
    const toStation = stationOf(lines, to);

    segments.push({
      lineName,
      short: (lineName || busline.name || '').replace(/^上海地铁/, ''),
      color: colorOf(lineName),
      from,
      to,
      // 标记点用本地坐标（与三维里的站点重合）；本地没有才退回接口给的 location
      fromCoord:
        parseCoord(fromStation?.xy_coords) ??
        parseCoord(busline.departure_stop?.location),
      toCoord:
        parseCoord(toStation?.xy_coords) ??
        parseCoord(busline.arrival_stop?.location),
      // 气泡的「换」徽标 + 详情卡的「是否换乘站」都读这个
      fromIsChange: Number(fromStation?.isChange) === 1 ? 1 : 0,
      toIsChange: Number(toStation?.isChange) === 1 ? 1 : 0,
      stopCount: countStations(local, from, to),
      viaStops,
      // 接口单位：duration 秒、distance 米、cost 元
      duration: num(busline.cost?.duration),
      distance: num(busline.distance),
      geometry,
    });
  });

  /** 最后一段之后的步行 = 出站步行 */
  const arrival = takeWalk();

  // 换乘点：第 i 段与第 i+1 段的交界
  const transfers = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const current = segments[i];
    const next = segments[i + 1];
    transfers.push({
      name: next.from || current.to,
      fromLine: current.short,
      toLine: next.short,
      coord: next.fromCoord ?? current.toCoord,
    });
  }

  /**
   * 只统计「站与站之间」的换乘步行。
   *
   * 进站/出站的步行**故意不统计也不展示**：起终点都是下拉里选的站，
   * 接口这时给出的步行来自两套坐标的偏差，不是真实路程 —— 实测我们的
   * 莘庄是 121.38029,31.112356，高德的莘庄站是 121.385373,31.111152，
   * 两者差 723 m，接口就报「步行 723 米到达莘庄」。把它显示出来会让用户
   * 以为「都站在莘庄站了还要走 700 米」。换乘步行（如陕西南路 1↔10 的 303 m）
   * 是站内通道的真实距离，照常展示。
   */
  const accessWalk = walkBefore[0]?.distance ?? 0;
  const arrivalWalk = arrival.distance;
  const walking = walkBefore
    .slice(1)
    .reduce((sum, walk) => sum + (walk?.distance ?? 0), 0);

  // 面板行程：地铁段 → 换乘（站内步行可展开）→ 地铁段
  const legs = [];
  segments.forEach((segment, index) => {
    if (index > 0) {
      const before = walkBefore[index] ?? { distance: 0, steps: [] };
      // 换乘行一律给，即使站内步行是 0 —— 否则面板上两段挨着，看不出要换线
      legs.push({
        type: 'transfer',
        station: segment.from,
        distance: before.distance,
        steps: before.steps,
      });
    }
    legs.push({ type: 'metro', segment });
  });

  return {
    cost: num(plan?.cost),
    duration: num(plan?.duration),
    distance: num(plan?.distance),
    walking,
    // 以下两项只做记录，面板不展示（原因见上面 walking 的注释）
    accessWalk,
    arrivalWalk,
    segments,
    transfers,
    legs,
  };
};
