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

/** 拉取该频道已录制分片的起始时间（epoch ms，升序）；失败返回空数组 */
export const fetchCoverage = async (serverUrl: string, channel: string): Promise<number[]> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const base = serverUrl.replace(/\/+$/, "");
      const res = await fetch(`${base}/coverage?channel=${encodeURIComponent(channel)}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data.filter((n) => typeof n === "number").map((s) => s * 1000) : [];
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    logger.info("获取录制覆盖情况失败:", e);
    return [];
  }
};
