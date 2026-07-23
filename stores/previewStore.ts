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

    // Fill missing frames sequentially (limits native/network pressure and
    // never blocks playback, which runs on its own player).
    (async () => {
      for (let i = 0; i < times.length; i++) {
        if (get().requestToken !== token) return; // a newer window superseded us
        const t = times[i];
        const key = roundKey(t);
        if (get().cache[key]) continue; // already have it

        const uri = await generateThumbnail(sourceUrl, t);
        if (get().requestToken !== token) return;
        if (uri) {
          set((state) => ({
            cache: { ...state.cache, [key]: uri },
            frames: state.frames.map((f) => (f.time === t ? { ...f, uri } : f)),
          }));
        }
      }
      logger.info(`[PREVIEW] window @${base}ms done`);
    })();
  },

  reset: () => set({ sourceUrl: null, durationMillis: 0, frames: [], cache: {}, requestToken: get().requestToken + 1 }),
}));

export default usePreviewStore;
