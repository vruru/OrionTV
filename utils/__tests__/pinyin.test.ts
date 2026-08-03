import { getFirstLetters, matchChannelSearch } from "../pinyin";

describe("pinyin", () => {
  describe("getFirstLetters", () => {
    it("应该提取中文首字母", () => {
      expect(getFirstLetters("北京卫视")).toBe("bjws");
      expect(getFirstLetters("湖南卫视")).toBe("hnws");
    });

    it("英文与数字应保留原字符", () => {
      expect(getFirstLetters("CCTV-1")).toBe("cctv-1");
      expect(getFirstLetters("CCTV1综合")).toBe("cctv1zh");
    });

    it("应该走缓存且结果一致", () => {
      const a = getFirstLetters("东方卫视");
      const b = getFirstLetters("东方卫视");
      expect(a).toBe(b);
      expect(a).toBe("dfws");
    });
  });

  describe("matchChannelSearch", () => {
    it("空关键词匹配一切", () => {
      expect(matchChannelSearch("北京卫视", "")).toBe(true);
      expect(matchChannelSearch("北京卫视", "   ")).toBe(true);
    });

    it("名称原文包含即命中（不区分大小写）", () => {
      expect(matchChannelSearch("CCTV-1 综合", "cctv")).toBe(true);
      expect(matchChannelSearch("北京卫视", "北京")).toBe(true);
    });

    it("拼音首字母命中", () => {
      expect(matchChannelSearch("北京卫视", "bj")).toBe(true);
      expect(matchChannelSearch("北京卫视", "bjws")).toBe(true);
      expect(matchChannelSearch("湖南卫视", "hnws")).toBe(true);
    });

    it("全拼命中（>=3 字符）", () => {
      expect(matchChannelSearch("北京卫视", "beijing")).toBe(true);
    });

    it("短关键词不做全拼匹配，避免跨字边界误命中", () => {
      // "sh" 会命中全拼 "weiSHi"，但短关键词应只走名称/首字母
      expect(matchChannelSearch("北京卫视", "sh")).toBe(false);
    });

    it("不相关关键词不命中", () => {
      expect(matchChannelSearch("北京卫视", "sh")).toBe(false);
      expect(matchChannelSearch("CCTV-1", "hnws")).toBe(false);
    });
  });
});
