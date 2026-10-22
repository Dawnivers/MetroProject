import api from './baseApi';

//baseURL = 'http://localhost:8092';
/**
 * 地铁路径规划
 * @param {string} origin      起点坐标 "lng,lat"
 * @param {string} destination 终点坐标 "lng,lat"
 * @returns {Promise} 方案：cost(费用) duration(时长) distance(距离) segments(分段)
 */
export function getLinePlan(origin, destination) {
  return api.get('/getLinePlan', {
    params: { origin, destination },
  });
}

/**
 * 天气查询
 * @param {string} extensions 'base'(实况) 或 'all'(预报)
 * @param {string} city       城市 adcode
 * @returns {Promise} base 返回 lives 实况，all 返回 forecasts 预报
 */
export function getWeather(extensions = 'base', city) {
  return api.get('/getWeather', {
    params: { extensions, city },
  });
}

/**
 * 地铁线路数据
 * @returns {Promise} 全部线路及其站点列表
 */
export function getLine() {
  return api.get('/getLine');
}

/**
 * 地铁站点信息查询
 * @param {string} name 站名
 * @returns {Promise} address(所在线路) peopleFlow(人流量)
 */
export function getStationInfo(name) {
  return api.get('/getStationInfo', {
    params: { name },
  });
}
