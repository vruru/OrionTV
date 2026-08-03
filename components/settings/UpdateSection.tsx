import React from "react";
import { View, StyleSheet, Platform, ActivityIndicator } from "react-native";
import * as Updates from "expo-updates";
import { ThemedText } from "../ThemedText";
import { StyledButton } from "../StyledButton";
import { useUpdateStore } from "@/stores/updateStore";
import Logger from "@/utils/Logger";
// import { UPDATE_CONFIG } from "@/constants/UpdateConfig";

const logger = Logger.withTag("OtaUpdate");

// EAS Update 热更新状态：idle → checking → downloading → ready / error / none
type OtaState = "idle" | "checking" | "downloading" | "ready" | "none" | "error";

export function UpdateSection() {
  const { 
    currentVersion, 
    remoteVersion, 
    updateAvailable, 
    downloading, 
    downloadProgress, 
    checkForUpdate,
    isLatestVersion,
    error
  } = useUpdateStore();

  const [checking, setChecking] = React.useState(false);
  const [otaState, setOtaState] = React.useState<OtaState>("idle");
  const [otaMessage, setOtaMessage] = React.useState<string | null>(null);

  // 开发构建 / Expo Go 下 expo-updates 不可用
  const otaSupported = Updates.isEnabled;

  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      await checkForUpdate(false);
    } finally {
      setChecking(false);
    }
  };

  // 检查并下载 EAS OTA 热更新；下载完成需重启生效
  const handleOtaCheck = async () => {
    if (!otaSupported) return;
    setOtaState("checking");
    setOtaMessage(null);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        setOtaState("none");
        setOtaMessage("已是最新热更新");
        return;
      }
      setOtaState("downloading");
      await Updates.fetchUpdateAsync();
      setOtaState("ready");
      setOtaMessage("热更新已下载，重启后生效");
    } catch (e) {
      logger.info("OTA check/fetch failed:", e);
      setOtaState("error");
      setOtaMessage("检查热更新失败，请稍后重试");
    }
  };

  const handleOtaReload = async () => {
    try {
      await Updates.reloadAsync();
    } catch (e) {
      logger.info("OTA reload failed:", e);
    }
  };

  return (
    <View style={styles.sectionContainer}>
      <ThemedText style={styles.sectionTitle}>应用更新</ThemedText>

      <View style={styles.row}>
        <ThemedText style={styles.label}>当前版本</ThemedText>
        <ThemedText style={styles.value}>v{currentVersion}</ThemedText>
      </View>

      {updateAvailable && (
        <View style={styles.row}>
          <ThemedText style={styles.label}>最新版本</ThemedText>
          <ThemedText style={[styles.value, styles.newVersion]}>v{remoteVersion}</ThemedText>
        </View>
      )}

      {isLatestVersion && remoteVersion && (
        <View style={styles.row}>
          <ThemedText style={styles.label}>状态</ThemedText>
          <ThemedText style={[styles.value, styles.latestVersion]}>已是最新版本</ThemedText>
        </View>
      )}

      {error && (
        <View style={styles.row}>
          <ThemedText style={styles.label}>检查结果</ThemedText>
          <ThemedText style={[styles.value, styles.errorText]}>{error}</ThemedText>
        </View>
      )}

      {downloading && (
        <View style={styles.row}>
          <ThemedText style={styles.label}>下载进度</ThemedText>
          <ThemedText style={styles.value}>{downloadProgress}%</ThemedText>
        </View>
      )}

      <View style={styles.buttonContainer}>
        <StyledButton onPress={handleCheckUpdate} disabled={checking || downloading} style={styles.button}>
          {checking ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <ThemedText style={styles.buttonText}>检查更新</ThemedText>
          )}
        </StyledButton>
      </View>

      {/* EAS OTA 热更新：JS bundle 级更新，无需重装应用 */}
      <View style={styles.otaDivider} />
      <ThemedText style={styles.otaTitle}>热更新（OTA）</ThemedText>

      {/* 诊断信息始终显示：用于排查正式构建中热更新未启用的问题 */}
      <View style={styles.row}>
        <ThemedText style={styles.label}>状态</ThemedText>
        <ThemedText style={[styles.value, otaSupported ? styles.latestVersion : styles.errorText]}>
          {otaSupported ? "已启用" : "未启用"}
        </ThemedText>
      </View>
      <View style={styles.row}>
        <ThemedText style={styles.label}>通道 / 运行时版本</ThemedText>
        <ThemedText style={styles.value} numberOfLines={1}>
          {Updates.channel || "默认"} / {Updates.runtimeVersion || "未知"}
        </ThemedText>
      </View>
      <View style={styles.row}>
        <ThemedText style={styles.label}>更新 ID</ThemedText>
        <ThemedText style={styles.value} numberOfLines={1}>
          {Updates.updateId ? Updates.updateId.slice(0, 8) : "内嵌包"}
        </ThemedText>
      </View>
      {Updates.isEmergencyLaunch && (
        <View style={styles.row}>
          <ThemedText style={styles.label}>紧急回退</ThemedText>
          <ThemedText style={[styles.value, styles.errorText]} numberOfLines={2}>
            {Updates.emergencyLaunchReason || "更新异常，已回退到内嵌包"}
          </ThemedText>
        </View>
      )}

      {otaSupported ? (
        <>
          {otaMessage && (
            <View style={styles.row}>
              <ThemedText style={styles.label}>检查结果</ThemedText>
              <ThemedText
                style={[
                  styles.value,
                  otaState === "error" ? styles.errorText : styles.latestVersion,
                ]}
              >
                {otaMessage}
              </ThemedText>
            </View>
          )}
          <View style={styles.buttonContainer}>
            {otaState === "ready" ? (
              <StyledButton onPress={handleOtaReload} style={styles.button}>
                <ThemedText style={styles.buttonText}>立即重启生效</ThemedText>
              </StyledButton>
            ) : (
              <StyledButton
                onPress={handleOtaCheck}
                disabled={otaState === "checking" || otaState === "downloading"}
                style={styles.button}
              >
                {otaState === "checking" || otaState === "downloading" ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <ThemedText style={styles.buttonText}>检查热更新</ThemedText>
                )}
              </StyledButton>
            )}
          </View>
        </>
      ) : (
        <ThemedText style={styles.hint}>
          热更新在当前构建中未启用。请将上方状态信息反馈给开发者排查
        </ThemedText>
      )}

      {/* {UPDATE_CONFIG.AUTO_CHECK && (
        <ThemedText style={styles.hint}>
          自动检查更新已开启，每{UPDATE_CONFIG.CHECK_INTERVAL / (60 * 60 * 1000)}小时检查一次
        </ThemedText>
      )} */}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionContainer: {
    marginBottom: 24,
    padding: 16,
    backgroundColor: Platform.select({
      ios: "rgba(255, 255, 255, 0.05)",
      android: "rgba(255, 255, 255, 0.05)",
      default: "transparent",
    }),
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: Platform.isTV ? 24 : 20,
    fontWeight: "bold",
    marginBottom: 16,
    paddingTop: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  label: {
    fontSize: Platform.isTV ? 18 : 16,
    color: "#999",
  },
  value: {
    fontSize: Platform.isTV ? 18 : 16,
  },
  newVersion: {
    color: "#00bb5e",
    fontWeight: "bold",
  },
  latestVersion: {
    color: "#00bb5e",
    fontWeight: "500",
  },
  errorText: {
    color: "#ff6b6b",
    fontWeight: "500",
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
    justifyContent: "center", // 居中对齐
    alignItems: "center",
  },
  button: {
    width: "90%",
    ...(Platform.isTV && {
      // TV平台焦点样式
      borderWidth: 2,
      borderColor: "transparent",
    }),
  },
  buttonText: {
    color: "#ffffff",
    fontSize: Platform.isTV ? 16 : 14,
    fontWeight: "500",
  },
  hint: {
    fontSize: Platform.isTV ? 14 : 12,
    color: "#666",
    marginTop: 12,
    textAlign: "center",
  },
  otaDivider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    marginTop: 20,
    marginBottom: 12,
  },
  otaTitle: {
    fontSize: Platform.isTV ? 18 : 15,
    fontWeight: "bold",
    color: "#ccc",
    marginBottom: 12,
  },
});
