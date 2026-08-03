import React from "react";
import { View, StyleSheet, Pressable, Animated, Modal, ActivityIndicator } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { SettingsSection } from "./SettingsSection";
import { useSpeedTestStore } from "@/stores/speedTestStore";
import { useButtonAnimation } from "@/hooks/useAnimation";
import { Colors } from "@/constants/Colors";
import { formatSpeed, speedColor } from "@/utils/sourceFilter";

interface SpeedTestSectionProps {
  onFocus?: () => void;
  onBlur?: () => void;
}

export const SpeedTestSection: React.FC<SpeedTestSectionProps> = ({ onFocus, onBlur }) => {
  const { results, isTesting, done, currentName, currentMbps, progressDone, progressTotal, runTest, cancelTest } =
    useSpeedTestStore();
  const [isButtonFocused, setIsButtonFocused] = React.useState(false);
  const animationStyle = useButtonAnimation(isButtonFocused, 1.05);

  const testedCount = Object.keys(results).length;
  const lastTestedAt = Object.values(results).reduce((max, r) => Math.max(max, r.testedAt), 0);

  const start = () => {
    if (!isTesting) runTest();
  };

  const lastLabel = testedCount > 0
    ? `上次测试：${new Date(lastTestedAt).toLocaleString()}（${testedCount} 个源）`
    : "尚未测试，点击开始测速";

  return (
    <SettingsSection
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <Pressable
        style={styles.settingItem}
        onFocus={() => setIsButtonFocused(true)}
        onBlur={() => setIsButtonFocused(false)}
        onPress={start}
      >
        <View style={styles.settingInfo}>
          <ThemedText style={styles.settingName}>源速度测试</ThemedText>
          <ThemedText style={styles.settingDescription}>
            {lastLabel}
          </ThemedText>
        </View>
        <Animated.View style={[styles.button, animationStyle, isButtonFocused && styles.buttonFocused]}>
          <ThemedText style={styles.buttonText}>{isTesting ? "测试中..." : "开始测速"}</ThemedText>
        </Animated.View>
      </Pressable>

      <Modal visible={isTesting} transparent animationType="fade" onRequestClose={cancelTest}>
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
                {/* 全量测速可能长达数分钟，必须允许中途取消（已完成的结果会保留） */}
                <Pressable style={styles.cancelButton} onPress={cancelTest} hasTVPreferredFocus>
                  <ThemedText style={styles.cancelButtonText}>取消（保留已完成结果）</ThemedText>
                </Pressable>
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
  cancelButton: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#3a3a3c",
  },
  cancelButtonText: { fontSize: 15, fontWeight: "bold", color: "white" },
});
