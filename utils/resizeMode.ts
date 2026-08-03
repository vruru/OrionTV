/**
 * 画面比例（resizeMode）的统一类型、标签与循环切换逻辑。
 * 直播 TV 快捷键、点播控制条按钮、设置页三处共用。
 */
import { ResizeMode } from "expo-av";

export type VideoResizeMode = "contain" | "cover" | "stretch";

export const RESIZE_MODE_ORDER: VideoResizeMode[] = ["contain", "cover", "stretch"];

export const RESIZE_MODE_LABELS: Record<VideoResizeMode, string> = {
  contain: "原始比例",
  cover: "裁剪填充",
  stretch: "拉伸满屏",
};

export const RESIZE_MODE_DESCRIPTIONS: Record<VideoResizeMode, string> = {
  contain: "保持画面原始比例，四周可能留黑边",
  cover: "填满屏幕，超出的画面被裁掉",
  stretch: "强行拉伸填满屏幕，画面可能变形",
};

/** 映射到 expo-av 的 ResizeMode 常量 */
export const toAvResizeMode = (mode: VideoResizeMode): ResizeMode => {
  switch (mode) {
    case "cover":
      return ResizeMode.COVER;
    case "stretch":
      return ResizeMode.STRETCH;
    case "contain":
    default:
      return ResizeMode.CONTAIN;
  }
};

/** 循环切换到下一个比例模式 */
export const nextResizeMode = (mode: VideoResizeMode): VideoResizeMode => {
  const idx = RESIZE_MODE_ORDER.indexOf(mode);
  return RESIZE_MODE_ORDER[(idx + 1) % RESIZE_MODE_ORDER.length];
};

/** 兼容历史脏数据：非法值回退到 contain */
export const normalizeResizeMode = (raw: unknown): VideoResizeMode =>
  RESIZE_MODE_ORDER.includes(raw as VideoResizeMode) ? (raw as VideoResizeMode) : "contain";
