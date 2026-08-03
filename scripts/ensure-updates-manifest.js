#!/usr/bin/env node
/**
 * 确保 AndroidManifest.xml 包含完整的 expo-updates 元数据。
 *
 * 背景：GitHub Actions(ubuntu) 上 expo prebuild 产出的清单曾丢失
 * EXPO_UPDATE_URL / EXPO_RUNTIME_VERSION / REQUEST_HEADERS 三项
 * （本地 macOS 无法复现），导致Release包 OTA 永远不可用。
 * 该脚本在 prebuild 之后、gradle 构建之前运行：缺什么补什么，幂等。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST = path.join(ROOT, "android/app/src/main/AndroidManifest.xml");
const STRINGS = path.join(ROOT, "android/app/src/main/res/values/strings.xml");

// app.json 含 // 注释（Expo 用 JSON5 解析），这里用项目自带的 json5
const JSON5 = require("json5");
const appJson = JSON5.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8"));
const expo = appJson.expo || {};
const updates = expo.updates || {};
const version = expo.version;

if (!updates.enabled || !updates.url) {
  console.error("[ensure-updates] app.json 缺少 updates.enabled/updates.url，跳过");
  process.exit(1);
}
if (!version) {
  console.error("[ensure-updates] app.json 缺少 version");
  process.exit(1);
}

const CHECK_ON_LAUNCH = { ON_LOAD: "ALWAYS", ON_ERROR_RECOVERY: "ON_ERROR_RECOVERY", NEVER: "NEVER" }[
  updates.checkAutomatically || "ON_LOAD"
];
const LAUNCH_WAIT_MS = String(updates.fallbackToCacheTimeout ?? 0);
const REQUEST_HEADERS = updates.requestHeaders ? JSON.stringify(updates.requestHeaders) : null;

const xmlEscape = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const META = [
  ["expo.modules.updates.ENABLED", "true"],
  ["expo.modules.updates.EXPO_UPDATE_URL", updates.url],
  ["expo.modules.updates.EXPO_RUNTIME_VERSION", "@string/expo_runtime_version"],
  ["expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH", CHECK_ON_LAUNCH],
  ["expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS", LAUNCH_WAIT_MS],
  ...(REQUEST_HEADERS
    ? [["expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY", REQUEST_HEADERS]]
    : []),
];

let manifest = fs.readFileSync(MANIFEST, "utf8");
let changed = 0;

for (const [name, value] of META) {
  // 先删掉该键的全部旧条目（可能多个/值过期），再在 </application> 前插入唯一正确值。
  // 注意：值里可能含 /（URL、@string/...），必须用 [^>] 而不是 [^/] 匹配
  const re = new RegExp(
    `<meta-data\\s+android:name="${name.replace(/[.]/g, "\\.")}"[^>]*?/>\\s*`,
    "g"
  );
  const had = re.test(manifest);
  manifest = manifest.replace(re, "");
  const entry = `<meta-data android:name="${name}" android:value="${xmlEscape(value)}"/>`;
  manifest = manifest.replace(/(\s*)<\/application>/, `\n    ${entry}$1</application>`);
  if (!had) {
    changed++;
    console.log(`[ensure-updates] 注入缺失项: ${name}`);
  }
}

fs.writeFileSync(MANIFEST, manifest);

// strings.xml 确保 expo_runtime_version
let strings = fs.readFileSync(STRINGS, "utf8");
const strRe = /<string name="expo_runtime_version">[^<]*<\/string>/;
if (strRe.test(strings)) {
  strings = strings.replace(strRe, `<string name="expo_runtime_version">${version}</string>`);
} else {
  strings = strings.replace(/(\s*)<\/resources>/, `\n  <string name="expo_runtime_version">${version}</string>$1</resources>`);
  changed++;
  console.log("[ensure-updates] 注入 strings.xml: expo_runtime_version");
}
fs.writeFileSync(STRINGS, strings);

console.log(`[ensure-updates] 完成，${changed} 处修正（0 = 清单一开始就完整）`);
