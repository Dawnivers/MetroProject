/**
 * 上海地铁 1–18 号线「重点保障活动」数据集。
 *
 * ============================ 数据是怎么来的 ============================
 *
 * 不是编的：每一条都对应一个**真实存在的大型活动场所**，并且该场所**最近的地铁站
 * 必须是本项目库里已有的车站**（下面每条的 station 字段都能在 /getLine 返回的
 * stationList 里原样找到，面板就是按站名去库内取 xy_coords 的，写错就立不出光柱）。
 *
 * 场所 ↔ 车站的对应关系与「该场所确实需要地铁保障」这两件事，来源如下：
 *   · 国家会展中心（进博会）／国家会展中心站
 *     https://www.jiemian.com/video/AGQCNQhuB2YBMFVl.html
 *   · 上海国际赛车场（F1 中国大奖赛，单场约 23 万观众）／上海赛车场站
 *     https://m.gmw.cn/toutiao/2026-03/12/content_1304373624.htm
 *   · 梅赛德斯-奔驰文化中心（演唱会）／中华艺术宫站
 *     https://www.jfdaily.com.cn/sgh/detail?id=1725655
 *   · 豫园商城（豫园灯会、国庆大客流）／豫园站
 *     https://www.thepaper.cn/newsDetail_forward_30067070
 *     https://www.jfdaily.com/sgh/detail?id=4068334
 *   · 上海体育场/上海体育馆（演唱会、球赛）／上海体育场站、上海体育馆站
 *     https://nw.eastday.com/zq/zw/20260731/5e09a3393961288658509e9e271c2c5e.html
 *
 * 其余场所（迪士尼、龙华古寺、顾村公园、滴水湖、江湾体育场、浦东足球场、
 * 源深体育中心、东方体育中心、新国际博览中心、世博展览馆、朱家角、东方绿舟、
 * 上海野生动物园、新场古镇、七宝老街、佘山国家森林公园、桂林公园、上海动物园、
 * 上海自然博物馆、中共一大会址、各高校校庆、虹桥/上海南/上海火车站枢纽）
 * 本身就是本地大型客流点，对应车站都是同名或紧邻的既有车站，属常识性对应。
 *
 * **重要**：activity 文案统一写成「场所 + 保障事项」，具体时间(time)是**演示用**的
 * 典型时段（如演唱会 19:00 开场、进博会 08:30 开馆），不是从官方通告抄的精确时刻。
 * 要接真实业务数据时，把 time 换成接口字段即可，面板不用改。
 *
 * ============================ 字段约定 ============================
 *
 *   time      活动时段，面板卡片第一行
 *   place     场所名（人看的），面板卡片第二行
 *   station   地铁站名（程序用的），**必须与库内站名逐字一致**
 *   activity  保障事项，面板卡片第三行
 *
 * 与参考项目 staticData.js 的 activity 的差别：那边用 id 当**站点数组下标**
 * （换个线路就落错站），这里改成直接写站名 —— 站名是稳定的，下标不是。
 */

/** 每条线路的建议条数上限：面板一屏要装得下，不出滚动条 */
export const MAX_ACTIVITY_PER_LINE = 4;

/**
 * 线路（短名，如 '1号线'）→ 活动列表。
 * 一次大型活动只登记在**它实际使用的那条线上**；换乘站（如人民广场、龙华）
 * 会自然出现在多条线里，那是各自线路自己的保障任务，不算重复。
 */
export const SHMETRO_ACTIVITY = {
  '1号线': [
    { time: '07:00', place: '上海火车站', station: '上海火车站', activity: '春运返程高峰保障' },
    { time: '09:30', place: '上海马戏城', station: '上海马戏城', activity: '《时空之旅》演出客流保障' },
    { time: '18:00', place: '徐家汇商圈', station: '徐家汇', activity: '商圈大客流疏导' },
    { time: '21:30', place: '上海体育馆', station: '上海体育馆', activity: '大型演唱会散场保障' },
  ],

  '2号线': [
    { time: '06:30', place: '浦东国际机场', station: '浦东1号2号航站楼', activity: '暑运进出港客流保障' },
    { time: '08:30', place: '国家会展中心', station: '国家会展中心', activity: '中国国际进口博览会安保' },
    { time: '09:00', place: '陆家嘴金融城', station: '陆家嘴', activity: '陆家嘴论坛安保' },
    { time: '19:00', place: '外滩·南京东路', station: '南京东路', activity: '节假日外滩大客流管控' },
  ],

  '3号线': [
    { time: '07:30', place: '上海南站', station: '上海南站', activity: '铁路旅客接驳保障' },
    { time: '21:00', place: '虹口足球场', station: '虹口足球场', activity: '足球赛事散场保障' },
  ],

  '4号线': [
    { time: '08:00', place: '上海火车站', station: '上海火车站', activity: '节假日铁路接驳保障' },
    { time: '17:30', place: '世纪大道枢纽', station: '世纪大道', activity: '四线换乘大客流管控' },
    { time: '22:00', place: '上海体育场', station: '上海体育场', activity: '大型演出散场疏导' },
  ],

  '5号线': [
    { time: '07:30', place: '莘庄枢纽', station: '莘庄', activity: '1/5 号线换乘客流管控' },
    { time: '09:00', place: '上海交通大学（闵行）', station: '东川路', activity: '校庆返校客流保障' },
    { time: '19:00', place: '九棵树未来艺术中心', station: '望园路', activity: '演出散场客流保障' },
  ],

  '6号线': [
    { time: '17:30', place: '世纪大道枢纽', station: '世纪大道', activity: '晚高峰换乘客流管控' },
    { time: '18:00', place: '东方体育中心', station: '东方体育中心', activity: '大型赛事安保' },
    { time: '19:30', place: '源深体育中心', station: '源深体育中心', activity: '赛事/演出客流保障' },
  ],

  '7号线': [
    { time: '08:30', place: '上海新国际博览中心', station: '花木路', activity: '上海车展安保' },
    { time: '09:00', place: '顾村公园', station: '顾村公园', activity: '上海樱花节客流保障' },
    { time: '09:30', place: '上海大学', station: '上海大学', activity: '校庆暨毕业季保障' },
  ],

  '8号线': [
    { time: '15:00', place: '大世界', station: '大世界', activity: '节假日客流管控' },
    { time: '18:00', place: '人民广场', station: '人民广场', activity: '三线换乘大客流管控' },
    { time: '19:00', place: '梅赛德斯-奔驰文化中心', station: '中华艺术宫', activity: '演唱会大客流保障' },
    { time: '21:00', place: '虹口足球场', station: '虹口足球场', activity: '足球赛事散场保障' },
  ],

  '9号线': [
    { time: '08:00', place: '佘山国家森林公园', station: '佘山', activity: '登高节客流保障' },
    { time: '09:00', place: '松江大学城', station: '松江大学城', activity: '开学季返校客流保障' },
    { time: '10:00', place: '七宝老街', station: '七宝', activity: '庙会客流保障' },
  ],

  '10号线': [
    { time: '09:00', place: '同济大学', station: '同济大学', activity: '校庆保障' },
    { time: '09:30', place: '上海动物园', station: '上海动物园', activity: '节假日亲子客流保障' },
    { time: '17:00', place: '豫园商城', station: '豫园', activity: '豫园灯会安保' },
    { time: '20:00', place: '江湾体育场', station: '江湾体育场', activity: '演出散场保障' },
  ],

  '11号线': [
    { time: '08:00', place: '上海迪士尼度假区', station: '迪士尼', activity: '暑期大客流保障' },
    { time: '12:00', place: '上海国际赛车场', station: '上海赛车场', activity: 'F1 中国大奖赛安保' },
    { time: '14:00', place: '上海游泳馆', station: '上海游泳馆', activity: '游泳赛事保障' },
    { time: '22:00', place: '龙华古寺', station: '龙华', activity: '跨年撞钟安保' },
  ],

  '12号线': [
    { time: '10:00', place: '北外滩国际客运中心', station: '国际客运中心', activity: '邮轮母港客流保障' },
    { time: '18:30', place: '南京西路商圈', station: '南京西路', activity: '商圈大客流疏导' },
    { time: '22:00', place: '龙华古寺', station: '龙华', activity: '跨年撞钟安保' },
  ],

  '13号线': [
    { time: '08:30', place: '中共一大会址', station: '一大会址·新天地', activity: '建党纪念日安保' },
    { time: '09:00', place: '上海世博展览馆', station: '世博大道', activity: '大型展会安保' },
    { time: '10:00', place: '上海自然博物馆', station: '自然博物馆', activity: '节假日客流管控' },
  ],

  '14号线': [
    { time: '08:30', place: '中共一大会址', station: '一大会址·黄陂南路', activity: '建党纪念日安保' },
    { time: '09:00', place: '陆家嘴金融城', station: '陆家嘴', activity: '金融论坛安保' },
    { time: '17:00', place: '豫园商城', station: '豫园', activity: '豫园灯会安保' },
    { time: '19:00', place: '浦东足球场', station: '浦东足球场', activity: '中超赛事安保' },
  ],

  '15号线': [
    { time: '07:30', place: '上海南站', station: '上海南站', activity: '铁路接驳保障' },
    { time: '09:00', place: '顾村公园', station: '顾村公园', activity: '上海樱花节客流保障' },
    { time: '09:00', place: '华东理工大学', station: '华东理工大学', activity: '校庆保障' },
    { time: '10:00', place: '桂林公园', station: '桂林公园', activity: '桂花节客流保障' },
  ],

  '16号线': [
    { time: '09:00', place: '上海野生动物园', station: '野生动物园', activity: '节假日亲子客流保障' },
    { time: '10:00', place: '新场古镇', station: '新场', activity: '古镇旅游节保障' },
    { time: '18:00', place: '滴水湖', station: '滴水湖', activity: '烟花秀暨音乐节安保' },
  ],

  '17号线': [
    { time: '08:30', place: '国家会展中心', station: '国家会展中心', activity: '中国国际进口博览会安保' },
    { time: '09:00', place: '东方绿舟', station: '东方绿舟', activity: '青少年活动保障' },
    { time: '10:00', place: '朱家角古镇', station: '朱家角', activity: '古镇旅游节保障' },
  ],

  '18号线': [
    { time: '08:30', place: '上海新国际博览中心', station: '龙阳路', activity: '大型展会安保' },
    { time: '09:00', place: '复旦大学', station: '复旦大学', activity: '校庆保障' },
    { time: '09:30', place: '上海财经大学', station: '上海财经大学', activity: '校庆保障' },
  ],
};

/**
 * 取某条线路的活动列表。
 * @param {string} shortLineName 线路短名，如 '1号线'
 * @returns {object[]} 找不到时返回空数组（面板显示「暂无」而不是崩）
 */
export const activityOfLine = (shortLineName) =>
  SHMETRO_ACTIVITY[shortLineName] ?? [];

/** 全部活动条数，供面板抬头显示 */
export const totalActivityCount = Object.values(SHMETRO_ACTIVITY).reduce(
  (sum, list) => sum + list.length,
  0,
);
