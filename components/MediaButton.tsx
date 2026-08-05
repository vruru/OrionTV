import React, { ComponentProps } from "react";
import { StyledButton } from "./StyledButton";
import { StyleSheet, View, Text } from "react-native";

type StyledButtonProps = ComponentProps<typeof StyledButton> & {
  timeLabel?: string;
  /** Android TV 上由页面统一处理遥控器事件时，仅渲染视觉按钮，不注册原生焦点。 */
  tvManaged?: boolean;
};

export const MediaButton = ({ timeLabel, tvManaged = false, ...props }: StyledButtonProps) => (
  <View style={props.isSelected && styles.selectedContainer}>
    {tvManaged ? (
      <View style={[styles.mediaControlButton, props.style]}>{props.children}</View>
    ) : (
      <StyledButton {...props} style={[styles.mediaControlButton, props.style]} variant="ghost" />
    )}
    {timeLabel && <Text style={styles.timeLabel}>{timeLabel}</Text>}
  </View>
);

const styles = StyleSheet.create({
  mediaControlButton: {
    padding: 12,
    minWidth: 80,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  selectedContainer: {
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#9ec9ff",
    backgroundColor: "rgba(158, 201, 255, 0.18)",
  },
  timeLabel: {
    position: "absolute",
    top: 14,
    right: 12,
    color: "white",
    fontSize: 10,
    fontWeight: "bold",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 4,
    borderRadius: 3,
  },
});
