import {
  parseXmltvTime,
  normalizeChannelName,
  parseEpgXml,
  getCurrentProgramme,
  findEpgChannelIdByName,
  buildEpgKeys,
  formatProgrammeTime,
  fetchEpg,
} from "../epg";

describe("epg", () => {
  describe("parseXmltvTime", () => {
    it("应该按 +0800 时区换算为 UTC epoch", () => {
      // 2026-08-03 20:00:00 +0800 == 2026-08-03 12:00:00 UTC
      expect(parseXmltvTime("20260803200000 +0800")).toBe(Date.UTC(2026, 7, 3, 12, 0, 0));
    });

    it("负时区应反向换算", () => {
      // 2026-08-03 20:00:00 -0500 == 2026-08-04 01:00:00 UTC
      expect(parseXmltvTime("20260803200000 -0500")).toBe(Date.UTC(2026, 7, 4, 1, 0, 0));
    });

    it("缺省时区应按 UTC 处理", () => {
      expect(parseXmltvTime("20260803200000")).toBe(Date.UTC(2026, 7, 3, 20, 0, 0));
    });

    it("非法输入返回 0", () => {
      expect(parseXmltvTime("not-a-time")).toBe(0);
      expect(parseXmltvTime("")).toBe(0);
    });
  });

  describe("normalizeChannelName", () => {
    it("应该忽略大小写、空格与横线", () => {
      expect(normalizeChannelName("CCTV-1")).toBe("cctv1");
      expect(normalizeChannelName("CCTV 1")).toBe("cctv1");
    });

    it("应该去掉画质与频道类后缀", () => {
      expect(normalizeChannelName("CCTV1高清")).toBe("cctv1");
      expect(normalizeChannelName("翡翠台 HD")).toBe("翡翠台");
      expect(normalizeChannelName("某频道 4K")).toBe("某");
    });

    it("前后空格与下划线也应去掉", () => {
      expect(normalizeChannelName(" 凤凰_卫视 ")).toBe("凤凰");
    });
  });

  // now 固定为 2026-08-03 12:00:00 UTC，窗口 = [11:00, 次日 12:00)
  const NOW = Date.UTC(2026, 7, 3, 12, 0, 0);
  const xmltvTime = (ms: number) => {
    const d = new Date(ms);
    const p = (n: number) => n.toString().padStart(2, "0");
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(
      d.getUTCMinutes()
    )}${p(d.getUTCSeconds())} +0000`;
  };

  const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="cctv1">
    <display-name lang="zh">CCTV1</display-name>
  </channel>
  <channel id="hunan">
    <display-name lang="zh">湖南卫视</display-name>
  </channel>
  <programme start="${xmltvTime(NOW - 3600_000)}" stop="${xmltvTime(NOW + 1800_000)}" channel="cctv1">
    <title lang="zh">新闻联播重播</title>
  </programme>
  <programme start="${xmltvTime(NOW + 1800_000)}" stop="${xmltvTime(NOW + 5400_000)}" channel="cctv1">
    <title lang="zh">黄金剧场</title>
  </programme>
  <programme start="${xmltvTime(NOW - 6 * 3600_000)}" stop="${xmltvTime(NOW - 5 * 3600_000)}" channel="cctv1">
    <title lang="zh">过期节目不应保留</title>
  </programme>
  <programme start="${xmltvTime(NOW + 30 * 3600_000)}" stop="${xmltvTime(NOW + 31 * 3600_000)}" channel="cctv1">
    <title lang="zh">远期节目不应保留</title>
  </programme>
  <programme start="${xmltvTime(NOW)}" stop="${xmltvTime(NOW + 3600_000)}" channel="hunan">
    <title lang="zh">快乐大本营</title>
  </programme>
  <programme start="${xmltvTime(NOW)}" stop="${xmltvTime(NOW + 3600_000)}" channel="notitle">
  </programme>
</tv>`;

  describe("parseEpgXml", () => {
    it("应该解析频道 display-name 并按开始时间排序节目", () => {
      const data = parseEpgXml(SAMPLE_XML, undefined, NOW);
      expect(data.channelDisplayNames.get("cctv1")).toBe("CCTV1");
      expect(data.channelDisplayNames.get("hunan")).toBe("湖南卫视");
      const list = data.programmesByChannel.get("cctv1")!;
      expect(list.map((p) => p.title)).toEqual(["新闻联播重播", "黄金剧场"]);
    });

    it("应该过滤掉过期与超过 24 小时的节目，以及无标题节目", () => {
      const data = parseEpgXml(SAMPLE_XML, undefined, NOW);
      const list = data.programmesByChannel.get("cctv1")!;
      expect(list.some((p) => p.title.includes("过期"))).toBe(false);
      expect(list.some((p) => p.title.includes("远期"))).toBe(false);
      expect(data.programmesByChannel.has("notitle")).toBe(false);
    });

    it("wantedChannelIds 应只保留目标频道", () => {
      const data = parseEpgXml(SAMPLE_XML, new Set(["hunan"]), NOW);
      expect(data.programmesByChannel.has("cctv1")).toBe(false);
      expect(data.programmesByChannel.get("hunan")!.map((p) => p.title)).toEqual(["快乐大本营"]);
    });
  });

  describe("getCurrentProgramme", () => {
    it("应该返回 start <= now < stop 的节目", () => {
      const data = parseEpgXml(SAMPLE_XML, undefined, NOW);
      const prog = getCurrentProgramme(data, ["cctv1"], NOW);
      expect(prog?.title).toBe("新闻联播重播");
    });

    it("当前无节目时应返回 null，且不会把未来节目当作当前节目", () => {
      const data = parseEpgXml(SAMPLE_XML, undefined, NOW);
      expect(getCurrentProgramme(data, ["cctv1"], NOW + 2 * 3600_000)).toBeNull();
    });

    it("keys 应按优先级依次尝试", () => {
      const data = parseEpgXml(SAMPLE_XML, undefined, NOW);
      const prog = getCurrentProgramme(data, ["不存在", "hunan"], NOW);
      expect(prog?.title).toBe("快乐大本营");
    });
  });

  describe("findEpgChannelIdByName / buildEpgKeys", () => {
    it("应按规范化名称兜底匹配 xmltv channel id", () => {
      const data = parseEpgXml(SAMPLE_XML, undefined, NOW);
      // m3u 里的频道名 "湖南卫视" 与 EPG display-name "湖南卫视" 规范化后一致
      expect(findEpgChannelIdByName(data, "湖南卫视")).toBe("hunan");
      expect(findEpgChannelIdByName(data, "CCTV1高清")).toBe("cctv1");
      expect(findEpgChannelIdByName(data, "不存在的台")).toBeUndefined();
    });

    it("buildEpgKeys 应包含 tvgId、tvgName 与名称兜底 id", () => {
      const data = parseEpgXml(SAMPLE_XML, undefined, NOW);
      const keys = buildEpgKeys(data, { tvgId: "cctv1", tvgName: "CCTV1", name: "CCTV-1 综合" });
      expect(keys[0]).toBe("cctv1");
      expect(keys).toContain("CCTV1");
      expect(keys).toContain("CCTV-1 综合");
    });

    it("没有 tvg 信息时应靠名称兜底", () => {
      const data = parseEpgXml(SAMPLE_XML, undefined, NOW);
      const keys = buildEpgKeys(data, { name: "湖南卫视" });
      expect(keys).toContain("hunan");
    });
  });

  describe("formatProgrammeTime", () => {
    it("应输出 HH:MM-HH:MM（本地时区）", () => {
      const start = new Date(2026, 7, 3, 20, 0).getTime();
      const stop = new Date(2026, 7, 3, 21, 30).getTime();
      expect(formatProgrammeTime({ channel: "x", start, stop, title: "t" })).toBe("20:00-21:30");
    });
  });

  describe("fetchEpg", () => {
    const realFetch = global.fetch;
    afterEach(() => {
      global.fetch = realFetch;
    });

    it("HTTP 非 2xx 应返回 null", async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
      expect(await fetchEpg("http://example.com/e.xml")).toBeNull();
    });

    it("超过 40MB 的响应应放弃解析并返回 null", async () => {
      const bigText = "<tv>" + "x".repeat(41 * 1024 * 1024) + "</tv>";
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, text: async () => bigText } as unknown as Response);
      expect(await fetchEpg("http://example.com/e.xml")).toBeNull();
    });

    it("fetch 抛错应返回 null", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("network down"));
      expect(await fetchEpg("http://example.com/e.xml")).toBeNull();
    });

    it("正常响应应返回解析结果", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, text: async () => SAMPLE_XML } as unknown as Response);
      const data = await fetchEpg("http://example.com/e.xml");
      expect(data).not.toBeNull();
      expect(data!.channelDisplayNames.get("hunan")).toBe("湖南卫视");
    });
  });
});
