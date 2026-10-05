# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OrionTV is a TV-first React Native TVOS streaming client built with Expo, with responsive mobile and tablet components. This single-package application connects to external MoonTV/LunaTV-compatible APIs and optionally serves a LAN remote-input page. This repository does not include the content backend or NAS replay recorder. See [README.md](README.md) for current setup, build, and release instructions, and [docs/MOBILE_TABLET_ADAPTATION.md](docs/MOBILE_TABLET_ADAPTATION.md) for the historical adaptation plan and current implementation notes.

## Key Commands

### Development Commands

#### TV Development (Apple TV & Android TV)
- `yarn start` - Start Metro bundler in TV mode (the script sets `EXPO_TV`)
- `yarn android` - Build and run on Android TV
- `yarn ios` - Build and run on Apple TV
- `yarn prebuild` - Clean and regenerate native project files for TV, then copy `xml/*` into Android sources; preserve any manual native edits first
- `yarn build` - Existing Android release entry point; it repeats prebuild and does not run the OTA manifest repair

#### Testing Commands
- `yarn test` - Run Jest tests with watch mode
- `yarn test-ci` - Run Jest tests for CI with coverage
- `yarn test utils` - Run tests for specific directory/file pattern
- `yarn lint` - Run ESLint checks
- `yarn typecheck` - Run TypeScript type checking

#### Build and Deployment
- `yarn copy-config` - Copy `xml/*` into Android sources (the manifest template disables Expo Updates)
- `node scripts/ensure-updates-manifest.js` - Repair Android Updates metadata from `app.json` after prebuild/copy-config
- `./gradlew assembleRelease` (inside generated `android/`) - Build after the repair without repeating prebuild; follow the [APK workflow](.github/workflows/build-apk.yml)
- `yarn build-debug` - Build Android APK for debugging; requires generated Android sources
- `yarn clean` - Clean cache and build artifacts
- `yarn clean-modules` - Reinstall all node modules

The [APK workflow](.github/workflows/build-apk.yml) is manually triggered and publishes a GitHub Release. The [OTA workflow](.github/workflows/eas-update.yml) publishes to the production channel on eligible `master` pushes; Markdown-only changes are ignored. Native/configuration changes require a new client build. EAS TV profiles are defined in [eas.json](eas.json); verify the final Android manifest when using cloud builds, which do not run the APK workflow's repair and validation steps.

## Architecture Overview

### Multi-Platform Responsive Design

The responsive implementation uses the following entry points:
- **Device Detection**: `hooks/useResponsiveLayout.ts` checks `Platform.isTV` first, then window-width breakpoints (mobile <768, tablet 768–1023, TV ≥1024). Its default grids use 3 portrait / 4 landscape columns on mobile and tablet, and 5 on TV. `DeviceUtils.getDeviceType()` checks width only; do not assume the two always agree.
- **Component Variants**: `components/VideoCard.tsx` explicitly imports and selects `.mobile.tsx`, `.tablet.tsx`, and `.tv.tsx` implementations. The TV-extension resolver example in `metro.config.js` is commented out.
- **Responsive Utilities**: `DeviceUtils` and `ResponsiveStyles` provide adaptive layout and scaling helpers.
- **Adaptive Navigation**: The root layout uses Expo Router Stack. Pages using `components/navigation/ResponsiveNavigation.tsx` receive mobile bottom navigation or a tablet sidebar; TV renders the page content directly.
- **Metro Scope**: `metro.config.js` watches the directory two levels above the project and resolves dependencies from that directory and the project. The repository itself contains one application package.

### State Management Architecture (Zustand)

Domain-specific stores with consistent patterns:
- **homeStore.ts** - Home screen content, categories, Douban/Bangumi API data, and play records
- **playerStore.ts** - Video player state, controls, and episode management  
- **settingsStore.ts** - App settings, API configuration, and user preferences
- **remoteControlStore.ts** - Remote control server functionality and HTTP bridge
- **authStore.ts** - User authentication state
- **updateStore.ts** - Automatic update checking and version management
- **favoritesStore.ts** - On-demand video favorites management
- **liveFavoritesStore.ts** - Live-channel favorites persisted locally

### Service Layer Pattern

Clean separation of concerns across service modules:
- **api.ts** - External API integration with error handling and caching
- **storage.ts** - App settings in AsyncStorage; on-demand favorites, play records, and search history use local storage or API according to the backend's `StorageType`
- **remoteControlService.ts** - LAN remote-input page with WebSocket transport and HTTP POST fallback
- **updateService.ts** - Automatic version checking and APK download management
- **tcpHttpServer.ts** / **webSocketProtocol.ts** - TCP HTTP server on port 12346 and WebSocket protocol handling
- **m3u.ts** / **epg.ts** - Live playlist parsing and XMLTV programme data
- **replay.ts** - External NAS replay client, recording coverage and HLS manifest validation
- **thumbnailGen.ts** / **speedTest.ts** - Playback previews and source throughput measurements

### TV Remote Control System

Sophisticated TV interaction handling:
- **useTVRemoteHandler** - Centralized hook for TV remote event processing
- **Hardware Events** - HWEvent handling for TV-specific controls (play/pause, seek, menu)
- **Focus Management** - TV-specific focus states and navigation flows
- **Gesture Support** - Long press, directional seeking, auto-hide controls

## Key Technologies

- **React Native TVOS (0.74.x)** - TV-optimized React Native with TV-specific event handling
- **Expo SDK 51** - Development platform providing native capabilities and build tooling
- **TypeScript** - Complete type safety with `@/*` path mapping configuration
- **Zustand** - Lightweight state management for global application state
- **Expo Router** - File-based routing system with typed routes
- **Expo AV** - Video playback with TV-optimized controls

## Development Workflow

### TV-First Development Pattern

This project uses a TV-first approach with responsive adaptations:
- **Primary Target**: Apple TV and Android TV with remote control interaction
- **Secondary Targets**: Mobile and tablet with touch-optimized responsive design
- **Build Environment**: Existing start/run/prebuild scripts and TV EAS profiles set `EXPO_TV`; no separate mobile/tablet scripts are currently defined
- **Component Strategy**: Shared components with explicitly imported device-specific variants

### Testing Strategy

- **Unit Tests**: Existing tests under `components/__tests__/`, `services/__tests__/`, `stores/__tests__/`, and `utils/__tests__/`; the adaptation document's coverage and device targets are planning goals
- **Jest Configuration**: Expo preset with Babel transpilation
- **Test Patterns**: Mock-based testing for React Native modules and external dependencies
- **Coverage Reporting**: CI-compatible coverage reports with detailed metrics

### Important Development Notes

- Run `yarn prebuild` after native dependency/configuration changes; it cleans generated native directories and already runs `yarn copy-config`
- For Android releases with OTA, repair the manifest after prebuild/copy-config, then run Gradle directly; repeating those copy steps requires another repair
- TV components require focus management and remote control support
- Test on both TV devices (Apple TV/Android TV) and responsive mobile/tablet layouts
- Backend content API calls are centralized in `services/api.ts`; EPG, replay and update services handle their own external endpoints
- Storage managers in `services/storage.ts` select AsyncStorage or backend API as described above; live favorites use local AsyncStorage
- Configure the API base URL in the app's settings, not through `.env`; required build/CI variable names are documented in README
- Remote input runs only on non-mobile layouts when enabled; `SettingsManager` defaults it to enabled when no saved configuration exists

### Component Development Patterns

- **Device Variants**: Follow `components/VideoCard.tsx` and explicitly select `.tv.tsx`, `.mobile.tsx`, `.tablet.tsx` implementations
- **Responsive Utilities**: Follow `useResponsiveLayout` for reactive layout and TV detection; account for the width-only behavior of `DeviceUtils.getDeviceType()`
- **TV Remote Handling**: Use `useTVRemoteHandler` hook for TV-specific interactions
- **Focus Management**: TV components must handle focus states for remote navigation
- **Shared Logic**: Place common logic in `/hooks` directory for reusability

## Common Development Tasks

### Adding New Components
1. Create base component in `/components` directory
2. Add platform-specific variants (`.tv.tsx`) if needed
3. Import and use responsive utilities from `@/utils/DeviceUtils`
4. Test across device types for proper responsive behavior

### Working with State
1. Identify appropriate Zustand store in `/stores` directory
2. Follow existing patterns for actions and state structure
3. Use TypeScript interfaces for type safety
4. Consider cross-store dependencies and data flow

### API Integration
1. Add new endpoints to `/services/api.ts`
2. Implement proper error handling and loading states
3. Use caching strategies for frequently accessed data
4. Update relevant Zustand stores with API responses

## File Structure Notes

- `/app` - Expo Router screens and navigation
- `/components` - Reusable UI components (including `.tv.tsx` variants)
- `/stores` - Zustand state management stores
- `/services` - API, storage, remote control, and update services
- `/hooks` - Custom React hooks including `useTVRemoteHandler`
- `/constants` - App constants, theme definitions, and update configuration
- `/assets` - Static assets including TV-specific icons and banners

# important-instruction-reminders

Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (\*.md) or README files. Only create documentation files if explicitly requested by the User.
Keep plans and todos in their existing location when moving from planning to implementation. Create a separate plan document only when the user requests one; a mode switch alone does not require a new document.
