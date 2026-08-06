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
 * 把播放器上报的位置限制在有效时间轴内。坏状态回调不能把 NaN/Infinity
 * 继续传给样式或原生 seek API；时长未知时统一回到 0。
 */
export const clampReplayPosition = (position: number, duration: number): number => {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return 0;
  return Math.max(0, Math.min(duration, position));
};

/** 返回控制条可直接使用的 0..100 百分比。 */
export const getReplayProgressPercent = (position: number, duration: number): number => {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return (clampReplayPosition(position, duration) / duration) * 100;
};

/**
 * 把点击/拖动的横坐标换算成回看位置。轨道以外的有限坐标会吸附到首尾；
 * 非有限坐标、零宽轨道或无效时长无法定位，返回 null。
 */
export const getReplayPositionFromTrack = (
  locationX: number,
  width: number,
  duration: number
): number | null => {
  if (
    !Number.isFinite(locationX) ||
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return null;
  }

  const ratio = Math.max(0, Math.min(1, locationX / width));
  return ratio * duration;
};

const REPLAY_BASE_SEEK_STEP_MS = 30_000;
const REPLAY_MEDIUM_SEEK_STEP_MS = 2 * 60_000;
const REPLAY_FAST_SEEK_STEP_MS = 5 * 60_000;

/**
 * 普通按键及长按连续定位的单步距离。长按 1 秒后加速到 2 分钟，3 秒后
 * 加速到 5 分钟；任何一步都不会超过当前有效时长。
 */
export const getReplayLongSeekStep = (duration: number, elapsed: number): number => {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const safeElapsed = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
  const step =
    safeElapsed >= 3_000
      ? REPLAY_FAST_SEEK_STEP_MS
      : safeElapsed >= 1_000
        ? REPLAY_MEDIUM_SEEK_STEP_MS
        : REPLAY_BASE_SEEK_STEP_MS;
  return Math.min(duration, step);
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

/**
 * 已排序分片表与节目窗口是否相交。二分定位首个仍可能覆盖窗口的分片，避免
 * 节目表每一行都从头扫描数万条短 HLS 分片。
 */
export const hasReplayCoverage = (
  sortedStarts: ReadonlyArray<number>,
  segmentDurationMs: number,
  windowStart: number,
  windowStop: number
): boolean => {
  if (
    sortedStarts.length === 0 ||
    !Number.isFinite(segmentDurationMs) ||
    segmentDurationMs <= 0 ||
    !Number.isFinite(windowStart) ||
    !Number.isFinite(windowStop) ||
    windowStop <= windowStart
  ) {
    return false;
  }

  let low = 0;
  let high = sortedStarts.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (sortedStarts[mid] + segmentDurationMs <= windowStart) low = mid + 1;
    else high = mid;
  }
  return low < sortedStarts.length && sortedStarts[low] < windowStop;
};
