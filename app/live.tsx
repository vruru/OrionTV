import React, { useState, useEffect, useCallback, useRef } from "react";
import { View, FlatList, StyleSheet, ActivityIndicator, Modal, useTVEventHandler, HWEvent, Text, Pressable } from "react-native";
import LivePlayer from "@/components/LivePlayer";
import { fetchAndParseM3u, getPlayableUrl, Channel } from "@/services/m3u";
import { api } from "@/services/api";
import { ThemedView } from "@/components/ThemedView";
import { Colors } from "@/constants/Colors";
import { useSettingsStore } from "@/stores/settingsStore";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("LiveScreen");
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import ResponsiveHeader from "@/components/navigation/ResponsiveHeader";
import { DeviceUtils } from "@/utils/DeviceUtils";

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
  const { m3uUrl, apiBaseUrl } = useSettingsStore();
  
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
  // Self-managed cursor within the current group's channel list (like TiviMate
  // etc.): we don't rely on the OS focus engine to move through the list.
  const [listSelectedIndex, setListSelectedIndex] = useState(0);
  const titleTimer = useRef<NodeJS.Timeout | null>(null);
  const channelListRef = useRef<FlatList<Channel>>(null);
  // Refs holding the latest values so key-repeat intervals read fresh data.
  const cursorRef = useRef(0);
  const groupListRef = useRef<Channel[]>([]);
  const selectedGroupRef = useRef("");
  const channelGroupsRef = useRef<string[]>([]);
  const fastIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const CHANNEL_ROW_HEIGHT = deviceType === "mobile" ? 48 : 42;

  const selectedChannelUrl = channels.length > 0 ? getPlayableUrl(channels[currentChannelIndex].url) : null;

  // Keep refs in sync with the latest render.
  const currentGroupList = groupedChannels[selectedGroup] || [];
  groupListRef.current = currentGroupList;
  selectedGroupRef.current = selectedGroup;
  channelGroupsRef.current = channelGroups;

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
          showChannelTitle(parsedChannels[0].name);
        }
        setIsLoading(false);
      }
    };
    loadChannels();
  }, [m3uUrl, apiBaseUrl]);

  const showChannelTitle = (title: string) => {
    setChannelTitle(title);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => setChannelTitle(null), 3000);
  };

  const scrollToRow = (index: number, center = true) => {
    try {
      channelListRef.current?.scrollToIndex({ index, animated: false, viewPosition: center ? 0.5 : 0 });
    } catch {
      // getItemLayout makes this reliable; ignore rare races
    }
  };

  // 打开频道列表时，把光标定位到当前正在播放的频道并滚动到它。
  useEffect(() => {
    if (!isChannelListVisible || channels.length === 0) return;
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
  useEffect(() => {
    if (!isChannelListVisible) stopFast();
  }, [isChannelListVisible]);
  useEffect(() => () => stopFast(), []);

  const handleSelectChannel = (channel: Channel) => {
    const globalIndex = channels.findIndex((c) => c.id === channel.id);
    if (globalIndex !== -1) {
      setCurrentChannelIndex(globalIndex);
      showChannelTitle(channel.name);
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

  const confirmSelect = () => {
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
      showChannelTitle(channels[newIndex].name);
    },
    [channels, currentChannelIndex]
  );

  const handleTVEvent = useCallback(
    (event: HWEvent) => {
      if (deviceType !== "tv") return;
      const type = event?.eventType;
      const action = (event as any)?.eventKeyAction;

      if (!isChannelListVisible) {
        // 播放器界面：左右换台，下键打开节目表
        if (type === "down") setIsChannelListVisible(true);
        else if (type === "left") changeChannel("prev");
        else if (type === "right") changeChannel("next");
        return;
      }

      // 节目表界面：自管光标（select 由焦点陷阱 Pressable 的 onPress 处理，避免重复）
      switch (type) {
        case "up":
          moveCursor(-1);
          break;
        case "down":
          moveCursor(1);
          break;
        case "left":
          changeGroup(-1);
          break;
        case "right":
          changeGroup(1);
          break;
        case "longUp":
          action === 0 ? startFast(-1) : stopFast();
          break;
        case "longDown":
          action === 0 ? startFast(1) : stopFast();
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deviceType, isChannelListVisible, changeChannel]
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
            {/* 焦点陷阱：唯一可聚焦元素，确保方向键事件交给我们自管、OK 触发选择 */}
            <Pressable
              focusable
              hasTVPreferredFocus
              onPress={confirmSelect}
              style={styles.focusTrap}
            />
            <Text style={dynamicStyles.modalTitle}>选择频道（左右切换分类 · 上下选频道 · 确认播放）</Text>
            <View style={dynamicStyles.listContainer}>
              <View style={dynamicStyles.groupColumn}>
                <FlatList
                  data={channelGroups}
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
              <View style={dynamicStyles.channelColumn}>
                {isLoading ? (
                  <ActivityIndicator size="large" />
                ) : (
                  <FlatList
                    ref={channelListRef}
                    data={currentGroupList}
                    keyExtractor={(item, index) => `${item.id}-${index}`}
                    extraData={`${listSelectedIndex}-${currentChannelIndex}`}
                    getItemLayout={(_, index) => ({
                      length: CHANNEL_ROW_HEIGHT,
                      offset: CHANNEL_ROW_HEIGHT * index,
                      index,
                    })}
                    initialNumToRender={20}
                    maxToRenderPerBatch={20}
                    windowSize={15}
                    renderItem={({ item, index }) => {
                      const isCursor = index === listSelectedIndex;
                      const isPlaying = channels[currentChannelIndex]?.id === item.id;
                      return (
                        <View
                          style={[
                            dynamicStyles.channelRow,
                            { height: CHANNEL_ROW_HEIGHT },
                            isCursor && styles.rowActive,
                          ]}
                        >
                          {isPlaying && <View style={styles.playingDot} />}
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
                        </View>
                      );
                    }}
                  />
                )}
              </View>
            </View>
          </View>
        </View>
      </Modal>
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
});

const createResponsiveStyles = (deviceType: string, spacing: number) => {
  const isMobile = deviceType === 'mobile';
  const isTablet = deviceType === 'tablet';
  const minTouchTarget = DeviceUtils.getMinTouchTargetSize();

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
    modalTitle: {
      color: "white",
      marginBottom: spacing / 2,
      textAlign: "center",
      fontSize: isMobile ? 18 : 16,
      fontWeight: "bold",
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
      fontSize: isMobile ? 14 : 13,
      color: "#ddd",
      flexShrink: 1,
    },
  });
};
