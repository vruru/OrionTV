import { useEffect, useRef, useCallback } from "react";
import { useTVEventHandler, HWEvent } from "react-native";
import usePlayerStore from "@/stores/playerStore";
import { PREVIEW_STEP_MS } from "@/stores/previewStore";

// 预览游标每次移动的步长（毫秒）——与预览缩略图间隔一致(5秒)
const PREVIEW_CURSOR_STEP = PREVIEW_STEP_MS;

// 定时器延迟时间（毫秒）
const CONTROLS_TIMEOUT = 5000;

/**
 * 管理播放器控件的显示/隐藏、遥控器事件和自动隐藏定时器。
 * @returns onScreenPress - 一个函数，用于处理屏幕点击事件，以显示控件并重置定时器。
 */
export const useTVRemoteHandler = () => {
  const {
    showControls,
    setShowControls,
    showEpisodeModal,
    togglePlayPause,
    enterPreview,
    movePreviewCursor,
    commitPreview,
  } = usePlayerStore();

  const controlsTimer = useRef<NodeJS.Timeout | null>(null);
  const fastForwardIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 重置或启动隐藏控件的定时器
  const resetTimer = useCallback(() => {
    // 清除之前的定时器
    if (controlsTimer.current) {
      clearTimeout(controlsTimer.current);
    }
    // 设置新的定时器
    controlsTimer.current = setTimeout(() => {
      setShowControls(false);
    }, CONTROLS_TIMEOUT);
  }, [setShowControls]);

  // 当控件显示时，启动定时器
  useEffect(() => {
    if (showControls) {
      resetTimer();
    } else {
      // 如果控件被隐藏，清除定时器
      if (controlsTimer.current) {
        clearTimeout(controlsTimer.current);
      }
    }

    // 组件卸载时清除定时器
    return () => {
      if (controlsTimer.current) {
        clearTimeout(controlsTimer.current);
      }
    };
  }, [showControls, resetTimer]);

  // 组件卸载时清除快进定时器
  useEffect(() => {
    return () => {
      if (fastForwardIntervalRef.current) {
        clearInterval(fastForwardIntervalRef.current);
      }
    };
  }, []);

  // 处理遥控器事件
  const handleTVEvent = useCallback(
    (event: HWEvent) => {
      if (showEpisodeModal) {
        return;
      }

      if (event.eventType === "longRight" || event.eventType === "longLeft") {
        if (event.eventKeyAction === 1) {
          if (fastForwardIntervalRef.current) {
            clearInterval(fastForwardIntervalRef.current);
            fastForwardIntervalRef.current = null;
          }
        }
      }

      if (showControls) {
        // 如果控制条已显示，则不处理后台的快进/快退等操作
        // 避免与控制条上的按钮焦点冲突
        resetTimer();
        return;
      }

      const { isPreviewing } = usePlayerStore.getState();

      switch (event.eventType) {
        case "select":
          if (isPreviewing) {
            // 在预览状态下按确认键：跳转到预览游标所在进度
            commitPreview();
          } else {
            togglePlayPause();
            setShowControls(true);
            resetTimer();
          }
          break;
        case "left":
          // 左键：进入/移动预览游标（不影响正在进行的播放）
          if (!isPreviewing) {
            enterPreview();
          } else {
            movePreviewCursor(-PREVIEW_CURSOR_STEP);
          }
          break;
        case "right":
          if (!isPreviewing) {
            enterPreview();
          } else {
            movePreviewCursor(PREVIEW_CURSOR_STEP);
          }
          break;
        case "longLeft":
          if (!fastForwardIntervalRef.current && event.eventKeyAction === 0) {
            usePlayerStore.getState().enterPreview();
            fastForwardIntervalRef.current = setInterval(() => {
              usePlayerStore.getState().movePreviewCursor(-PREVIEW_CURSOR_STEP);
            }, 200);
          }
          break;
        case "longRight":
          if (!fastForwardIntervalRef.current && event.eventKeyAction === 0) {
            usePlayerStore.getState().enterPreview();
            fastForwardIntervalRef.current = setInterval(() => {
              usePlayerStore.getState().movePreviewCursor(PREVIEW_CURSOR_STEP);
            }, 200);
          }
          break;
        case "down":
          if (!isPreviewing) {
            setShowControls(true);
            resetTimer();
          }
          break;
      }
    },
    [showControls, showEpisodeModal, setShowControls, resetTimer, togglePlayPause, enterPreview, movePreviewCursor, commitPreview]
  );

  useTVEventHandler(handleTVEvent);

  // 处理屏幕点击事件
  const onScreenPress = () => {
    // 切换控件的显示状态
    const newShowControls = !showControls;
    setShowControls(newShowControls);

    // 如果控件变为显示状态，则重置定时器
    if (newShowControls) {
      resetTimer();
    }
  };

  return { onScreenPress };
};
