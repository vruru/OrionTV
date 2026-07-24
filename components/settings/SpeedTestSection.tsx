import React from "react";
import { View, StyleSheet, Pressable, Animated, Platform, Modal, ActivityIndicator } from "react-native";
import { useTVEventHandler } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { SettingsSection } from "./SettingsSection";
import { useSpeedTestStore } from "@/stores/speedTestStore";
import { useButtonAnimation } from "@/hooks/useAnimation";
import { Colors } from "@/constants/Colors";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { formatSpeed, speedColor } from "@/utils/sourceFilter";

interface SpeedTestSectionProps {
  onFocus?: () => void;
  onBlur?: () => void;
}

export const SpeedTestSection: React.FC<SpeedTestSectionProps> = ({ onFocus, onBlur }) => {
  const { results, isTesting, done, currentName, currentMbps, progressDone, progressTotal, runTest } =
    useSpeedTestStore();
  const [isFocused, setIsFocused] = React.useState(false);
  const animationStyle = useButtonAnimation(isFocused, 1.05);
  const deviceType = useResponsiveLayout().deviceType;

  const testedCount = Object.keys(results).length;
  const lastTestedAt = Object.values(results).reduce((max, r) => Math.max(max, r.testedAt), 0);

  const start = () => {
    if (!isTesting) runTest();
  };

  const handleTVEvent = React.useCallback(
    (event: any) => {
      if (isFocused && event.eventType === "select") start();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isFocused, isTesting]
  );
  useTVEventHandler(handleTVEvent);

  const lastLabel = testedCount > 0
    ? `上次测试：${new Date(lastTestedAt).toLocaleString()}（${testedCount} 个源）`
    : "尚未测试，点击开始测速";

  return (
    <SettingsSection focusable onFocus={onFocus} onBlur={onBlur}>
      <Pressable
        style={styles.settingItem}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        {...(Platform.isTV || deviceType !== "tv" ? undefined : { onPress: start })}
      >
        <View style={styles.settingInfo}>
          <ThemedText style={styles.settingName}>源速度测试</ThemedText>
          <ThemedText style={styles.settingDescription}>{lastLabel}</ThemedText>
        </View>
        <Animated.View style={[styles.button, animationStyle, isFocused && styles.buttonFocused]}>
          <ThemedText style={styles.buttonText}>{isTesting ? "测试中..." : "开始测速"}</ThemedText>
        </Animated.View>
      </Pressable>

      <Modal visible={isTesting} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.card}>
            {done ? (
              <ThemedText style={styles.doneText}>测试完成</ThemedText>
            ) : (
              <>
                <ActivityIndicator size="large" color={Colors.dark.primary} />
                <ThemedText style={styles.progressText}>
                  正在测试 {progressDone + 1}/{progressTotal || "?"}
                </ThemedText>
                <ThemedText style={styles.nameText} numberOfLines={1}>
                  {currentName || "准备中..."}
                </ThemedText>
                <ThemedText
                  style={[styles.speedText, currentMbps != null && { color: speedColor(currentMbps) }]}
                >
                  {currentMbps != null ? formatSpeed(currentMbps) : "测速中..."}
                </ThemedText>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SettingsSection>
  );
};

const styles = StyleSheet.create({
  settingItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  settingInfo: { flex: 1, paddingRight: 12 },
  settingName: { fontSize: 16, fontWeight: "bold", marginBottom: 4 },
  settingDescription: { fontSize: 13, color: "#888" },
  button: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#3a3a3c",
  },
  buttonFocused: {
    backgroundColor: Colors.dark.primary,
  },
  buttonText: { fontSize: 15, fontWeight: "bold", color: "white" },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    minWidth: 320,
    paddingVertical: 28,
    paddingHorizontal: 32,
    borderRadius: 14,
    backgroundColor: "rgba(20,20,22,0.96)",
    alignItems: "center",
  },
  progressText: { color: "#ccc", fontSize: 14, marginTop: 14 },
  nameText: { color: "white", fontSize: 20, fontWeight: "bold", marginTop: 8, maxWidth: 360, textAlign: "center" },
  speedText: { color: "#ccc", fontSize: 22, fontWeight: "bold", marginTop: 8 },
  doneText: { color: Colors.dark.primary, fontSize: 24, fontWeight: "bold" },
});
