import {
  clampReplayPosition,
  DEFAULT_REPLAY_CONTROL_INDEX,
  findReplayRateIndex,
  findReplayGuideIndex,
  getReplayLongSeekStep,
  getReplayPositionFromTrack,
  getReplayProgressPercent,
  hasReplayCoverage,
  moveReplayControlIndex,
  moveReplayRateIndex,
  REPLAY_PLAYBACK_RATES,
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

  describe("replay rate menu", () => {
    it("提供完整且固定顺序的倍率选项", () => {
      expect(REPLAY_PLAYBACK_RATES).toEqual([1, 1.25, 1.5, 2]);
    });

    it("按当前倍率定位选项，无效倍率回到 1 倍", () => {
      expect(findReplayRateIndex(1)).toBe(0);
      expect(findReplayRateIndex(1.5)).toBe(2);
      expect(findReplayRateIndex(3)).toBe(0);
      expect(findReplayRateIndex(Number.NaN)).toBe(0);
    });

    it("方向移动停在倍率列表首尾", () => {
      expect(moveReplayRateIndex(0, 1)).toBe(1);
      expect(moveReplayRateIndex(2, -1)).toBe(1);
      expect(moveReplayRateIndex(0, -1)).toBe(0);
      expect(moveReplayRateIndex(3, 1)).toBe(3);
      expect(moveReplayRateIndex(Number.NaN, 1)).toBe(1);
    });
  });

  describe("clampReplayPosition", () => {
    it("保留时间轴内的位置并钳制首尾越界", () => {
      expect(clampReplayPosition(30_000, 120_000)).toBe(30_000);
      expect(clampReplayPosition(-1, 120_000)).toBe(0);
      expect(clampReplayPosition(120_001, 120_000)).toBe(120_000);
      expect(clampReplayPosition(120_000, 120_000)).toBe(120_000);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      "无效位置 %s 安全回到 0",
      (position) => {
        expect(clampReplayPosition(position, 120_000)).toBe(0);
      }
    );

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      "无效时长 %s 安全回到 0",
      (duration) => {
        expect(clampReplayPosition(30_000, duration)).toBe(0);
      }
    );
  });

  describe("getReplayProgressPercent", () => {
    it("计算并钳制 0..100 的进度", () => {
      expect(getReplayProgressPercent(30_000, 120_000)).toBe(25);
      expect(getReplayProgressPercent(-1, 120_000)).toBe(0);
      expect(getReplayProgressPercent(120_000, 120_000)).toBe(100);
      expect(getReplayProgressPercent(180_000, 120_000)).toBe(100);
    });

    it("位置或时长损坏时不产生 NaN/Infinity 百分比", () => {
      expect(getReplayProgressPercent(Number.NaN, 120_000)).toBe(0);
      expect(getReplayProgressPercent(Number.POSITIVE_INFINITY, 120_000)).toBe(0);
      expect(getReplayProgressPercent(30_000, 0)).toBe(0);
      expect(getReplayProgressPercent(30_000, Number.NaN)).toBe(0);
      expect(getReplayProgressPercent(30_000, Number.POSITIVE_INFINITY)).toBe(0);
    });
  });

  describe("getReplayPositionFromTrack", () => {
    it("按轨道横坐标定位播放时间", () => {
      expect(getReplayPositionFromTrack(50, 200, 120_000)).toBe(30_000);
      expect(getReplayPositionFromTrack(0, 200, 120_000)).toBe(0);
      expect(getReplayPositionFromTrack(200, 200, 120_000)).toBe(120_000);
    });

    it("轨道外的有限坐标吸附到首尾", () => {
      expect(getReplayPositionFromTrack(-20, 200, 120_000)).toBe(0);
      expect(getReplayPositionFromTrack(250, 200, 120_000)).toBe(120_000);
    });

    it.each([
      [Number.NaN, 200, 120_000],
      [Number.POSITIVE_INFINITY, 200, 120_000],
      [50, Number.NaN, 120_000],
      [50, Number.POSITIVE_INFINITY, 120_000],
      [50, 0, 120_000],
      [50, -200, 120_000],
      [50, 200, Number.NaN],
      [50, 200, Number.POSITIVE_INFINITY],
      [50, 200, 0],
      [50, 200, -120_000],
    ])("无效参数 (%s, %s, %s) 返回 null", (locationX, width, duration) => {
      expect(getReplayPositionFromTrack(locationX, width, duration)).toBeNull();
    });
  });

  describe("getReplayLongSeekStep", () => {
    const longDuration = 20 * 60_000;

    it("普通按键和长按不足 1 秒使用 30 秒基准", () => {
      expect(getReplayLongSeekStep(longDuration, 0)).toBe(30_000);
      expect(getReplayLongSeekStep(longDuration, 999)).toBe(30_000);
    });

    it("在 1 秒和 3 秒边界分别加速到 2 分钟、5 分钟", () => {
      expect(getReplayLongSeekStep(longDuration, 1_000)).toBe(120_000);
      expect(getReplayLongSeekStep(longDuration, 2_999)).toBe(120_000);
      expect(getReplayLongSeekStep(longDuration, 3_000)).toBe(300_000);
      expect(getReplayLongSeekStep(longDuration, 30_000)).toBe(300_000);
    });

    it("单步不会超过有效时长", () => {
      expect(getReplayLongSeekStep(10_000, 0)).toBe(10_000);
      expect(getReplayLongSeekStep(60_000, 1_000)).toBe(60_000);
      expect(getReplayLongSeekStep(180_000, 3_000)).toBe(180_000);
    });

    it("无效或负 elapsed 回退普通 30 秒步长", () => {
      expect(getReplayLongSeekStep(longDuration, -1)).toBe(30_000);
      expect(getReplayLongSeekStep(longDuration, Number.NaN)).toBe(30_000);
      expect(getReplayLongSeekStep(longDuration, Number.POSITIVE_INFINITY)).toBe(30_000);
      expect(getReplayLongSeekStep(longDuration, Number.NEGATIVE_INFINITY)).toBe(30_000);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      "无效时长 %s 不产生定位步长",
      (duration) => {
        expect(getReplayLongSeekStep(duration, 3_000)).toBe(0);
      }
    );
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

  describe("hasReplayCoverage", () => {
    const starts = [1_000, 11_000, 21_000];

    it("找到与节目窗口相交的短分片", () => {
      expect(hasReplayCoverage(starts, 10_000, 10_500, 10_800)).toBe(true);
      expect(hasReplayCoverage(starts, 10_000, 20_500, 22_000)).toBe(true);
    });

    it("边界刚好相接不算相交", () => {
      expect(hasReplayCoverage(starts, 10_000, 31_000, 40_000)).toBe(false);
      expect(hasReplayCoverage(starts, 10_000, 0, 1_000)).toBe(false);
    });

    it("空覆盖和损坏时长安全返回 false", () => {
      expect(hasReplayCoverage([], 10_000, 0, 1_000)).toBe(false);
      expect(hasReplayCoverage(starts, 0, 0, 1_000)).toBe(false);
    });
  });
});
