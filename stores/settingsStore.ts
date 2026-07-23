import { create } from "zustand";
import { SettingsManager } from "@/services/storage";
import { api, ServerConfig } from "@/services/api";
import { storageConfig } from "@/services/storageConfig";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Logger from "@/utils/Logger";

const logger = Logger.withTag('SettingsStore');

interface SettingsState {
  apiBaseUrl: string;
  m3uUrl: string;
  remoteInputEnabled: boolean;
  autoSkipIntroOutro: boolean;
  hdSourcesOnly: boolean;
  videoSource: {
    enabledAll: boolean;
    sources: {
      [key: string]: boolean;
    };
  };
  isModalVisible: boolean;
  serverConfig: ServerConfig | null;
  isLoadingServerConfig: boolean;
  loadSettings: () => Promise<void>;
  fetchServerConfig: () => Promise<void>;
  setApiBaseUrl: (url: string) => void;
  setM3uUrl: (url: string) => void;
  setRemoteInputEnabled: (enabled: boolean) => void;
  setAutoSkipIntroOutro: (enabled: boolean) => void;
  setHdSourcesOnly: (enabled: boolean) => void;
  saveSettings: () => Promise<void>;
  setVideoSource: (config: { enabledAll: boolean; sources: { [key: string]: boolean } }) => void;
  showModal: () => void;
  hideModal: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  apiBaseUrl: "",
  m3uUrl: "",
  liveStreamSources: [],
  remoteInputEnabled: false,
  autoSkipIntroOutro: true,
  hdSourcesOnly: true,
  isModalVisible: false,
  serverConfig: null,
  isLoadingServerConfig: false,
  videoSource: {
    enabledAll: true,
    sources: {},
  },
  loadSettings: async () => {
    const settings = await SettingsManager.get();
    set({
      apiBaseUrl: settings.apiBaseUrl,
      m3uUrl: settings.m3uUrl,
      remoteInputEnabled: settings.remoteInputEnabled || false,
      autoSkipIntroOutro: settings.autoSkipIntroOutro ?? true,
      hdSourcesOnly: settings.hdSourcesOnly ?? true,
      videoSource: settings.videoSource || {
        enabledAll: true,
        sources: {},
      },
    });
    if (settings.apiBaseUrl) {
      api.setBaseUrl(settings.apiBaseUrl);
      await get().fetchServerConfig();
    }
  },
  fetchServerConfig: async () => {
    set({ isLoadingServerConfig: true });
    // Retry a few times: on a cold start (e.g. reopening after days) the first
    // request can fail while the network stack warms up. Without a retry the app
    // ends up with no server config and can't load saved resources until the
    // user manually re-saves settings.
    const maxAttempts = 3;
    try {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const config = await api.getServerConfig();
          if (config) {
            storageConfig.setStorageType(config.StorageType);
            set({ serverConfig: config });
            return;
          }
        } catch (error) {
          lastError = error;
          logger.error(`Failed to fetch server config (attempt ${attempt}/${maxAttempts}):`, error);
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
          }
        }
      }
      set({ serverConfig: null });
      if (lastError) {
        logger.error("Giving up fetching server config after retries:", lastError);
      }
    } finally {
      set({ isLoadingServerConfig: false });
    }
  },
  setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
  setM3uUrl: (url) => set({ m3uUrl: url }),
  setRemoteInputEnabled: (enabled) => set({ remoteInputEnabled: enabled }),
  setAutoSkipIntroOutro: (enabled) => set({ autoSkipIntroOutro: enabled }),
  setHdSourcesOnly: (enabled) => set({ hdSourcesOnly: enabled }),
  setVideoSource: (config) => set({ videoSource: config }),
  saveSettings: async () => {
    const { apiBaseUrl, m3uUrl, remoteInputEnabled, videoSource, autoSkipIntroOutro, hdSourcesOnly } = get();
    const currentSettings = await SettingsManager.get()
    const currentApiBaseUrl = currentSettings.apiBaseUrl;
    let processedApiBaseUrl = apiBaseUrl.trim();
    if (processedApiBaseUrl.endsWith("/")) {
      processedApiBaseUrl = processedApiBaseUrl.slice(0, -1);
    }

    if (!/^https?:\/\//i.test(processedApiBaseUrl)) {
      const hostPart = processedApiBaseUrl.split("/")[0];
      // Simple check for IP address format.
      const isIpAddress = /^((\d{1,3}\.){3}\d{1,3})(:\d+)?$/.test(hostPart);
      // Check if the domain includes a port.
      const hasPort = /:\d+/.test(hostPart);

      if (isIpAddress || hasPort) {
        processedApiBaseUrl = "http://" + processedApiBaseUrl;
      } else {
        processedApiBaseUrl = "https://" + processedApiBaseUrl;
      }
    }

    await SettingsManager.save({
      apiBaseUrl: processedApiBaseUrl,
      m3uUrl,
      remoteInputEnabled,
      videoSource,
      autoSkipIntroOutro,
      hdSourcesOnly,
    });
    if ( currentApiBaseUrl !== processedApiBaseUrl) {
      await AsyncStorage.setItem('authCookies', '');
    }
    api.setBaseUrl(processedApiBaseUrl);
    // Also update the URL in the state so the input field shows the processed URL
    set({ isModalVisible: false, apiBaseUrl: processedApiBaseUrl });
    await get().fetchServerConfig();
  },
  showModal: () => set({ isModalVisible: true }),
  hideModal: () => set({ isModalVisible: false }),
}));
