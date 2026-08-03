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

interface LiveStreamSectionProps {
  onChanged: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onPress?: () => void;
  onInputFocus?: () => void;
  onInputBlur?: () => void;
  onEditModeChange?: (editing: boolean) => void;
}

export interface LiveStreamSectionRef {
  setInputValue: (value: string) => void;
}

// TV 编辑模式下的目标输入框顺序（模块级常量，引用稳定）
const FIELD_ORDER = ["m3u", "epg", "replay"] as const;
type Field = (typeof FIELD_ORDER)[number];

export const LiveStreamSection = forwardRef<LiveStreamSectionRef, LiveStreamSectionProps>(
  ({ onChanged, onFocus, onBlur, onPress, onInputFocus, onInputBlur, onEditModeChange }, ref) => {
    const { m3uUrl, setM3uUrl, epgUrl, setEpgUrl, replayServerUrl, setReplayServerUrl, remoteInputEnabled } = useSettingsStore();
    const { serverUrl } = useRemoteControlStore();
    const deviceType = useResponsiveLayout().deviceType;
    const isTV = deviceType === "tv";

    const [isSectionFocused, setIsSectionFocused] = useState(false);
    // 当前激活编辑的输入框（仅 TV 编辑模式）：非激活的输入框 focusable=false，
    // 防止系统焦点引擎绕过编辑模式直接钻进输入框
    const [editingField, setEditingField] = useState<Field | null>(null);
    const inputRef = useRef<TextInput>(null);
    const epgInputRef = useRef<TextInput>(null);
    const replayInputRef = useRef<TextInput>(null);
    const inputAnimationStyle = useButtonAnimation(isSectionFocused, 1.01);

    const inputRefs: Record<Field, React.RefObject<TextInput>> = {
      m3u: inputRef,
      epg: epgInputRef,
      replay: replayInputRef,
    };

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

    // TV 编辑模式：确认键激活光标所在输入框并弹出系统键盘
    const handleActivate = (index: number) => {
      setEditingField(FIELD_ORDER[index]);
    };

    const dismissEditing = () => {
      if (editingField) inputRefs[editingField].current?.blur();
      Keyboard.dismiss();
      setEditingField(null);
    };

    const { editMode, cursor, enterEditMode } = useSectionEditMode({
      deviceType,
      itemCount: FIELD_ORDER.length,
      isSectionFocused,
      isEditingTarget: !!editingField,
      onActivate: handleActivate,
      onDismissTarget: dismissEditing,
      onEditModeChange,
    });

    // 激活后等一帧让 focusable=true 先生效，再程序聚焦弹键盘
    useEffect(() => {
      if (!editingField) return;
      const t = setTimeout(() => {
        inputRefs[editingField].current?.focus();
      }, 50);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editingField]);

    const makeInputProps = (field: Field) => ({
      // TV 上只有被激活的输入框才可聚焦；其余平台保持默认
      focusable: !isTV || editingField === field,
      onFocus: () => {
        if (isTV) setEditingField(field);
        onInputFocus?.();
      },
      onBlur: () => {
        if (isTV) setEditingField(null);
        onInputBlur?.();
      },
    });

    const inputStyleFor = (field: Field) => [
      styles.input,
      editingField === field && styles.inputFocused,
      isTV && editMode && FIELD_ORDER[cursor] === field && editingField !== field && styles.inputTarget,
    ];

    const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
    const onSelectionChange = ({ nativeEvent: { selection } }: any) => {
      setSelection(selection);
    };

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
            <ThemedText style={styles.sectionTitle}>直播源地址</ThemedText>
            {remoteInputEnabled && serverUrl && (
              <ThemedText style={styles.subtitle}>用手机访问 {serverUrl}，可远程输入</ThemedText>
            )}
            {isTV && (
              <ThemedText style={styles.subtitle}>
                {editMode ? "上下键选择 · 确认键编辑 · 返回键退出" : "按确认键进入编辑"}
              </ThemedText>
            )}
          </View>
          <Animated.View style={inputAnimationStyle}>
            <TextInput
              ref={inputRef}
              style={inputStyleFor("m3u")}
              value={m3uUrl}
              onChangeText={handleUrlChange}
              placeholder="输入 M3U 直播源地址"
              placeholderTextColor="#888"
              autoCapitalize="none"
              autoCorrect={false}
              selection={selection}
              onSelectionChange={onSelectionChange}
              {...makeInputProps("m3u")}
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
              style={inputStyleFor("epg")}
              value={epgUrl}
              onChangeText={(url) => {
                setEpgUrl(url);
                onChanged();
              }}
              placeholder="输入 EPG 节目单地址（如 http://epg.51zmt.top:8000/e.xml）"
              placeholderTextColor="#888"
              autoCapitalize="none"
              autoCorrect={false}
              {...makeInputProps("epg")}
            />
          </Animated.View>
        </View>
        <View style={styles.inputContainer}>
          <View style={styles.titleContainer}>
            <ThemedText style={styles.sectionTitle}>回看服务地址</ThemedText>
            <ThemedText style={styles.subtitle}>选填，NAS 回看服务；填写后直播频道按菜单键可看回看</ThemedText>
          </View>
          <Animated.View style={inputAnimationStyle}>
            <TextInput
              ref={replayInputRef}
              style={inputStyleFor("replay")}
              value={replayServerUrl}
              onChangeText={(url) => {
                setReplayServerUrl(url);
                onChanged();
              }}
              placeholder="输入回看服务地址（如 http://192.168.0.251:50088）"
              placeholderTextColor="#888"
              autoCapitalize="none"
              autoCorrect={false}
              {...makeInputProps("replay")}
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
