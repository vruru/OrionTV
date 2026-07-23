import React, { useState } from "react";
import { View, StyleSheet, Text, Image, LayoutChangeEvent } from "react-native";
import usePlayerStore from "@/stores/playerStore";
import usePreviewStore from "@/stores/previewStore";

const PREVIEW_WIDTH = 176;
const PREVIEW_HEIGHT = 99; // 16:9

const formatTime = (milliseconds: number) => {
  if (isNaN(milliseconds) || milliseconds < 0) {
    return "00:00";
  }
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

export const SeekingBar = () => {
  const { isSeeking, seekPosition, status } = usePlayerStore();
  const thumbnails = usePreviewStore((s) => s.thumbnails);
  const getNearest = usePreviewStore((s) => s.getNearest);
  const [barWidth, setBarWidth] = useState(0);

  const onBarLayout = (e: LayoutChangeEvent) => {
    setBarWidth(e.nativeEvent.layout.width);
  };

  if (!isSeeking || !status?.isLoaded) {
    return null;
  }

  const durationMillis = status.durationMillis || 0;
  const currentPositionMillis = seekPosition * durationMillis;

  // Nearest pre-generated thumbnail for the current seek position.
  const nearest = thumbnails.length > 0 ? getNearest(currentPositionMillis) : null;

  // Horizontal position of the preview window, centered on the seek point and
  // clamped so it never overflows the bar edges.
  let previewLeft = seekPosition * barWidth - PREVIEW_WIDTH / 2;
  if (barWidth > 0) {
    previewLeft = Math.max(0, Math.min(previewLeft, barWidth - PREVIEW_WIDTH));
  }

  return (
    <View style={styles.seekingContainer}>
      <View style={styles.barArea} onLayout={onBarLayout}>
        {/* Preview window that follows the seek point */}
        {barWidth > 0 && (
          <View style={[styles.previewWindow, { left: previewLeft }]}>
            {nearest ? (
              <>
                <Image source={{ uri: nearest.uri }} style={styles.previewImage} resizeMode="cover" />
                <View style={styles.previewTimeOverlay}>
                  <Text style={styles.previewTimeText}>{formatTime(currentPositionMillis)}</Text>
                </View>
              </>
            ) : (
              // Fallback when thumbnails are unavailable (e.g. some HLS sources)
              <View style={styles.previewFallback}>
                <Text style={styles.previewFallbackTime}>{formatTime(currentPositionMillis)}</Text>
                <Text style={styles.previewFallbackDuration}>/ {formatTime(durationMillis)}</Text>
              </View>
            )}
            {/* small pointer under the window */}
            <View style={styles.previewPointer} />
          </View>
        )}

        {/* The seek progress bar itself */}
        <View style={styles.seekingBarContainer}>
          <View style={styles.seekingBarBackground} />
          <View style={[styles.seekingBarFilled, { width: `${seekPosition * 100}%` }]} />
          {/* seek handle */}
          <View style={[styles.seekHandle, { left: `${seekPosition * 100}%` }]} />
        </View>
      </View>

      {/* Overall time readout under the bar */}
      <Text style={styles.timeText}>
        {formatTime(currentPositionMillis)} / {formatTime(durationMillis)}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  seekingContainer: {
    position: "absolute",
    bottom: 80,
    left: "5%",
    right: "5%",
    alignItems: "center",
  },
  barArea: {
    width: "100%",
    // Leave vertical room above the bar for the floating preview window.
    paddingTop: PREVIEW_HEIGHT + 24,
    justifyContent: "flex-end",
  },
  previewWindow: {
    position: "absolute",
    top: 0,
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    backgroundColor: "#000",
    overflow: "visible",
  },
  previewImage: {
    width: "100%",
    height: "100%",
    borderRadius: 6,
    backgroundColor: "#111",
  },
  previewTimeOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    paddingVertical: 2,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
  },
  previewTimeText: {
    color: "white",
    fontSize: 14,
    fontWeight: "bold",
  },
  previewFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  previewFallbackTime: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
  },
  previewFallbackDuration: {
    color: "#bbb",
    fontSize: 13,
    marginTop: 2,
  },
  previewPointer: {
    position: "absolute",
    bottom: -8,
    left: PREVIEW_WIDTH / 2 - 6,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "rgba(255,255,255,0.9)",
  },
  timeText: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 12,
  },
  seekingBarContainer: {
    width: "100%",
    height: 5,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 2.5,
  },
  seekingBarBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 2.5,
  },
  seekingBarFilled: {
    height: "100%",
    backgroundColor: "#fff",
    borderRadius: 2.5,
  },
  seekHandle: {
    position: "absolute",
    top: -4,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    marginLeft: -6.5,
    backgroundColor: "#fff",
  },
});
