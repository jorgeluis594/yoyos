import { describe, expect, test } from "vitest";
import { readShadowConfig } from "@core/src/features/orders/infrastructure/reader/shadow-config";

describe("readShadowConfig", () => {
  test("defaults to the legacy shadow on with a 3 s wait, and treats empty values as unset", () => {
    expect(readShadowConfig({})).toEqual({ success: true, data: { legacy: true, waitMs: 3000 } });
    expect(readShadowConfig({ READER_SHADOW_LEGACY: "", READER_SHADOW_WAIT_MS: "" })).toEqual({ success: true, data: { legacy: true, waitMs: 3000 } });
  });

  test("reads both variables", () => {
    expect(readShadowConfig({ READER_SHADOW_LEGACY: "false", READER_SHADOW_WAIT_MS: "1500" })).toEqual({ success: true, data: { legacy: false, waitMs: 1500 } });
    expect(readShadowConfig({ READER_SHADOW_WAIT_MS: "0" })).toEqual({ success: true, data: { legacy: true, waitMs: 0 } });
  });

  test.each([
    ["a legacy flag that is not true or false", { READER_SHADOW_LEGACY: "yes" }, "READER_SHADOW_LEGACY"],
    ["a negative wait", { READER_SHADOW_WAIT_MS: "-1" }, "READER_SHADOW_WAIT_MS"],
    ["a fractional wait", { READER_SHADOW_WAIT_MS: "1.5" }, "READER_SHADOW_WAIT_MS"],
    ["a wait that is not a number", { READER_SHADOW_WAIT_MS: "soon" }, "READER_SHADOW_WAIT_MS"],
  ])("refuses %s, naming the variable", (_title, env, name) => {
    expect(readShadowConfig(env)).toEqual({ success: false, error: { code: "INVALID_SHADOW_ENV", message: expect.stringContaining(name) } });
  });
});
