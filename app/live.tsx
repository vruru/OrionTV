import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { View, FlatList, StyleSheet, ActivityIndicator, Modal, useTVEventHandler, HWEvent, Text, TextInput, Pressable, BackHandler } from "react-native";
import { FlashList } from "@shopify/flash-list";
import Toast from "react-native-toast-message";
import { QrCode } from "lucide-react-native";
import LivePlayer from "@/components/LivePlayer";
import { fetchAndParseM3u, getPlayableUrl, Channel } from "@/services/m3u";
import { api } from "@/services/api";
import { ThemedView } from "@/components/ThemedView";
import { Colors } from "@/constants/Colors";
import { useSettingsStore } from "@/stores/settingsStore";
import useLiveFavoritesStore from "@/stores/liveFavoritesStore";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { RemoteControlModal } from "@/components/RemoteControlModal";
import { matchChannelSearch } from "@/utils/pinyin";
import { nextResizeMode, RESIZE_MODE_LABELS } from "@/utils/resizeMode";
import { EpgData, EpgProgramme, fetchEpg, getCurrentProgramme, buildEpgKeys, formatProgrammeTime } from "@/services/epg";
import { fetchRecordedChannels, buildReplayUrl } from "@/services/replay";
import Logger from "@/utils/Logger";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import ResponsiveHeader from "@/components/navigation/ResponsiveHeader";

const logger = Logger.withTag("LiveScreen");

// 收藏分组的固定名称：有收藏时排在分组列表第一位
const FAVORITES_GROUP = "我的收藏";

// Convert backend live channels into the local Channel shape.
const mapChannels = (
  chans: { id?: string; name?: string; url: string; logo?: string; group?: string }[],
  fallbackGroup: string
): Channel[] =>
  chans
    .filter((c) => !!c.url)
    .map((c) => ({
      id: c.id || c.url,
      name: c.name || "未知频道",
      url: c.url,
      logo: c.logo || "",
      group: c.group || fallbackGroup || "Default",
    }));

// 在 EPG 数据里找频道的节目单：按 tvg-id / tvg-name / 名称兜底匹配
const findEpgProgrammes = (epg: EpgData | null, channel: Channel): EpgProgramme[] => {
  if (!epg) return [];
  for (const key of buildEpgKeys(epg, channel)) {
    const list = epg.programmesByChannel.get(key);
    if (list && list.length > 0) return list;
  }
  return [];
};

// 回看节目单行的时间前缀："08-03 19:30-20:00"
const formatReplayRowTime = (p: EpgProgramme): string => {
  const d = new Date(p.start);
  const p2 = (n: number) => n.toString().padStart(2, "0");
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${formatProgrammeTime(p)}`;
};

export default function LiveScreen() {
  const { m3uUrl, apiBaseUrl, epgUrl, replayServerUrl, remoteInputEnabled } = useSettingsStore();
  const { favoriteIds, load: loadFavorites, toggle: toggleFavorite } = useLiveFavoritesStore();
  const { showModal: showRemoteModal, lastMessage, targetPage, clearMessage } = useRemoteControlStore();
  
  // 响应式布局配置
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType, spacing } = responsiveConfig;

  const [channels, setChannels] = useState<Channel[]>([]);
  const [groupedChannels, setGroupedChannels] = useState<Record<string, Channel[]>>({});
  const [channelGroups, setChannelGroups] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>("");

  const [currentChannelIndex, setCurrentChannelIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isChannelListVisible, setIsChannelListVisible] = useState(false);
  const [channelTitle, setChannelTitle] = useState<string | null>(null);
  // EPG 节目单数据（设置了 epgUrl 才有）
  const [epgData, setEpgData] = useState<EpgData | null>(null);
  // 回看：NAS 录制频道清单（设置了 replayServerUrl 才有）、节目单面板目标频道、回放会话
  const [recordedChannels, setRecordedChannels] = useState<Set<string>>(new Set());
  const [replayChannel, setReplayChannel] = useState<Channel | null>(null);
  const [replayCursor, setReplayCursor] = useState(0);
  const [replaySession, setReplaySession] = useState<{ url: string; title: string; channelName: string; channel: Channel } | null>(null);
  const replayCursorRef = useRef(0);
  const replayListRef = useRef<FlashList<EpgProgramme>>(null);
  // handleTVEvent 的 useCallback 依赖不含这些 state，闭包通过 ref 读最新值
  const replayChannelRef = useRef<Channel | null>(null);
  const replayProgrammesRef = useRef<EpgProgramme[]>([]);
  const replaySessionRef = useRef<{ url: string; title: string; channelName: string; channel: Channel } | null>(null);
  const epgDataRef = useRef<EpgData | null>(null);
  const recordedChannelsRef = useRef<Set<string>>(new Set());
  // 频道搜索：有关键词时节目表切换为跨分组搜索结果模式
  const [searchKeyword, setSearchKeyword] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  // 播放失败状态（含 LivePlayer 15s 超时）与重试计数
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const playbackFailedRef = useRef(false);
  playbackFailedRef.current = playbackFailed;
  // Self-managed cursor within the current group's channel list (like TiviMate
  // etc.): we don't rely on the OS focus engine to move through the list.
  const [listSelectedIndex, setListSelectedIndex] = useState(0);
  const titleTimer = useRef<NodeJS.Timeout | null>(null);
  const channelListRef = useRef<FlashList<Channel>>(null);
  // Refs holding the latest values so key-repeat intervals read fresh data.
  const cursorRef = useRef(0);
  const groupListRef = useRef<Channel[]>([]);
  const selectedGroupRef = useRef("");
  const channelGroupsRef = useRef<string[]>([]);
  const fastIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // 搜索模式的最新值镜像（handleTVEvent 闭包里读取）
  const searchModeRef = useRef(false);

  const CHANNEL_ROW_HEIGHT = deviceType === "mobile" ? 48 : 42;

  // 可选链保护：频道列表重载后旧索引可能暂时越界
  const selectedChannelUrl = channels.length > 0 ? getPlayableUrl(channels[currentChannelIndex]?.url ?? null) : null;

  // Keep refs in sync with the latest render.
  const favoriteChannels = channels.filter((c) => favoriteIds.includes(c.id));
  const displayGroups = favoriteChannels.length > 0 ? [FAVORITES_GROUP, ...channelGroups] : channelGroups;
  const currentGroupList =
    selectedGroup === FAVORITES_GROUP ? favoriteChannels : groupedChannels[selectedGroup] || [];

  // 搜索模式：跨所有分组按名称/拼音首字母过滤
  const trimmedKeyword = searchKeyword.trim();
  const isSearchMode = trimmedKeyword.length > 0;
  const searchResults = useMemo(
    () => (isSearchMode ? channels.filter((c) => matchChannelSearch(c.name, trimmedKeyword)) : []),
    [channels, isSearchMode, trimmedKeyword]
  );
  // 搜索模式下列表操作（移动光标/确认播放/菜单键收藏）都作用于搜索结果
  const activeList = isSearchMode ? searchResults : currentGroupList;

  groupListRef.current = activeList;
  selectedGroupRef.current = selectedGroup;
  channelGroupsRef.current = displayGroups;
  searchModeRef.current = isSearchMode;
  replayChannelRef.current = replayChannel;
  replaySessionRef.current = replaySession;
  epgDataRef.current = epgData;
  recordedChannelsRef.current = recordedChannels;

  // 加载频道收藏（本地持久化）
  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  // 配置了 EPG 地址才拉取节目单；留空即不启用（顺带探测回看能力）
  useEffect(() => {
    if (!epgUrl || channels.length === 0) {
      setEpgData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const data = await fetchEpg(epgUrl);
      if (!cancelled) {
        setEpgData(data);
        const supportCount = channels.filter((c) => !!c.catchupSource).length;
        logger.info(`回看能力探测：${supportCount}/${channels.length} 个频道声明了 catchup-source`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [epgUrl, channels]);

  // 配置了回看服务地址才拉取 NAS 录制频道清单；留空即不启用回看（功能自动隐藏）
  useEffect(() => {
    if (!replayServerUrl) {
      setRecordedChannels(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      const list = await fetchRecordedChannels(replayServerUrl);
      if (!cancelled) setRecordedChannels(new Set(list));
    })();
    return () => {
      cancelled = true;
    };
  }, [replayServerUrl]);

  // 有 EPG 节目单的频道名集合：频道行右侧「节目单」标的数据源
  const epgChannelNames = useMemo(() => {
    const set = new Set<string>();
    if (!epgData) return set;
    for (const ch of channels) {
      if (findEpgProgrammes(epgData, ch).length > 0) set.add(ch.name);
    }
    return set;
  }, [epgData, channels]);

  // 收藏变化后保持选中状态合法：收藏分组可能消失、列表可能变短
  useEffect(() => {
    if (selectedGroup === FAVORITES_GROUP && favoriteChannels.length === 0) {
      setSelectedGroup(channelGroups[0] || "");
    }
    const list = selectedGroup === FAVORITES_GROUP ? favoriteChannels : groupedChannels[selectedGroup] || [];
    if (cursorRef.current > list.length - 1) {
      const next = Math.max(0, list.length - 1);
      cursorRef.current = next;
      setListSelectedIndex(next);
    }
  }, [favoriteChannels, selectedGroup, channelGroups, groupedChannels]);

  // 搜索词变化时回到搜索结果顶部
  useEffect(() => {
    cursorRef.current = 0;
    setListSelectedIndex(0);
  }, [trimmedKeyword]);

  // 远程输入（手机扫码打字）直投频道搜索
  useEffect(() => {
    if (lastMessage && targetPage === "live") {
      setSearchKeyword(lastMessage.text);
      setIsChannelListVisible(true);
      cursorRef.current = 0;
      setListSelectedIndex(0);
      clearMessage();
    }
  }, [lastMessage, targetPage, clearMessage]);

  useEffect(() => {
    const loadChannels = async () => {
      setIsLoading(true);
      let parsedChannels: Channel[] = [];

      try {
        // 1. 优先使用后端(LunaTV)管理的直播源：无需在 App 里手动填写地址，
        //    直接用已配置的服务器地址(apiBaseUrl)拉取后端的直播源和频道。
        if (apiBaseUrl) {
          try {
            const sources = await api.getLiveSources();
            const enabled = sources.filter((s) => !s.disabled);
            for (const src of enabled) {
              try {
                const chans = await api.getLiveChannels(src.key);
                const mapped = mapChannels(chans, src.name);
                if (mapped.length > 0) {
                  parsedChannels = mapped;
                  break;
                }
              } catch (channelErr) {
                // 频道缓存可能尚未生成(404)，退而尝试直接解析该源的上游 m3u 地址
                logger.info(`getLiveChannels failed for ${src.key}, trying its m3u url`, channelErr);
                if (src.url) {
                  const fromM3u = await fetchAndParseM3u(src.url);
                  if (fromM3u.length > 0) {
                    parsedChannels = fromM3u;
                    break;
                  }
                }
              }
            }
          } catch (sourcesErr) {
            logger.info("getLiveSources failed, will fall back to manual m3u url", sourcesErr);
          }
        }

        // 2. 回退：如果后端没有可用直播源，且用户手动填了直播源地址，则解析它
        if (parsedChannels.length === 0 && m3uUrl) {
          parsedChannels = await fetchAndParseM3u(m3uUrl);
        }
      } finally {
        setChannels(parsedChannels);

        const groups: Record<string, Channel[]> = parsedChannels.reduce((acc, channel) => {
          const groupName = channel.group || "Other";
          if (!acc[groupName]) {
            acc[groupName] = [];
          }
          acc[groupName].push(channel);
          return acc;
        }, {} as Record<string, Channel[]>);

        const groupNames = Object.keys(groups);
        setGroupedChannels(groups);
        setChannelGroups(groupNames);
        setSelectedGroup(groupNames[0] || "");
        setCurrentChannelIndex(0);

        if (parsedChannels.length > 0) {
          showChannelTitle(buildChannelDisplayTitle(parsedChannels[0]));
        }
        setIsLoading(false);
      }
    };
    loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m3uUrl, apiBaseUrl]);

  const showChannelTitle = (title: string) => {
    setChannelTitle(title);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => setChannelTitle(null), 3000);
  };

  // 频道标题附带 EPG 当前节目（有 EPG 数据时）
  const buildChannelDisplayTitle = (channel: Channel): string => {
    if (!epgData) return channel.name;
    const prog = getCurrentProgramme(epgData, buildEpgKeys(epgData, channel));
    return prog ? `${channel.name} · ${prog.title}（${formatProgrammeTime(prog)}）` : channel.name;
  };

  // 回看：目标频道的完整节目单（EPG 含 78h 回溯窗口，配合 NAS 72h 录制档案）
  const replayProgrammes = useMemo<EpgProgramme[]>(
    () => (replayChannel ? findEpgProgrammes(epgData, replayChannel) : []),
    [epgData, replayChannel]
  );
  replayProgrammesRef.current = replayProgrammes;

  // 频道表里长按确认键打开回看节目单：光标落在当前节目，否则落在最后一个已播节目
  const openReplayList = (channel: Channel) => {
    const serverUrl = useSettingsStore.getState().replayServerUrl;
    if (!serverUrl) {
      Toast.show({ type: "info", text1: "未配置回看服务", text2: "请在设置-直播源中填写回看服务地址" });
      return;
    }
    if (!recordedChannelsRef.current.has(channel.name)) {
      Toast.show({ type: "info", text1: "该频道未开启录制回看" });
      return;
    }
    const list = findEpgProgrammes(epgDataRef.current, channel);
    if (list.length === 0) {
      Toast.show({ type: "info", text1: "该频道暂无节目单", text2: "请确认已在设置中填写 EPG 地址" });
      return;
    }
    const now = Date.now();
    let idx = list.findIndex((p) => p.start <= now && now < p.stop);
    if (idx === -1) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].stop <= now) {
          idx = i;
          break;
        }
      }
      if (idx === -1) idx = 0;
    }
    replayCursorRef.current = idx;
    setReplayCursor(idx);
    setReplayChannel(channel);
  };

  const moveReplayCursor = (delta: number) => {
    const list = replayProgrammesRef.current;
    if (list.length === 0) return;
    let next = replayCursorRef.current + delta;
    if (next < 0) next = 0;
    if (next > list.length - 1) next = list.length - 1;
    if (next === replayCursorRef.current) return;
    replayCursorRef.current = next;
    setReplayCursor(next);
    try {
      replayListRef.current?.scrollToIndex({ index: next, animated: false, viewPosition: 0.5 });
    } catch {
      // FlashList 尚未挂载时忽略
    }
  };

  // 选中节目开始回看：只播已播完的时间窗（正在播/未播的节目没有完整录像）
  const playReplay = (prog: EpgProgramme) => {
    const channel = replayChannelRef.current;
    const serverUrl = useSettingsStore.getState().replayServerUrl;
    if (!channel || !serverUrl) return;
    if (prog.stop > Date.now()) {
      Toast.show({ type: "info", text1: "节目尚未播完，暂不可回看" });
      return;
    }
    const url = buildReplayUrl(serverUrl, channel.name, prog.start, prog.stop);
    setReplaySession({ url, title: prog.title, channelName: channel.name, channel });
    setReplayChannel(null);
  };

  const exitReplay = () => setReplaySession(null);

  // 收藏/取消收藏并给出反馈
  const toggleFavoriteAndToast = async (channel: Channel) => {
    const isFav = await toggleFavorite(channel.id);
    Toast.show({
      type: "success",
      text1: isFav ? "已加入收藏" : "已取消收藏",
      text2: channel.name,
    });
  };

  // 手机扫码远程输入搜索词（与搜索页同一套 WebSocket 远程输入）
  const handleQrPress = () => {
    if (!remoteInputEnabled) {
      Toast.show({
        type: "info",
        text1: "远程输入未启用",
        text2: "请先在设置页面中启用远程输入功能",
      });
      return;
    }
    showRemoteModal("live");
  };

  // TV 播放界面按上键：循环切换画面比例（getState 避免闭包拿到旧值）
  const cycleResizeModeWithToast = () => {
    const { videoResizeMode, setVideoResizeMode } = useSettingsStore.getState();
    const next = nextResizeMode(videoResizeMode);
    setVideoResizeMode(next);
    Toast.show({ type: "info", text1: `画面比例：${RESIZE_MODE_LABELS[next]}` });
  };

  const scrollToRow = (index: number, center = true) => {
    try {
      channelListRef.current?.scrollToIndex({ index, animated: false, viewPosition: center ? 0.5 : 0 });
    } catch {
      // getItemLayout makes this reliable; ignore rare races
    }
  };

  // 打开频道列表时，把光标定位到当前正在播放的频道并滚动到它。
  // 搜索模式（含远程输入直投）下不重置光标，保留在搜索结果顶部。
  useEffect(() => {
    if (!isChannelListVisible || channels.length === 0 || searchModeRef.current) return;
    const current = channels[currentChannelIndex];
    if (!current) return;
    const group = current.group || "Other";
    setSelectedGroup(group);

    const list = groupedChannels[group] || [];
    const idx = Math.max(0, list.findIndex((c) => c.id === current.id));
    cursorRef.current = idx;
    setListSelectedIndex(idx);

    const t = setTimeout(() => scrollToRow(idx), 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChannelListVisible]);

  // 播放回看中按返回键：退出回看回到直播（拦截系统返回，不退出 App）
  useEffect(() => {
    if (!replaySession) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setReplaySession(null);
      return true;
    });
    return () => sub.remove();
  }, [replaySession]);

  // 回看节目单打开时滚动到光标位置（当前节目）
  useEffect(() => {
    if (!replayChannel) return;
    const t = setTimeout(() => {
      try {
        replayListRef.current?.scrollToIndex({ index: replayCursorRef.current, animated: false, viewPosition: 0.5 });
      } catch {
        // FlashList 尚未挂载时忽略
      }
    }, 200);
    return () => clearTimeout(t);
  }, [replayChannel]);

  // 关闭列表 / 卸载时清理快速滚动定时器
  const stopFast = () => {
    if (fastIntervalRef.current) {
      clearInterval(fastIntervalRef.current);
      fastIntervalRef.current = null;
    }
  };
  // 关闭列表时停掉快速滚动并清空搜索词
  useEffect(() => {
    if (!isChannelListVisible) {
      stopFast();
      setSearchKeyword("");
    }
  }, [isChannelListVisible]);
  useEffect(() => () => stopFast(), []);

  const handleSelectChannel = (channel: Channel) => {
    const globalIndex = channels.findIndex((c) => c.id === channel.id);
    if (globalIndex !== -1) {
      setReplaySession(null); // 换台即退出回看
      setCurrentChannelIndex(globalIndex);
      showChannelTitle(buildChannelDisplayTitle(channel));
      setIsChannelListVisible(false);
    }
  };

  // 列表内：移动光标（上下键 / 长按快速连跳都走这里）
  const moveCursor = (delta: number) => {
    const list = groupListRef.current;
    if (list.length === 0) return;
    let next = cursorRef.current + delta;
    if (next < 0) next = 0;
    if (next > list.length - 1) next = list.length - 1;
    if (next === cursorRef.current) return;
    cursorRef.current = next;
    setListSelectedIndex(next);
    scrollToRow(next);
  };

  // 列表内：左右键切换分组
  const changeGroup = (delta: number) => {
    const groups = channelGroupsRef.current;
    if (groups.length <= 1) return;
    const gi = groups.indexOf(selectedGroupRef.current);
    let ni = gi + delta;
    if (ni < 0) ni = 0;
    if (ni > groups.length - 1) ni = groups.length - 1;
    if (ni === gi) return;
    setSelectedGroup(groups[ni]);
    cursorRef.current = 0;
    setListSelectedIndex(0);
    setTimeout(() => {
      try {
        channelListRef.current?.scrollToOffset({ offset: 0, animated: false });
      } catch {}
    }, 0);
  };

  // 防止一次按键触发多次（select/longSelect 可能连续到达）
  const lastConfirmRef = useRef(0);
  // 最近一次长按确认键的时间：长按后的 select 抬起事件要作废，避免一按两触发
  const lastLongSelectRef = useRef(0);
  const confirmSelect = () => {
    const now = Date.now();
    if (now - lastConfirmRef.current < 400) return;
    lastConfirmRef.current = now;
    const ch = groupListRef.current[cursorRef.current];
    if (ch) handleSelectChannel(ch);
  };

  const startFast = (delta: number) => {
    stopFast();
    moveCursor(delta);
    fastIntervalRef.current = setInterval(() => moveCursor(delta), 70);
  };

  const changeChannel = useCallback(
    (direction: "next" | "prev") => {
      if (channels.length === 0) return;
      let newIndex =
        direction === "next"
          ? (currentChannelIndex + 1) % channels.length
          : (currentChannelIndex - 1 + channels.length) % channels.length;
      setCurrentChannelIndex(newIndex);
      showChannelTitle(buildChannelDisplayTitle(channels[newIndex]));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channels, currentChannelIndex, epgData]
  );

  const handleTVEvent = useCallback(
    (event: HWEvent) => {
      if (deviceType !== "tv") return;
      // 搜索框聚焦时按键交给系统键盘/输入框，不做列表导航
      if (isSearchFocused) return;
      const type = event?.eventType;
      const action = (event as any)?.eventKeyAction;

      // 回看节目单面板打开时接管按键：上下选节目、确认回看、菜单/返回关闭
      if (replayChannelRef.current) {
        switch (type) {
          case "up":
            moveReplayCursor(-1);
            break;
          case "down":
            moveReplayCursor(1);
            break;
          case "select": {
            // 按下(action=0)不处理，等抬起；长按后的抬起作废，避免一按两触发
            if (action === 0) break;
            if (Date.now() - lastLongSelectRef.current < 600) break;
            const prog = replayProgrammesRef.current[replayCursorRef.current];
            if (prog) playReplay(prog);
            break;
          }
          case "longSelect": {
            lastLongSelectRef.current = Date.now();
            const prog = replayProgrammesRef.current[replayCursorRef.current];
            if (prog) playReplay(prog);
            break;
          }
          case "menu":
          case "contextMenu":
          case "back":
            setReplayChannel(null);
            break;
        }
        return;
      }

      if (!isChannelListVisible) {
        // 播放器界面：左右换台（同时退出回看），下键打开节目表，上键切换画面比例，
        // 菜单键退出回看，加载失败时确认键重试当前流
        if (type === "down") setIsChannelListVisible(true);
        else if (type === "left") {
          exitReplay();
          changeChannel("prev");
        } else if (type === "right") {
          exitReplay();
          changeChannel("next");
        } else if (type === "up") cycleResizeModeWithToast();
        else if (type === "menu" || type === "contextMenu") {
          // 回看播放中按菜单键：直接打开该频道的节目单（方便接着选下一集）
          const sess = replaySessionRef.current;
          if (sess) openReplayList(sess.channel);
        }
        else if ((type === "select" || type === "playPause") && playbackFailedRef.current) {
          setRetryKey((k) => k + 1);
        }
        return;
      }

      // 节目表界面：方向键与确认键都由这里自管（隐藏的焦点陷阱视图无法可靠收到
      // 确认键的 onPress，所以 select 必须在这里处理）
      switch (type) {
        case "select":
          // 按下(action=0)不处理，等抬起；长按后的抬起作废，避免一按两触发
          if (action === 0) break;
          if (Date.now() - lastLongSelectRef.current < 600) break;
          confirmSelect();
          break;
        case "longSelect": {
          // 长按确认键：收藏/取消收藏光标所在频道（与手机端长按一致）
          lastLongSelectRef.current = Date.now();
          const ch = groupListRef.current[cursorRef.current];
          if (ch) void toggleFavoriteAndToast(ch);
          break;
        }
        case "menu":
        case "contextMenu": {
          // TV 端：菜单键打开光标所在频道的回看节目单
          const ch = groupListRef.current[cursorRef.current];
          if (ch) openReplayList(ch);
          break;
        }
        case "up":
          // 光标已在首行时再按上：焦点交给搜索框（TV 端弹系统键盘输入）
          if (cursorRef.current === 0) {
            searchInputRef.current?.focus();
          } else {
            moveCursor(-1);
          }
          break;
        case "down":
          moveCursor(1);
          break;
        case "left":
          // 搜索模式下隐藏了分组列，左右键不切换分组
          if (!searchModeRef.current) changeGroup(-1);
          break;
        case "right":
          if (!searchModeRef.current) changeGroup(1);
          break;
        case "longUp":
          if (action === 0) {
            startFast(-1);
          } else {
            stopFast();
          }
          break;
        case "longDown":
          if (action === 0) {
            startFast(1);
          } else {
            stopFast();
          }
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deviceType, isChannelListVisible, isSearchFocused, changeChannel]
  );

  useTVEventHandler(deviceType === "tv" ? handleTVEvent : () => {});

  // 动态样式
  const dynamicStyles = createResponsiveStyles(deviceType, spacing);

  const renderLiveContent = () => (
    <>
      <LivePlayer
        streamUrl={replaySession ? replaySession.url : selectedChannelUrl}
        channelTitle={
          replaySession ? `回看 · ${replaySession.channelName} · ${replaySession.title}` : channelTitle
        }
        onPlaybackStatusUpdate={() => {}}
        retryKey={retryKey}
        onPlaybackError={setPlaybackFailed}
      />
      {/* 回看播放中：右上角常驻水印式标志（镂空透明，不挡画面与台标位） */}
      {replaySession && (
        <View style={styles.replayOverlay} pointerEvents="none">
          <Text style={styles.replayOverlayBadge}>回看</Text>
          <Text style={styles.replayOverlayText} numberOfLines={1}>
            {replaySession.title}
          </Text>
        </View>
      )}
      {/* 移动端/平板：加载失败时点按重试（TV 端走确认键） */}
      {playbackFailed && deviceType !== "tv" && (
        <Pressable style={styles.retryTouchOverlay} onPress={() => setRetryKey((k) => k + 1)} />
      )}
      {isLoading && channels.length === 0 && (
        <View style={styles.centerOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.overlayText}>正在加载直播源...</Text>
        </View>
      )}
      {!isLoading && channels.length === 0 && (
        <View style={styles.centerOverlay} pointerEvents="none">
          <Text style={styles.overlayText}>未获取到直播源</Text>
          <Text style={styles.overlaySubText}>
            请在后端(管理员设置-直播源配置)添加并启用直播源，或在设置里填写 M3U 直播源地址
          </Text>
        </View>
      )}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isChannelListVisible}
        onRequestClose={() => setIsChannelListVisible(false)}
      >
        <View style={dynamicStyles.modalContainer}>
          <View style={dynamicStyles.modalContent}>
            {/* 焦点陷阱：唯一可聚焦元素，兜住焦点避免系统焦点乱跳。
                按键处理（含确认键）统一在 handleTVEvent 里完成。 */}
            <Pressable focusable hasTVPreferredFocus style={styles.focusTrap} />
            {/* 搜索行：移动端直接点按输入；TV 端光标在首行时再按上键聚焦，
                也可扫码用手机远程输入。 */}
            <View style={dynamicStyles.searchRow}>
              <TextInput
                ref={searchInputRef}
                style={dynamicStyles.searchInput}
                placeholder={deviceType === "tv" ? "搜索频道（拼音/首字母 · 首行按上键输入）" : "搜索频道（拼音 / 首字母）"}
                placeholderTextColor="#888"
                value={searchKeyword}
                onChangeText={setSearchKeyword}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                returnKeyType="search"
              />
              {deviceType !== "mobile" && (
                <Pressable style={dynamicStyles.qrButton} onPress={handleQrPress}>
                  <QrCode size={deviceType === "tv" ? 22 : 18} color="white" />
                </Pressable>
              )}
            </View>
            <View style={dynamicStyles.listContainer}>
              {/* 搜索模式下隐藏分组列，结果为跨分组平铺列表 */}
              {!isSearchMode && (
                <View style={dynamicStyles.groupColumn}>
                  <FlatList
                    data={displayGroups}
                    keyExtractor={(item, index) => `group-${item}-${index}`}
                    extraData={selectedGroup}
                    renderItem={({ item }) => {
                      const active = selectedGroup === item;
                      return (
                        <View style={[dynamicStyles.groupRow, active && styles.rowActive]}>
                          <Text
                            numberOfLines={1}
                            style={[dynamicStyles.groupRowText, active && styles.rowActiveText]}
                          >
                            {item}
                          </Text>
                        </View>
                      );
                    }}
                  />
                </View>
              )}
              <View style={dynamicStyles.channelColumn}>
                {isLoading ? (
                  <ActivityIndicator size="large" />
                ) : isSearchMode && activeList.length === 0 ? (
                  <View style={styles.emptyResult}>
                    <Text style={styles.emptyResultText}>没有匹配「{trimmedKeyword}」的频道</Text>
                  </View>
                ) : (
                  <FlashList
                    ref={channelListRef}
                    data={activeList}
                    keyExtractor={(item, index) => `${item.id}-${index}`}
                    extraData={`${listSelectedIndex}-${currentChannelIndex}|${favoriteIds.join(",")}|${trimmedKeyword}|${[...recordedChannels].join(",")}|${epgChannelNames.size}:${epgData?.fetchedAt ?? 0}`}
                    estimatedItemSize={CHANNEL_ROW_HEIGHT}
                    renderItem={({ item, index }) => {
                      const isCursor = index === listSelectedIndex;
                      const isPlaying = channels[currentChannelIndex]?.id === item.id;
                      const isFav = favoriteIds.includes(item.id);
                      return (
                        // TV 端行不可聚焦（焦点由陷阱视图 + handleTVEvent 自管），
                        // 移动端/平板端通过 onPress 触摸选台、长按收藏。
                        <Pressable
                          focusable={deviceType !== "tv"}
                          onPress={() => handleSelectChannel(item)}
                          onLongPress={() => {
                            void toggleFavoriteAndToast(item);
                          }}
                        >
                          <View
                            style={[
                              dynamicStyles.channelRow,
                              { height: CHANNEL_ROW_HEIGHT },
                              isCursor && styles.rowActive,
                            ]}
                          >
                            {/* 左边固定槽位：能回看的频道才有「回看」标，无标时占位对齐 */}
                            <View style={styles.badgeSlotLeft}>
                              {item.catchupSource || recordedChannels.has(item.name) ? (
                                <Text style={styles.catchupBadge}>回看</Text>
                              ) : null}
                            </View>
                            {isPlaying && <View style={styles.playingDot} />}
                            {isFav && <Text style={styles.favStar}>★</Text>}
                            <Text
                              numberOfLines={1}
                              style={[
                                dynamicStyles.channelRowText,
                                isCursor && styles.rowActiveText,
                                isPlaying && !isCursor && styles.playingText,
                              ]}
                            >
                              {item.name || "未知频道"}
                            </Text>
                            {/* 右边固定位置：有 EPG 节目单的频道显示「节目单」标 */}
                            {epgChannelNames.has(item.name) ? (
                              <Text style={styles.epgBadge}>节目单</Text>
                            ) : null}
                          </View>
                        </Pressable>
                      );
                    }}
                  />
                )}
              </View>
            </View>
            <Text style={[styles.replayHint, { marginTop: 8, marginBottom: 0 }]}>
              {deviceType === "tv" ? "确认键播放 · 菜单键打开回看 · 长按确认键收藏" : "点按播放 · 长按收藏"}
            </Text>
          </View>
        </View>
      </Modal>
      {/* 回看节目单：频道表里按菜单键打开；上下选择、确认回看已播节目、菜单/返回关闭 */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={!!replayChannel}
        onRequestClose={() => setReplayChannel(null)}
      >
        <View style={dynamicStyles.modalContainer}>
          <View style={dynamicStyles.modalContent}>
            {/* 焦点陷阱：与频道表同一套自管按键方案（handleTVEvent） */}
            <Pressable focusable hasTVPreferredFocus style={styles.focusTrap} />
            <Text style={styles.replayTitle} numberOfLines={1}>
              {replayChannel ? `${replayChannel.name} · 节目单` : ""}
            </Text>
            <Text style={styles.replayHint}>确认键回看已播节目 · 菜单键/返回键关闭</Text>
            <FlashList
              ref={replayListRef}
              data={replayProgrammes}
              keyExtractor={(item, index) => `${item.start}-${index}`}
              extraData={replayCursor}
              estimatedItemSize={40}
              renderItem={({ item, index }) => {
                const isCursor = index === replayCursor;
                const now = Date.now();
                const playable = item.stop <= now;
                const onAir = item.start <= now && now < item.stop;
                return (
                  <Pressable focusable={deviceType !== "tv"} onPress={() => playReplay(item)}>
                    <View style={[dynamicStyles.channelRow, { height: 40 }, isCursor && styles.rowActive]}>
                      <Text
                        numberOfLines={1}
                        style={[
                          dynamicStyles.channelRowText,
                          isCursor && styles.rowActiveText,
                          !playable && styles.replayFutureText,
                        ]}
                      >
                        {`${formatReplayRowTime(item)}  ${item.title}${onAir ? "（正在播）" : ""}`}
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>
      <RemoteControlModal />
    </>
  );

  const content = (
    <ThemedView style={[commonStyles.container, dynamicStyles.container]}>
      {renderLiveContent()}
    </ThemedView>
  );

  // 根据设备类型决定是否包装在响应式导航中
  if (deviceType === 'tv') {
    return content;
  }

  return (
    <ResponsiveNavigation>
      <ResponsiveHeader title="直播" showBackButton />
      {content}
    </ResponsiveNavigation>
  );
}

const styles = StyleSheet.create({
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  overlayText: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 12,
    textAlign: "center",
  },
  overlaySubText: {
    color: "#bbb",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
    lineHeight: 20,
  },
  focusTrap: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  retryTouchOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  rowActive: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 6,
  },
  rowActiveText: {
    color: "#fff",
    fontWeight: "bold",
  },
  playingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.dark.primary,
    marginRight: 8,
  },
  playingText: {
    color: Colors.dark.primary,
  },
  favStar: {
    color: "#f5c518",
    fontSize: 12,
    marginRight: 6,
  },
  emptyResult: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  emptyResultText: {
    color: "#999",
    fontSize: 14,
    textAlign: "center",
  },
  catchupBadge: {
    color: "#9ec9ff",
    fontSize: 10,
    borderWidth: 1,
    borderColor: "rgba(158, 201, 255, 0.6)",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginLeft: 8,
    overflow: "hidden",
  },
  replayTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 4,
  },
  replayHint: {
    color: "#999",
    fontSize: 12,
    marginBottom: 10,
  },
  replayFutureText: {
    color: "#666",
  },
  badgeSlotLeft: {
    width: 34,
    marginRight: 2,
    alignItems: "flex-start",
  },
  epgBadge: {
    color: "#a8e6b8",
    fontSize: 10,
    borderWidth: 1,
    borderColor: "rgba(168, 230, 184, 0.6)",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginLeft: "auto",
    overflow: "hidden",
  },
  replayOverlay: {
    position: "absolute",
    top: 24,
    right: 24,
    alignItems: "center",
    maxWidth: "40%",
  },
  replayOverlayBadge: {
    color: "#9ec9ff",
    fontSize: 13,
    fontWeight: "bold",
    borderWidth: 1,
    borderColor: "rgba(158, 201, 255, 0.6)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginBottom: 4,
    overflow: "hidden",
    textShadowColor: "rgba(0, 0, 0, 0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  replayOverlayText: {
    color: "#eee",
    fontSize: 12,
    textAlign: "center",
    textShadowColor: "rgba(0, 0, 0, 0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});

const createResponsiveStyles = (deviceType: string, spacing: number) => {
  const isMobile = deviceType === 'mobile';
  const isTablet = deviceType === 'tablet';

  return StyleSheet.create({
    container: {
      flex: 1,
    },
    modalContainer: {
      flex: 1,
      flexDirection: "row",
      justifyContent: isMobile ? "center" : "flex-end",
      backgroundColor: "transparent",
    },
    modalContent: {
      width: isMobile ? '90%' : isTablet ? 400 : 450,
      height: "100%",
      backgroundColor: "rgba(0, 0, 0, 0.85)",
      padding: spacing,
    },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing / 2,
    },
    searchInput: {
      flex: 1,
      height: isMobile ? 44 : 40,
      backgroundColor: "#2c2c2e",
      borderRadius: 8,
      paddingHorizontal: spacing / 2,
      color: "white",
      fontSize: isMobile ? 16 : 15,
    },
    qrButton: {
      width: isMobile ? 44 : 40,
      height: isMobile ? 44 : 40,
      marginLeft: spacing / 2,
      borderRadius: 8,
      backgroundColor: "#2c2c2e",
      justifyContent: "center",
      alignItems: "center",
    },
    listContainer: {
      flex: 1,
      flexDirection: isMobile ? "column" : "row",
    },
    groupColumn: {
      flex: isMobile ? 0 : 1,
      marginRight: isMobile ? 0 : spacing / 2,
      marginBottom: isMobile ? spacing : 0,
      maxHeight: isMobile ? 120 : undefined,
    },
    channelColumn: {
      flex: isMobile ? 1 : 2,
    },
    groupRow: {
      paddingVertical: 8,
      paddingHorizontal: spacing / 2,
      marginVertical: 3,
      borderRadius: 6,
      justifyContent: "center",
    },
    groupRowText: {
      fontSize: isMobile ? 14 : 13,
      color: "#ddd",
    },
    channelRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing,
    },
    channelRowText: {
      fontSize: isMobile ? 14 : 12,
      color: "#ddd",
      flexShrink: 1,
    },
  });
};
