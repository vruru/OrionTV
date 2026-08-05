import React from "react";
import renderer from "react-test-renderer";
import { Text } from "react-native";
import { MediaButton } from "../MediaButton";

jest.mock("../StyledButton", () => ({
  StyledButton: ({ children }: { children?: React.ReactNode }) => {
    const MockView = require("react-native").View;
    return <MockView testID="native-focus-button">{children}</MockView>;
  },
}));

describe("MediaButton", () => {
  it("TV 自管模式不渲染原生焦点按钮", () => {
    const tree = renderer.create(
      <MediaButton tvManaged isSelected onPress={jest.fn()}>
        <Text>暂停</Text>
      </MediaButton>
    );

    expect(tree.root.findAllByProps({ testID: "native-focus-button" })).toHaveLength(0);
    expect(tree.root.findByType(Text).props.children).toBe("暂停");
  });

  it("普通模式保留可点击按钮", () => {
    const tree = renderer.create(
      <MediaButton onPress={jest.fn()}>
        <Text>暂停</Text>
      </MediaButton>
    );

    expect(tree.root.findAllByProps({ testID: "native-focus-button" }).length).toBeGreaterThan(0);
  });
});
