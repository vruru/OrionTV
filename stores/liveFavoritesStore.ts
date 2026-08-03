import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("LiveFavorites");

const STORAGE_KEY = "mytv_live_favorites";

interface LiveFavoritesState {
  favoriteIds: string[];
  loaded: boolean;
  load: () => Promise<void>;
  toggle: (channelId: string) => Promise<boolean>; // 返回切换后是否为收藏
  isFavorite: (channelId: string) => boolean;
}

/** 直播频道收藏：按频道 id（通常是 url）持久化到本地 */
const useLiveFavoritesStore = create<LiveFavoritesState>((set, get) => ({
  favoriteIds: [],
  loaded: false,

  load: async () => {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      set({ favoriteIds: data ? JSON.parse(data) : [], loaded: true });
    } catch (error) {
      logger.info("Failed to load live favorites:", error);
      set({ loaded: true });
    }
  },

  toggle: async (channelId: string) => {
    const current = get().favoriteIds;
    const isFav = current.includes(channelId);
    const next = isFav ? current.filter((id) => id !== channelId) : [...current, channelId];
    set({ favoriteIds: next });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      logger.info("Failed to save live favorites:", error);
    }
    return !isFav;
  },

  isFavorite: (channelId: string) => get().favoriteIds.includes(channelId),
}));

export default useLiveFavoritesStore;
