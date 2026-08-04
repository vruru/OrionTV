/**
 * JS 崩溃取证：全局错误处理器把致命异常写入 AsyncStorage，
 * 下次启动时展示在设置页（更新区），用户可原样读回。
 * 电视端 release 包崩溃只有"闪退"表象，没有这一层就永远只能猜。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "crash_report_v1";

export const installCrashReporter = () => {
  const anyGlobal = global as any;
  const errorUtils = anyGlobal.ErrorUtils;
  if (!errorUtils?.getGlobalHandler || !errorUtils?.setGlobalHandler) return;
  const prev = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error: any, isFatal: boolean) => {
    try {
      void AsyncStorage.setItem(
        KEY,
        JSON.stringify({
          at: new Date().toISOString(),
          fatal: isFatal,
          message: String(error?.message ?? error).slice(0, 300),
          stack: String(error?.stack ?? "").slice(0, 1200),
        })
      );
    } catch {
      // 存储失败也不能影响原崩溃流程
    } finally {
      prev?.(error, isFatal);
    }
  });
};

export interface CrashReport {
  at: string;
  fatal: boolean;
  message: string;
  stack: string;
}

export const readCrashReport = async (): Promise<CrashReport | null> => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CrashReport) : null;
  } catch {
    return null;
  }
};

export const clearCrashReport = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // 忽略
  }
};
