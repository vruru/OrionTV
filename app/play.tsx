import React, { useEffect, useRef, useCallback, memo, useMemo } from "react";
import { StyleSheet, TouchableOpacity, BackHandler, AppState, AppStateStatus, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Video } from "expo-av";
import { useKeepAwake } from "expo-keep-awake";
import { ThemedView } from "@/components/ThemedView";
import { PlayerControls } from "@/components/PlayerControls";
import { EpisodeSelectionModal } from "@/components/EpisodeSelectionModal";
import { SourceSelectionModal } from "@/components/SourceSelectionModal";
import { SpeedSelectionModal } from "@/components/SpeedSelectionModal";
import { SeekingBar } from "@/components/SeekingBar";
// import { NextEpisodeOverlay } from "@/components/NextEpisodeOverlay";
import VideoLoadingAnimation from "@/components/VideoLoadingAnimation";
import useDetailStore from "@/stores/detailStore";
import { useTVRemoteHandler } from "@/hooks/useTVRemoteHandler";
import Toast from "react-native-toast-message";
import usePlayerStore, { selectCurrentEpisode } from "@/stores/playerStore";
import usePreviewStore from "@/stores/previewStore";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useVideoHandlers } from "@/hooks/useVideoHandlers";
import Logger from '@/utils/Logger';

const logger = Logger.withTag('PlayScreen');

// 优化的加载动画组件
const LoadingContainer = memo(
  ({ style, currentEpisode }: { style: any; currentEpisode: { url: string; title: string } | undefined }) => {
    logger.info(
      `[PERF] Video component NOT rendered - waiting for valid URL. currentEpisode: ${!!currentEpisode}, url: ${
        currentEpisode?.url ? "exists" : "missing"
      }`
    );
    return (
      <View style={style}>
        <VideoLoadingAnimation showProgressBar />
      </View>
    );
  }
);

LoadingContainer.displayName = "LoadingContainer";

// 移到组件外部避免重复创建
const createResponsiveStyles = (deviceType: string) => {
  const isMobile = deviceType === "mobile";
  const isTablet = deviceType === "tablet";

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "black",
      // 移动端和平板端可能需要状态栏处理
      ...(isMobile || isTablet ? { paddingTop: 0 } : {}),
    },
    videoContainer: {
      ...StyleSheet.absoluteFillObject,
      // 为触摸设备添加更多的交互区域
      ...(isMobile || isTablet ? { zIndex: 1 } : {}),
    },
    videoPlayer: {
      ...StyleSheet.absoluteFillObject,
    },
    loadingContainer: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.8)",
      justifyContent: "center",
      alignItems: "center",
      zIndex: 10,
    },
  });
};

export default function PlayScreen() {
  const videoRef = useRef<Video>(null);
  const router = useRouter();
  useKeepAwake();

  // 响应式布局配置
  const { deviceType } = useResponsiveLayout();

  const {
    episodeIndex: episodeIndexStr,
    position: positionStr,
    source: sourceStr,
    id: videoId,
    title: videoTitle,
  } = useLocalSearchParams<{
    episodeIndex: string;
    position?: string;
    source?: string;
    id?: string;
    title?: string;
  }>();
  const episodeIndex = parseInt(episodeIndexStr || "0", 10);
  const position = positionStr ? parseInt(positionStr, 10) : undefined;

  const { detail } = useDetailStore();
  const source = sourceStr || detail?.source;
  const id = videoId || detail?.id.toString();
  const title = videoTitle || detail?.title;
  const {
    isLoading,
    showControls,
    // showNextEpisodeOverlay,
    initialPosition,
    introEndTime,
    playbackRate,
    setVideoRef,
    handlePlaybackStatusUpdate,
    setShowControls,
    // setShowNextEpisodeOverlay,
    reset,
    loadVideo,
  } = usePlayerStore();
  const currentEpisode = usePlayerStore(selectCurrentEpisode);
  // Duration of the currently loaded video (stable once loaded).
  const durationMillis = usePlayerStore((s) => (s.status?.isLoaded ? s.status.durationMillis : undefined));
  // Set to true once the final episode finishes -> return to home.
  const playbackAllFinished = usePlayerStore((s) => s.playbackAllFinished);
  // Preview-scrub state, drives on-demand thumbnail window generation.
  const isPreviewing = usePlayerStore((s) => s.isPreviewing);
  const previewWindowStartMillis = usePlayerStore((s) => s.previewWindowStartMillis);

  // 使用Video事件处理hook
  const { videoProps } = useVideoHandlers({
    videoRef,
    currentEpisode,
    initialPosition,
    introEndTime,
    playbackRate,
    handlePlaybackStatusUpdate,
    deviceType,
    detail: detail || undefined,
  });

  // TV遥控器处理 - 总是调用hook，但根据设备类型决定是否使用结果
  const tvRemoteHandler = useTVRemoteHandler();

  // 优化的动态样式 - 使用useMemo避免重复计算
  const dynamicStyles = useMemo(() => createResponsiveStyles(deviceType), [deviceType]);

  useEffect(() => {
    const perfStart = performance.now();
    logger.info(`[PERF] PlayScreen useEffect START - source: ${source}, id: ${id}, title: ${title}`);

    setVideoRef(videoRef);
    if (source && id && title) {
      logger.info(`[PERF] Calling loadVideo with episodeIndex: ${episodeIndex}, position: ${position}`);
      loadVideo({ source, id, episodeIndex, position, title });
    } else {
      logger.info(`[PERF] Missing required params - source: ${!!source}, id: ${!!id}, title: ${!!title}`);
    }

    const perfEnd = performance.now();
    logger.info(`[PERF] PlayScreen useEffect END - took ${(perfEnd - perfStart).toFixed(2)}ms`);

    return () => {
      logger.info(`[PERF] PlayScreen unmounting - calling reset()`);
      reset(); // Reset state when component unmounts
      usePreviewStore.getState().reset(); // Clear cached seek-preview thumbnails
    };
  }, [episodeIndex, source, position, setVideoRef, reset, loadVideo, id, title]);

  // Tell the preview store which stream/duration to use (per episode). Thumbnails
  // are only generated on demand while previewing, not up front.
  useEffect(() => {
    if (currentEpisode?.url) {
      usePreviewStore.getState().setSource(currentEpisode.url, durationMillis || 0);
    }
  }, [currentEpisode?.url, durationMillis]);

  // While previewing, (re)generate the 6-frame window whenever the window's
  // start position changes (moving the selection within the window doesn't
  // regenerate). Debounced so fast scrubbing doesn't spawn a window per keypress.
  useEffect(() => {
    if (!isPreviewing) return;
    const id = setTimeout(() => {
      usePreviewStore.getState().generateWindow(previewWindowStartMillis);
    }, 120);
    return () => clearTimeout(id);
  }, [isPreviewing, previewWindowStartMillis]);

  // When the whole title has finished (last episode ended), go back to home.
  useEffect(() => {
    if (playbackAllFinished) {
      Toast.show({ type: "info", text1: "已播放完所有剧集，返回首页" });
      router.replace("/");
    }
  }, [playbackAllFinished, router]);

  // 优化的屏幕点击处理
  const onScreenPress = useCallback(() => {
    if (deviceType === "tv") {
      tvRemoteHandler.onScreenPress();
    } else {
      setShowControls(!showControls);
    }
  }, [deviceType, tvRemoteHandler, setShowControls, showControls]);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === "background" || nextAppState === "inactive") {
        videoRef.current?.pauseAsync();
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const backAction = () => {
      // 预览状态下按返回键：仅退出预览，继续正常播放（不改变进度）
      if (usePlayerStore.getState().isPreviewing) {
        usePlayerStore.getState().cancelPreview();
        return true;
      }
      if (showControls) {
        setShowControls(false);
        return true;
      }
      router.back();
      return true;
    };

    const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);

    return () => backHandler.remove();
  }, [showControls, setShowControls, router]);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;

    if (isLoading) {
      timeoutId = setTimeout(() => {
        if (usePlayerStore.getState().isLoading) {
          usePlayerStore.setState({ isLoading: false });
          Toast.show({ type: "error", text1: "播放超时，请重试" });
        }
      }, 60000); // 1 minute
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isLoading]);

  if (!detail) {
    return <VideoLoadingAnimation showProgressBar />;
  }

  return (
    <ThemedView focusable style={dynamicStyles.container}>
      <TouchableOpacity
        activeOpacity={1}
        style={dynamicStyles.videoContainer}
        onPress={onScreenPress}
        disabled={deviceType !== "tv" && showControls} // 移动端和平板端在显示控制条时禁用触摸
      >
        {/* 条件渲染Video组件：只有在有有效URL时才渲染 */}
        {currentEpisode?.url ? (
          <Video ref={videoRef} style={dynamicStyles.videoPlayer} {...videoProps} />
        ) : (
          <LoadingContainer style={dynamicStyles.loadingContainer} currentEpisode={currentEpisode} />
        )}

        {showControls && deviceType === "tv" && (
          <PlayerControls showControls={showControls} setShowControls={setShowControls} />
        )}

        <SeekingBar />

        {/* 只在Video组件存在且正在加载时显示加载动画覆盖层 */}
        {currentEpisode?.url && isLoading && (
          <View style={dynamicStyles.loadingContainer}>
            <VideoLoadingAnimation showProgressBar />
          </View>
        )}

        {/* <NextEpisodeOverlay visible={showNextEpisodeOverlay} onCancel={() => setShowNextEpisodeOverlay(false)} /> */}
      </TouchableOpacity>

      <EpisodeSelectionModal />
      <SourceSelectionModal />
      <SpeedSelectionModal />
    </ThemedView>
  );
}
