const mockNative = { discover: jest.fn(), send: jest.fn() };
jest.mock("expo", () => ({ requireOptionalNativeModule: () => mockNative }));

import { discoverBrother, sendBrother } from "@mobile/modules/brother-printer";
import { Platform } from "react-native";

const originalPlatform = Platform.OS;
beforeAll(() => { Object.defineProperty(Platform, "OS", { configurable: true, value: "android" }); });
afterAll(() => { Object.defineProperty(Platform, "OS", { configurable: true, value: originalPlatform }); });
beforeEach(() => { mockNative.discover.mockReset(); mockNative.send.mockReset(); });

test("validates discovered printer fields before exposing them", async () => {
  mockNative.discover.mockResolvedValue({ success: true, data: [{ model: "QL-810W", ip: "invalid" }] });
  expect(await discoverBrother()).toMatchObject({ success: false, error: { code: "DISCOVERY_FAILED" } });
});

test("an invalid send response remains uncertain", async () => {
  mockNative.send.mockResolvedValue({ success: true, data: { confirmation: "queued" } });
  expect(await sendBrother({ ip: "192.168.1.10", identityKind: "serial", identityValue: "ABC", uri: "file:///label.png", copies: 1 })).toMatchObject({ success: false, error: { code: "INVALID_NATIVE_RESPONSE", outcome: "unknown" } });
});
