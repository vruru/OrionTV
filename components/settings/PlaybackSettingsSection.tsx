import React, { useCallback } from "react";
import { View, Switch, StyleSheet, Pressable, Animated, Platform, TouchableOpacity } from "react-native";
import { useTVEventHandler } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { SettingsSection } from "./SettingsSection";
import { useSettingsStore } from "@/stores/settingsStore";
import { useButtonAnimation } from "@/hooks/useAnimation";
import { Colors } from "@/constants/Colors";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

interface PlaybackSettingsSectionProps {
  onChanged: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

interface ToggleRowProps {
  name: string;
  description?: string;
  value: boolean;
  onToggle: (next: boolean) => void;
}

// A single focusable toggle row. On TV the row itself is focusable and "select"
// flips the value; the Switch is display-only.
const ToggleRow: React.FC<ToggleRowProps> = ({ name, description, value, onToggle }) => {
  const [isFocused, setIsFocused] = React.useState(false);
  const animationStyle = useButtonAnimation(isFocused, 1.05);
  const deviceType = useResponsiveLayout().deviceType;

  const handleTVEvent = React.useCallback(
    (event: any) => {
      if (isFocused && event.eventType === "select") {
        onToggle(!value);
      }
    },
    [isFocused, value, onToggle]
  );
  useTVEventHandler(handleTVEvent);

  return (
    <Pressable
      style={styles.settingItem}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      {...(Platform.isTV || deviceType !== "tv" ? undefined : { onPress: () => onToggle(!value) })}
    >
      <View style={styles.settingInfo}>
        <ThemedText style={styles.settingName}>{name}</ThemedText>
        {description ? <ThemedText style={styles.settingDescription}>{description}</ThemedText> : null}
      </View>
      <Animated.View style={animationStyle}>
        {Platform.OS === "ios" && Platform.isTV ? (
          <TouchableOpacity activeOpacity={0.8} onPress={() => onToggle(!value)} style={styles.iosToggle}>
            <ThemedText style={styles.iosToggleText}>{value ? "已开启" : "已关闭"}</ThemedText>
          </TouchableOpacity>
        ) : (
          <Switch
            value={value}
            onValueChange={() => {}}
            trackColor={{ false: "#767577", true: Colors.dark.primary }}
            thumbColor={value ? "#ffffff" : "#f4f3f4"}
            pointerEvents="none"
          />
        )}
      </Animated.View>
    </Pressable>
  );
};

export const PlaybackSettingsSection: React.FC<PlaybackSettingsSectionProps> = ({ onChanged, onFocus, onBlur }) => {
  const { autoSkipIntroOutro, setAutoSkipIntroOutro, hdSourcesOnly, setHdSourcesOnly } = useSettingsStore();

  const handleAutoSkip = useCallback(
    (next: boolean) => {
      setAutoSkipIntroOutro(next);
      onChanged();
    },
    [setAutoSkipIntroOutro, onChanged]
  );

  const handleHdOnly = useCallback(
    (next: boolean) => {
      setHdSourcesOnly(next);
      onChanged();
    },
    [setHdSourcesOnly, onChanged]
  );

  return (
    <SettingsSection focusable onFocus={onFocus} onBlur={onBlur}>
      <ThemedText style={styles.sectionTitle}>播放设置</ThemedText>
      <ToggleRow
        name="自动跳过片头片尾"
        description="按已标记的片头/片尾时间自动跳过，并在片尾自动播放下一集"
        value={autoSkipIntroOutro}
        onToggle={handleAutoSkip}
      />
      <ToggleRow
        name="仅显示1080P及以上播放源"
        description="在选源列表中隐藏低于1080P的播放源（分辨率未知的仍会保留）"
        value={hdSourcesOnly}
        onToggle={handleHdOnly}
      />
    </SettingsSection>
  );
};

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 8,
  },
  settingItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  settingInfo: {
    flex: 1,
    paddingRight: 12,
  },
  settingName: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 13,
    color: "#888",
  },
  iosToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  iosToggleText: {
    fontSize: 14,
  },
});
