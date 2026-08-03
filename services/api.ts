import AsyncStorage from "@react-native-async-storage/async-storage";

// region: --- Interface Definitions ---
export interface DoubanItem {
  id?: string;
  title: string;
  poster: string;
  rate?: string;
  year?: string;
}

export interface DoubanResponse {
  code: number;
  message: string;
  list: DoubanItem[];
}

export interface VideoDetail {
  id: string;
  title: string;
  poster: string;
  source: string;
  source_name: string;
  desc?: string;
  type?: string;
  year?: string;
  area?: string;
  director?: string;
  actor?: string;
  remarks?: string;
}

export interface SearchResult {
  id: number;
  title: string;
  poster: string;
  episodes: string[];
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
}

export interface Favorite {
  cover: string;
  title: string;
  source_name: string;
  total_episodes: number;
  search_title: string;
  year: string;
  save_time?: number;
}

export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  index: number;
  total_episodes: number;
  play_time: number;
  total_time: number;
  save_time: number;
  year: string;
}

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

export interface ServerConfig {
  SiteName: string;
  StorageType: "localstorage" | "redis" | string;
}

export interface LiveSource {
  key: string;
  name: string;
  url: string;
  ua?: string;
  epg?: string;
  channelNumber?: number;
  from?: string;
  disabled?: boolean;
}

export interface LiveChannel {
  id: string;
  tvgId?: string;
  tvgName?: string;
  name: string;
  logo?: string;
  group?: string;
  url: string;
  catchup?: string;
  catchupSource?: string;
  catchupDays?: string;
}

// Storage key for saved login credentials (kept in sync with services/storage.ts).
// Read directly here to avoid a circular import with storage.ts.
const LOGIN_CREDENTIALS_KEY = "mytv_login_credentials";

export class API {
  public baseURL: string = "";
  // Guards against concurrent re-login attempts when several requests 401 at once.
  private reloginPromise: Promise<boolean> | null = null;

  constructor(baseURL?: string) {
    if (baseURL) {
      this.baseURL = baseURL;
    }
  }

  public setBaseUrl(url: string) {
    this.baseURL = url;
  }

  /**
   * Attempt to silently re-login using saved credentials.
   * The native cookie jar can be cleared when the app is killed for a while
   * (e.g. left closed for a couple of days), which invalidates the session and
   * makes every authenticated request return 401. Re-logging in transparently
   * restores the session cookie so the user does not have to re-enter settings
   * or log in again manually.
   */
  private async _tryRelogin(): Promise<boolean> {
    if (this.reloginPromise) {
      return this.reloginPromise;
    }

    this.reloginPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(LOGIN_CREDENTIALS_KEY);
        if (!raw) return false;
        const creds = JSON.parse(raw) as { username?: string; password?: string };
        if (!creds || !creds.password) return false;

        const response = await fetch(`${this.baseURL}/api/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: creds.username, password: creds.password }),
        });
        if (!response.ok) return false;

        const cookies = response.headers.get("Set-Cookie");
        if (cookies) {
          await AsyncStorage.setItem("authCookies", cookies);
        }
        return true;
      } catch {
        return false;
      } finally {
        // Release the guard on the next tick so bursts of 401s share one attempt.
        setTimeout(() => {
          this.reloginPromise = null;
        }, 0);
      }
    })();

    return this.reloginPromise;
  }

  private async _fetch(url: string, options: RequestInit = {}, allowRetry = true, timeoutMs?: number): Promise<Response> {
    if (!this.baseURL) {
      throw new Error("API_URL_NOT_SET");
    }

    // Optional timeout: guards against a slow/hanging host blocking the UI
    // indefinitely (e.g. a dead live source configured on the backend).
    // The caller's own AbortSignal (if any) is forwarded into the same controller.
    let controller: AbortController | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs && timeoutMs > 0) {
      controller = new AbortController();
      const c = controller;
      if (options.signal) {
        if (options.signal.aborted) {
          c.abort();
        } else {
          options.signal.addEventListener("abort", () => c.abort());
        }
      }
      timeoutId = setTimeout(() => c.abort(), timeoutMs);
    }

    let response: Response;
    try {
      response = await fetch(
        `${this.baseURL}${url}`,
        controller ? { ...options, signal: controller.signal } : options
      );
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    if (response.status === 401) {
      // Session likely expired / cookie jar cleared. Try to recover silently
      // with saved credentials, then retry the original request once.
      if (allowRetry && url !== "/api/login") {
        const reloggedIn = await this._tryRelogin();
        if (reloggedIn) {
          return this._fetch(url, options, false, timeoutMs);
        }
      }
      throw new Error("UNAUTHORIZED");
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response;
  }

  async login(username?: string | undefined, password?: string): Promise<{ ok: boolean }> {
    const response = await this._fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    // 存储cookie到AsyncStorage
    const cookies = response.headers.get("Set-Cookie");
    if (cookies) {
      await AsyncStorage.setItem("authCookies", cookies);
    }

    return response.json();
  }

  async logout(): Promise<{ ok: boolean }> {
    const response = await this._fetch("/api/logout", {
      method: "POST",
    });
    await AsyncStorage.setItem("authCookies", '');
    return response.json();
  }

  async getServerConfig(): Promise<ServerConfig> {
    const response = await this._fetch("/api/server-config");
    return response.json();
  }

  async getFavorites(key?: string): Promise<Record<string, Favorite> | Favorite | null> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url);
    return response.json();
  }

  async addFavorite(key: string, favorite: Omit<Favorite, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, favorite }),
    });
    return response.json();
  }

  async deleteFavorite(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getPlayRecords(): Promise<Record<string, PlayRecord>> {
    const response = await this._fetch("/api/playrecords");
    return response.json();
  }

  async savePlayRecord(key: string, record: Omit<PlayRecord, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/playrecords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, record }),
    });
    return response.json();
  }

  async deletePlayRecord(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/playrecords?key=${encodeURIComponent(key)}` : "/api/playrecords";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getSearchHistory(): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory");
    return response.json();
  }

  async addSearchHistory(keyword: string): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword }),
    });
    return response.json();
  }

  async deleteSearchHistory(keyword?: string): Promise<{ success: boolean }> {
    const url = keyword ? `/api/searchhistory?keyword=${keyword}` : "/api/searchhistory";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  getImageProxyUrl(imageUrl: string): string {
    return `${this.baseURL}/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  }

  async getDoubanData(
    type: "movie" | "tv",
    tag: string,
    pageSize: number = 16,
    pageStart: number = 0
  ): Promise<DoubanResponse> {
    const url = `/api/douban?type=${type}&tag=${encodeURIComponent(tag)}&pageSize=${pageSize}&pageStart=${pageStart}`;
    const response = await this._fetch(url);
    return response.json();
  }

  /** LunaTV 网页端“电视剧/综艺”的最近热门分类接口。 */
  async getDoubanCategoryData(
    kind: "movie" | "tv",
    category: string,
    categoryType: string,
    pageSize: number = 20,
    pageStart: number = 0
  ): Promise<DoubanResponse> {
    const url =
      `/api/douban/categories?kind=${kind}` +
      `&category=${encodeURIComponent(category)}` +
      `&type=${encodeURIComponent(categoryType)}` +
      `&limit=${pageSize}&start=${pageStart}`;
    const response = await this._fetch(url);
    return response.json();
  }

  /** LunaTV 网页端“全部/卡通”使用的多条件推荐接口。 */
  async getDoubanRecommendData(
    params: {
      kind: "movie" | "tv";
      category?: string;
      format?: string;
      label?: string;
      region?: string;
      year?: string;
      platform?: string;
      sort?: string;
    },
    pageSize: number = 20,
    pageStart: number = 0
  ): Promise<DoubanResponse> {
    const query = [
      `kind=${params.kind}`,
      `limit=${pageSize}`,
      `start=${pageStart}`,
      ...Object.entries(params)
        .filter(([key, value]) => key !== "kind" && !!value)
        .map(([key, value]) => `${key}=${encodeURIComponent(value!)}`),
    ].join("&");
    const response = await this._fetch(`/api/douban/recommends?${query}`);
    return response.json();
  }

  /** 网页端“每日放送”的 Bangumi 日历，转换成首页卡片通用结构。 */
  async getBangumiToday(): Promise<DoubanResponse> {
    const response = await this._fetch("/api/bangumi/calendar");
    const calendar = (await response.json()) as Array<{
      weekday?: { en?: string };
      items?: Array<{
        id?: number;
        name?: string;
        name_cn?: string;
        air_date?: string;
        rating?: { score?: number };
        images?: { large?: string; common?: string; medium?: string; small?: string; grid?: string };
      }>;
    }>;
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const today = calendar.find((day) => day.weekday?.en === weekdays[new Date().getDay()]);
    const list: DoubanItem[] = (today?.items ?? [])
      .filter((item) => !!item.images)
      .map((item) => ({
        id: item.id?.toString(),
        title: item.name_cn || item.name || "未知动画",
        poster:
          item.images?.large ||
          item.images?.common ||
          item.images?.medium ||
          item.images?.small ||
          item.images?.grid ||
          "",
        rate: item.rating?.score?.toFixed(1) || "",
        year: item.air_date?.split("-")[0] || "",
      }));
    return { code: 200, message: "获取成功", list };
  }

  async searchVideos(query: string): Promise<{ results: SearchResult[] }> {
    const url = `/api/search?q=${encodeURIComponent(query)}`;
    const response = await this._fetch(url);
    return response.json();
  }

  async searchVideo(query: string, resourceId: string, signal?: AbortSignal): Promise<{ results: SearchResult[] }> {
    const url = `/api/search/one?q=${encodeURIComponent(query)}&resourceId=${encodeURIComponent(resourceId)}`;
    const response = await this._fetch(url, { signal });
    const { results } = await response.json();
    return { results: results.filter((item: any) => item.title === query )};
  }

  async getResources(signal?: AbortSignal): Promise<ApiSite[]> {
    const url = `/api/search/resources`;
    const response = await this._fetch(url, { signal });
    return response.json();
  }

  async getVideoDetail(source: string, id: string): Promise<VideoDetail> {
    const url = `/api/detail?source=${source}&id=${id}`;
    const response = await this._fetch(url);
    return response.json();
  }

  // --- Live TV (managed by the backend, e.g. LunaTV) ---
  // These two use an explicit timeout: a dead or slow live source configured on
  // the backend must not leave the live screen spinning forever.
  async getLiveSources(): Promise<LiveSource[]> {
    const response = await this._fetch("/api/live/sources", {}, true, 8000);
    const json = await response.json();
    return (json?.data ?? []) as LiveSource[];
  }

  async getLiveChannels(sourceKey: string): Promise<LiveChannel[]> {
    const response = await this._fetch(`/api/live/channels?source=${encodeURIComponent(sourceKey)}`, {}, true, 8000);
    const json = await response.json();
    return (json?.data ?? []) as LiveChannel[];
  }
}

// 默认实例
export let api = new API();
