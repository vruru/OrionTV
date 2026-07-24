import * as FileSystem from "expo-file-system";
import { isHlsUrl, resolveSegmentUrl } from "@/services/thumbnailGen";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("SpeedTest");

// How long to sample the download before measuring throughput.
const MEASURE_MS = 3000;

/**
 * Measure the download throughput of a stream in MB/s.
 * For HLS we download an actual media segment (the .m3u8 playlist itself is tiny
 * and would not reflect real speed); for direct files we download the file.
 * The download is capped at ~3s, then cancelled, and speed = bytes / elapsed.
 * Never throws — returns 0 when it can't measure.
 */
export const measureSpeedMbps = async (streamUrl: string): Promise<number> => {
  let measureUrl = streamUrl;
  try {
    if (isHlsUrl(streamUrl)) {
      const seg = await resolveSegmentUrl(streamUrl, 0);
      if (!seg) return 0;
      measureUrl = seg;
    }
  } catch {
    return 0;
  }

  const localPath = `${FileSystem.cacheDirectory}spd_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`;
  let lastBytes = 0;
  const start = Date.now();

  const download = FileSystem.createDownloadResumable(measureUrl, localPath, {}, (p) => {
    lastBytes = p.totalBytesWritten;
  });

  const timer = setTimeout(() => {
    download.cancelAsync().catch(() => {});
  }, MEASURE_MS);

  try {
    await download.downloadAsync();
  } catch {
    // Cancelled after the time cap (expected) or a network error — either way
    // we use whatever bytes were transferred.
  } finally {
    clearTimeout(timer);
    FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
  }

  const elapsedSec = (Date.now() - start) / 1000;
  if (elapsedSec <= 0 || lastBytes <= 0) return 0;
  const mbps = lastBytes / elapsedSec / (1024 * 1024);
  logger.info(`[SPEED] ${measureUrl.substring(0, 60)} -> ${mbps.toFixed(2)} MB/s (${lastBytes}B / ${elapsedSec.toFixed(1)}s)`);
  return mbps;
};
