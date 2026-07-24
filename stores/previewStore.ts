import { create } from "zustand";
import { generateThumbnail } from "@/services/thumbnailGen";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("PreviewStore");

export const PREVIEW_COUNT = 6; // number of thumbnails shown at once
export const PREVIEW_STEP_MS = 10000; // spacing between thumbnails (10s)

export interface PreviewFrame {
  time: number; // absolute position in ms
  uri: string | null; // local image uri, or null
  loading: boolean; // true while extraction is in progress (show spinner)
}

// How many frames to extract at the same time. Fully parallel (6) can overwhelm
// the native video decoder on some TV boxes and none finish; fully sequential is
// slow. A small pool is the reliable middle ground.
const CONCURRENCY = 2;
// Per-frame hard timeout so a stuck segment download / decode never leaves a
// cell spinning forever (it falls back to a time label instead).
const FRAME_TIMEOUT_MS = 15000;

interface PreviewState {
  sourceUrl: string | null;
  durationMillis: number;
  frames: PreviewFrame[]; // current window, ordered by time
  // Cache of already-extracted thumbnails, keyed by rounded time (ms).
  cache: Record<number, string>;
  // Monotonic token so stale async results from an older window are ignored.
  requestToken: number;
  setSource: (url: string | null, durationMillis: number) => void;
  /** Build the 6-frame window starting at startMillis and fill images on demand. */
  generateWindow: (startMillis: number) => void;
  reset: () => void;
}

const roundKey = (ms: number) => Math.round(ms / 1000) * 1000;

const usePreviewStore = create<PreviewState>((set, get) => ({
  sourceUrl: null,
  durationMillis: 0,
  frames: [],
  cache: {},
  requestToken: 0,

  setSource: (url, durationMillis) => {
    if (get().sourceUrl === url) {
      // Same source, just refresh duration.
      set({ durationMillis });
      return;
    }
    // New source -> drop cache and window.
    set({ sourceUrl: url, durationMillis, frames: [], cache: {}, requestToken: get().requestToken + 1 });
  },

  generateWindow: (startMillis) => {
    const { sourceUrl, durationMillis, cache } = get();
    if (!sourceUrl) return;

    const maxStart = durationMillis > 0 ? Math.max(0, durationMillis - 1000) : Number.MAX_SAFE_INTEGER;
    const base = Math.min(Math.max(0, startMillis), maxStart);

    // Compute the target times for this window.
    const times: number[] = [];
    for (let i = 0; i < PREVIEW_COUNT; i++) {
      const t = base + i * PREVIEW_STEP_MS;
      if (durationMillis > 0 && t >= durationMillis) break;
      times.push(t);
    }
    if (times.length === 0) times.push(base);

    const token = get().requestToken + 1;
    set({
      requestToken: token,
      frames: times.map((t) => {
        const cached = cache[roundKey(t)];
        return { time: t, uri: cached ?? null, loading: !cached };
      }),
    });

    // Frames still needing extraction.
    const pending = times.filter((t) => !get().cache[roundKey(t)]);
    if (pending.length === 0) {
      logger.info(`[PREVIEW] window @${base}ms fully cached`);
      return;
    }

    const finishFrame = (t: number, uri: string | null) => {
      if (get().requestToken !== token) return; // a newer window superseded us
      set((state) => ({
        cache: uri ? { ...state.cache, [roundKey(t)]: uri } : state.cache,
        frames: state.frames.map((f) => (f.time === t ? { ...f, uri, loading: false } : f)),
      }));
    };

    const extractOne = async (t: number) => {
      let done = false;
      // Race the extraction against a hard timeout so a stuck source can't leave
      // the cell spinning forever.
      const uri = await Promise.race<string | null>([
        generateThumbnail(sourceUrl, t).then((u) => {
          done = true;
          return u;
        }),
        new Promise<string | null>((resolve) => setTimeout(() => (done ? undefined : resolve(null)), FRAME_TIMEOUT_MS)),
      ]).catch(() => null);
      finishFrame(t, uri);
    };

    // Run with limited concurrency (a small pool of workers pulling from the queue).
    const queue = [...pending];
    const worker = async () => {
      while (queue.length > 0) {
        if (get().requestToken !== token) return;
        const t = queue.shift()!;
        await extractOne(t);
      }
    };
    const workers = Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker());
    Promise.all(workers).then(() => logger.info(`[PREVIEW] window @${base}ms done (${pending.length} frames)`));
  },

  reset: () => set({ sourceUrl: null, durationMillis: 0, frames: [], cache: {}, requestToken: get().requestToken + 1 }),
}));

export default usePreviewStore;
