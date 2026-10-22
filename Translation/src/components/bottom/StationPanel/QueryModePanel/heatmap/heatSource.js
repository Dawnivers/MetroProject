/**
 * 把后端 /getLine 的线路数据整理成「热力图所需的最小集合」。
 *
 * 纯函数、不碰 Cesium 也不碰 DOM，所以可以直接 node 里跑测试：
 *   node --input-type=module -e "import('./heatSource.js')..."
 *
 * 三个坑都在这一个函数里处理掉：
 *   ① 换乘站会同时出现在多条线路的 stationList 里 —— 必须按站名去重，
 *      否则人民广场会被叠 3 次，热力值凭空翻三倍、晕成一团；
 *   ② 坐标是 "经度,纬度" 的**文本**（后端 index.js:137 拼出来的），要拆成数字；
 *   ③ 拥挤度用后端真实字段 peopleFlow（换乘站 300~999、普通站 50~299，
 *      见 Translation_BE/index.js:15），不是前端随机数。
 */

/** bbox 在真实站点范围外扩的余量（度）。0.012° ≈ 1.3km，够让边缘的团不被切掉 */
const BBOX_PAD = 0.012;

/** peopleFlow 缺失时的兜底值（落在普通站的区间里） */
const FALLBACK_VALUE = 120;

/**
 * @param {Array} lines 后端线路数组，形如 [{ name, stationList: [...] }]
 * @param {Object} [options]
 * @param {number} [options.pad] bbox 外扩量（度）
 * @returns {{
 *   points: Array<{name:string,lng:number,lat:number,value:number,isChange:boolean}>,
 *   bbox: number[] | null,
 *   min: number, max: number
 * }}
 */
export function buildHeatSource(lines, options = {}) {
  const pad = Number.isFinite(options.pad) ? options.pad : BBOX_PAD;

  /** 站名 → 站点。Map 天然去重，且保留第一次遇到的那份（含它的坐标） */
  const byName = new Map();

  (Array.isArray(lines) ? lines : []).forEach((line) => {
    (line?.stationList ?? []).forEach((station) => {
      const name = station?.name;
      if (!name || byName.has(name)) return;

      const [lng, lat] = String(station.xy_coords ?? '')
        .split(',')
        .map((token) => Number(token.trim()));
      // 解析失败就跳过，避免把 (0, 0) 之类的脏点画到几内亚湾
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

      const raw = Number(station.peopleFlow);
      byName.set(name, {
        name,
        lng,
        lat,
        value: Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_VALUE,
        isChange: Number(station.isChange) === 1,
      });
    });
  });

  const points = Array.from(byName.values());
  if (!points.length) {
    return { points: [], bbox: null, min: 0, max: 0 };
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let min = Infinity;
  let max = -Infinity;

  points.forEach((point) => {
    if (point.lng < minLng) minLng = point.lng;
    if (point.lng > maxLng) maxLng = point.lng;
    if (point.lat < minLat) minLat = point.lat;
    if (point.lat > maxLat) maxLat = point.lat;
    if (point.value < min) min = point.value;
    if (point.value > max) max = point.value;
  });

  return {
    points,
    // 顺序必须是 [左, 下, 右, 上]，与 Cesium.Rectangle.fromDegrees(...) 一致
    bbox: [minLng - pad, minLat - pad, maxLng + pad, maxLat + pad],
    min,
    max,
  };
}

export default buildHeatSource;
