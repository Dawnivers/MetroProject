// 统一配置：服务端口 + 数据库 + 高德 API
//
// 密钥一律走环境变量，源码里不留明文：
//   · 本地开发：把 Translation_BE/.env（已被 .gitignore 忽略）填好即可，
//     下面会自己把它加载进 process.env，所以 `node index.js` 直接就能跑；
//   · 部署时：由运行环境注入同名环境变量（.env 可以不存在）。
//
// 模板见同目录 .env.example。缺 AMAP_KEY 时下面会打一条明确的警告，
// 否则表现是「路径规划/天气接口报 高德接口错误: INVALID_USER_KEY」，很难查。
const { join } = require('node:path');

// Node ≥ 20.12 / 21.7 自带 loadEnvFile，不需要 dotenv。
// 文件不存在（CI、别人的机器）会抛错，直接忽略 —— 用系统环境变量即可。
try {
  process.loadEnvFile(join(__dirname, '.env'));
} catch {
  /* 没有 .env：走系统环境变量 */
}

const { env } = process;

const amapKey = env.AMAP_KEY ?? '';

if (!amapKey) {
  console.warn(
    '[config] 未配置 AMAP_KEY：路径规划与天气接口会失败。\n' +
      '         在 Translation_BE/.env 里写 AMAP_KEY=<高德 Web服务 Key>（模板见 .env.example）。',
  );
}

module.exports = {
  // 服务监听端口
  port: Number(env.PORT) || 8092,

  // 本地 PostgreSQL
  db: {
    user: env.PGUSER ?? 'postgres',
    host: env.PGHOST ?? 'localhost',
    database: env.PGDATABASE ?? 'Translation',
    password: env.PGPASSWORD ?? '',
    port: Number(env.PGPORT) || 5432,
  },

  // 高德 Web 服务 API
  amap: {
    key: amapKey, // 高德开放平台申请的 Web服务 类型 Key
    city: env.AMAP_CITY ?? '021', // 上海 citycode（本项目固定同城规划）
    adcode: env.AMAP_ADCODE ?? '310000', // 上海 adcode（天气查询接口只认 adcode）
  },
};
