import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { View, FlatList, StyleSheet, ActivityIndicator, Modal, useTVEventHandler, HWEvent, Text, TextInput, Pressable } from "react-native";
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
import { EpgData, fetchEpg, getCurrentProgramme, buildEpgKeys, formatProgrammeTime } from "@/services/epg";
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

export default function LiveScreen() {
  const { m3uUrl, apiBaseUrl, epgUrl, remoteInputEnabled } = useSettingsStore();
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
  // 频道搜索：有关键词时节目表切换为跨分组搜索结果模式
  const [searchKeyword, setSearchKeyword] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
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

      if (!isChannelListVisible) {
        // 播放器界面：左右换台，下键打开节目表
        if (type === "down") setIsChannelListVisible(true);
        else if (type === "left") changeChannel("prev");
        else if (type === "right") changeChannel("next");
        return;
      }

      // 节目表界面：方向键与确认键都由这里自管（隐藏的焦点陷阱视图无法可靠收到
      // 确认键的 onPress，所以 select 必须在这里处理）
      switch (type) {
        case "select":
        case "longSelect":
          confirmSelect();
          break;
        case "menu":
        case "contextMenu": {
          // TV 端：菜单键收藏/取消收藏光标所在频道
          const ch = groupListRef.current[cursorRef.current];
          if (ch) void toggleFavoriteAndToast(ch);
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
        streamUrl={selectedChannelUrl}
        channelTitle={channelTitle}
        onPlaybackStatusUpdate={() => {}}
      />
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
                placeholder={deviceType === "tv" ? "搜索频道（首行再按上键输入）" : "搜索频道（拼音 / 首字母）"}
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
                    extraData={`${listSelectedIndex}-${currentChannelIndex}|${favoriteIds.join(",")}|${trimmedKeyword}`}
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
                            {item.catchupSource ? <Text style={styles.catchupBadge}>回看</Text> : null}
                          </View>
                        </Pressable>
                      );
                    }}
                  />
                )}
              </View>
            </View>
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
