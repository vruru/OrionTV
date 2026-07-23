import React, { useState, useEffect, useCallback, useRef } from "react";
import { View, FlatList, StyleSheet, ActivityIndicator, Modal, useTVEventHandler, HWEvent, Text } from "react-native";
import LivePlayer from "@/components/LivePlayer";
import { fetchAndParseM3u, getPlayableUrl, Channel } from "@/services/m3u";
import { api } from "@/services/api";
import { ThemedView } from "@/components/ThemedView";
import { StyledButton } from "@/components/StyledButton";
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
  const titleTimer = useRef<NodeJS.Timeout | null>(null);

  const selectedChannelUrl = channels.length > 0 ? getPlayableUrl(channels[currentChannelIndex].url) : null;

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

  const handleSelectChannel = (channel: Channel) => {
    const globalIndex = channels.findIndex((c) => c.id === channel.id);
    if (globalIndex !== -1) {
      setCurrentChannelIndex(globalIndex);
      showChannelTitle(channel.name);
      setIsChannelListVisible(false);
    }
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
      if (deviceType !== 'tv') return;
      if (isChannelListVisible) return;
      if (event.eventType === "down") setIsChannelListVisible(true);
      else if (event.eventType === "left") changeChannel("prev");
      else if (event.eventType === "right") changeChannel("next");
    },
    [changeChannel, isChannelListVisible, deviceType]
  );

  useTVEventHandler(deviceType === 'tv' ? handleTVEvent : () => {});

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
            <Text style={dynamicStyles.modalTitle}>选择频道</Text>
            <View style={dynamicStyles.listContainer}>
              <View style={dynamicStyles.groupColumn}>
                <FlatList
                  data={channelGroups}
                  keyExtractor={(item, index) => `group-${item}-${index}`}
                  renderItem={({ item }) => (
                    <StyledButton
                      text={item}
                      onPress={() => setSelectedGroup(item)}
                      isSelected={selectedGroup === item}
                      style={dynamicStyles.groupButton}
                      textStyle={dynamicStyles.groupButtonText}
                    />
                  )}
                />
              </View>
              <View style={dynamicStyles.channelColumn}>
                {isLoading ? (
                  <ActivityIndicator size="large" />
                ) : (
                  <FlatList
                    data={groupedChannels[selectedGroup] || []}
                    keyExtractor={(item, index) => `${item.id}-${item.group}-${index}`}
                    renderItem={({ item }) => (
                      <StyledButton
                        text={item.name || "Unknown Channel"}
                        onPress={() => handleSelectChannel(item)}
                        isSelected={channels[currentChannelIndex]?.id === item.id}
                        hasTVPreferredFocus={channels[currentChannelIndex]?.id === item.id}
                        style={dynamicStyles.channelItem}
                        textStyle={dynamicStyles.channelItemText}
                      />
                    )}
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
    groupButton: {
      paddingVertical: isMobile ? minTouchTarget / 4 : 8,
      paddingHorizontal: spacing / 2,
      marginVertical: isMobile ? 2 : 4,
      minHeight: isMobile ? minTouchTarget * 0.7 : undefined,
    },
    groupButtonText: {
      fontSize: isMobile ? 14 : 13,
    },
    channelItem: {
      paddingVertical: isMobile ? minTouchTarget / 5 : 6,
      paddingHorizontal: spacing,
      marginVertical: isMobile ? 2 : 3,
      minHeight: isMobile ? minTouchTarget * 0.8 : undefined,
    },
    channelItemText: {
      fontSize: isMobile ? 14 : 12,
    },
  });
};
