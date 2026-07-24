export const UPDATE_CONFIG = {
  // 自动检查更新
  AUTO_CHECK: true,

  // 检查更新间隔（毫秒）
  CHECK_INTERVAL: 12 * 60 * 60 * 1000, // 12小时

  // 本 fork 仓库与用于加速访问 GitHub 的代理前缀
  GITHUB_REPO: "vruru/OrionTV",
  PROXY_PREFIX: "https://ghfast.top/",

  // GitHub相关URL —— 指向本 fork (vruru/OrionTV) 的最新 Releases 进行检查与更新
  GITHUB_RAW_URL:
    `https://ghfast.top/https://raw.githubusercontent.com/vruru/OrionTV/refs/heads/master/package.json?t=${Date.now()}`,

  // GitHub Releases API（用于确认某个版本确实发布了对应的 APK 资源）
  getReleasesApiUrl(): string {
    return `https://api.github.com/repos/${this.GITHUB_REPO}/releases?per_page=15`;
  },

  // 给任意 github 链接套上加速代理前缀
  withProxy(url: string): string {
    return `${this.PROXY_PREFIX}${url}`;
  },

  // 获取平台特定的下载URL
  getDownloadUrl(version: string): string {
    return `https://ghfast.top/https://github.com/vruru/OrionTV/releases/download/v${version}/orionTV.${version}.apk`;
  },

  // 是否显示更新日志
  SHOW_RELEASE_NOTES: true,

  // 是否允许跳过版本
  ALLOW_SKIP_VERSION: true,

  // 下载超时时间（毫秒）
  DOWNLOAD_TIMEOUT: 10 * 60 * 1000, // 10分钟

  // 是否在WIFI下自动下载
  AUTO_DOWNLOAD_ON_WIFI: false,

  // 更新通知设置
  NOTIFICATION: {
    ENABLED: true,
    TITLE: "OrionTV 更新",
    DOWNLOADING_TEXT: "正在下载新版本...",
    DOWNLOAD_COMPLETE_TEXT: "下载完成，点击安装",
  },
};
