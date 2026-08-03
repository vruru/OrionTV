import { useCallback, RefObject, useMemo } from 'react';
import { Video, ResizeMode } from 'expo-av';
import Toast from 'react-native-toast-message';
import usePlayerStore from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import Logger from '@/utils/Logger';

const logger = Logger.withTag('VideoHandlers');

interface UseVideoHandlersProps {
  videoRef: RefObject<Video>;
  currentEpisode: { url: string; title: string } | undefined;
  initialPosition: number;
  introEndTime?: number;
  playbackRate: number;
  handlePlaybackStatusUpdate: (status: any) => void;
  deviceType: string;
  detail?: { poster?: string };
}

export const useVideoHandlers = ({
  videoRef,
  currentEpisode,
  initialPosition,
  introEndTime,
  playbackRate,
  handlePlaybackStatusUpdate,
  deviceType,
  detail,
}: UseVideoHandlersProps) => {
  
  const onLoad = useCallback(async () => {
    logger.info(`[PERF] Video onLoad - video ready to play`);
    
    try {
      // 1. 先设置位置（如果需要）。片头跳过仅在“自动跳过片头片尾”开启时生效；
      //    继续播放的进度(initialPosition)始终优先。
      const autoSkipIntroOutro = useSettingsStore.getState().autoSkipIntroOutro;
      const jumpPosition = initialPosition || (autoSkipIntroOutro ? introEndTime || 0 : 0) || 0;
      if (jumpPosition > 0) {
        logger.info(`[PERF] Setting initial position to ${jumpPosition}ms`);
        await videoRef.current?.setPositionAsync(jumpPosition);
      }
      
      // 2. 显式调用播放以确保自动播放
      logger.info(`[AUTOPLAY] Attempting to start playback after onLoad`);
      await videoRef.current?.playAsync();
      logger.info(`[AUTOPLAY] Auto-play successful after onLoad`);

      // 3. 重新应用播放速度。Android 上切换剧集/播放源会重新加载 Video，
      // rate 属性有时不会自动生效，这里显式设置以保证倍速持续有效。
      if (playbackRate && playbackRate !== 1.0) {
        try {
          // shouldCorrectPitch:true keeps speech natural (ExoPlayer Sonic
          // time-stretching); false would make pitch follow the rate.
          await videoRef.current?.setStatusAsync({
            rate: playbackRate,
            shouldCorrectPitch: true,
            shouldPlay: true,
          });
          logger.info(`[RATE] Re-applied playback rate ${playbackRate}x after onLoad`);
        } catch (rateError) {
          logger.warn(`[RATE] Failed to re-apply playback rate:`, rateError);
        }
      }

      usePlayerStore.setState({ isLoading: false });
      logger.info(`[PERF] Video loading complete - isLoading set to false`);
    } catch (error) {
      logger.warn(`[AUTOPLAY] Failed to auto-play after onLoad:`, error);
      // 即使自动播放失败，也要设置加载完成状态
      usePlayerStore.setState({ isLoading: false });
      // 不显示错误提示，因为自动播放失败是常见且预期的情况
    }
  }, [videoRef, initialPosition, introEndTime, playbackRate]);

  const onLoadStart = useCallback(() => {
    if (!currentEpisode?.url) return;
    
    logger.info(`[PERF] Video onLoadStart - starting to load video: ${currentEpisode.url.substring(0, 100)}...`);
    usePlayerStore.setState({ isLoading: true });
  }, [currentEpisode?.url]);

  const onError = useCallback((error: any) => {
    if (!currentEpisode?.url) return;
    
    logger.error(`[ERROR] Video playback error:`, error);
    
    // 检测SSL证书错误和其他网络错误
    const errorString = (error as any)?.error?.toString() || error?.toString() || '';
    const isSSLError = errorString.includes('SSLHandshakeException') || 
                      errorString.includes('CertPathValidatorException') ||
                      errorString.includes('Trust anchor for certification path not found');
    const isNetworkError = errorString.includes('HttpDataSourceException') ||
                         errorString.includes('IOException') ||
                         errorString.includes('SocketTimeoutException');
    
    if (isSSLError) {
      logger.error(`[SSL_ERROR] SSL certificate validation failed for URL: ${currentEpisode.url}`);
      Toast.show({ 
        type: "error", 
        text1: "SSL证书错误，正在尝试其他播放源...",
        text2: "请稍候"
      });
      usePlayerStore.getState().handleVideoError('ssl', currentEpisode.url);
    } else if (isNetworkError) {
      logger.error(`[NETWORK_ERROR] Network connection failed for URL: ${currentEpisode.url}`);
      Toast.show({ 
        type: "error", 
        text1: "网络连接失败，正在尝试其他播放源...",
        text2: "请稍候"
      });
      usePlayerStore.getState().handleVideoError('network', currentEpisode.url);
    } else {
      logger.error(`[VIDEO_ERROR] Other video error for URL: ${currentEpisode.url}`);
      Toast.show({ 
        type: "error", 
        text1: "视频播放失败，正在尝试其他播放源...",
        text2: "请稍候"
      });
      usePlayerStore.getState().handleVideoError('other', currentEpisode.url);
    }
  }, [currentEpisode?.url]);

  // 优化的Video组件props
  const videoProps = useMemo(() => ({
    source: { uri: currentEpisode?.url || '' },
    posterSource: { uri: detail?.poster ?? "" },
    resizeMode: ResizeMode.CONTAIN,
    // NOTE: `rate` is deliberately NOT passed as a prop. The declarative prop
    // fights the imperative setStatusAsync call (each render re-applies it and
    // reconfigures the decoder), which caused stuttering at non-1x rates.
    // Rate is applied imperatively in onLoad and in setPlaybackRate.
    progressUpdateIntervalMillis: 1000,
    onPlaybackStatusUpdate: handlePlaybackStatusUpdate,
    onLoad,
    onLoadStart,
    onError,
    useNativeControls: deviceType !== 'tv',
    shouldPlay: true,
  }), [
    currentEpisode?.url,
    detail?.poster,
    handlePlaybackStatusUpdate,
    onLoad,
    onLoadStart,
    onError,
    deviceType,
  ]);

  return {
    onLoad,
    onLoadStart,
    onError,
    videoProps,
  };
};