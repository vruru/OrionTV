/** @jest-environment node */
/* eslint-env node, jest */
const path = require("path");
jest.mock("expo/metro-config", () => ({ getDefaultConfig: () => ({ resolver: {}, watchFolders: [] }) }));
it("resolves standalone dependencies without watching ancestor directories", () => {
  const config = require("../../metro.config");
  expect(config.resolver.disableHierarchicalLookup).toBe(true);
  expect(config.resolver.nodeModulesPaths).toEqual([path.resolve(__dirname, "../../node_modules")]);
  expect(config.watchFolders).toEqual([]);
});
