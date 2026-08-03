import React, { useState, useRef, useImperativeHandle, forwardRef } from "react";
import { View, TextInput, StyleSheet, TouchableOpacity } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { SettingsSection } from "./SettingsSection";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
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

type Field = "m3u" | "epg" | "replay";

export const LiveStreamSection = forwardRef<LiveStreamSectionRef, LiveStreamSectionProps>(
  ({ onChanged, onFocus, onBlur, onPress, onInputFocus, onInputBlur }, ref) => {
    const { m3uUrl, setM3uUrl, epgUrl, setEpgUrl, replayServerUrl, setReplayServerUrl, remoteInputEnabled } = useSettingsStore();
    const { serverUrl } = useRemoteControlStore();
    const deviceType = useResponsiveLayout().deviceType;
    const isTV = deviceType === "tv";

    const [focusedTarget, setFocusedTarget] = useState<Field | null>(null);
    const [editingField, setEditingField] = useState<Field | null>(null);
    const inputRef = useRef<TextInput>(null);
    const epgInputRef = useRef<TextInput>(null);
    const replayInputRef = useRef<TextInput>(null);
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
      onFocus?.();
    };

    const focusInput = (field: Field) => {
      inputRefs[field].current?.focus();
      onPress?.();
    };

    const makeInputProps = (field: Field) => ({
      onFocus: () => {
        setEditingField(field);
        onInputFocus?.();
      },
      onBlur: () => {
        setEditingField((current) => current === field ? null : current);
        onInputBlur?.();
      },
    });

    const inputStyleFor = (field: Field) => [
      styles.input,
      (focusedTarget === field || editingField === field) && styles.inputFocused,
    ];

    const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
    const onSelectionChange = ({ nativeEvent: { selection } }: any) => {
      setSelection(selection);
    };

    return (
      <SettingsSection
        onFocus={handleSectionFocus}
        onBlur={onBlur}
      >
        <View style={styles.inputContainer}>
          <View style={styles.titleContainer}>
            <ThemedText style={styles.sectionTitle}>直播源地址</ThemedText>
            {remoteInputEnabled && serverUrl && (
              <ThemedText style={styles.subtitle}>用手机访问 {serverUrl}，可远程输入</ThemedText>
            )}
            {isTV && (
              <ThemedText style={styles.subtitle}>
                上下键切换输入框 · 确认键编辑
              </ThemedText>
            )}
          </View>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => focusInput("m3u")}
            onFocus={() => setFocusedTarget("m3u")}
            onBlur={() => setFocusedTarget((current) => current === "m3u" ? null : current)}
          >
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
          </TouchableOpacity>
        </View>
        <View style={styles.inputContainer}>
          <View style={styles.titleContainer}>
            <ThemedText style={styles.sectionTitle}>EPG 节目单地址</ThemedText>
            <ThemedText style={styles.subtitle}>选填，xmltv 格式；填写后直播显示当前节目</ThemedText>
          </View>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => focusInput("epg")}
            onFocus={() => setFocusedTarget("epg")}
            onBlur={() => setFocusedTarget((current) => current === "epg" ? null : current)}
          >
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
          </TouchableOpacity>
        </View>
        <View style={styles.inputContainer}>
          <View style={styles.titleContainer}>
            <ThemedText style={styles.sectionTitle}>回看服务地址</ThemedText>
            <ThemedText style={styles.subtitle}>选填，NAS 回看服务；填写后直播频道按菜单键可看回看</ThemedText>
          </View>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => focusInput("replay")}
            onFocus={() => setFocusedTarget("replay")}
            onBlur={() => setFocusedTarget((current) => current === "replay" ? null : current)}
          >
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
          </TouchableOpacity>
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
});
