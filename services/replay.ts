/**
 * NAS 回看服务（replay-recorder）客户端。
 *
 * 服务接口：
 *   GET /channels        → string[]          已配置录制的频道名
 *   GET /replay.m3u8     ?channel=&start=&stop=  指定时间窗的 HLS 点播列表
 * start/stop 为 14 位紧凑时间（+0800），与 EPG 的 xmltv 时间一致。
 */
import Logger from "@/utils/Logger";

const logger = Logger.withTag("Replay");

const REPLAY_MANIFEST_TIMEOUT_MS = 10_000;
export const DEFAULT_REPLAY_SEGMENT_LIMIT_SECONDS = 30;

export interface ReplayManifestValidationOptions {
  /** 单个媒体分片允许的最长时间；默认 30 秒。 */
  maxSegmentDurationSeconds?: number;
  /** 下载清单的超时时间；默认 10 秒。主要供测试或特殊网络环境调整。 */
  timeoutMs?: number;
  /** 允许页面卸载时主动取消检查。 */
  signal?: AbortSignal;
}

interface ReplayManifestMetrics {
  targetDurationSeconds: number;
  maxSegmentDurationSeconds: number;
  segmentCount: number;
  thresholdSeconds: number;
}

export type ReplayManifestValidationResult =
  | ({
      status: "safe";
      safe: true;
    } & ReplayManifestMetrics)
  | ({
      status: "unsafe";
      safe: false;
      reason: "segment-too-long";
      message: string;
    } & ReplayManifestMetrics)
  | {
      status: "error";
      safe: false;
      error: "invalid-url" | "http" | "timeout" | "aborted" | "network" | "invalid-media-playlist";
      message: string;
      httpStatus?: number;
    };

type ParsedReplayManifest = Omit<ReplayManifestMetrics, "thresholdSeconds">;

const invalidManifest = (message: string): ReplayManifestValidationResult => ({
  status: "error",
  safe: false,
  error: "invalid-media-playlist",
  message,
});

/**
 * 解析 direct media playlist，并确认每个 EXTINF 后都有对应的媒体 URI。
 * master playlist 不能反映实际分片长度，因此不能通过此安全检查。
 */
const parseReplayMediaManifest = (text: string): ParsedReplayManifest | ReplayManifestValidationResult => {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  const firstLine = lines.find((line) => line.length > 0);
  if (firstLine !== "#EXTM3U") return invalidManifest("回看地址没有返回有效的 HLS 清单");
  if (lines.some((line) => line.startsWith("#EXT-X-STREAM-INF"))) {
    return invalidManifest("回看地址返回的是主清单，不是 direct media playlist");
  }

  const targetLine = lines.find((line) => line.startsWith("#EXT-X-TARGETDURATION:"));
  const targetMatch = targetLine?.match(/^#EXT-X-TARGETDURATION:\s*(\d+(?:\.\d+)?)\s*$/);
  const targetDurationSeconds = targetMatch ? Number(targetMatch[1]) : Number.NaN;
  if (!Number.isFinite(targetDurationSeconds) || targetDurationSeconds <= 0) {
    return invalidManifest("回看媒体清单缺少有效的 EXT-X-TARGETDURATION");
  }

  const durations: number[] = [];
  let awaitingSegmentUri = false;
  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) {
      if (awaitingSegmentUri) return invalidManifest("回看媒体清单存在没有媒体地址的 EXTINF");
      const match = line.match(/^#EXTINF:\s*(\d+(?:\.\d+)?)(?:\s*,.*)?$/);
      const duration = match ? Number(match[1]) : Number.NaN;
      if (!Number.isFinite(duration) || duration <= 0) {
        return invalidManifest("回看媒体清单包含无效的 EXTINF 时长");
      }
      durations.push(duration);
      awaitingSegmentUri = true;
    } else if (awaitingSegmentUri && line && !line.startsWith("#")) {
      awaitingSegmentUri = false;
    }
  }

  if (durations.length === 0) return invalidManifest("回看媒体清单没有 EXTINF 媒体分片");
  if (awaitingSegmentUri) return invalidManifest("回看媒体清单最后一个 EXTINF 没有媒体地址");

  return {
    targetDurationSeconds,
    maxSegmentDurationSeconds: Math.max(...durations),
    segmentCount: durations.length,
  };
};

/**
 * 下载并校验 direct VOD m3u8。此函数永不向 UI 抛错：网络、超时和格式问题
 * 都会转换成明确的 error 结果；单片超限则返回 unsafe。
 */
export const validateReplayManifest = async (
  manifestUrl: string,
  options: ReplayManifestValidationOptions = {}
): Promise<ReplayManifestValidationResult> => {
  if (!manifestUrl.trim()) {
    return { status: "error", safe: false, error: "invalid-url", message: "回看清单地址为空" };
  }

  const thresholdSeconds =
    typeof options.maxSegmentDurationSeconds === "number" &&
    Number.isFinite(options.maxSegmentDurationSeconds) &&
    options.maxSegmentDurationSeconds > 0
      ? options.maxSegmentDurationSeconds
      : DEFAULT_REPLAY_SEGMENT_LIMIT_SECONDS;
  const timeoutMs =
    typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : REPLAY_MANIFEST_TIMEOUT_MS;

  if (options.signal?.aborted) {
    return { status: "error", safe: false, error: "aborted", message: "回看清单校验已取消" };
  }

  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(manifestUrl, { signal: controller.signal });
    if (!response.ok) {
      return {
        status: "error",
        safe: false,
        error: "http",
        message: `回看清单请求失败（HTTP ${response.status}）`,
        httpStatus: response.status,
      };
    }

    const parsed = parseReplayMediaManifest(await response.text());
    if ("status" in parsed) return parsed;

    const metrics: ReplayManifestMetrics = { ...parsed, thresholdSeconds };
    if (parsed.maxSegmentDurationSeconds > thresholdSeconds) {
      return {
        status: "unsafe",
        safe: false,
        reason: "segment-too-long",
        message: `回看清单单片最长 ${parsed.maxSegmentDurationSeconds} 秒，超过 ${thresholdSeconds} 秒安全上限`,
        ...metrics,
      };
    }
    return { status: "safe", safe: true, ...metrics };
  } catch (error) {
    if (timedOut) {
      return { status: "error", safe: false, error: "timeout", message: "回看清单请求超时（10 秒）" };
    }
    if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      return { status: "error", safe: false, error: "aborted", message: "回看清单校验已取消" };
    }
    logger.info("校验回看清单失败:", error);
    return { status: "error", safe: false, error: "network", message: "回看清单请求失败" };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
};

/** 拉取回看服务的频道清单；失败返回空数组（功能自动降级为无回看） */
export const fetchRecordedChannels = async (serverUrl: string): Promise<string[]> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const base = serverUrl.replace(/\/+$/, "");
      const res = await fetch(`${base}/channels`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data.filter((x) => typeof x === "string") : [];
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    logger.info("获取回看频道清单失败:", e);
    return [];
  }
};

/** epoch ms → "yyyyMMddHHmmss"（+0800，与回放服务约定一致） */
const toCompact = (ms: number): string => {
  const d = new Date(ms + 8 * 3600 * 1000); // 用 UTC 视角拼 +0800 的墙钟
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
};

/** 生成某个节目时间窗的回看 HLS 地址 */
export const buildReplayUrl = (
  serverUrl: string,
  channel: string,
  startMs: number,
  stopMs: number
): string => {
  const base = serverUrl.replace(/\/+$/, "");
  return (
    `${base}/replay.m3u8?channel=${encodeURIComponent(channel)}` +
    `&start=${toCompact(startMs)}&stop=${toCompact(stopMs)}`
  );
};

export interface ReplayCoverage {
  /** 已完成分片的起始时间（epoch ms，升序）。 */
  starts: number[];
  /** 单个分片实际覆盖长度；旧服务没有该字段时按 10 分钟兼容。 */
  segmentDurationMs: number;
}

const EMPTY_COVERAGE: ReplayCoverage = { starts: [], segmentDurationMs: 600_000 };

/** 拉取该频道已完成分片的覆盖信息；v2 同时返回服务端真实分片时长。 */
export const fetchCoverage = async (serverUrl: string, channel: string): Promise<ReplayCoverage> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const base = serverUrl.replace(/\/+$/, "");
      const res = await fetch(`${base}/coverage?channel=${encodeURIComponent(channel)}&v=2`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // 旧服务返回 number[]；新服务返回 { starts, segmentSeconds }。
      const rawStarts = Array.isArray(data) ? data : data?.starts;
      const starts = Array.isArray(rawStarts)
        ? rawStarts.filter((n) => typeof n === "number" && Number.isFinite(n)).map((s) => s * 1000)
        : [];
      const rawSegmentSeconds = Array.isArray(data) ? 600 : data?.segmentSeconds;
      const segmentDurationMs =
        typeof rawSegmentSeconds === "number" && Number.isFinite(rawSegmentSeconds) && rawSegmentSeconds > 0
          ? rawSegmentSeconds * 1000
          : 600_000;
      return { starts, segmentDurationMs };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    logger.info("获取录制覆盖情况失败:", e);
    return EMPTY_COVERAGE;
  }
};
