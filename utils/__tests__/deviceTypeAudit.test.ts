import { Platform, Dimensions } from "react-native";
import { DeviceUtils } from "../DeviceUtils";
import { getDeviceType } from "../../hooks/useResponsiveLayout";

jest.mock("react-native", () => {
  return {
    Dimensions: {
      get: jest.fn(),
      addEventListener: jest.fn(),
    },
    Platform: {
      isTV: false,
    },
  };
});

describe("DeviceUtils and Hook Consistency", () => {
  const widths = [767, 768, 1023, 1024];

  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as unknown as { isTV: boolean }).isTV = false;
  });

  it("DeviceUtils delegates to hook getDeviceType", () => {
    widths.forEach((width) => {
      (Dimensions.get as jest.Mock).mockReturnValue({ width, height: 1000 });
      const hookResult = getDeviceType(width);
      const utilResult = DeviceUtils.getDeviceType();
      expect(utilResult).toBe(hookResult);
    });
  });

  it("Handles TV Platform flag correctly", () => {
    (Platform as unknown as { isTV: boolean }).isTV = true;
    const smallWidth = 100;
    (Dimensions.get as jest.Mock).mockReturnValue({ width: smallWidth, height: 1000 });

    expect(getDeviceType(smallWidth)).toBe("tv");
    expect(DeviceUtils.getDeviceType()).toBe("tv");

    (Platform as unknown as { isTV: boolean }).isTV = false;
  });
});
