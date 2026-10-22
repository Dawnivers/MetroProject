import { useStationState } from '@/stores/stationState';
import { hideStationByName } from '@/cesiumTools/lineAndpoints/points/setpoints';

/**
 * 全局站点标记（光锥 + 底圈 + 站名气泡）的「一键清场 / 原样还原」。
 *
 * 为什么抽成公共件：路径规划和站控措施都要「进入模式先把满屏站点收掉」——
 * 前者怕站点标记盖住路线，后者怕站名气泡和措施气泡叠在一起。
 * 两处各写一遍的话，快照字段或还原顺序迟早会走样。
 *
 * 规则只有一条：**只动三维对象的 show / isDisplay，不碰**
 * `checked / lineStationOn / forced` 那套状态机 —— 那三个开关归 StationPanel 管，
 * 这里改了就会和「N/M 显示」的计数打架。
 */
export function useStationSnapshot() {
  const { stationObjs } = useStationState();

  /** stationObj → 进入模式前的显隐（按对象本身做键，换线重渲染后自然失效） */
  const saved = new Map();

  /** 收掉摊在屏幕上的站点详情卡，否则卡片会浮在模式效果上面 */
  const closeDetailCards = () => {
    stationObjs.forEach((station) => station.popup?.removeQueryPopup?.());
  };

  const hideAll = () => {
    closeDetailCards();
    stationObjs.forEach((station) => {
      if (saved.has(station)) return;
      saved.set(station, {
        cone: station.conePrimitve?.show ?? true,
        circle: station.bottomCircleEntity?.show ?? true,
        popup: station.popup?.isDisplay ?? true,
      });
    });
    hideStationByName(
      stationObjs,
      stationObjs.map((station) => station.name),
      false,
    );
  };

  const restore = () => {
    stationObjs.forEach((station) => {
      const prev = saved.get(station);
      if (!prev) return;
      if (station.conePrimitve) station.conePrimitve.show = prev.cone;
      if (station.bottomCircleEntity) station.bottomCircleEntity.show = prev.circle;
      if (station.popup) station.popup.isDisplay = prev.popup;
      saved.delete(station);
    });
  };

  return { stationObjs, hideAll, restore };
}

export default useStationSnapshot;
