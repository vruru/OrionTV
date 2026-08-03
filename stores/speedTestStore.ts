import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/services/api";
import { measureSpeedMbps } from "@/services/speedTest";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("SpeedTestStore");

const STORAGE_KEY = "source_speed_results";
// Common keywords used to fetch a sample stream per source site.
const SAMPLE_QUERIES = ["爱", "我", "天"];
const MAX_SITES = 40;

export interface SpeedResult {
  name: string;
  mbps: number;
  testedAt: number;
}

interface SpeedTestState {
  results: Record<string, SpeedResult>; // keyed by source(site) key
  isTesting: boolean;
  done: boolean;
  currentName: string | null;
  currentMbps: number | null;
  progressDone: number;
  progressTotal: number;
  loadResults: () => Promise<void>;
  runTest: () => Promise<void>;
  cancelTest: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const useSpeedTestStore = create<SpeedTestState>((set, get) => ({
  results: {},
  isTesting: false,
  done: false,
  currentName: null,
  currentMbps: null,
  progressDone: 0,
  progressTotal: 0,

  loadResults: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) set({ results: JSON.parse(raw) });
    } catch (e) {
      logger.info("loadResults failed", e);
    }
  },

  runTest: async () => {
    if (get().isTesting) return;
    set({ isTesting: true, done: false, currentName: null, currentMbps: null, progressDone: 0, progressTotal: 0 });

    try {
      // Collect one sample stream url per source site via a few global searches.
      const sampleBySite: Record<string, { name: string; url: string }> = {};
      let siteCount = Infinity;
      try {
        const sites = await api.getResources();
        siteCount = sites.length;
      } catch {
        // ignore — we'll just test whatever the searches return
      }

      for (const q of SAMPLE_QUERIES) {
        if (!get().isTesting) return; // cancelled while sampling
        try {
          const { results } = await api.searchVideos(q);
          for (const r of results) {
            if (!sampleBySite[r.source] && r.episodes && r.episodes.length > 0) {
              sampleBySite[r.source] = { name: r.source_name, url: r.episodes[0] };
            }
          }
        } catch (e) {
          logger.info(`sample search failed for "${q}"`, e);
        }
        if (Object.keys(sampleBySite).length >= Math.min(siteCount, MAX_SITES)) break;
      }

      const entries = Object.entries(sampleBySite).slice(0, MAX_SITES);
      set({ progressTotal: entries.length });

      if (entries.length === 0) {
        set({ done: true, currentName: null });
        await sleep(1500);
        return;
      }

      const newResults: Record<string, SpeedResult> = { ...get().results };
      let done = 0;
      for (const [siteKey, sample] of entries) {
        if (!get().isTesting) break; // cancelled by user
        set({ currentName: sample.name, currentMbps: null });
        const mbps = await measureSpeedMbps(sample.url);
        newResults[siteKey] = { name: sample.name, mbps, testedAt: Date.now() };
        done += 1;
        set({ currentMbps: mbps, progressDone: done, results: { ...newResults } });
        await sleep(400); // let the just-measured speed be readable
      }

      // 被取消时也保留已完成的结果
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newResults));
      set({ done: true, currentName: null, currentMbps: null });
      await sleep(1500);
    } catch (e) {
      logger.error("runTest failed", e);
    } finally {
      set({ isTesting: false, done: false });
    }
  },

  cancelTest: () => {
    // 中断遍历循环（runTest 每轮迭代前检查 isTesting）；正在进行中的单个
    // 测速会自然结束，已完成的测量结果仍会被保存。
    if (get().isTesting) {
      set({ isTesting: false });
    }
  },
}));
