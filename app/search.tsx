import React, { useState, useRef, useEffect } from "react";
import { View, TextInput, StyleSheet, Alert, Keyboard, TouchableOpacity, Pressable } from "react-native";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import VideoCard from "@/components/VideoCard";
import VideoLoadingAnimation from "@/components/VideoLoadingAnimation";
import { api, SearchResult } from "@/services/api";
import { Search, QrCode } from "lucide-react-native";
import { StyledButton } from "@/components/StyledButton";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { RemoteControlModal } from "@/components/RemoteControlModal";
import { useSettingsStore } from "@/stores/settingsStore";
import useSearchHistoryStore from "@/stores/searchHistoryStore";
import { useRouter } from "expo-router";
import { Colors } from "@/constants/Colors";
import CustomScrollView from "@/components/CustomScrollView";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import ResponsiveHeader from "@/components/navigation/ResponsiveHeader";
import { DeviceUtils } from "@/utils/DeviceUtils";
import Logger from '@/utils/Logger';

const logger = Logger.withTag('SearchScreen');

export default function SearchScreen() {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textInputRef = useRef<TextInput>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  // 实时搜索建议（输入防抖后取前几个标题）
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const suggestionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionSeq = useRef(0);
  const { showModal: showRemoteModal, lastMessage, targetPage, clearMessage } = useRemoteControlStore();
  const { remoteInputEnabled } = useSettingsStore();
  const { history, load: loadHistory, add: addHistory, clear: clearHistory } = useSearchHistoryStore();
  const router = useRouter();

  // 响应式布局配置
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType, spacing } = responsiveConfig;

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // 输入防抖 300ms 拉取搜索建议；序号守卫丢弃过期响应
  useEffect(() => {
    const term = keyword.trim();
    if (suggestionTimer.current) clearTimeout(suggestionTimer.current);
    if (!term) {
      setSuggestions([]);
      return;
    }
    suggestionTimer.current = setTimeout(async () => {
      const seq = ++suggestionSeq.current;
      try {
        const res = await api.searchVideos(term);
        if (seq !== suggestionSeq.current) return;
        const titles = res.results.map((r) => r.title).filter(Boolean);
        setSuggestions([...new Set(titles)].slice(0, 8));
      } catch {
        if (seq === suggestionSeq.current) setSuggestions([]);
      }
    }, 300);
    return () => {
      if (suggestionTimer.current) clearTimeout(suggestionTimer.current);
    };
  }, [keyword]);

  useEffect(() => {
    if (lastMessage && targetPage === 'search') {
      logger.debug("Received remote input:", lastMessage.text);
      const realMessage = lastMessage.text;
      setKeyword(realMessage);
      handleSearch(realMessage);
      clearMessage(); // Clear the message after processing
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage, targetPage]);

  // useEffect(() => {
  //   // Focus the text input when the screen loads
  //   const timer = setTimeout(() => {
  //     textInputRef.current?.focus();
  //   }, 200);
  //   return () => clearTimeout(timer);
  // }, []);

  const handleSearch = async (searchText?: string) => {
    const term = typeof searchText === "string" ? searchText : keyword;
    if (!term.trim()) {
      Keyboard.dismiss();
      return;
    }
    Keyboard.dismiss();
    setSuggestions([]); // 发起搜索后收起建议
    addHistory(term);
    setLoading(true);
    setError(null);
    try {
      const response = await api.searchVideos(term);
      if (response.results.length > 0) {
        setResults(response.results);
      } else {
        setError("没有找到相关内容");
      }
    } catch (err) {
      setError("搜索失败，请稍后重试。");
      logger.info("Search failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const onSearchPress = () => handleSearch();

  // 点击建议或历史词：填入并立即搜索
  const pickSuggestion = (term: string) => {
    setKeyword(term);
    handleSearch(term);
  };

  const handleQrPress = () => {
    if (!remoteInputEnabled) {
      Alert.alert("远程输入未启用", "请先在设置页面中启用远程输入功能", [
        { text: "取消", style: "cancel" },
        { text: "去设置", onPress: () => router.push("/settings") },
      ]);
      return;
    }
    showRemoteModal('search');
  };

  const renderItem = ({ item }: { item: SearchResult; index: number }) => (
    <VideoCard
      id={item.id.toString()}
      source={item.source}
      title={item.title}
      poster={item.poster}
      year={item.year}
      sourceName={item.source_name}
      api={api}
    />
  );

  // 动态样式
  const dynamicStyles = createResponsiveStyles(deviceType, spacing);

  const renderSearchContent = () => (
    <>
      <View style={dynamicStyles.searchContainer}>
        <TouchableOpacity
          activeOpacity={1}
          style={[
            dynamicStyles.inputContainer,
            {
              borderColor: isInputFocused ? Colors.dark.primary : "transparent",
            },
          ]}
          onPress={() => textInputRef.current?.focus()}
        >
          <TextInput
            ref={textInputRef}
            style={dynamicStyles.input}
            placeholder="搜索电影、剧集..."
            placeholderTextColor="#888"
            value={keyword}
            onChangeText={setKeyword}
            onSubmitEditing={onSearchPress}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            returnKeyType="search"
          />
        </TouchableOpacity>
        <StyledButton style={dynamicStyles.searchButton} onPress={onSearchPress}>
          <Search size={deviceType === 'mobile' ? 20 : 24} color="white" />
        </StyledButton>
        {deviceType !== 'mobile' && (
          <StyledButton style={dynamicStyles.qrButton} onPress={handleQrPress}>
            <QrCode size={deviceType === 'tv' ? 24 : 20} color="white" />
          </StyledButton>
        )}
      </View>

      {/* 实时搜索建议：输入时防抖拉取，点词即搜 */}
      {isInputFocused && suggestions.length > 0 && (
        <View style={dynamicStyles.suggestionBox}>
          {suggestions.map((s) => (
            <Pressable
              key={s}
              style={({ focused }: any) => [dynamicStyles.suggestionItem, focused && dynamicStyles.suggestionItemFocused]}
              onPress={() => pickSuggestion(s)}
            >
              <ThemedText style={dynamicStyles.suggestionText} numberOfLines={1}>
                {s}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}

      {/* 搜索历史：初始空态显示，点词即搜，可一键清空 */}
      {!keyword.trim() && results.length === 0 && history.length > 0 && (
        <View style={dynamicStyles.historySection}>
          <View style={dynamicStyles.historyHeader}>
            <ThemedText style={dynamicStyles.historyTitle}>搜索历史</ThemedText>
            <Pressable onPress={clearHistory}>
              <ThemedText style={dynamicStyles.historyClear}>清空</ThemedText>
            </Pressable>
          </View>
          <View style={dynamicStyles.historyTags}>
            {history.map((h) => (
              <Pressable key={h} style={dynamicStyles.historyTag} onPress={() => pickSuggestion(h)}>
                <ThemedText style={dynamicStyles.historyTagText} numberOfLines={1}>
                  {h}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {loading ? (
        <VideoLoadingAnimation showProgressBar={false} />
      ) : error ? (
        <View style={[commonStyles.center, { flex: 1 }]}>
          <ThemedText style={dynamicStyles.errorText}>{error}</ThemedText>
        </View>
      ) : (
        <CustomScrollView
          data={results}
          renderItem={renderItem}
          loading={loading}
          error={error}
          emptyMessage="输入关键词开始搜索"
        />
      )}
      <RemoteControlModal />
    </>
  );

  const content = (
    <ThemedView style={[commonStyles.container, dynamicStyles.container]}>
      {renderSearchContent()}
    </ThemedView>
  );

  // 根据设备类型决定是否包装在响应式导航中
  if (deviceType === 'tv') {
    return content;
  }

  return (
    <ResponsiveNavigation>
      <ResponsiveHeader title="搜索" showBackButton />
      {content}
    </ResponsiveNavigation>
  );
}

const createResponsiveStyles = (deviceType: string, spacing: number) => {
  const isMobile = deviceType === 'mobile';
  const minTouchTarget = DeviceUtils.getMinTouchTargetSize();

  return StyleSheet.create({
    container: {
      flex: 1,
      paddingTop: deviceType === 'tv' ? 50 : 0,
    },
    searchContainer: {
      flexDirection: "row",
      paddingHorizontal: spacing,
      marginBottom: spacing,
      alignItems: "center",
      paddingTop: isMobile ? spacing / 2 : 0,
    },
    inputContainer: {
      flex: 1,
      height: isMobile ? minTouchTarget : 50,
      backgroundColor: "#2c2c2e",
      borderRadius: isMobile ? 8 : 8,
      marginRight: spacing / 2,
      borderWidth: 2,
      borderColor: "transparent",
      justifyContent: "center",
    },
    input: {
      flex: 1,
      paddingHorizontal: spacing,
      color: "white",
      fontSize: isMobile ? 16 : 18,
    },
    searchButton: {
      width: isMobile ? minTouchTarget : 50,
      height: isMobile ? minTouchTarget : 50,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: isMobile ? 8 : 8,
      marginRight: deviceType !== 'mobile' ? spacing / 2 : 0,
    },
    qrButton: {
      width: isMobile ? minTouchTarget : 50,
      height: isMobile ? minTouchTarget : 50,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: isMobile ? 8 : 8,
    },
    errorText: {
      color: "red",
      fontSize: isMobile ? 14 : 16,
      textAlign: "center",
    },
    suggestionBox: {
      marginHorizontal: spacing,
      marginTop: -spacing / 2,
      marginBottom: spacing / 2,
      backgroundColor: "#2c2c2e",
      borderRadius: 8,
      overflow: "hidden",
    },
    suggestionItem: {
      paddingVertical: isMobile ? 12 : 10,
      paddingHorizontal: spacing,
    },
    suggestionItemFocused: {
      backgroundColor: Colors.dark.primary,
    },
    suggestionText: {
      color: "white",
      fontSize: isMobile ? 15 : 16,
    },
    historySection: {
      paddingHorizontal: spacing,
      marginBottom: spacing,
    },
    historyHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: spacing / 2,
    },
    historyTitle: {
      color: "#ccc",
      fontSize: isMobile ? 14 : 15,
      fontWeight: "bold",
    },
    historyClear: {
      color: "#888",
      fontSize: isMobile ? 13 : 14,
    },
    historyTags: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    historyTag: {
      backgroundColor: "#2c2c2e",
      borderRadius: 16,
      paddingVertical: isMobile ? 8 : 6,
      paddingHorizontal: 14,
      marginRight: spacing / 2,
      marginBottom: spacing / 2,
      maxWidth: 200,
    },
    historyTagText: {
      color: "white",
      fontSize: isMobile ? 13 : 14,
    },
  });
};
