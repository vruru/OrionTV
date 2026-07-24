import { create } from "zustand";
import { generateThumbnail } from "@/services/thumbnailGen";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("PreviewStore");

export const PREVIEW_COUNT = 6; // number of thumbnails shown at once
export const PREVIEW_STEP_MS = 10000; // spacing between thumbnails (10s)

export interface PreviewFrame {
  time: number; // absolute position in ms
  uri: string | null; // local image uri, or null while loading / unsupported
}

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
      frames: times.map((t) => ({ time: t, uri: cache[roundKey(t)] ?? null })),
    });

    // Generate all missing frames in parallel so the 6 thumbnails come up
    // together instead of trickling in one by one. Each extraction (segment
    // download + native frame decode) runs off the JS thread, so firing them
    // concurrently gives real parallelism; each cell updates as soon as its own
    // frame is ready. Playback is unaffected (it runs on its own player).
    times.forEach((t) => {
      const key = roundKey(t);
      if (get().cache[key]) return; // already cached
      (async () => {
        const uri = await generateThumbnail(sourceUrl, t);
        if (get().requestToken !== token) return; // a newer window superseded us
        if (uri) {
          set((state) => ({
            cache: { ...state.cache, [key]: uri },
            frames: state.frames.map((f) => (f.time === t ? { ...f, uri } : f)),
          }));
        }
      })();
    });
    logger.info(`[PREVIEW] window @${base}ms dispatched ${times.length} frames in parallel`);
  },

  reset: () => set({ sourceUrl: null, durationMillis: 0, frames: [], cache: {}, requestToken: get().requestToken + 1 }),
}));

export default usePreviewStore;
