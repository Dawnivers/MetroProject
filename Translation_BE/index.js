const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const config = require('./config');

const app = express();
const PORT = config.port; // 监听端口（配置见 config.js）

// 数据库连接（配置见 config.js）
const pool = new Pool(config.db);

app.use(cors());

// 随机模拟人流量：换乘站 300~999，普通站 50~299
function genPeopleFlow(isChange) {
  return isChange === 1
    ? 300 + Math.floor(Math.random() * 700)
    : 50 + Math.floor(Math.random() * 250);
}

// 高德 Web 服务 API（配置见 config.js）
const AMAP_KEY = config.amap.key;
const AMAP_CITY = config.amap.city;
const AMAP_ADCODE = config.amap.adcode;

// 坐标格式化：高德要求小数点后不超过 6 位
function fmtCoord(coord) {
  const [lng, lat] = String(coord).split(',');
  return `${Number(lng).toFixed(6)},${Number(lat).toFixed(6)}`;
}

// 地铁路径规划 getLinePlan?origin=lng,lat&destination=lng,lat
app.get('/getLinePlan', async (req, res) => {
  try {
    const { origin, destination } = req.query;
    if (!origin || !destination) {
      return res.json({
        code: 400,
        message: '缺少参数 origin 或 destination',
        data: null,
      });
    }

    const url = new URL(
      'https://restapi.amap.com/v5/direction/transit/integrated',
    );
    url.searchParams.set('key', AMAP_KEY);
    url.searchParams.set('origin', fmtCoord(origin));
    url.searchParams.set('destination', fmtCoord(destination));
    url.searchParams.set('city1', AMAP_CITY);
    url.searchParams.set('city2', AMAP_CITY);
    url.searchParams.set('strategy', '7'); // 地铁优先模式
    url.searchParams.set('AlternativeRoute', '1'); // 只返回一条方案
    url.searchParams.set('show_fields', 'cost,polyline');

    const resp = await fetch(url);
    const amap = await resp.json();

    if (amap.status !== '1') {
      return res.json({
        code: 500,
        message: `高德接口错误: ${amap.info}`,
        data: null,
      });
    }

    const transit = amap.route?.transits?.[0];
    if (!transit) {
      return res.json({ code: 404, message: '未找到可达方案', data: null });
    }

    res.json({
      code: 200,
      message: '成功',
      data: {
        cost: transit.cost?.transit_fee ?? '',
        duration: transit.cost?.duration ?? '',
        distance: transit.distance ?? '',
        segments: transit.segments ?? [],
      },
    });
  } catch (err) {
    res.json({ code: 500, message: err.message, data: null });
  }
});

// 天气查询 getWeather?extensions=base|all&city=adcode
app.get('/getWeather', async (req, res) => {
  try {
    const extensions = req.query.extensions === 'all' ? 'all' : 'base';
    const city = req.query.city || AMAP_ADCODE;

    const url = new URL('https://restapi.amap.com/v3/weather/weatherInfo');
    url.searchParams.set('key', AMAP_KEY);
    url.searchParams.set('city', city);
    url.searchParams.set('extensions', extensions);

    const resp = await fetch(url);
    const amap = await resp.json();

    if (amap.status !== '1') {
      return res.json({
        code: 500,
        message: `高德接口错误: ${amap.info}`,
        data: null,
      });
    }

    // base 返回 lives 实况，all 返回 forecasts 预报
    const data = extensions === 'all' ? amap.forecasts?.[0] : amap.lives?.[0];
    if (!data) {
      return res.json({ code: 404, message: '未查询到天气数据', data: null });
    }

    res.json({ code: 200, message: '成功', data });
  } catch (err) {
    res.json({ code: 500, message: err.message, data: null });
  }
});

// 地铁线路数据 getLine
app.get('/getLine', async (req, res) => {
  try {
    const lines = await pool.query(
      'SELECT id, name, "basicPrice", length, xs, ys FROM line ORDER BY id',
    );
    const stations = await pool.query(
      'SELECT name, name_2, lon, lat, ischange, sort FROM station ORDER BY name_2, sort',
    );

    // 按线路名分组站点，组内按 sort 排序
    const stationMap = {};
    for (const s of stations.rows) {
      if (!stationMap[s.name_2]) stationMap[s.name_2] = [];
      stationMap[s.name_2].push({
        name: s.name,
        xy_coords: `${s.lon},${s.lat}`,
        peopleFlow: genPeopleFlow(s.ischange),
        isChange: s.ischange,
        sort: s.sort,
      });
    }

    // 按线路名中的数字排序：上海地铁1号线、上海地铁2号线……（无数字的排最后）
    const lineNo = (name) => {
      const m = name.match(/\d+/);
      return m ? parseInt(m[0], 10) : Infinity;
    };
    lines.rows.sort((a, b) => lineNo(a.name) - lineNo(b.name));

    const data = lines.rows.map((l) => ({
      id: l.id,
      name: l.name,
      basicPrice: l.basicPrice,
      length: String(l.length),
      stationList: stationMap[l.name] || [],
      xs: l.xs,
      ys: l.ys,
    }));

    res.json({ code: 200, message: '成功', data });
  } catch (err) {
    res.json({ code: 500, message: err.message, data: null });
  }
});

// 地铁站点信息查询 getStationInfo?name=站名
app.get('/getStationInfo', async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.json({ code: 400, message: '缺少参数 name', data: null });
    }

    const result = await pool.query(
      'SELECT name_2, ischange FROM station WHERE name = $1',
      [name],
    );
    if (result.rows.length === 0) {
      return res.json({ code: 404, message: '站点不存在', data: null });
    }

    // 同名站点出现在多条线路，去重后用 ; 拼接
    const lines = [...new Set(result.rows.map((r) => r.name_2))];
    res.json({
      code: 200,
      message: '成功',
      data: {
        address: lines.join(';'),
        peopleFlow: genPeopleFlow(
          result.rows.some((r) => r.ischange === 1) ? 1 : 0,
        ),
      },
    });
  } catch (err) {
    res.json({ code: 500, message: err.message, data: null });
  }
});

app.listen(PORT, () => {
  console.log(`Translation_BE server running at http://localhost:${PORT}`);
});
