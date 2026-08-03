/**
 * 错误监控（Sentry）初始化
 *
 * 默认关闭：把 dsn 换成你自己的 Sentry DSN 后自动启用。
 * 不配置 DSN 时所有函数均为空操作，不产生任何网络请求。
 */
import * as Sentry from "@sentry/react-native";
import Logger from "@/utils/Logger";
import { setErrorSink } from "@/utils/Logger";

const logger = Logger.withTag("Monitoring");

// TODO: 填入你的 Sentry DSN（https://sentry.io 免费创建项目即可获得）
const SENTRY_DSN = "";

export function initMonitoring(): void {
  if (!SENTRY_DSN) {
    logger.info("Sentry DSN 未配置，错误监控未启用");
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    // 开发环境不上报，避免噪音
    enabled: !__DEV__,
    // 崩溃/错误采样率，1.0 = 全部上报
    sampleRate: 1.0,
    // 性能追踪采样率（App 内页面/请求耗时），按需调低
    tracesSampleRate: 0.2,
    enableAutoSessionTracking: true,
  });

  // 让 Logger.error 在生产环境也上报到 Sentry（console 输出仍受 __DEV__ 控制）
  setErrorSink((message: string) => {
    Sentry.captureMessage(message, "error");
  });

  logger.info("Sentry 错误监控已启用");
}

export { Sentry };
