# OrionTV 📺

OrionTV 是一个以电视体验为主的视频点播和直播客户端，使用 React Native TVOS、Expo 和 TypeScript 构建。它连接外部 MoonTV／LunaTV 兼容后端获取内容、搜索结果与播放地址；本仓库包含客户端，不包含内容 API 服务或 NAS 录制服务。

项目提供 Android TV 和 Apple TV 的构建配置，并已有手机、平板的响应式组件和导航。当前 `package.json` 的开发与原生生成脚本默认启用 TV 模式，Android TV 的 APK 发布流程见下文。手机／平板适配的规划与当前实现边界见 [适配方案](docs/MOBILE_TABLET_ADAPTATION.md)。

## 功能

- 点播：首页分类、豆瓣数据与每日放送、搜索、视频详情、多源与剧集切换、倍速、画面比例、跳过片头片尾、继续观看、收藏及播放记录。
- 直播：优先读取后端管理的直播源，未取得可用频道时回退到设置中的 M3U 地址；支持分组、频道收藏、中文／拼音搜索和 XMLTV 节目单。
- 回看：接入外部 NAS 回看服务，根据 EPG 和录制覆盖选择节目，支持进度跳转和倍速。客户端会校验 HLS 媒体清单及分片时长，服务端需提供兼容的短分片。
- 交互：TV 遥控器焦点与按键处理，手机底部导航、平板侧栏，以及从同一局域网浏览器发送远程输入。
- 更新：Android APK 版本检查与下载安装，以及 Expo Updates 的 OTA 更新。两者使用不同的发布流程。

## 架构与目录

这是一个单包 Expo 应用，入口为 `expo-router/entry`。主要依赖为 Expo SDK 51、React 18、React Native TVOS 0.74.x、Expo Router 3.5、Expo AV 14、Zustand 5 和 AsyncStorage；具体版本以 [package.json](package.json) 与 `yarn.lock` 为准。

页面通过 Zustand stores 管理业务状态，调用 `services/` 中的 API、播放辅助和存储服务。`settingsStore` 加载设置、配置 API 基址并读取 `/api/server-config`；点播收藏、播放记录和搜索历史根据后端返回的 `StorageType` 使用本地 AsyncStorage 或后端 API，直播频道收藏始终保存在本地。根布局负责字体、设置、登录检查、远程输入服务和 Android APK 更新检查。

`useResponsiveLayout` 优先识别 `Platform.isTV`，再按窗口宽度选择手机、平板或 TV 布局；手机／平板默认竖屏 3 列、横屏 4 列，TV 默认 5 列。`VideoCard.tsx` 显式选择三个组件变体，`ResponsiveNavigation` 在使用它的页面提供底部导航或侧栏，根路由仍为 Stack。`DeviceUtils.getDeviceType()` 仅按宽度判断，与该 hook 的 TV 判断存在差异。

```text
app/          Expo Router 页面：主页、搜索、详情、点播、直播、收藏、设置
components/   播放器、卡片、响应式导航、设置区块和弹窗
stores/       Zustand 业务状态
services/     后端 API、存储、M3U/HLS、EPG、回看、测速与更新
hooks/        响应式布局、遥控器事件和播放器事件
utils/        布局工具、拼音搜索、日志及崩溃记录
constants/    主题、文本样式与 APK 更新配置
assets/       字体、图片和 TV 图标
xml/          prebuild 后复制的 Android 清单
scripts/      Android OTA 清单修复脚本
docs/         手机／平板适配方案
.github/      PR 检查、APK 发布和 EAS OTA 工作流
```

`metro.config.js` 监视仓库上两级目录，并从项目与上两级目录的 `node_modules` 解析依赖；这不代表仓库本身含有多个 workspace 包。TV 文件后缀自动解析的示例目前处于注释状态，卡片变体通过显式导入选择。

## 环境准备

- Node.js：现有 APK 工作流使用 Node 18，PR 检查和 OTA 工作流使用 Node 20；按对应工作流准备环境。
- Yarn Classic：`packageManager` 锁定 Yarn 1.22.22，使用仓库中的 `yarn.lock`。
- Android：Android SDK、模拟器或已连接设备、JDK 17；安装 APK 可使用 SDK 的 `adb`，清单检查使用 `aapt`。
- Apple TV：macOS、Xcode 与 tvOS 模拟器／设备，以及原生 iOS 工程所需的 CocoaPods 工具链。
- Expo CLI 随项目依赖安装，通过 Yarn 脚本调用即可。仅使用 EAS 云构建／OTA 时需要另行准备 EAS CLI 和有项目权限的 Expo 账号。

项目使用 TCP socket、Cookie 等原生模块，完整运行需要原生构建，不能仅依赖 Expo Go。Web 相关文件和依赖存在，但根布局在 Web 上不注册点播页，本文不将其作为完整播放器的部署入口。

## 安装与开发运行

在项目根目录安装锁定依赖：

```sh
yarn install --frozen-lockfile
```

首次运行或原生依赖／配置变化后生成原生工程：

```sh
yarn prebuild
```

该脚本执行清理式 prebuild，会重建 `android/`、`ios/`，再运行 `yarn copy-config` 复制 `xml/*`。这两个原生目录已被 Git 忽略；生成前保存需要保留的原生手工修改。

在已启动的 Android TV 模拟器或已连接的设备上构建并运行：

```sh
yarn android
```

Apple TV 构建与运行入口：

```sh
yarn ios
```

需要单独启动 Metro 时运行 `yarn start`。这三个脚本均启用 TV 模式；仓库没有独立的 `start-tv`、`android-tv`、`ios-tv`、`prebuild-tv` 或手机／平板启动脚本。

## 首次使用与外部服务

1. 进入应用的“设置”，填写兼容后端的服务器基址并保存。客户端会在此地址后附加 `/api/...`，因此填写服务器基址而非单个 API 端点。主要接口见 [services/api.ts](services/api.ts)，包括 `/api/server-config`、登录、搜索、详情、豆瓣和直播接口。
2. 按后端要求完成登录。API 地址、直播源地址和播放偏好由应用设置保存，账号在登录弹窗填写，不需要为这些设置创建 `.env`。
3. 如需直播，优先在兼容后端配置直播源；也可在客户端填写 M3U 地址作为回退。填写 XMLTV EPG 地址后可显示节目单。
4. 如需回看，另行提供 NAS／`replay-recorder` 兼容服务并填写回看服务地址。客户端使用 `/channels`、`/coverage` 和 `/replay.m3u8`，接口与时间格式见 [services/replay.ts](services/replay.ts)。回看还需要可匹配的 EPG、录制频道和实际录制覆盖；本仓库不部署录制服务。
5. TV／平板可在设置中控制“远程输入”。无已存设置时，`SettingsManager` 的默认配置会启用它。手机浏览器访问设置页显示的地址或扫码连接，输入发送给当前目标页面。应用内 TCP HTTP 服务监听端口 `12346`，优先使用 WebSocket，失败时回退到 HTTP POST；手机布局不启动此服务。

## Android APK 构建与安装

发布包建议遵循 [APK 工作流](.github/workflows/build-apk.yml) 的顺序，在项目根目录执行：

```sh
yarn prebuild
node scripts/ensure-updates-manifest.js
cd android
./gradlew assembleRelease
cd ..
```

`xml/AndroidManifest.xml` 中的模板禁用了 Expo Updates，而 `prebuild` 会复制它。因此，保留 OTA 能力的 Android 包必须在复制配置后执行 `ensure-updates-manifest.js`，从 `app.json` 补全启用状态、更新 URL、运行时版本及 channel 请求头。修复后直接运行 Gradle；如果再次运行 `yarn prebuild`、`yarn copy-config` 或包含 prebuild 的 `yarn build`，需要重新修复清单。

Release APK 位于 `android/app/build/outputs/apk/release/app-release.apk`。可在连接设备后安装：

```sh
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

发布前使用 Android SDK 的 `aapt dump xmltree` 检查该 APK 的 `AndroidManifest.xml`，确认 Updates 已启用且包含更新 URL、运行时版本和请求头元数据。CI 对这三类元数据缺失会直接报错。

调试包入口为 `yarn build-debug`，要求已生成 `android/`，产物位于 `android/app/build/outputs/apk/debug/app-debug.apk`。`yarn build` 是现有的一步 Release 构建脚本，但未调用 OTA 清单修复；需要 OTA 的发布包使用上面的分步流程。

## 发布与更新

### GitHub APK 发布

[Build Android APK](.github/workflows/build-apk.yml) 通过 GitHub Actions 的 `workflow_dispatch` 手动触发。它安装依赖、生成 TV 工程、修复 OTA 清单、构建并检查 APK，然后创建标签 `v<version>` 对应的 Release，上传 `orionTV.<version>.apk`。版本取自 `package.json`；发布前保持它与 `app.json` 的版本一致。

应用的 APK 更新源由 [constants/UpdateConfig.ts](constants/UpdateConfig.ts) 指向 [vruru/OrionTV Releases](https://github.com/vruru/OrionTV/releases)，更新服务优先选择实际带有 APK 的 Release。修改客户端代码或推送到 `master` 本身不会触发 APK 构建。

### EAS 构建与 OTA

[eas.json](eas.json) 提供 `development_tv`、`preview_tv` 和 `production_tv` 等 TV profile，分别继承对应的基础 profile。准备 EAS CLI、登录并确认拥有 `app.json` 中配置的 Expo 项目权限后，可使用这些入口：

```sh
eas build --platform android --profile production_tv
eas build --platform ios --profile production_tv
```

`preview_tv` 对应内部预览构建，`development_tv` 的 Android 构建使用 Debug、iOS 构建面向模拟器。这些是配置中的云构建入口；仓库的 GitHub APK 工作流使用直接 Gradle 构建，EAS 构建不包含该工作流的清单修复与 APK 验证步骤。使用 Android 云构建时同样核验最终清单。

`app.json` 已配置 Expo Updates 的项目与 URL，运行时策略为 `appVersion`，启动时检查更新，当前请求头指向 `production` channel。[EAS Update 工作流](.github/workflows/eas-update.yml) 在 `master` 推送包含未被忽略的文件时自动发布到该 channel，也支持手动触发。手动 CLI 入口为：

```sh
eas update --channel production --message "<更新说明>" --non-interactive
```

OTA 只能更新兼容运行时的 JavaScript 和资源。原生依赖或构建配置变化需要重新构建客户端。工作流的 `paths-ignore` 包含依赖、原生／构建配置、`.github/**` 与 `**/*.md`：仅修改这些被忽略文件时不自动发布，混合提交若还包含未被忽略文件仍可能触发 OTA。纯文档提交不触发自动 OTA。

`preview` profile 声明的 channel 与 `app.json` 中固定的 `production` 请求头不同；预览包的更新隔离需要检查实际构建结果，不能仅根据 profile 名称判断。

## 环境变量名称

仓库没有应用配置用的 `.env` 模板，客户端 API 地址通过设置页配置。下表只列变量名称、用途与配置来源，不包含值。

| 名称 | 使用场景与配置来源 |
| --- | --- |
| `EXPO_TV` | TV 构建开关，由现有开发／prebuild 脚本和 TV EAS profile 设置。 |
| `EXPO_USE_METRO_WORKSPACE_ROOT` | 现有开发与 prebuild 脚本设置的 Metro 工作区选项。 |
| `NODE_ENV` | `yarn build` 设置的构建环境，Babel 据此移除生产环境的 console 调用。 |
| `ANDROID_HOME` | Android SDK 路径；APK 工作流用它定位 `aapt`，本地按工具链配置。 |
| `JAVA_HOME` | 本地 JDK 工具链路径；CI 通过 setup-java 准备 JDK。 |
| `EXPO_TOKEN` | 自动 OTA 发布必需的 GitHub Actions Secret，用于 Expo／EAS 认证；本地交互登录可用 Expo 账号。 |
| `GITHUB_TOKEN` | APK 工作流发布 Release 的令牌，由 GitHub Actions 提供；工作流声明 `contents: write`。 |
| `SENTRY_DISABLE_AUTO_UPLOAD` | APK 工作流设置，用于禁用构建期 sourcemap 自动上传。 |
| `COMMIT_MSG` | OTA 工作流内部设置的发布说明，传给 EAS CLI。 |
| `CI` | PR 工作流测试命令设置的 CI 标识，无需作为应用运行配置。 |

运行时 Sentry 当前关闭。[utils/monitoring.ts](utils/monitoring.ts) 中的 `SENTRY_DSN` 是代码常量，未从环境变量读取；`app.json` 的 Sentry 插件也禁用了自动上传。现有配置不要求提供 Sentry 认证变量。

## 开发检查与文档

```sh
yarn typecheck
yarn lint
yarn test-ci
```

`yarn test` 为 Jest 监听模式，`yarn test-ci` 为一次性 CI 模式并生成覆盖率。[PR 工作流](.github/workflows/pr-check.yml) 对面向 `master` 的 PR 执行 TypeScript、ESLint 和 Jest 检查。测试位于 `components/`、`services/`、`stores/` 和 `utils/` 下的 `__tests__/`。

- [CLAUDE.md](CLAUDE.md)：英文开发约定与架构说明。
- [手机／平板适配方案](docs/MOBILE_TABLET_ADAPTATION.md)：历史规划及当前实现说明；手势、画中画、时间表和指标不代表已完成验收。

## License

原 README 标注采用 MIT 许可证；当前仓库未包含独立的 LICENSE 文件，完整授权文本尚未随仓库提供。

## 免责声明

OrionTV 仅作为视频搜索工具，不存储、上传或分发任何视频内容。所有视频均来自第三方 API 接口提供的搜索结果。如有侵权内容，请联系相应的内容提供方。

本项目开发者不对使用本项目产生的任何后果负责。使用本项目时，您必须遵守当地的法律法规。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=vruru/OrionTV&type=Date)](https://www.star-history.com/#vruru/OrionTV&Date)

## 致谢

本项目受到以下开源项目的启发：

- [MoonTV](https://github.com/senshinya/MoonTV)：一个基于 Next.js 的视频聚合应用。
- [LibreTV](https://github.com/LibreSpark/LibreTV)：一个开源的视频流媒体应用。

感谢以下项目提供 API Key 的赞助：

- [gpt-load](https://github.com/tbphp/gpt-load)：一个高性能的 OpenAI 格式 API 多密钥轮询代理服务器，支持负载均衡，使用 Go 语言开发。
