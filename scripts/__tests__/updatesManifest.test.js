/** @jest-environment node */
/* eslint-env node, jest */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const script = path.resolve(__dirname, "../ensure-updates-manifest.js");

describe("local build Updates repair", () => {
  let root;
  let manifest;
  let strings;
  const stale = '<manifest><application><meta-data android:name="expo.modules.updates.ENABLED" android:value="false"/></application></manifest>';
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "orion updates "));
    manifest = path.join(root, "android/app/src/main/AndroidManifest.xml");
    strings = path.join(root, "android/app/src/main/res/values/strings.xml");
    fs.mkdirSync(path.dirname(strings), { recursive: true });
    fs.writeFileSync(manifest, stale);
    fs.writeFileSync(strings, '<resources><string name="expo_runtime_version">old</string></resources>');
    fs.writeFileSync(path.join(root, "app.json"), JSON.stringify({ expo: {
      version: "9.9.9", updates: { enabled: true, url: "https://example.invalid/updates", requestHeaders: { "expo-channel-name": "preview" } }
    } }));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const repair = () => execFileSync(process.execPath, [script, root], { stdio: "pipe" });
  function verify() {
    const xml = fs.readFileSync(manifest, "utf8");
    for (const key of ["ENABLED", "EXPO_UPDATE_URL", "EXPO_RUNTIME_VERSION", "UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY"]) {
      expect(xml.split(`android:name="expo.modules.updates.${key}"`).length - 1).toBe(1);
    }
    expect(xml).toContain('android:value="true"');
    expect(xml).toContain("https://example.invalid/updates");
    expect(xml).toContain("preview");
    expect(xml).not.toContain('android:value="false"');
    expect(fs.readFileSync(strings, "utf8")).toContain(">9.9.9</string>");
  }
  it("repairs disabled metadata and survives repeated prebuild/copy", () => {
    repair(); verify(); repair(); verify();
    fs.writeFileSync(manifest, stale);
    fs.writeFileSync(strings, "<resources></resources>");
    repair(); verify();
  });
  it("places repair between prebuild and Gradle and repairs Debug too", () => {
    const { scripts } = require("../../package.json");
    expect(scripts.build).toMatch(/yarn prebuild && node scripts\/ensure-updates-manifest.js && cd android && .\/gradlew assembleRelease/);
    expect(scripts["build-debug"]).toMatch(/^node scripts\/ensure-updates-manifest.js && cd android/);
  });
});
