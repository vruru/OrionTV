export const REPLAY_CONTROL_COUNT = 6;
export const DEFAULT_REPLAY_CONTROL_INDEX = 2;

/**
 * TV 回看控制条使用 JS 自管光标，原生焦点始终留在播放器锚点上。
 * 这样方向键不会在播放器状态更新时触发 Android FocusFinder 重建焦点树。
 */
export const moveReplayControlIndex = (current: number, delta: number): number => {
  if (!Number.isFinite(current)) return DEFAULT_REPLAY_CONTROL_INDEX;
  return Math.max(0, Math.min(REPLAY_CONTROL_COUNT - 1, current + delta));
};

/**
 * 打开节目表时选中哪一条：回看会话优先定位当前播放节目；普通打开则定位
 * 正在播的节目，其次最后一个已播节目，最后才是第一条未来节目。
 */
export const findReplayGuideIndex = (
  programmes: ReadonlyArray<{ start: number; stop: number }>,
  now: number,
  preferredIndex?: number
): number => {
  if (programmes.length === 0) return -1;
  if (
    preferredIndex !== undefined &&
    Number.isInteger(preferredIndex) &&
    preferredIndex >= 0 &&
    preferredIndex < programmes.length
  ) {
    return preferredIndex;
  }

  const onAir = programmes.findIndex((programme) => programme.start <= now && now < programme.stop);
  if (onAir !== -1) return onAir;

  for (let index = programmes.length - 1; index >= 0; index--) {
    if (programmes[index].stop <= now) return index;
  }

  return 0;
};
