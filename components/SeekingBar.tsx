import React from "react";
import { View, StyleSheet, Text, Image, ActivityIndicator } from "react-native";
import usePlayerStore from "@/stores/playerStore";
import usePreviewStore from "@/stores/previewStore";
import { Colors } from "@/constants/Colors";

const CELL_WIDTH = 150;
const CELL_HEIGHT = 84; // ~16:9

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

// Shows a strip of preview thumbnails (5s apart, starting at the cursor) while
// the user scrubs. Playback continues in the background; the strip only reflects
// where a jump WOULD land if confirmed.
export const SeekingBar = () => {
  const isPreviewing = usePlayerStore((s) => s.isPreviewing);
  const selectedIndex = usePlayerStore((s) => s.previewSelectedIndex);
  const focusRow = usePlayerStore((s) => s.previewFocusRow);
  const status = usePlayerStore((s) => s.status);
  const frames = usePreviewStore((s) => s.frames);

  if (!isPreviewing || !status?.isLoaded) {
    return null;
  }

  const durationMillis = status.durationMillis || 0;
  const playedRatio = durationMillis > 0 ? status.positionMillis / durationMillis : 0;
  // Time of the currently highlighted (selected) preview frame.
  const selectedTime = frames[selectedIndex]?.time ?? frames[0]?.time ?? 0;
  const cursorRatio = durationMillis > 0 ? selectedTime / durationMillis : 0;

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Thumbnail strip */}
      <View style={styles.strip}>
        {frames.map((frame, index) => {
          const isCursor = index === selectedIndex; // highlighted == the jump target
          const activeStyle = isCursor ? (focusRow === "strip" ? styles.cellActive : styles.cellActiveDim) : null;
          return (
            <View key={`${frame.time}-${index}`} style={[styles.cell, activeStyle]}>
              {frame.uri ? (
                <Image source={{ uri: frame.uri }} style={styles.cellImage} resizeMode="cover" />
              ) : (
                <View style={styles.cellPlaceholder}>
                  <ActivityIndicator size="small" color="#888" />
                </View>
              )}
              <View style={styles.cellTimeOverlay}>
                <Text style={styles.cellTimeText}>{formatTime(frame.time)}</Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Selected time + hint */}
      <Text style={styles.cursorTime}>
        {formatTime(selectedTime)} / {formatTime(durationMillis)}
      </Text>
      <Text style={styles.hint}>
        {focusRow === "timeline"
          ? "左右快速定位(±1分钟) · 上键切回画面 · 确认键跳转 · 返回键继续"
          : "左右选择画面 · 下键切到进度条 · 确认键跳转 · 返回键继续"}
      </Text>

      {/* Progress bar: real playback position + preview cursor marker */}
      <View style={[styles.barContainer, focusRow === "timeline" && styles.barContainerActive]}>
        <View style={styles.barBackground} />
        <View style={[styles.barPlayed, { width: `${Math.min(100, Math.max(0, playedRatio * 100))}%` }]} />
        <View
          style={[
            styles.cursorMarker,
            focusRow === "timeline" && styles.cursorMarkerActive,
            { left: `${Math.min(100, Math.max(0, cursorRatio * 100))}%` },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 60,
    left: "4%",
    right: "4%",
    alignItems: "center",
  },
  strip: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "nowrap",
  },
  cell: {
    width: CELL_WIDTH,
    height: CELL_HEIGHT,
    marginHorizontal: 4,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "#000",
    overflow: "hidden",
  },
  cellActive: {
    borderColor: Colors.dark.primary,
    transform: [{ scale: 1.08 }],
  },
  cellActiveDim: {
    // Selected cell while the timeline row has focus (subtler than strip focus).
    borderColor: "rgba(255,255,255,0.85)",
  },
  cellImage: {
    width: "100%",
    height: "100%",
    backgroundColor: "#111",
  },
  cellPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1a1a1a",
  },
  cellTimeOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    paddingVertical: 1,
  },
  cellTimeText: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
  },
  cursorTime: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 14,
  },
  hint: {
    color: "#ccc",
    fontSize: 13,
    marginTop: 6,
  },
  barContainer: {
    width: "100%",
    height: 6,
    marginTop: 12,
    position: "relative",
    justifyContent: "center",
  },
  barContainerActive: {
    // Emphasize the timeline bar when it has focus.
    height: 10,
  },
  barBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 3,
  },
  barPlayed: {
    position: "absolute",
    left: 0,
    height: 6,
    backgroundColor: "rgba(255,255,255,0.7)",
    borderRadius: 3,
  },
  cursorMarker: {
    position: "absolute",
    top: -5,
    width: 4,
    height: 16,
    marginLeft: -2,
    borderRadius: 2,
    backgroundColor: Colors.dark.primary,
  },
  cursorMarkerActive: {
    width: 6,
    height: 22,
    top: -6,
    marginLeft: -3,
  },
});
