const mockNative = { discoverPrinters: jest.fn(), resolvePrinter: jest.fn(), printImage: jest.fn() };
const mockRequireNative = jest.fn((_name: string) => mockNative);
jest.mock("expo", () => ({ requireOptionalNativeModule: (name: string) => mockRequireNative(name) }));

import { discoverBrother, resolveBrother, sendBrother } from "@mobile/modules/brother-printer";
import { Platform } from "react-native";

const originalPlatform = Platform.OS;
beforeAll(() => { Object.defineProperty(Platform, "OS", { configurable: true, value: "android" }); });
afterAll(() => { Object.defineProperty(Platform, "OS", { configurable: true, value: originalPlatform }); });
beforeEach(() => { mockRequireNative.mockClear(); mockNative.discoverPrinters.mockReset(); mockNative.resolvePrinter.mockReset(); mockNative.printImage.mockReset(); });

test("validates discovered printer fields before exposing them", async () => {
  mockNative.discoverPrinters.mockResolvedValue({ status: "ok", data: [{ model: "QL-810W", ip: "invalid" }] });
  expect(await discoverBrother()).toMatchObject({ success: false, error: { code: "DISCOVERY_FAILED" } });
  expect(mockNative.discoverPrinters).toHaveBeenCalledWith(5000);
});

test("validates native printer resolution before exposing it", async () => {
  mockNative.resolvePrinter.mockResolvedValue({ status: "ok", data: { model: "QL-810W", ip: "invalid" } });
  expect(await resolveBrother({ model: "QL-810W", identityKind: "serial", identityValue: "ABC", lastKnownIp: "192.168.1.10" }))
    .toMatchObject({ success: false, error: { code: "INVALID_NATIVE_RESPONSE" } });
});

test("an invalid send response remains uncertain", async () => {
  mockNative.printImage.mockResolvedValue({ status: "ok", data: { confirmation: "queued" } });
  expect(await sendBrother({ model: "QL-810W", labelSize: "DK-1209", ip: "192.168.1.10", identityKind: "serial", identityValue: "ABC", uri: "file:///label.png", copies: 1 })).toMatchObject({ success: false, error: { code: "INVALID_NATIVE_RESPONSE", outcome: "unknown" } });
});

test("iOS reports Brother unavailable without loading the Android module", async () => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  try {
    expect(await discoverBrother()).toMatchObject({ success: false, error: { code: "PRINTING_UNAVAILABLE" } });
    expect(await resolveBrother({ model: "QL-810W", identityKind: "serial", identityValue: "ABC", lastKnownIp: "192.168.1.10" }))
      .toMatchObject({ success: false, error: { code: "PRINTING_UNAVAILABLE" } });
    expect(mockRequireNative).not.toHaveBeenCalled();
  } finally { Object.defineProperty(Platform, "OS", { configurable: true, value: "android" }); }
});
