import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("SearchHistory");

const STORAGE_KEY = "mytv_search_history";
const MAX_HISTORY = 10;

interface SearchHistoryState {
  history: string[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (keyword: string) => Promise<void>;
  clear: () => Promise<void>;
}

/** 点播搜索历史：本地持久化，最多 10 条，最新搜索排最前 */
const useSearchHistoryStore = create<SearchHistoryState>((set, get) => ({
  history: [],
  loaded: false,

  load: async () => {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      set({ history: data ? JSON.parse(data) : [], loaded: true });
    } catch (error) {
      logger.info("Failed to load search history:", error);
      set({ loaded: true });
    }
  },

  add: async (keyword: string) => {
    const term = keyword.trim();
    if (!term) return;
    // 去重后置顶，截断到上限
    const next = [term, ...get().history.filter((h) => h !== term)].slice(0, MAX_HISTORY);
    set({ history: next });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      logger.info("Failed to save search history:", error);
    }
  },

  clear: async () => {
    set({ history: [] });
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      logger.info("Failed to clear search history:", error);
    }
  },
}));

export default useSearchHistoryStore;
