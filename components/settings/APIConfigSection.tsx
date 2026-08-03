import React, { useState, useRef, useImperativeHandle, forwardRef, useEffect } from "react";
import { View, TextInput, StyleSheet, Animated, Keyboard } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { SettingsSection } from "./SettingsSection";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { useButtonAnimation } from "@/hooks/useAnimation";
import { useSectionEditMode } from "@/hooks/useSectionEditMode";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { Colors } from "@/constants/Colors";

interface APIConfigSectionProps {
  onChanged: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onPress?: () => void;
  onInputFocus?: () => void;
  onInputBlur?: () => void;
  onEditModeChange?: (editing: boolean) => void;
  hideDescription?: boolean;
}

export interface APIConfigSectionRef {
  setInputValue: (value: string) => void;
}

export const APIConfigSection = forwardRef<APIConfigSectionRef, APIConfigSectionProps>(
  ({ onChanged, onFocus, onBlur, onPress, onInputFocus, onInputBlur, onEditModeChange, hideDescription = false }, ref) => {
    const { apiBaseUrl, setApiBaseUrl, remoteInputEnabled } = useSettingsStore();
    const { serverUrl } = useRemoteControlStore();
    const deviceType = useResponsiveLayout().deviceType;
    const isTV = deviceType === "tv";

    const [isSectionFocused, setIsSectionFocused] = useState(false);
    const [editing, setEditing] = useState(false);
    const inputRef = useRef<TextInput>(null);
    const inputAnimationStyle = useButtonAnimation(isSectionFocused, 1.01);

    const handleUrlChange = (url: string) => {
      setApiBaseUrl(url);
      onChanged();
    };

    useImperativeHandle(ref, () => ({
      setInputValue: (value: string) => {
        setApiBaseUrl(value);
        onChanged();
      },
    }));

    const handleSectionFocus = () => {
      setIsSectionFocused(true);
      onFocus?.();
    };

    const handleSectionBlur = () => {
      setIsSectionFocused(false);
      onBlur?.();
    };

    const dismissEditing = () => {
      inputRef.current?.blur();
      Keyboard.dismiss();
      setEditing(false);
    };

    const { editMode, enterEditMode } = useSectionEditMode({
      deviceType,
      itemCount: 1,
      isSectionFocused,
      isEditingTarget: editing,
      onActivate: () => setEditing(true),
      onDismissTarget: dismissEditing,
      onEditModeChange,
    });

    // 激活后等一帧让 focusable=true 先生效，再程序聚焦弹键盘
    useEffect(() => {
      if (!editing) return;
      const t = setTimeout(() => {
        inputRef.current?.focus();
        // 光标移到文本末尾
        const end = apiBaseUrl.length;
        inputRef.current?.setNativeProps({ selection: { start: end, end: end } });
      }, 50);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editing]);

    return (
      <SettingsSection
        focusable
        onFocus={handleSectionFocus}
        onBlur={handleSectionBlur}
        onPress={() => {
          enterEditMode();
          onPress?.();
        }}
      >
        <View style={styles.inputContainer}>
          <View style={styles.titleContainer}>
            <ThemedText style={styles.sectionTitle}>API 地址</ThemedText>
            {!hideDescription && remoteInputEnabled && serverUrl && (
              <ThemedText style={styles.subtitle}>用手机访问 {serverUrl}，可远程输入</ThemedText>
            )}
            {isTV && (
              <ThemedText style={styles.subtitle}>
                {editMode ? "确认键编辑 · 返回键退出" : "按确认键进入编辑"}
              </ThemedText>
            )}
          </View>
          <Animated.View style={inputAnimationStyle}>
            <TextInput
              ref={inputRef}
              style={[
                styles.input,
                editing && styles.inputFocused,
                isTV && editMode && !editing && styles.inputTarget,
              ]}
              value={apiBaseUrl}
              onChangeText={handleUrlChange}
              placeholder="输入服务器地址"
              placeholderTextColor="#888"
              autoCapitalize="none"
              autoCorrect={false}
              focusable={!isTV || editing}
              onFocus={() => {
                if (isTV) setEditing(true);
                onInputFocus?.();
              }}
              onBlur={() => {
                if (isTV) setEditing(false);
                onInputBlur?.();
              }}
            />
          </Animated.View>
        </View>
      </SettingsSection>
    );
  }
);

APIConfigSection.displayName = "APIConfigSection";

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    flexWrap: "wrap",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginRight: 12,
  },
  subtitle: {
    fontSize: 12,
    color: "#888",
    fontStyle: "italic",
  },
  inputContainer: {
    marginBottom: 12,
  },
  input: {
    height: 50,
    borderWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 15,
    fontSize: 16,
    backgroundColor: "#3a3a3c",
    color: "white",
    borderColor: "transparent",
  },
  inputFocused: {
    borderColor: Colors.dark.primary,
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 5,
  },
  // TV 编辑模式下的光标目标提示边框
  inputTarget: {
    borderColor: "rgba(255, 255, 255, 0.4)",
  },
});
