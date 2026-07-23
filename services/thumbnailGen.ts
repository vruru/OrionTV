import * as FileSystem from "expo-file-system";
import * as VideoThumbnails from "expo-video-thumbnails";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("ThumbnailGen");

/**
 * On-device thumbnail generation that works for both direct files (mp4) and
 * HLS (m3u8) streams.
 *
 * Why not just call VideoThumbnails on the m3u8 URL? On Android that goes
 * through MediaMetadataRetriever, which does NOT support remote HLS playlists
 * and can crash the whole app natively. Instead, for HLS we resolve the single
 * media segment (.ts / .m4s) that covers the requested time, download just that
 * segment to a LOCAL file, and extract the frame from the local file. Operating
 * on a local, self-contained segment is both supported and safe (a failure just
 * returns null instead of crashing).
 */

const isHls = (url: string) => /\.m3u8(\?|$)/i.test(url) || url.toLowerCase().includes(".m3u8");

const fetchText = async (url: string, timeoutMs = 8000): Promise<string> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(id);
  }
};

// Resolve a possibly-relative URI against the playlist URL.
const resolveUrl = (base: string, ref: string): string => {
  if (/^https?:\/\//i.test(ref)) return ref;
  try {
    // Strip query from base for resolution, then build.
    const baseNoQuery = base.split("?")[0];
    if (ref.startsWith("/")) {
      const m = baseNoQuery.match(/^(https?:\/\/[^/]+)/i);
      return m ? m[1] + ref : ref;
    }
    const dir = baseNoQuery.substring(0, baseNoQuery.lastIndexOf("/") + 1);
    return dir + ref;
  } catch {
    return ref;
  }
};

interface Segment {
  uri: string;
  start: number; // seconds
  duration: number; // seconds
}

// Parse a media playlist into a segment timeline. Returns null if the playlist
// is a master playlist (handled separately) or is encrypted/unsupported.
const parseMediaPlaylist = (text: string, playlistUrl: string): { segments: Segment[]; encrypted: boolean } => {
  const lines = text.split("\n").map((l) => l.trim());
  const segments: Segment[] = [];
  let pendingDuration = 0;
  let start = 0;
  let encrypted = false;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-KEY")) {
      // AES-128 / SAMPLE-AES encrypted segments can't be decoded by the OS
      // retriever; flag so the caller can skip gracefully.
      if (!/METHOD=NONE/i.test(line)) {
        encrypted = true;
      }
    } else if (line.startsWith("#EXTINF:")) {
      const m = line.match(/#EXTINF:([\d.]+)/);
      pendingDuration = m ? parseFloat(m[1]) : 0;
    } else if (line && !line.startsWith("#")) {
      segments.push({ uri: resolveUrl(playlistUrl, line), start, duration: pendingDuration });
      start += pendingDuration;
      pendingDuration = 0;
    }
  }

  return { segments, encrypted };
};

// Resolve a master playlist to a media playlist url (pick first variant).
const resolveMediaPlaylistUrl = async (url: string): Promise<{ url: string; text: string }> => {
  const text = await fetchText(url);
  if (text.includes("#EXT-X-STREAM-INF")) {
    const lines = text.split("\n").map((l) => l.trim());
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("#EXT-X-STREAM-INF") && lines[i + 1] && !lines[i + 1].startsWith("#")) {
        const variantUrl = resolveUrl(url, lines[i + 1]);
        const variantText = await fetchText(variantUrl);
        return { url: variantUrl, text: variantText };
      }
    }
  }
  return { url, text };
};

let tempCounter = 0;

const extractFromHls = async (m3u8Url: string, timeMillis: number): Promise<string | null> => {
  const { url: mediaUrl, text } = await resolveMediaPlaylistUrl(m3u8Url);
  const { segments, encrypted } = parseMediaPlaylist(text, mediaUrl);
  if (encrypted || segments.length === 0) {
    logger.info(`[HLS] Cannot extract (encrypted=${encrypted}, segments=${segments.length})`);
    return null;
  }

  const totalDuration = segments[segments.length - 1].start + segments[segments.length - 1].duration;
  const targetSec = Math.min(Math.max(timeMillis / 1000, 0), Math.max(totalDuration - 0.5, 0));
  const seg = segments.find((s) => targetSec >= s.start && targetSec < s.start + s.duration) || segments[0];
  const offsetMs = Math.max(0, Math.floor((targetSec - seg.start) * 1000));

  const ext = seg.uri.split("?")[0].toLowerCase().endsWith(".m4s") ? "m4s" : "ts";
  const localPath = `${FileSystem.cacheDirectory}seg_${Date.now()}_${tempCounter++}.${ext}`;

  try {
    const dl = await FileSystem.downloadAsync(seg.uri, localPath);
    if (!dl || !dl.uri) return null;
    try {
      const { uri } = await VideoThumbnails.getThumbnailAsync(dl.uri, { time: offsetMs, quality: 0.5 });
      return uri;
    } finally {
      // Clean up the downloaded segment; the extracted thumbnail lives elsewhere.
      FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
    }
  } catch (e) {
    logger.info(`[HLS] segment extract failed`, e);
    return null;
  }
};

/**
 * Generate a single thumbnail for `sourceUrl` at `timeMillis`.
 * Returns a local image uri, or null if extraction isn't possible for the
 * source (never throws to the caller for expected failures).
 */
export const generateThumbnail = async (sourceUrl: string, timeMillis: number): Promise<string | null> => {
  try {
    if (isHls(sourceUrl)) {
      return await extractFromHls(sourceUrl, timeMillis);
    }
    // Direct file (mp4 etc.) — MediaMetadataRetriever handles remote files fine.
    const { uri } = await VideoThumbnails.getThumbnailAsync(sourceUrl, { time: timeMillis, quality: 0.5 });
    return uri;
  } catch (e) {
    logger.info(`generateThumbnail failed for ${sourceUrl.substring(0, 80)}`, e);
    return null;
  }
};

export const isHlsUrl = isHls;
