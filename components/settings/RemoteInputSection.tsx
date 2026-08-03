import React, { useCallback } from "react";
import { View, Switch, StyleSheet, Pressable, Animated, Platform, TouchableOpacity } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { SettingsSection } from "./SettingsSection";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { useButtonAnimation } from "@/hooks/useAnimation";
import { Colors } from "@/constants/Colors";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

interface RemoteInputSectionProps {
  onChanged: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export const RemoteInputSection: React.FC<RemoteInputSectionProps> = ({ onChanged, onFocus, onBlur }) => {
  const { remoteInputEnabled } = useSettingsStore();
  const { isServerRunning, serverUrl, error } = useRemoteControlStore();
  const [isRowFocused, setIsRowFocused] = React.useState(false);
  const deviceType = useResponsiveLayout().deviceType;
  const isTV = deviceType === "tv";
  const animationStyle = useButtonAnimation(isRowFocused, 1.2);

  const handleToggle = useCallback(() => {
    const s = useSettingsStore.getState();
    s.setRemoteInputEnabled(!s.remoteInputEnabled);
    onChanged();
  }, [onChanged]);

  return (
    <SettingsSection onFocus={onFocus} onBlur={onBlur}>
      <Pressable
        style={[styles.settingItem, isRowFocused && styles.settingItemFocused]}
        onFocus={() => setIsRowFocused(true)}
        onBlur={() => setIsRowFocused(false)}
        onPress={handleToggle}
      >
        <View style={styles.settingInfo}>
          <ThemedText style={styles.settingName}>启用远程输入</ThemedText>
          {isTV && (
            <ThemedText style={styles.settingDescription}>
              按确认键切换开关
            </ThemedText>
          )}
        </View>
        <Animated.View style={animationStyle}>
          { Platform.OS === 'ios' && Platform.isTV ? (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleToggle}
              style={styles.statusLabel}
            >
              <ThemedText style={styles.statusValue}>{remoteInputEnabled ? '已启用' : '已禁用'}</ThemedText>
            </TouchableOpacity>
          ) : (
            <Switch
              value={remoteInputEnabled}
              onValueChange={() => { }} // 禁用Switch的直接交互
              trackColor={{ false: "#767577", true: Colors.dark.primary }}
              thumbColor={remoteInputEnabled ? "#ffffff" : "#f4f3f4"}
              pointerEvents="none"
            />
          )
          }
        </Animated.View>
      </Pressable>

      {remoteInputEnabled && (
        <View style={styles.statusContainer}>
          <View style={styles.statusItem}>
            <ThemedText style={styles.statusLabel}>服务状态：</ThemedText>
            <ThemedText style={[styles.statusValue, { color: isServerRunning ? Colors.dark.primary : "#FF6B6B" }]}>
              {isServerRunning ? "运行中" : "已停止"}
            </ThemedText>
          </View>

          {serverUrl && (
            <View style={styles.statusItem}>
              <ThemedText style={styles.statusLabel}>访问地址：</ThemedText>
              <ThemedText style={styles.statusValue}>{serverUrl}</ThemedText>
            </View>
          )}

          {error && (
            <View style={styles.statusItem}>
              <ThemedText style={styles.statusLabel}>错误：</ThemedText>
              <ThemedText style={[styles.statusValue, { color: "#FF6B6B" }]}>{error}</ThemedText>
            </View>
          )}
        </View>
      )}
    </SettingsSection>
  );
};

const styles = StyleSheet.create({
  settingItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  settingItemFocused: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  settingInfo: {
    flex: 1,
  },
  settingName: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
    color: "#888",
  },
  statusContainer: {
    marginTop: 16,
    padding: 16,
    backgroundColor: "#2a2a2c",
    borderRadius: 8,
  },
  statusItem: {
    flexDirection: "row",
    marginBottom: 8,
  },
  statusLabel: {
    fontSize: 14,
    color: "#ccc",
    minWidth: 80,
  },
  statusValue: {
    fontSize: 14,
    flex: 1,
  },
  actionButtons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
  },
});
