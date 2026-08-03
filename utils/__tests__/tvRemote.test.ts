import { isTVLongPressStart } from "../tvRemote";

describe("isTVLongPressStart", () => {
  it("只把长按按下事件视为一次业务触发", () => {
    expect(isTVLongPressStart(0)).toBe(true);
    expect(isTVLongPressStart(1)).toBe(false);
  });

  it("兼容不提供 eventKeyAction 的遥控器", () => {
    expect(isTVLongPressStart(undefined)).toBe(true);
  });
});
