import React, { useState } from "react";
import { StyleSheet } from "react-native";
import { ThemedView } from "@/components/ThemedView";
import { Colors } from "@/constants/Colors";

interface SettingsSectionProps {
  children: React.ReactNode;
  onFocus?: () => void;
  onBlur?: () => void;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({ children, onFocus, onBlur }) => {
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = () => {
    setIsFocused(true);
    onFocus?.();
  };

  const handleBlur = () => {
    setIsFocused(false);
    onBlur?.();
  };

  // The section is deliberately presentation-only. Focus and blur events from
  // its descendants bubble to this View, so the frame can still be highlighted
  // without placing one large Pressable over every TextInput/Switch inside it.
  // A focusable wrapper here intercepts touch events and traps Android TV focus.
  return (
    <ThemedView
      style={[styles.section, isFocused && styles.sectionFocused]}
      // react-native-tvos supports bubbling focus events on View at runtime;
      // the 0.74 TypeScript ViewProps shipped by RN do not declare them yet.
      // @ts-expect-error react-native-tvos View focus event
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      {children}
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  section: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#333",
  },
  sectionFocused: {
    borderColor: Colors.dark.primary,
    backgroundColor: "#007AFF10",
  },
});
