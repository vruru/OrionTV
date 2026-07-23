import { create } from "zustand";
import * as VideoThumbnails from "expo-video-thumbnails";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("PreviewStore");

export interface PreviewThumbnail {
  /** Timestamp of the frame, in milliseconds. */
  time: number;
  /** Local file uri of the generated thumbnail. */
  uri: string;
}

type PreviewStatus = "idle" | "generating" | "ready" | "unavailable";

// Tuning: how many thumbnails to spread across the timeline and how the probing
// backs off. Generating frames from remote streams is expensive, so we cap the
// count and bail out early if the source clearly does not support extraction
// (common with some HLS/m3u8 streams on Android).
const MAX_THUMBNAILS = 40;
const MIN_THUMBNAILS = 6;
const THUMBNAIL_INTERVAL_MS = 30 * 1000; // aim for ~1 frame / 30s
const EARLY_FAILURE_ABORT = 3; // give up if the first few frames all fail

interface PreviewState {
  thumbnails: PreviewThumbnail[]; // sorted by time ascending
  status: PreviewStatus;
  sourceUrl: string | null;
  /** Kick off background generation for the given source/duration (idempotent per url). */
  generate: (url: string, durationMillis: number) => Promise<void>;
  /** Nearest cached thumbnail for a position (ms), or null if none available. */
  getNearest: (positionMillis: number) => PreviewThumbnail | null;
  reset: () => void;
}

const usePreviewStore = create<PreviewState>((set, get) => ({
  thumbnails: [],
  status: "idle",
  sourceUrl: null,

  generate: async (url, durationMillis) => {
    if (!url || !durationMillis || durationMillis <= 0) return;
    // Already handled this source (or in progress) — nothing to do.
    if (get().sourceUrl === url && get().status !== "idle") return;

    set({ sourceUrl: url, status: "generating", thumbnails: [] });

    const count = Math.min(
      MAX_THUMBNAILS,
      Math.max(MIN_THUMBNAILS, Math.floor(durationMillis / THUMBNAIL_INTERVAL_MS))
    );
    const step = durationMillis / (count + 1);

    logger.info(`[PREVIEW] Generating ${count} thumbnails for duration ${durationMillis}ms`);

    let failures = 0;
    for (let i = 1; i <= count; i++) {
      // Source changed (episode/source switch or unmount) — stop quietly.
      if (get().sourceUrl !== url) {
        logger.info(`[PREVIEW] Source changed, aborting generation`);
        return;
      }

      const time = Math.floor(step * i);
      try {
        const { uri } = await VideoThumbnails.getThumbnailAsync(url, {
          time,
          quality: 0.5,
        });

        if (get().sourceUrl !== url) return; // re-check after await
        set((state) => ({
          thumbnails: [...state.thumbnails, { time, uri }].sort((a, b) => a.time - b.time),
        }));
      } catch (error) {
        failures++;
        logger.info(`[PREVIEW] Failed to extract frame at ${time}ms (failure ${failures})`, error);
        // If extraction fails right away, this source almost certainly does not
        // support on-device thumbnails — stop and fall back to time-only preview.
        if (i <= EARLY_FAILURE_ABORT && failures >= EARLY_FAILURE_ABORT) {
          logger.warn(`[PREVIEW] Source does not support thumbnail extraction, marking unavailable`);
          if (get().sourceUrl === url) {
            set({ status: "unavailable" });
          }
          return;
        }
      }
    }

    if (get().sourceUrl === url) {
      set({ status: get().thumbnails.length > 0 ? "ready" : "unavailable" });
      logger.info(`[PREVIEW] Generation complete: ${get().thumbnails.length} thumbnails`);
    }
  },

  getNearest: (positionMillis) => {
    const { thumbnails } = get();
    if (thumbnails.length === 0) return null;

    let nearest = thumbnails[0];
    let bestDelta = Math.abs(thumbnails[0].time - positionMillis);
    for (let i = 1; i < thumbnails.length; i++) {
      const delta = Math.abs(thumbnails[i].time - positionMillis);
      if (delta < bestDelta) {
        bestDelta = delta;
        nearest = thumbnails[i];
      }
    }
    return nearest;
  },

  reset: () => set({ thumbnails: [], status: "idle", sourceUrl: null }),
}));

export default usePreviewStore;
