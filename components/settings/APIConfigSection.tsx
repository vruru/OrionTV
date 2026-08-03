import React, { useState, useRef, useImperativeHandle, forwardRef } from "react";
import { View, TextInput, StyleSheet, Animated, TouchableOpacity } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { SettingsSection } from "./SettingsSection";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { useButtonAnimation } from "@/hooks/useAnimation";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { Colors } from "@/constants/Colors";

interface APIConfigSectionProps {
  onChanged: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onPress?: () => void;
  onInputFocus?: () => void;
  onInputBlur?: () => void;
  hideDescription?: boolean;
}

export interface APIConfigSectionRef {
  setInputValue: (value: string) => void;
}

export const APIConfigSection = forwardRef<APIConfigSectionRef, APIConfigSectionProps>(
  ({ onChanged, onFocus, onBlur, onPress, onInputFocus, onInputBlur, hideDescription = false }, ref) => {
    const { apiBaseUrl, setApiBaseUrl, remoteInputEnabled } = useSettingsStore();
    const { serverUrl } = useRemoteControlStore();
    const deviceType = useResponsiveLayout().deviceType;
    const isTV = deviceType === "tv";

    const [isInputTargetFocused, setIsInputTargetFocused] = useState(false);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const inputRef = useRef<TextInput>(null);
    const inputAnimationStyle = useButtonAnimation(isInputTargetFocused || isInputFocused, 1.01);

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
      onFocus?.();
    };

    const focusInput = () => {
      inputRef.current?.focus();
      const end = apiBaseUrl.length;
      inputRef.current?.setNativeProps({ selection: { start: end, end: end } });
      onPress?.();
    };

    return (
      <SettingsSection
        onFocus={handleSectionFocus}
        onBlur={onBlur}
      >
        <View style={styles.inputContainer}>
          <View style={styles.titleContainer}>
            <ThemedText style={styles.sectionTitle}>API 地址</ThemedText>
            {!hideDescription && remoteInputEnabled && serverUrl && (
              <ThemedText style={styles.subtitle}>用手机访问 {serverUrl}，可远程输入</ThemedText>
            )}
            {isTV && (
              <ThemedText style={styles.subtitle}>
                聚焦输入框后按确认键编辑
              </ThemedText>
            )}
          </View>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={focusInput}
            onFocus={() => setIsInputTargetFocused(true)}
            onBlur={() => setIsInputTargetFocused(false)}
          >
            <Animated.View style={inputAnimationStyle}>
              <TextInput
                ref={inputRef}
                style={[styles.input, (isInputTargetFocused || isInputFocused) && styles.inputFocused]}
                value={apiBaseUrl}
                onChangeText={handleUrlChange}
                placeholder="输入服务器地址"
                placeholderTextColor="#888"
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={() => {
                  setIsInputFocused(true);
                  onInputFocus?.();
                }}
                onBlur={() => {
                  setIsInputFocused(false);
                  onInputBlur?.();
                }}
              />
            </Animated.View>
          </TouchableOpacity>
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
});
