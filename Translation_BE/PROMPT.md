# 智慧地铁项目后端搭建提示词（Translation_BE）

## 技术栈与结构

- Node.js + Express，端口 8092（写进 config.js），启用 cors；依赖仅 express、pg、cors（Node 18+ 自带 fetch，勿装 axios）
- 仅两个源码文件：
  - config.js：统一配置（服务端口 + 数据库 + 高德 API）
  - index.js：连接池 + 全部路由，配置一律从 config.js 引用

## 数据库（本地 PostgreSQL 14，勿改表结构）

库名 Translation，用户 postgres，密码 <PGPASSWORD>，端口 5432

- line：id(int4 PK自增)、name(varchar50 NOT NULL UNIQUE 如"上海地铁13号线")、basicPrice(varchar10 起步价)、length(float8 km)、xs(text 逗号分隔经度串)、ys(text 逗号分隔纬度串)
- station：id、name(站名)、name_2(所属线路名=line.name 逻辑外键)、lon/lat(float8)、ischange(int4 0普通/1换乘)、sort(int4 站序)

## 统一响应格式

{ code: 200成功/400缺参/404无数据/500错误, message, data }

## 接口

### GET /getLine —— 线路+嵌套站点

- SQL：line 按 id；station 按 name_2, sort；JS 按 name_2 分组
- 每条线路：{ id, name, basicPrice, length: String(length), stationList, xs, ys }
- stationList 元素：{ name, xy_coords: "lon,lat", peopleFlow, isChange: ischange, sort }，严格按 sort 升序
- peopleFlow 为接口层随机模拟（换乘站 300~999，普通站 50~299），不动数据库

### GET /getStationInfo?name=站名

- 查 station WHERE name=$1（取 name_2, ischange）
- data: { address: 去重后 name_2 用";"拼接, peopleFlow: 同上随机，任一 ischange=1 按换乘站范围 }
- 缺参 400，站名不存在 404

### GET /getLinePlan?origin=经度,纬度&destination=经度,纬度

- 参数为字符串 "lng,lat"，经度在前；服务端用 Number(x).toFixed(6) 截断（高德硬性要求≤6位小数）
- 服务端调高德 v5 公交规划 https://restapi.amap.com/v5/direction/transit/integrated，参数：
  key、origin、destination、city1=021、city2=021、strategy=7(地铁优先)、AlternativeRoute=1、show_fields=cost,polyline
- 高德 status!=='1' → code 500, message=`高德接口错误: ${info}`
- 成功取 route.transits[0] 拍平：{ cost: transit_fee||'', duration: cost.duration||'', distance, segments }；无方案 404

### GET /getWeather?extensions=base|all&city=adcode —— 天气查询

- 高德 v3 天气接口 https://restapi.amap.com/v3/weather/weatherInfo，参数：key、city、extensions
- extensions=base(默认，实况 lives[0])/all(预报 forecasts[0] 含 4 天 casts)；city 默认上海 adcode 310000（该接口只认 adcode，不认 citycode 021）
- 高德 status!=='1' → code 500, message=`高德接口错误: ${info}`；无数据 404

## config.js 结构

```js
module.exports = {
  port: 8092, // 服务监听端口
  db: {
    user: 'postgres',
    host: 'localhost',
    database: 'Translation',
    password: '<PGPASSWORD>',
    port: 5432,
  },
  amap: { key: '高德Web服务类型Key', city: '021', adcode: '310000' }, // 上海 citycode 与 adcode
};
```

## 踩坑记录（务必遵守）

1. "basicPrice" 驼峰列名，SQL 必须写 "basicPrice" 双引号，否则 PG 折叠小写报"字段不存在"
2. 高德 Key 必须是"Web服务"类型，JSAPI 类型会报 USERKEY_PLAT_NOMATCH
3. 高德天气接口只认 adcode（310000），不认 citycode（021）；路径规划接口 v5 用 citycode
4. 库里没有的字段（人流量等）一律接口层模拟，不修改表结构

## 僵尸进程排查（Windows 环境高发，务必掌握）

症状：接口行为与最新代码不符——新增路由报 `Cannot GET /xxx`、已删除的字段仍出现在响应里、排序/逻辑改动"不生效"。
原因：旧的 node 进程残留并占用 8092，新进程绑定失败或请求被旧进程接走，响应的是旧代码。

排查步骤（重启服务前必做）：

```powershell
netstat -ano | findstr :8092   # 1. 找 LISTENING 状态行的 PID（最后一列）
taskkill /F /PID <pid>         # 2. tasklist /FI "PID eq <pid>" 确认是 node.exe 后强杀
netstat -ano | findstr :8092   # 3. 再次确认无输出（端口 free）才启动新服务
```

判断口诀：**只要"响应与代码不符"，先怀疑僵尸进程，再排查代码。**

## 验证样例

- getLine：应返回 18 条线路，13号线 stationList 前3站 金运路→金沙江西路→丰庄
- getLinePlan：origin=121.316623,31.242752&destination=121.389619,31.233608（13号线 金运路→大渡河路）