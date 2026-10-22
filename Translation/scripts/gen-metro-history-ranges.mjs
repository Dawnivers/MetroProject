/**
 * 重新生成 src/config/shmetroHistory.js 里的 range: [lo, hi]。
 *
 * 为什么需要它：range 是**库内 stationList 按 sort 排序后的 1 基下标**，
 * 一旦后端线路/站点数据变动（增删站、改 sort、改站名），全部 18 条线的区间
 * 就会整体错位。这个脚本把「里程碑文案 → 区间」的推导固化下来，改完数据重跑即可。
 *
 * 用法（需要后端 Translation_BE 已在 8092 运行）：
 *   node scripts/gen-metro-history-ranges.mjs            # 重写数据文件
 *   node scripts/gen-metro-history-ranges.mjs --check    # 只校验，有差异则退出码 1
 *
 * 里程碑的 time / date / text 由「已存在的数据文件」提供（人工维护、不覆盖）；
 * 本脚本只重算 range 字段。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'src/config/shmetroHistory.js');
const API = 'http://127.0.0.1:8092/getLine';
const CHECK_ONLY = process.argv.includes('--check');

/** 站名对照：里程碑文案里的写法 → 库内写法 */
const ALIAS = {
  虹梅路: '锦江乐园', // 2001-05 改名
  东方路: '世纪大道', // 现名世纪大道
  徐泾东: '蟠祥路・国家会计学院', // 库内把西端合并成一个站
  蟠祥路: '蟠祥路・国家会计学院',
  浦东国际机场: '浦东1号2号航站楼',
  松江南站: '上海松江站',
  江湾新城: '新江湾城', // 18 号线之外，10 号线 2020 年里程碑的写法
  新天地: '一大会址·新天地',
  长青路: '长清路',
};

/** 库内没有的支线终点 → 用该支线在主线上的分岔站代替 */
const JUNCTION = {
  闵行开发区: ['东川路', '5号线闵行开发区支线，分岔于东川路'],
  航中路: ['龙溪路', '10号线航中路支线，分岔于龙溪路'],
  嘉定北: ['嘉定新城', '11号线嘉定北支线，分岔于嘉定新城'],
};

/** 环线闭合的里程碑：不是延伸，而是首尾相接 */
const RING = /环线运营/;

const { SH_METRO_HISTORY } = await import(pathToFileURL(TARGET).href);

const res = await fetch(API).then((r) => r.json()).catch(() => null);
if (!res) {
  console.error(`拉不到 ${API} —— 请先启动后端 Translation_BE（node index.js，8092）`);
  process.exit(2);
}
const lines = Array.isArray(res) ? res : (res.data ?? res.rows ?? []);
const byNo = new Map();
for (const l of lines) {
  const n = Number(String(l.name).match(/(\d{1,2})\s*号线/)?.[1]);
  const st = (l.stationList || []).slice().sort((a, b) => Number(a.sort) - Number(b.sort));
  byNo.set(n, { count: st.length, sortOf: new Map(st.map((s) => [s.name, Number(s.sort)])) });
}

const problems = [];
const out = {};

for (let n = 1; n <= 18; n++) {
  const info = byNo.get(n);
  if (!info) { problems.push(`${n}号线：接口里没有这条线`); continue; }
  const { count, sortOf } = info;
  const resolve = (raw) => {
    const k = String(raw).trim();
    if (sortOf.has(k)) return sortOf.get(k);
    if (ALIAS[k] && sortOf.has(ALIAS[k])) return sortOf.get(ALIAS[k]);
    if (JUNCTION[k] && sortOf.has(JUNCTION[k][0])) return sortOf.get(JUNCTION[k][0]);
    return null;
  };

  let lo = null;
  let hi = null;
  const rows = [];
  for (const m of SH_METRO_HISTORY[n] || []) {
    let names = [];
    let ring = false;
    const pair = m.text.match(/^(.+?)(?:至|~)(.+?)(?:开通|贯通)/);
    if (pair) names = [pair[1], pair[2]];
    else if (RING.test(m.text)) { ring = true; lo = 1; hi = count; }
    else {
      const single = m.text.match(/^(.+?)开通/);
      if (single) names = single[1].split(/[、,，]/);
    }
    if (!ring) {
      for (const raw of names) {
        const s = resolve(raw);
        if (s == null) { problems.push(`${n}号线 ${m.time}：「${raw}」在库内找不到对应站`); continue; }
        lo = lo === null ? s : Math.min(lo, s);
        hi = hi === null ? s : Math.max(hi, s);
      }
    }
    if (lo === null) { problems.push(`${n}号线 ${m.time}：「${m.text}」整条落不到主线`); continue; }
    if (m.range && (m.range[0] !== lo || m.range[1] !== hi)) {
      problems.push(`${n}号线 ${m.time}：区间变了 [${m.range}] → [${lo}, ${hi}]`);
    }
    rows.push({ ...m, range: [lo, hi] });
  }
  out[n] = rows;
}

if (problems.length) {
  console.log('=== 与现有数据文件的差异 / 需要人工确认 ===');
  for (const p of problems) console.log('  ' + p);
  console.log('\n（没写文件。确认上面的差异是预期内的，再删掉对应行的 range 重跑，或直接改数据文件。）');
  process.exit(1);
}

const head = `/**
 * 上海地铁 1–18 号线建设历程（里程碑精简版 + 已开通站区间）。
 *
 * ⚠ 本文件的 range 字段由 scripts/gen-metro-history-ranges.mjs 生成，
 *   库内站点数据一变就会整体错位；改完线路数据请重跑该脚本（--check 只校验）。
 *   下面的注释由该脚本输出，手改会被覆盖。
 *
 * ── 日期来源（双源交叉核对）────────────────────────────────
 *   · 主源：china-emu.cn 各线路页「发展历程」表
 *     https://www.china-emu.cn/UrbanRails/Line/3100<两位线号>/ （2026-10 抓取）
 *   · 校验：Wikidata 各线路条目 P1619「正式开通日期」
 *     上海地铁系统 = wd:Q462201。18 条里 16 条首通日期完全一致；2 条口径不同，
 *     保留主源的分段口径 —— 2 号线（本站 1999-09-20 通车 / Wikidata 记 2000-06-11
 *     正式运营，其 P571 正是 1999-09-20）、13 号线（本站首条 2010-04-20 世博专线段
 *     / Wikidata 记 2012-12-30 金运路至金沙江路）。
 *   · 已剔除：临时「停运 / 恢复运营」（世纪大道、海伦路、人民广场等改造停运）
 *     与「站名更改」—— 不属于建设里程碑。
 *
 * ── range: [lo, hi] 是什么 ─────────────────────────────────
 *   该里程碑达成时「已经开通」的连续站点区间，取的是**库内 stationList 按 sort
 *   排序后的 1 基下标**（也就是三维里根据 line1to18_2.json 画出来的那段折线，
 *   从数组头到数组尾正好是 sort 1 → max 的顺序）。
 *   逐条累积、只增不减，所以后一条的区间一定包含前一条。
 *
 *   画出「已开通的那一段」：
 *     const coords = line.positions                        // 一维 [lng,lat,lng,lat,…]
 *     const cur = coords.slice(lo0 * 2, (hi0 + 1) * 2)     // lo0/hi0 是 0 基站点下标
 *   ⚠ 注意 ×2：一维数组里一个站占两个数。另外 coords 是加密折线（1 号线 337 个
 *   坐标点对 28 个站，平均每站间 ~12 个点），所以站点下标必须先映射成坐标下标，
 *   不能直接拿去 slice。
 *
 * ── 为什么不是一个「方向开关」──────────────────────────────
 *   18 条线里有 6 条的首通段落在**线路中段**（1/2/9/10/11/13），是同时往两头长的，
 *   「从数组头长」或「从数组尾长」都表达不了；4 号线更是环线。用区间就没有这个问题：
 *     单头延伸 → 只有 lo 或 hi 动；两头延伸 → 两个都动；中段补站 → 区间不动。
 *
 * ── 站名对照（里程碑文案 → 库内写法）──────────────────────
${Object.entries(ALIAS).map(([k, v]) => ` *   ${k} → ${v}`).join('\n')}
 *
 * ── 库内缺支线终点，按「分岔站」折算到主线 ─────────────────
${Object.entries(JUNCTION).map(([k, [v, why]]) => ` *   ${k} → ${v}（${why}）`).join('\n')}
 *   ⚠ 这 3 条都恰好是所在线路的**首条里程碑**，折算后首通范围比史实略短
 *     （真实起点在支线端），但这是「只保留库内主线」下的最优近似。
 *
 * ── 其它口径───────────────────────────────────────────────
 *   · 2 号线库内只有一个西端站「蟠祥路・国家会计学院」，徐泾东（2010-03）与
 *     蟠祥路（2025-11）两条里程碑都落到它 sort=1 上，区间不变。
 *   · 4 号线 2007-12「环线运营」是**首尾闭合**，不是简单延伸，range 直接写 [1, ${byNo.get(4)?.count ?? 26}]；
 *     接动画时这条要单独按「绕圈闭合」处理，不能按区间扩张处理。
 *   · 14/15 号线 2021 年一次性开通，各只有 1 条里程碑，range 就是全线。
 */`;

const body = Object.keys(out)
  .map(Number)
  .sort((a, b) => a - b)
  .map((n) => {
    const rows = out[n]
      .map((m) => `    { time: '${m.time}', date: '${m.date}', text: '${m.text}', range: [${m.range[0]}, ${m.range[1]}] },`)
      .join('\n');
    return `  ${n}: [\n${rows}\n  ],`;
  })
  .join('\n');

const tail = `
/** 从「上海地铁14号线」这类线路名里取出线号，取不到返回 null */
export const lineNumberOf = (name) => {
  const m = String(name ?? '').match(/(\\d{1,2})\\s*号线/);
  return m ? Number(m[1]) : null;
};

/** 取某条线的建设历程；没有收录的线路返回空数组 */
export const historyOfLine = (name) => {
  const n = lineNumberOf(name);
  return (n && SH_METRO_HISTORY[n]) || [];
};
`;

const next = `${head}\n\nexport const SH_METRO_HISTORY = {\n${body}\n};\n${tail}`;
const cur = fs.readFileSync(TARGET, 'utf8');

if (next === cur) {
  console.log('✓ 与库内数据一致，无需改动');
  process.exit(0);
}
if (CHECK_ONLY) {
  console.log('✗ 生成结果与文件不一致（库内站点数据可能已变动），重跑不带 --check 即可更新');
  process.exit(1);
}
fs.writeFileSync(TARGET, next, 'utf8');
console.log(`✓ 已重写 ${path.relative(ROOT, TARGET)}：18 条线 / ${Object.values(out).reduce((a, b) => a + b.length, 0)} 条里程碑`);
