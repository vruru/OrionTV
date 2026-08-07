import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { View, StyleSheet, Text, ActivityIndicator } from "react-native";
import { Video, AVPlaybackStatus } from "expo-av";
import { useKeepAwake } from "expo-keep-awake";
import { useSettingsStore } from "@/stores/settingsStore";
import { toAvResizeMode } from "@/utils/resizeMode";
import { REPLAY_PLAYBACK_RATES } from "@/utils/replayUi";

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
  /** 直接应用指定回看倍率；播放器未就绪或倍率无效时返回 null。 */
  setRate: (rate: number) => Promise<number | null>;
  getStatusSnapshot: () => {
    positionMillis: number;
    durationMillis: number;
    isPlaying: boolean;
    rate: number;
  } | null;
}

const PLAYBACK_TIMEOUT = 15000; // 15 seconds

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
  // 倍率命令也必须与切源串行，避免 setRateAsync 与 unloadAsync 同时进入 ExoPlayer。
  const rateCommandRef = useRef<Promise<number | null> | null>(null);
  // 播放/暂停和 seek、倍率同样不能并发进入同一个原生播放器实例。
  const playbackCommandRef = useRef<Promise<void> | null>(null);
  // 整个旧播放器释放过程 single-flight；重入时复用同一 Promise，严禁并发 unload。
  const releaseCommandRef = useRef<Promise<void> | null>(null);
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
      const activeRateCommand = rateCommandRef.current;
      const activePlaybackCommand = playbackCommandRef.current;
      await Promise.all([
        activeRateCommand?.catch(() => null),
        activePlaybackCommand?.catch(() => undefined),
      ]);
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

  const setPlaybackRate = (rate: number): Promise<number | null> => {
    if (!REPLAY_PLAYBACK_RATES.includes(rate)) return Promise.resolve(null);
    const sourceKey = sourceKeyRef.current;
    const previous = rateCommandRef.current;
    const activeSeek = seekDrainRef.current;
    const activePlaybackCommand = playbackCommandRef.current;
    const command = (async () => {
      await Promise.all([
        previous?.catch(() => null),
        activeSeek?.catch(() => undefined),
        activePlaybackCommand?.catch(() => undefined),
      ]);
      const status = statusRef.current;
      if (sourceKeyRef.current !== sourceKey || !status?.isLoaded) return null;
      const nextStatus = await video.current?.setRateAsync(rate, true).catch(() => undefined);
      if (sourceKeyRef.current !== sourceKey || !nextStatus?.isLoaded) return null;
      statusRef.current = nextStatus;
      return rate;
    })();
    rateCommandRef.current = command;
    void command.finally(() => {
      if (rateCommandRef.current === command) rateCommandRef.current = null;
    });
    return command;
  };

  const togglePlayback = (): Promise<void> => {
    const sourceKey = sourceKeyRef.current;
    const previous = playbackCommandRef.current;
    const activeSeek = seekDrainRef.current;
    const activeRateCommand = rateCommandRef.current;
    const command = (async () => {
      await Promise.all([
        previous?.catch(() => undefined),
        activeSeek?.catch(() => undefined),
        activeRateCommand?.catch(() => null),
      ]);
      const status = statusRef.current;
      if (sourceKeyRef.current !== sourceKey || !status?.isLoaded) return;
      const nextStatus = status.isPlaying
        ? await video.current?.pauseAsync().catch(() => undefined)
        : await video.current?.playAsync().catch(() => undefined);
      if (sourceKeyRef.current === sourceKey && nextStatus?.isLoaded) {
        statusRef.current = nextStatus;
      }
    })();
    playbackCommandRef.current = command;
    void command.finally(() => {
      if (playbackCommandRef.current === command) playbackCommandRef.current = null;
    });
    return command;
  };

  useImperativeHandle(ref, () => ({
    prepareForSourceChange: () => {
      const existing = releaseCommandRef.current;
      if (existing) return existing;

      const release = (async () => {
        // 先置为哨兵，unload 过程中到达的旧状态不会再写入页面状态。
        const activeSeek = seekDrainRef.current;
        const activeRateCommand = rateCommandRef.current;
        const activePlaybackCommand = playbackCommandRef.current;
        const playerToRelease = video.current;
        sourceKeyRef.current = "releasing";
        statusRef.current = null;
        pendingSeekTargetRef.current = null;
        hasPlaybackStartedRef.current = false;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        // seek / rate / 播放暂停与 unloadAsync 都不能并发打进同一个 ExoPlayer 实例。
        await Promise.all([
          activeSeek?.catch(() => undefined),
          activeRateCommand?.catch(() => null),
          activePlaybackCommand?.catch(() => undefined),
        ]);
        if (!activeSeek) resolveSeekWaiters(null);
        await playerToRelease?.unloadAsync().catch(() => undefined);
      })();
      releaseCommandRef.current = release;
      void release.finally(() => {
        if (releaseCommandRef.current === release) releaseCommandRef.current = null;
      });
      return release;
    },
    seekTo: seekToPosition,
    togglePlayPause: togglePlayback,
    setRate: setPlaybackRate,
    getStatusSnapshot: () => {
      const status = statusRef.current;
      if (!status || !status.isLoaded) return null;
      return {
        positionMillis: status.positionMillis ?? 0,
        durationMillis: status.durationMillis ?? 0,
        isPlaying: status.isPlaying,
        rate: status.rate ?? 1,
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
      rateCommandRef.current = null;
      playbackCommandRef.current = null;
      releaseCommandRef.current = null;
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
