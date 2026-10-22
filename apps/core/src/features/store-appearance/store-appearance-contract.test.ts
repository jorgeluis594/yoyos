import { describe, expect, test } from "vitest";
import { saveStoreAppearanceSchema, storeAppearanceResponseSchema } from "@shared/contracts/store-appearance";

const logoId = "0f4d2c3e-1b6a-4c5d-8e7f-9a0b1c2d3e4f";

describe("store appearance contract", () => {
  test("the store appearance contract accepts the unknown-theme response and a logo without url, and rejects a theme outside the five or an unknown key", () => {
    expect(storeAppearanceResponseSchema.safeParse({ kind: "unknown_theme" }).success).toBe(true);
    expect(storeAppearanceResponseSchema.safeParse({ kind: "readable", appearance: { theme: "noche", logo: { id: logoId, url: null } } }).success).toBe(true);
    expect(storeAppearanceResponseSchema.safeParse({ kind: "readable", appearance: { theme: "boutique", logo: null } }).success).toBe(true);
    expect(storeAppearanceResponseSchema.safeParse({ kind: "readable", appearance: { theme: "rojo", logo: null } }).success).toBe(false);
    expect(storeAppearanceResponseSchema.safeParse({ kind: "unknown_theme", extra: true }).success).toBe(false);
    expect(storeAppearanceResponseSchema.safeParse({ kind: "readable", appearance: { theme: "noche", logo: null, extra: 1 } }).success).toBe(false);
    expect(saveStoreAppearanceSchema.safeParse({ theme: "rojo", logoImageId: null }).success).toBe(false);
    expect(saveStoreAppearanceSchema.safeParse({ theme: "noche", logoImageId: null, companyId: "x" }).success).toBe(false);
    expect(saveStoreAppearanceSchema.safeParse({ theme: "suave", logoImageId: logoId }).success).toBe(true);
  });
});
