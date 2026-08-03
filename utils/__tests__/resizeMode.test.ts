import { ResizeMode } from "expo-av";
import {
  nextResizeMode,
  normalizeResizeMode,
  toAvResizeMode,
  RESIZE_MODE_ORDER,
  RESIZE_MODE_LABELS,
} from "../resizeMode";

describe("resizeMode", () => {
  describe("nextResizeMode", () => {
    it("应按 contain → cover → stretch → contain 循环", () => {
      expect(nextResizeMode("contain")).toBe("cover");
      expect(nextResizeMode("cover")).toBe("stretch");
      expect(nextResizeMode("stretch")).toBe("contain");
    });

    it("所有模式都在循环表里且有中文标签", () => {
      for (const mode of RESIZE_MODE_ORDER) {
        expect(RESIZE_MODE_LABELS[mode]).toBeTruthy();
      }
      expect(RESIZE_MODE_ORDER).toHaveLength(3);
    });
  });

  describe("toAvResizeMode", () => {
    it("应映射到 expo-av 常量", () => {
      expect(toAvResizeMode("contain")).toBe(ResizeMode.CONTAIN);
      expect(toAvResizeMode("cover")).toBe(ResizeMode.COVER);
      expect(toAvResizeMode("stretch")).toBe(ResizeMode.STRETCH);
    });
  });

  describe("normalizeResizeMode", () => {
    it("合法值原样返回", () => {
      expect(normalizeResizeMode("cover")).toBe("cover");
    });

    it("历史脏数据回退到 contain", () => {
      expect(normalizeResizeMode("weird")).toBe("contain");
      expect(normalizeResizeMode(undefined)).toBe("contain");
      expect(normalizeResizeMode(123)).toBe("contain");
    });
  });
});
