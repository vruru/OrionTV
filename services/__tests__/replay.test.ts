import { fetchCoverage, validateReplayManifest } from "../replay";

const mediaManifest = (duration: number) => `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:${Math.ceil(duration)}
#EXTINF:${duration.toFixed(3)},
segment-001.ts
#EXT-X-ENDLIST`;

describe("validateReplayManifest", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it("10 秒媒体分片应通过默认安全阈值", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mediaManifest(10),
    } as Response);

    await expect(validateReplayManifest("http://replay.test/direct.m3u8")).resolves.toMatchObject({
      status: "safe",
      safe: true,
      targetDurationSeconds: 10,
      maxSegmentDurationSeconds: 10,
      segmentCount: 1,
      thresholdSeconds: 30,
    });
  });

  it("600 秒媒体分片应返回明确的 unsafe 结果", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mediaManifest(600),
    } as Response);

    await expect(validateReplayManifest("http://replay.test/direct.m3u8")).resolves.toMatchObject({
      status: "unsafe",
      safe: false,
      reason: "segment-too-long",
      targetDurationSeconds: 600,
      maxSegmentDurationSeconds: 600,
      thresholdSeconds: 30,
    });
  });

  it("HTTP 失败应返回状态码且不抛异常", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 } as Response);

    await expect(validateReplayManifest("http://replay.test/direct.m3u8")).resolves.toEqual({
      status: "error",
      safe: false,
      error: "http",
      message: "回看清单请求失败（HTTP 503）",
      httpStatus: 503,
    });
  });

  it("没有 EXTINF 的内容应视为无效媒体清单", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-ENDLIST",
    } as Response);

    await expect(validateReplayManifest("http://replay.test/direct.m3u8")).resolves.toMatchObject({
      status: "error",
      safe: false,
      error: "invalid-media-playlist",
    });
  });

  it("调用前已经 abort 时不请求网络", async () => {
    const controller = new AbortController();
    controller.abort();
    global.fetch = jest.fn();

    await expect(
      validateReplayManifest("http://replay.test/direct.m3u8", { signal: controller.signal })
    ).resolves.toMatchObject({ status: "error", safe: false, error: "aborted" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("请求超过默认 10 秒应中止并返回 timeout", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }) as jest.MockedFunction<typeof fetch>;

    const resultPromise = validateReplayManifest("http://replay.test/direct.m3u8");
    await jest.advanceTimersByTimeAsync(10_000);

    await expect(resultPromise).resolves.toMatchObject({
      status: "error",
      safe: false,
      error: "timeout",
    });
  });
});

describe("fetchCoverage", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("读取 v2 返回的真实短分片时长", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ starts: [100, 110], segmentSeconds: 10 }),
    } as Response);

    await expect(fetchCoverage("http://replay.test", "湖南卫视")).resolves.toEqual({
      starts: [100_000, 110_000],
      segmentDurationMs: 10_000,
    });
  });

  it("兼容旧服务 number[] 并按十分钟解释", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [100, 700],
    } as Response);

    await expect(fetchCoverage("http://replay.test", "湖南卫视")).resolves.toEqual({
      starts: [100_000, 700_000],
      segmentDurationMs: 600_000,
    });
  });
});
