// UpdateService.ts
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
// import * as Device from 'expo-device';
import Toast from 'react-native-toast-message';
import { version as currentVersion } from '../package.json';
import { UPDATE_CONFIG } from '../constants/UpdateConfig';
import Logger from '@/utils/Logger';
import { Platform } from 'react-native';

const logger = Logger.withTag('UpdateService');

interface VersionInfo {
  version: string;
  downloadUrl: string;
}

/**
 * 只在 Android 平台使用的常量（iOS 不会走到下载/安装流程）
 */
const ANDROID_MIME_TYPE = 'application/vnd.android.package-archive';

class UpdateService {
  private static instance: UpdateService;
  static getInstance(): UpdateService {
    if (!UpdateService.instance) {
      UpdateService.instance = new UpdateService();
    }
    return UpdateService.instance;
  }

  /** 带超时的 fetch */
  private async fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  }

  /**
   * 通过 GitHub Releases API 获取“确实带有 APK 资源”的最新发布版本。
   * 之前的做法只读 package.json 的版本号并拼出下载地址，并不校验该版本是否真的
   * 发布了 APK；因此在 CI 构建尚未完成、或构建失败时，会显示新版本号但点击更新
   * 却下载失败。这里改为以真正带 apk 资源的 release 为准。
   */
  private async fetchLatestReleaseWithApk(): Promise<VersionInfo | null> {
    const apiUrl = UPDATE_CONFIG.getReleasesApiUrl();
    // 优先走加速代理，失败再直连 api.github.com
    const candidates = [UPDATE_CONFIG.withProxy(apiUrl), apiUrl];

    for (const url of candidates) {
      try {
        const res = await this.fetchWithTimeout(url, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) continue;
        const releases = await res.json();
        if (!Array.isArray(releases)) continue;

        for (const rel of releases) {
          if (rel.draft || rel.prerelease) continue;
          const assets: any[] = Array.isArray(rel.assets) ? rel.assets : [];
          const apk = assets.find(
            (a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.apk') && (a.state ? a.state === 'uploaded' : true)
          );
          if (apk && apk.browser_download_url) {
            const version = String(rel.tag_name || '').replace(/^v/i, '');
            if (!version) continue;
            return {
              version,
              // 用加速代理包裹真实的资源下载地址
              downloadUrl: UPDATE_CONFIG.withProxy(apk.browser_download_url),
            };
          }
        }
      } catch (e) {
        logger.warn(`releases API failed for ${url}`, e);
      }
    }
    return null;
  }

  /** HEAD 校验下载地址是否真的存在（用于 package.json 回退路径） */
  private async verifyUrlAvailable(url: string): Promise<boolean> {
    try {
      const res = await this.fetchWithTimeout(url, { method: 'HEAD' }, 8_000);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** --------------------------------------------------------------
   *  1️⃣ 远程版本检查：以“带 APK 资源的最新 release”为准
   * --------------------------------------------------------------- */
  async checkVersion(): Promise<VersionInfo> {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 首选：GitHub Releases API（确保对应版本确实发布了 APK）
        const fromApi = await this.fetchLatestReleaseWithApk();
        if (fromApi) return fromApi;

        // 回退：读取 master 的 package.json 版本号，但必须先校验 APK 已存在，
        // 避免显示了新版本却没有对应 APK 导致更新失败。
        const response = await this.fetchWithTimeout(UPDATE_CONFIG.GITHUB_RAW_URL);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const remotePackage = await response.json();
        const remoteVersion = remotePackage.version as string;
        const downloadUrl = UPDATE_CONFIG.getDownloadUrl(remoteVersion);

        const available = await this.verifyUrlAvailable(downloadUrl);
        if (available) {
          return { version: remoteVersion, downloadUrl };
        }
        // 新版本的 APK 尚未发布：按“当前即最新”处理，不误报可更新。
        logger.warn(`Version ${remoteVersion} has no published APK yet; treating as no update.`);
        return { version: currentVersion, downloadUrl: UPDATE_CONFIG.getDownloadUrl(currentVersion) };
      } catch (e) {
        logger.warn(`checkVersion attempt ${attempt}/${maxRetries}`, e);
        if (attempt === maxRetries) {
          Toast.show({
            type: 'error',
            text1: '检查更新失败',
            text2: '无法获取版本信息，请检查网络',
          });
          throw e;
        }
        // 指数退避
        await new Promise(r => setTimeout(r, 2_000 * attempt));
      }
    }
    // 这句永远走不到，仅为 TypeScript 报错
    throw new Error('Unexpected');
  }

  /** --------------------------------------------------------------
   *  2️⃣ 清理旧的 APK 文件（使用 expo-file-system 的 API）
   * --------------------------------------------------------------- */
  private async cleanOldApkFiles(): Promise<void> {
    try {
      const dirUri = FileSystem.documentDirectory; // e.g. file:///data/user/0/.../files/
      if (!dirUri) {
        throw new Error('Document directory is not available');
      }
      const listing = await FileSystem.readDirectoryAsync(dirUri);
      const apkFiles = listing.filter(name => name.startsWith('OrionTV_v') && name.endsWith('.apk'));

      if (apkFiles.length <= 2) return;

      const sorted = apkFiles.sort((a, b) => {
        const numA = parseInt(a.replace(/[^0-9]/g, ''), 10);
        const numB = parseInt(b.replace(/[^0-9]/g, ''), 10);
        return numB - numA; // 倒序（最新在前）
      });

      const stale = sorted.slice(2); // 保留最新的两个
      for (const file of stale) {
        const path = `${dirUri}${file}`;
        try {
          await FileSystem.deleteAsync(path, { idempotent: true });
          logger.debug(`Deleted old APK: ${file}`);
        } catch (e) {
          logger.warn(`Failed to delete ${file}`, e);
        }
      }
    } catch (e) {
      logger.warn('cleanOldApkFiles error', e);
    }
  }

  /** --------------------------------------------------------------
   *  3️⃣ 下载 APK（使用 expo-file-system 的下载 API）
   * --------------------------------------------------------------- */
  async downloadApk(
    url: string,
    onProgress?: (percent: number) => void,
  ): Promise<string> {
    const maxRetries = 3;
    await this.cleanOldApkFiles();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const timestamp = Date.now();
        const fileName = `OrionTV_v${timestamp}.apk`;
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;

        // expo-file-system 把下载进度回调参数统一为 `{totalBytesWritten, totalBytesExpectedToWrite}`
        const downloadResumable = FileSystem.createDownloadResumable(
          url,
          fileUri,
          {
            // Android 需要在 AndroidManifest 中声明 INTERNET、WRITE_EXTERNAL_STORAGE (API 33+ 使用 MANAGE_EXTERNAL_STORAGE)
            // 这里不使用系统下载管理器，因为我们想自己控制进度回调。
          },
          progress => {
            if (onProgress && progress.totalBytesExpectedToWrite) {
              const percent = Math.floor(
                (progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 100,
              );
              onProgress(percent);
            }
          },
        );

        const result = await downloadResumable.downloadAsync();
        if (result && result.uri) {
          logger.debug(`APK downloaded to ${result.uri}`);
          return result.uri;
        } else {
          throw new Error('Download failed: No URI available');
        }
      } catch (e) {
        logger.warn(`downloadApk attempt ${attempt}/${maxRetries}`, e);
        if (attempt === maxRetries) {
          Toast.show({
            type: 'error',
            text1: '下载失败',
            text2: 'APK 下载出现错误，请检查网络',
          });
          throw e;
        }
        // 指数退避
        await new Promise(r => setTimeout(r, 3_000 * attempt));
      }
    }
    // 同上，理论不会到这里
    throw new Error('Download failed');
  }

  /** --------------------------------------------------------------
   *  4️⃣ 安装 APK（只在 Android 可用，使用 expo-intent-launcher）
   * --------------------------------------------------------------- */
  async installApk(fileUri: string): Promise<void> {
    // ① 先确认文件存在
    const exists = await FileSystem.getInfoAsync(fileUri);
    if (!exists.exists) {
      throw new Error(`APK not found at ${fileUri}`);
    }

    // ② 把 file:// 转成 content://，Expo‑FileSystem 已经实现了 FileProvider
    const contentUri = await FileSystem.getContentUriAsync(fileUri);

    // ③ 只在 Android 里执行
    if (Platform.OS !== 'android') {
      // iOS 设备不支持直接安装 APK
      Toast.show({
        type: 'error',
        text1: '安装失败',
        text2: 'iOS 设备无法直接安装 APK',
      });
      throw new Error('APK install not supported on iOS');
    }

    // 需要授予接收方读取 content:// 的权限，并以新任务方式启动系统安装器。
    const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
    const FLAG_ACTIVITY_NEW_TASK = 0x10000000;
    const flags = FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK;

    // 不同的 Android 电视盒子/固件对“安装 APK”的 Intent 支持不一致：
    // 部分盒子没有响应 ACTION_VIEW(application/vnd.android.package-archive) 的
    // 界面（就会报 ActivityNotFoundException），但系统 PackageInstaller 会响应
    // ACTION_INSTALL_PACKAGE。这里按可靠性依次尝试多种方式，任意一种成功即可。
    const strategies: { action: string; withType: boolean; label: string }[] = [
      { action: 'android.intent.action.INSTALL_PACKAGE', withType: false, label: 'INSTALL_PACKAGE' },
      { action: 'android.intent.action.INSTALL_PACKAGE', withType: true, label: 'INSTALL_PACKAGE+type' },
      { action: 'android.intent.action.VIEW', withType: true, label: 'VIEW' },
    ];

    let lastError: any = null;
    for (const s of strategies) {
      try {
        await IntentLauncher.startActivityAsync(s.action, {
          data: contentUri, // 必须是 content://
          ...(s.withType ? { type: ANDROID_MIME_TYPE } : {}),
          flags,
          extra: { 'android.intent.extra.NOT_UNKNOWN_SOURCE': true },
        });
        logger.debug(`installApk launched via ${s.label}`);
        return; // 成功启动安装界面
      } catch (e: any) {
        lastError = e;
        logger.warn(`installApk strategy ${s.label} failed: ${e?.message}`);
        // 继续尝试下一种方式
      }
    }

    // 所有方式都失败
    const msg: string = lastError?.message || '';
    if (msg.includes('Activity not found') || msg.includes('ActivityNotFound')) {
      Toast.show({
        type: 'error',
        text1: '安装失败',
        text2: '系统未找到可安装 APK 的程序，请确认已允许本应用安装未知来源应用',
      });
    } else if (msg.toLowerCase().includes('permission')) {
      Toast.show({
        type: 'error',
        text1: '安装失败',
        text2: '请在系统设置里允许本应用“安装未知应用/未知来源”',
      });
    } else {
      Toast.show({
        type: 'error',
        text1: '安装失败',
        text2: '未知错误，请稍后重试或手动安装',
      });
    }
    throw lastError || new Error('APK install failed');
  }

  /** --------------------------------------------------------------
   *  5️⃣ 版本比对工具（保持原来的实现）
   * --------------------------------------------------------------- */
  compareVersions(v1: string, v2: string): number {
    const p1 = v1.split('.').map(Number);
    const p2 = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const n1 = p1[i] ?? 0;
      const n2 = p2[i] ?? 0;
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    }
    return 0;
  }
  getCurrentVersion(): string {
    return currentVersion;
  }
  isUpdateAvailable(remoteVersion: string): boolean {
    return this.compareVersions(remoteVersion, currentVersion) > 0;
  }
}

/* 单例导出 */
export default UpdateService.getInstance();
