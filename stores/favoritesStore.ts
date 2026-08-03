import { create } from "zustand";
import { Favorite, FavoriteManager } from "@/services/storage";

interface FavoritesState {
  favorites: (Favorite & { key: string })[];
  loading: boolean;
  error: string | null;
  fetchFavorites: () => Promise<void>;
  removeFavorite: (key: string) => Promise<void>;
}

const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: [],
  loading: false,
  error: null,
  fetchFavorites: async () => {
    set({ loading: true, error: null });
    try {
      const favoritesData = await FavoriteManager.getAll();
      const favoritesArray = Object.entries(favoritesData).map(([key, value]) => ({
        ...value,
        key,
      }));
      //   favoritesArray.sort((a, b) => (b.save_time || 0) - (a.save_time || 0));
      set({ favorites: favoritesArray, loading: false });
    } catch (e) {
      const error = e instanceof Error ? e.message : "获取收藏列表失败";
      set({ error, loading: false });
    }
  },
  removeFavorite: async (key: string) => {
    const [source, id] = key.split("+");
    await FavoriteManager.remove(source, id);
    // 本地先行移除，避免整表重新拉取造成的闪烁
    set({ favorites: get().favorites.filter((f) => f.key !== key) });
  },
}));

export default useFavoritesStore;
