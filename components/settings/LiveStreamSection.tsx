import React, { useState, useRef, useImperativeHandle, forwardRef } from "react";
import { View, TextInput, StyleSheet, Animated } from "react-native";
import { useTVEventHandler } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { SettingsSection } from "./SettingsSection";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { useButtonAnimation } from "@/hooks/useAnimation";
import { Colors } from "@/constants/Colors";

interface LiveStreamSectionProps {
  onChanged: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onPress?: () => void;
  onInputFocus?: () => void;
  onInputBlur?: () => void;
}

export interface LiveStreamSectionRef {
  setInputValue: (value: string) => void;
}

export const LiveStreamSection = forwardRef<LiveStreamSectionRef, LiveStreamSectionProps>(
  ({ onChanged, onFocus, onBlur, onPress, onInputFocus, onInputBlur }, ref) => {
    const { m3uUrl, setM3uUrl, epgUrl, setEpgUrl, remoteInputEnabled } = useSettingsStore();
    const { serverUrl } = useRemoteControlStore();
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [isEpgInputFocused, setIsEpgInputFocused] = useState(false);
    const [isSectionFocused, setIsSectionFocused] = useState(false);
    // TV 遥控器上下键切换的目标输入框
    const [activeField, setActiveField] = useState<"m3u" | "epg">("m3u");
    const inputRef = useRef<TextInput>(null);
    const epgInputRef = useRef<TextInput>(null);
    const inputAnimationStyle = useButtonAnimation(isSectionFocused, 1.01);

    const handleUrlChange = (url: string) => {
      setM3uUrl(url);
      onChanged();
    };

    useImperativeHandle(ref, () => ({
      setInputValue: (value: string) => {
        setM3uUrl(value);
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

    // TV 上按确认键：聚焦当前目标输入框（M3U 或 EPG）
    const handlePress = () => {
      if (activeField === "epg") {
        epgInputRef.current?.focus();
      } else {
        inputRef.current?.focus();
      }
      onPress?.();
    };

    // TV 遥控器上下键切换目标输入框；确认键交给 onPress，避免双触发
    const handleTVEvent = React.useCallback(
      (event: any) => {
        if (!isSectionFocused || isInputFocused || isEpgInputFocused) return;
        if (event.eventType === "down") {
          setActiveField("epg");
        } else if (event.eventType === "up") {
          setActiveField("m3u");
        }
      },
      [isSectionFocused, isInputFocused, isEpgInputFocused]
    );

    useTVEventHandler(handleTVEvent);


        const [selection, setSelection] = useState<{ start: number; end: number }>({
          start: 0,
          end: 0,
        });
        // 当用户手动移动光标或选中文本时，同步到 state（可选）
        const onSelectionChange = ({
          nativeEvent: { selection },
        }: any) => {
          setSelection(selection);
        };

    return (
      <SettingsSection focusable onFocus={handleSectionFocus} onBlur={handleSectionBlur}
        onPress={handlePress}
      >
        <View style={styles.inputContainer}>
          <View style={styles.titleContainer}>
            <ThemedText style={styles.sectionTitle}>直播源地址</ThemedText>
            {remoteInputEnabled && serverUrl && (
              <ThemedText style={styles.subtitle}>用手机访问 {serverUrl}，可远程输入</ThemedText>
            )}
          </View>
          <Animated.View style={inputAnimationStyle}>
            <TextInput
              ref={inputRef}
              style={[styles.input, isInputFocused && styles.inputFocused, isSectionFocused && activeField === "m3u" && !isInputFocused && styles.inputTarget]}
              value={m3uUrl}
              onChangeText={handleUrlChange}
              placeholder="输入 M3U 直播源地址"
              placeholderTextColor="#888"
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => {
                setIsInputFocused(true);
                onInputFocus?.();
                // 将光标移动到文本末尾
                const end = m3uUrl.length;
                setSelection({ start: end, end: end });
                // 有时需要延迟一下，让系统先完成 focus 再设置 selection
                //（在 Android 上更可靠）
                setTimeout(() => {
                  // 对于受控的 selection 已经生效，这里仅作保险
                  inputRef.current?.setNativeProps({ selection: { start: end, end: end } });
                }, 0);
              }}
              selection={selection}
              onSelectionChange={onSelectionChange} // 可选

              onBlur={() => {
                setIsInputFocused(false);
                onInputBlur?.();
              }}
            // onPress={handlePress}
            />
          </Animated.View>
        </View>
        <View style={styles.inputContainer}>
          <View style={styles.titleContainer}>
            <ThemedText style={styles.sectionTitle}>EPG 节目单地址</ThemedText>
            <ThemedText style={styles.subtitle}>选填，xmltv 格式；填写后直播显示当前节目</ThemedText>
          </View>
          <Animated.View style={inputAnimationStyle}>
            <TextInput
              ref={epgInputRef}
              style={[styles.input, isEpgInputFocused && styles.inputFocused, isSectionFocused && activeField === "epg" && !isEpgInputFocused && styles.inputTarget]}
              value={epgUrl}
              onChangeText={(url) => {
                setEpgUrl(url);
                onChanged();
              }}
              placeholder="输入 EPG 节目单地址（如 http://epg.51zmt.top:8000/e.xml）"
              placeholderTextColor="#888"
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => {
                setIsEpgInputFocused(true);
                onInputFocus?.();
              }}
              onBlur={() => {
                setIsEpgInputFocused(false);
                onInputBlur?.();
              }}
            />
          </Animated.View>
        </View>
      </SettingsSection>
    );
  }
);

LiveStreamSection.displayName = "LiveStreamSection";

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
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
  // TV 上下键切换时的目标输入框提示边框
  inputTarget: {
    borderColor: "rgba(255, 255, 255, 0.4)",
  },
});
