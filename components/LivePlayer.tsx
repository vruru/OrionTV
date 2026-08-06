import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { View, StyleSheet, Text, ActivityIndicator } from "react-native";
import { Video, AVPlaybackStatus } from "expo-av";
import { useKeepAwake } from "expo-keep-awake";
import { useSettingsStore } from "@/stores/settingsStore";
import { toAvResizeMode } from "@/utils/resizeMode";

interface LivePlayerProps {
  streamUrl: string | null;
  channelTitle?: string | null;
  onPlaybackStatusUpdate: (status: AVPlaybackStatus) => void;
  /** 自增即重试：外部（TV 确认键/移动端点按）触发重新加载当前流 */
  retryKey?: number;
  /** 加载失败/恢复时上报（含 15s 超时路径），供外部决定确认键行为 */
  onPlaybackError?: (failed: boolean) => void;
}

/** 回看（VOD）场景的命令式控制：快进快退/暂停播放/倍速 */
export interface LivePlayerControlRef {
  /** 在父级切换直播/回看 URL 前串行释放旧播放器，并屏蔽迟到状态回调。 */
  prepareForSourceChange: () => Promise<void>;
  /** 绝对定位；连续请求只保留最新目标，避免 ExoPlayer 并发 seek。 */
  seekTo: (positionMs: number) => Promise<number | null>;
  togglePlayPause: () => Promise<void>;
  cycleRate: () => Promise<number>;
  getStatusSnapshot: () => { positionMillis: number; durationMillis: number; isPlaying: boolean } | null;
}

const PLAYBACK_TIMEOUT = 15000; // 15 seconds

const REPLAY_RATES = [1, 1.25, 1.5, 2];

const LivePlayer = forwardRef<LivePlayerControlRef, LivePlayerProps>(function LivePlayer(
  { streamUrl, channelTitle, onPlaybackStatusUpdate, retryKey = 0, onPlaybackError },
  ref
) {
  const video = useRef<Video>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTimeout, setIsTimeout] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  // 一旦当前流已经真正开始播放，后续短暂缓冲不再用全屏加载层盖住画面。
  const hasPlaybackStartedRef = useRef(false);
  // 最近一次播放状态（seek/暂停/倍速的命令式控制读取用）
  const statusRef = useRef<AVPlaybackStatus | null>(null);
  const rateRef = useRef(1);
  // seek 采用 single-flight + latest-wins：至多一个原生 setPositionAsync 在途，
  // 长按/拖动产生的新目标只覆盖 pending，不把一串解码器 flush 堆进 ExoPlayer。
  const pendingSeekTargetRef = useRef<number | null>(null);
  const seekDrainRef = useRef<Promise<void> | null>(null);
  const seekWaitersRef = useRef<((position: number | null) => void)[]>([]);
  const activeSourceKey = `${streamUrl ?? "none"}-${retryKey}`;
  // 旧 VideoView 卸载后仍可能送达迟到回调；只接受当前 source 代次。
  const sourceKeyRef = useRef(activeSourceKey);
  const renderedSourceKeyRef = useRef(activeSourceKey);
  if (renderedSourceKeyRef.current !== activeSourceKey) {
    renderedSourceKeyRef.current = activeSourceKey;
    sourceKeyRef.current = activeSourceKey;
  }
  // 全局画面比例设置（设置页 / TV 上键快捷切换即时生效）
  const videoResizeMode = useSettingsStore((s) => s.videoResizeMode);
  useKeepAwake();

  const resolveSeekWaiters = (position: number | null) => {
    const waiters = seekWaitersRef.current.splice(0);
    for (const resolve of waiters) resolve(position);
  };

  const ensureSeekDrain = (sourceKey: string) => {
    if (seekDrainRef.current) return;
    const drain = (async () => {
      let lastPosition: number | null = null;
      while (sourceKeyRef.current === sourceKey) {
        const next = pendingSeekTargetRef.current;
        if (next === null) break;
        pendingSeekTargetRef.current = null;
        const nextStatus = await video.current?.setPositionAsync(next).catch(() => undefined);
        if (sourceKeyRef.current !== sourceKey) break;
        if (nextStatus?.isLoaded) {
          statusRef.current = nextStatus;
          lastPosition = nextStatus.positionMillis ?? next;
        } else {
          lastPosition = null;
        }
      }
      resolveSeekWaiters(sourceKeyRef.current === sourceKey ? lastPosition : null);
    })();
    seekDrainRef.current = drain;
    void drain.finally(() => {
      if (seekDrainRef.current === drain) seekDrainRef.current = null;
      // 极窄竞态：新请求可能在旧 Promise resolve 后、finally 前到达。
      if (pendingSeekTargetRef.current !== null && sourceKeyRef.current === sourceKey) {
        ensureSeekDrain(sourceKey);
      }
    });
  };

  const seekToPosition = (positionMs: number): Promise<number | null> => {
    const status = statusRef.current;
    if (!status || !status.isLoaded || !Number.isFinite(positionMs)) return Promise.resolve(null);
    const duration = status.durationMillis ?? 0;
    if (!Number.isFinite(duration) || duration <= 0) return Promise.resolve(null);

    const sourceKey = sourceKeyRef.current;
    const target = Math.max(0, Math.min(duration, positionMs));
    return new Promise<number | null>((resolve) => {
      pendingSeekTargetRef.current = target;
      seekWaitersRef.current.push(resolve);
      ensureSeekDrain(sourceKey);
    });
  };

  useImperativeHandle(ref, () => ({
    prepareForSourceChange: async () => {
      // 先置为哨兵，unload 过程中到达的旧状态不会再写入页面状态。
      const activeSeek = seekDrainRef.current;
      sourceKeyRef.current = "releasing";
      statusRef.current = null;
      pendingSeekTargetRef.current = null;
      hasPlaybackStartedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      // setPositionAsync 与 unloadAsync 不能并发打进同一个 ExoPlayer 实例。
      await activeSeek?.catch(() => undefined);
      if (!activeSeek) resolveSeekWaiters(null);
      await video.current?.unloadAsync().catch(() => undefined);
    },
    seekTo: seekToPosition,
    togglePlayPause: async () => {
      const st = statusRef.current;
      if (!st || !st.isLoaded) return;
      if (st.isPlaying) await video.current?.pauseAsync().catch(() => undefined);
      else await video.current?.playAsync().catch(() => undefined);
    },
    cycleRate: async () => {
      const idx = REPLAY_RATES.indexOf(rateRef.current);
      const next = REPLAY_RATES[(idx + 1) % REPLAY_RATES.length];
      rateRef.current = next;
      await video.current?.setRateAsync(next, true).catch(() => undefined);
      return next;
    },
    getStatusSnapshot: () => {
      const status = statusRef.current;
      if (!status || !status.isLoaded) return null;
      return {
        positionMillis: status.positionMillis ?? 0,
        durationMillis: status.durationMillis ?? 0,
        isPlaying: status.isPlaying,
      };
    },
  }));

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (streamUrl) {
      hasPlaybackStartedRef.current = false;
      statusRef.current = null;
      rateRef.current = 1;
      setIsLoading(true);
      setIsTimeout(false);
      timeoutRef.current = setTimeout(() => {
        setIsTimeout(true);
        setIsLoading(false);
      }, PLAYBACK_TIMEOUT);
    } else {
      hasPlaybackStartedRef.current = false;
      setIsLoading(false);
      setIsTimeout(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
    // retryKey 变化时重走加载流程（Video 以 key 强制重挂载）
  }, [streamUrl, retryKey]);

  useEffect(
    () => () => {
      sourceKeyRef.current = "unmounted";
      pendingSeekTargetRef.current = null;
      resolveSeekWaiters(null);
    },
    []
  );

  // 失败状态变化（含超时路径）统一上报外部
  useEffect(() => {
    onPlaybackError?.(isTimeout);
  }, [isTimeout, onPlaybackError]);

  const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (sourceKeyRef.current !== activeSourceKey) return;
    statusRef.current = status;
    if (status.isLoaded) {
      if (status.isPlaying) {
        hasPlaybackStartedRef.current = true;
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        setIsLoading(false);
        setIsTimeout(false);
      } else if (status.isBuffering) {
        setIsLoading(!hasPlaybackStartedRef.current);
      } else {
        // HLS 在首帧可显示到 isPlaying=true 之间可能先报告“已加载且未缓冲”。
        // 此时隐藏转圈，但保留 15 秒超时，真正开始播放后再清掉计时器。
        setIsLoading(false);
      }
    } else {
      if (status.error) {
        setIsLoading(false);
        setIsTimeout(true);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      }
    }
    onPlaybackStatusUpdate(status);
  };

  if (!streamUrl) {
    return (
      <View style={styles.container}>
        <Text style={styles.messageText}>按向下键选择频道</Text>
      </View>
    );
  }

  if (isTimeout) {
    return (
      <View style={styles.container}>
        <Text style={styles.messageText}>加载失败，请重试</Text>
        <Text style={styles.retryHintText}>按确认键或点按屏幕重试</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Video
        key={`${streamUrl}-${retryKey}`}
        ref={video}
        style={styles.video}
        source={{
          uri: streamUrl,
        }}
        resizeMode={toAvResizeMode(videoResizeMode)}
        shouldPlay
        progressUpdateIntervalMillis={1000}
        onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
        onError={(e) => {
          if (sourceKeyRef.current !== activeSourceKey) return;
          setIsTimeout(true);
          setIsLoading(false);
        }}
      />
      {isLoading && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.messageText}>加载中...</Text>
        </View>
      )}
      {channelTitle && !isLoading && !isTimeout && (
        <View style={styles.overlay}>
          <Text style={styles.title}>{channelTitle}</Text>
        </View>
      )}
    </View>
  );
});

LivePlayer.displayName = "LivePlayer";
export default LivePlayer;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
  },
  video: {
    flex: 1,
    alignSelf: "stretch",
  },
  overlay: {
    position: "absolute",
    top: 20,
    left: 20,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    padding: 10,
    borderRadius: 5,
  },
  title: {
    color: "#fff",
    fontSize: 18,
  },
  messageText: {
    color: "#fff",
    fontSize: 16,
    marginTop: 10,
  },
  retryHintText: {
    color: "#aaa",
    fontSize: 13,
    marginTop: 8,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
});
