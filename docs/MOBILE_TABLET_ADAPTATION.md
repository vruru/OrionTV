# OrionTV 手机端和平板端适配方案

## 阅读说明与当前实现

本文保留最初的适配规划。下方的阶段、时间表、手势、画中画、测试设备范围和成功指标均为设计目标，不代表当前版本已完成验收。安装、运行和发布请以 [README](../README.md) 与 [package.json](../package.json) 为准。

当前已有响应式布局、卡片变体和导航：

- `hooks/useResponsiveLayout.ts` 优先识别 `Platform.isTV`，再按窗口宽度划分手机（<768）、平板（768–1023）和 TV（≥1024）。手机／平板默认竖屏 3 列、横屏 4 列，TV 为 5 列；`DeviceUtils.getDeviceType()` 仅按宽度判断。
- `components/VideoCard.tsx` 显式导入三个卡片变体并选择渲染。`metro.config.js` 中 TV 后缀自动解析的示例尚未启用。
- 根布局仍使用 Stack；页面中的 `ResponsiveNavigation` 为手机提供底部导航、为平板提供侧栏，TV 直接渲染页面内容。
- 当前开发脚本默认启用 TV 模式，没有单独的手机／平板脚本。阶段 6 的构建建议不是现行命令。

## 项目概述

OrionTV 是一个基于 React Native TVOS 的视频流媒体客户端，以 Android TV 和 Apple TV 为主要构建目标。本文记录手机和平板适配的设计方案，现有实现摘要见上方说明。

## 初始 TV 基线（规划背景）

### TV端特征
- **技术栈**: React Native TVOS 0.74.x + Expo 51
- **导航**: Stack 导航结构，适合遥控器操作
- **布局**: 固定5列网格布局 (`NUM_COLUMNS = 5`)
- **交互**: TV遥控器专用事件处理 (`useTVRemoteHandler`)
- **组件**: TV专用组件 (`VideoCard.tv.tsx`)
- **UI元素**: 大间距、大按钮，适合10英尺距离观看

### 页面入口与初始布局

以下均为 `app/` 下的页面；列数和交互描述为规划时的 TV 基线，现有响应式布局见开头说明。

1. **index.tsx** - 首页：分类选择 + 5列视频网格
2. **detail.tsx** - 详情页：横向布局，海报+信息+播放源
3. **search.tsx** - 搜索页：搜索框 + 5列结果网格
4. **play.tsx** - 播放页：全屏视频播放器 + TV遥控器控制
5. **settings.tsx** - 设置页：TV遥控器导航 + 远程输入配置
6. **favorites.tsx** - 收藏页：网格布局展示收藏内容
7. **live.tsx** - 直播页：直播流播放
8. **_layout.tsx** - 根布局：Stack导航 + 全局状态管理

## 适配目标

### 设备分类
- **手机端** (< 768px): 单手操作，纵向为主，触摸交互
- **平板端** (768px - 1023px): 双手操作，横竖屏，触摸+键盘
- **TV端** (≥ 1024px，或 `Platform.isTV`): 遥控器操作，横屏，10英尺距离

### 响应式设计原则
1. **内容优先**: 保持核心功能一致性
2. **渐进增强**: 根据屏幕尺寸增加功能
3. **平台原生感**: 符合各平台交互习惯
4. **性能优化**: 避免不必要的重新渲染

## 技术实施方案

### 阶段1: 响应式基础架构

#### 1.1 创建响应式 Hook
```typescript
// hooks/useResponsiveLayout.ts
export interface ResponsiveConfig {
  deviceType: 'mobile' | 'tablet' | 'tv';
  columns: number;
  cardWidth: number;
  cardHeight: number;
  spacing: number;
  isPortrait: boolean;
}
```

#### 1.2 设备检测逻辑（当前实现）
- 基于 `Dimensions.get('window')` 获取屏幕尺寸
- 监听 `Dimensions` 的 `change` 事件并根据宽高判断横竖屏
- `useResponsiveLayout` 优先检测 `Platform.isTV`，再使用宽度断点；`DeviceUtils.getDeviceType()` 只使用宽度断点

#### 1.3 断点定义
```typescript
const BREAKPOINTS = {
  mobile: { min: 0, max: 767 },
  tablet: { min: 768, max: 1023 },
  tv: { min: 1024, max: Infinity }
};
```

### 阶段2: 多平台组件系统

#### 2.1 VideoCard 组件族
- **VideoCard.mobile.tsx**: 纵向卡片，大触摸目标
- **VideoCard.tablet.tsx**: 中等卡片，平衡布局  
- **VideoCard.tv.tsx**: 保持现有实现

#### 2.2 组件选择器

实际入口为 `components/VideoCard.tsx`；以下为选择逻辑示意，完整 props、ref 和导入见源码。

```typescript
// components/VideoCard.tsx
export const VideoCard = (props) => {
  const { deviceType } = useResponsiveLayout();
  
  switch(deviceType) {
    case 'mobile': return <VideoCardMobile {...props} />;
    case 'tablet': return <VideoCardTablet {...props} />;
    case 'tv': return <VideoCardTV {...props} />;
  }
};
```

### 阶段3: 导航系统重构

#### 3.1 手机端导航
- **底部Tab导航**: 首页、搜索、收藏、设置
- **Header导航**: 返回按钮、标题、操作按钮
- **抽屉导航**: 次要功能入口

#### 3.2 平板端导航  
- **侧边栏导航**: 持久化主导航
- **Master-Detail**: 列表+详情分屏
- **Tab Bar**: 内容区域二级导航

#### 3.3 TV端导航
- **保持现有**: Stack导航结构
- **遥控器优化**: Focus管理和按键导航

### 阶段4: 页面逐一适配

#### 4.1 首页 (index.tsx)
**手机端改进:**
- 1-2列网格布局
- 分类用横向滚动标签
- 下拉刷新
- 上拉加载更多

**平板端改进:**
- 2-3列网格布局  
- 左侧分类侧边栏
- 内容区域可滚动
- 支持横竖屏切换

**TV端保持:**
- 5列网格布局
- 遥控器导航
- 现有交互逻辑

#### 4.2 详情页 (detail.tsx)
**手机端改进:**
- 纵向布局：海报→信息→播放源→剧集
- 海报占屏幕宽度40%
- 播放源横向滚动
- 剧集网格4-5列

**平板端改进:**
- 左右分栏：海报+信息 | 播放源+剧集
- 海报固定尺寸  
- 播放源卡片式布局
- 剧集6-8列网格

#### 4.3 搜索页 (search.tsx)
**手机端改进:**
- 优化键盘输入体验
- 搜索历史和推荐
- 2列结果网格
- 筛选和排序功能

**平板端改进:**
- 更大的搜索框
- 3列结果网格
- 侧边栏筛选选项
- 搜索建议下拉

#### 4.4 播放页 (play.tsx)
**手机端改进:**
- 触摸控制替代遥控器
- 手势操作：双击暂停、滑动调节
- 竖屏小窗播放模式
- 亮度和音量调节

**平板端改进:**
- 触摸+手势控制
- 画中画模式支持
- 外接键盘快捷键
- 更大的控制按钮

#### 4.5 设置页 (settings.tsx)
**手机端改进:**
- 分组设置列表
- 原生选择器和开关
- 键盘友好的输入框
- 滚动优化

**平板端改进:**
- 左侧设置分类，右侧设置详情
- 更大的输入区域
- 实时预览效果
- 批量操作支持

### 阶段5: 组件库升级

#### 5.1 触摸优化组件
- **TouchableButton**: 44px最小触摸目标
- **SwipeableCard**: 支持滑动操作
- **PullToRefresh**: 下拉刷新组件
- **InfiniteScroll**: 无限滚动加载

#### 5.2 手势处理
- **PinchToZoom**: 双指缩放
- **SwipeNavigation**: 滑动导航
- **LongPressMenu**: 长按菜单
- **DoubleTapHandler**: 双击处理

#### 5.3 响应式工具
- **ResponsiveText**: 自适应字体大小
- **ResponsiveSpacing**: 自适应间距
- **ConditionalRender**: 条件渲染组件
- **OrientationHandler**: 方向变化处理

### 阶段6: 构建和部署

#### 6.1 构建脚本现状与后续建议

当前 `package.json` 的 `start`、`android`、`ios` 和 `prebuild` 脚本默认启用 TV 模式，构建参数由 `EXPO_TV` 和 `EXPO_USE_METRO_WORKSPACE_ROOT` 控制。这里原先提议的 `android-mobile`、`android-tablet`、`android-tv` 脚本未加入仓库；如后续需要独立移动端构建，须另行实现并验证。

现行安装与运行命令、Android OTA 清单修复顺序及发布入口见 [README](../README.md)。

#### 6.2 配置文件适配
- **app.json**: 多平台配置
- **metro.config.js**: 当前监视与模块解析配置；TV 后缀自动解析示例仍为注释
- **package.json**: 平台特定依赖

#### 6.3 资源文件
- 手机端应用图标 (48dp-192dp)
- 平板端应用图标 (优化尺寸)
- 启动屏适配不同分辨率
- 自适应图标 (Adaptive Icons)

## 测试计划（规划范围，非已验证兼容性）

### 测试设备覆盖
- **手机**: Android 5.0-14, 屏幕 4"-7"
- **平板**: Android 平板 7"-12", 横竖屏
- **TV**: 保持现有测试覆盖

### 测试要点
1. **响应式布局**: 不同屏幕尺寸正确显示
2. **交互体验**: 触摸、手势、导航流畅
3. **性能表现**: 启动速度、滚动性能、内存使用
4. **兼容性**: 不同Android版本和设备

### 自动化测试
- Jest单元测试覆盖新组件
- E2E测试核心用户流程
- 视觉回归测试UI一致性
- 性能基准测试

## 风险评估

### 技术风险
- **复杂度增加**: 多平台适配增加维护成本
- **性能影响**: 条件渲染可能影响性能
- **测试覆盖**: 需要覆盖更多设备组合

### 缓解策略
- 渐进式迁移，优先核心功能
- 性能监控和优化
- 自动化测试保证质量
- 代码复用最大化

## 原始实施时间表（历史规划，非当前进度）

### 第1周: 基础架构
- [ ] 响应式Hook开发
- [ ] 多平台组件框架
- [ ] 基础样式系统

### 第2周: 核心页面适配
- [ ] 首页手机/平板适配
- [ ] 详情页手机/平板适配
- [ ] 搜索页手机/平板适配

### 第3周: 功能完善
- [ ] 播放页适配
- [ ] 设置页适配
- [ ] 导航系统重构

### 第4周: 优化和测试
- [ ] 组件库升级
- [ ] 性能优化
- [ ] 全面测试

## 成功指标

### 用户体验指标
- 应用启动时间 < 3秒
- 页面切换流畅度 > 95%
- 触摸响应延迟 < 100ms
- 用户满意度 > 4.5/5

### 技术指标
- 代码复用率 > 80%
- 自动化测试覆盖率 > 90%
- 应用包大小增长 < 20%
- 内存使用优化 > 15%

---

## 附录

### 相关文档

- [项目运行与发布说明](../README.md)
- [英文开发约定与架构说明](../CLAUDE.md)
- [响应式布局实现](../hooks/useResponsiveLayout.ts)
- [导航容器实现](../components/navigation/ResponsiveNavigation.tsx)
- [卡片选择器实现](../components/VideoCard.tsx)

---
*原始规划: 2025-08-01*
*现状与引用核对: 2026-10-05*
