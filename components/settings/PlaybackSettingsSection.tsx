import React, { useCallback } from "react";
import { View, Switch, StyleSheet, Pressable, Animated, Platform, TouchableOpacity } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { SettingsSection } from "./SettingsSection";
import { useSettingsStore } from "@/stores/settingsStore";
import { nextResizeMode, RESIZE_MODE_DESCRIPTIONS, RESIZE_MODE_LABELS } from "@/utils/resizeMode";
import { useButtonAnimation } from "@/hooks/useAnimation";
import { Colors } from "@/constants/Colors";

interface PlaybackSettingsSectionProps {
  onChanged: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

interface RowBaseProps {
  name: string;
  description?: string;
}

interface ToggleRowProps extends RowBaseProps {
  value: boolean;
  onToggle: (next: boolean) => void;
}

interface CycleRowProps extends RowBaseProps {
  valueLabel: string;
  onCycle: () => void;
}

// A single cycle row: each "select" switches to the next option and
// the current value is shown as text on the right (like TV OSD settings).
const CycleRow: React.FC<CycleRowProps> = ({ name, description, valueLabel, onCycle }) => {
  const [isFocused, setIsFocused] = React.useState(false);
  const animationStyle = useButtonAnimation(isFocused, 1.05);

  return (
    <Pressable
      style={[styles.settingItem, isFocused && styles.settingItemFocused]}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onPress={onCycle}
    >
      <View style={styles.settingInfo}>
        <ThemedText style={styles.settingName}>{name}</ThemedText>
        {description ? <ThemedText style={styles.settingDescription}>{description}</ThemedText> : null}
      </View>
      <Animated.View style={animationStyle}>
        <ThemedText style={styles.cycleValue}>{valueLabel} ›</ThemedText>
      </Animated.View>
    </Pressable>
  );
};

// The row owns focus and activation; the visual Switch is display-only so the
// same target works with touch, keyboard, and a TV remote.
const ToggleRow: React.FC<ToggleRowProps> = ({ name, description, value, onToggle }) => {
  const [isFocused, setIsFocused] = React.useState(false);
  const animationStyle = useButtonAnimation(isFocused, 1.05);

  return (
    <Pressable
      style={[styles.settingItem, isFocused && styles.settingItemFocused]}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onPress={() => onToggle(!value)}
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
  const { autoSkipIntroOutro, hdSourcesOnly, videoResizeMode } = useSettingsStore();

  // TV 编辑模式：确认键进入模块，上下选行，确认激活（读 store 最新值避免闭包过期）
  const handleActivate = useCallback(
    (index: number) => {
      const s = useSettingsStore.getState();
      if (index === 0) {
        s.setAutoSkipIntroOutro(!s.autoSkipIntroOutro);
      } else if (index === 1) {
        s.setHdSourcesOnly(!s.hdSourcesOnly);
      } else {
        s.setVideoResizeMode(nextResizeMode(s.videoResizeMode));
      }
      onChanged();
    },
    [onChanged]
  );

  return (
    <SettingsSection onFocus={onFocus} onBlur={onBlur}>
      <ThemedText style={styles.sectionTitle}>播放设置</ThemedText>
      <ToggleRow
        name="自动跳过片头片尾"
        description="按已标记的片头/片尾时间自动跳过，并在片尾自动播放下一集"
        value={autoSkipIntroOutro}
        onToggle={(next) => {
          useSettingsStore.getState().setAutoSkipIntroOutro(next);
          onChanged();
        }}
      />
      <ToggleRow
        name="仅显示1080P及以上播放源"
        description="在选源列表中隐藏低于1080P的播放源（分辨率未知的仍会保留）"
        value={hdSourcesOnly}
        onToggle={(next) => {
          useSettingsStore.getState().setHdSourcesOnly(next);
          onChanged();
        }}
      />
      <CycleRow
        name="画面比例"
        description={`${RESIZE_MODE_DESCRIPTIONS[videoResizeMode]}（直播时 TV 遥控器上键可快捷切换）`}
        valueLabel={RESIZE_MODE_LABELS[videoResizeMode]}
        onCycle={handleActivate.bind(null, 2)}
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
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  // TV/keyboard focus highlight
  settingItemFocused: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
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
  cycleValue: {
    fontSize: 14,
    color: Colors.dark.primary,
    fontWeight: "bold",
  },
});
