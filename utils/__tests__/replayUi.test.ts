import {
  DEFAULT_REPLAY_CONTROL_INDEX,
  findReplayGuideIndex,
  moveReplayControlIndex,
} from "../replayUi";

describe("replayUi", () => {
  describe("moveReplayControlIndex", () => {
    it("在控制条边界内移动", () => {
      expect(moveReplayControlIndex(2, -1)).toBe(1);
      expect(moveReplayControlIndex(2, 1)).toBe(3);
    });

    it("不会越过首尾控制项", () => {
      expect(moveReplayControlIndex(0, -1)).toBe(0);
      expect(moveReplayControlIndex(5, 1)).toBe(5);
    });

    it("损坏的光标值回退到暂停键", () => {
      expect(moveReplayControlIndex(Number.NaN, 1)).toBe(DEFAULT_REPLAY_CONTROL_INDEX);
    });
  });

  describe("findReplayGuideIndex", () => {
    const programmes = [
      { start: 100, stop: 200 },
      { start: 200, stop: 300 },
      { start: 300, stop: 400 },
    ];

    it("回看会话优先定位当前播放节目", () => {
      expect(findReplayGuideIndex(programmes, 350, 0)).toBe(0);
    });

    it("普通打开定位正在播的节目", () => {
      expect(findReplayGuideIndex(programmes, 250)).toBe(1);
    });

    it("没有正在播的节目时定位最后一个已播节目", () => {
      expect(findReplayGuideIndex(programmes, 500)).toBe(2);
    });

    it("节目都未开播时定位第一条", () => {
      expect(findReplayGuideIndex(programmes, 50)).toBe(0);
    });

    it("空节目表返回 -1", () => {
      expect(findReplayGuideIndex([], 250)).toBe(-1);
    });
  });
});
