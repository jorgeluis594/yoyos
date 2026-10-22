import { describe, expect, test } from "vitest";
import {
  defaultStoreAppearance, isDefaultStoreAppearance, parseStoreAppearance, parseCompanyId, parseImageId, parseUserId,
} from "@core/src/features/store-appearance/domain/store-appearance";
import { storeThemeIds } from "@shared/store-themes";

const logoImageId = "0f4d2c3e-1b6a-4c5d-8e7f-9a0b1c2d3e4f";

describe("parseStoreAppearance", () => {
  test("accepts a logo with each of the five themes", () => {
    for (const theme of storeThemeIds)
      expect(parseStoreAppearance({ logoImageId, theme })).toEqual({ success: true, data: { logoImageId, theme } });
  });

  test("accepts an appearance without logo", () => {
    expect(parseStoreAppearance({ logoImageId: null, theme: "classic" }))
      .toMatchObject({ success: true, data: { logoImageId: null } });
  });

  test.each(["neon", "Boutique", "#2F6B4F", "", null])("rejects an unknown theme naming the theme field (%s)", (theme) => {
    expect(parseStoreAppearance({ logoImageId: null, theme }))
      .toMatchObject({ success: false, error: { code: "INVALID_STORE_APPEARANCE", invalidFields: ["theme"] } });
  });

  test("rejects a logo id that is not a UUID", () => {
    expect(parseStoreAppearance({ logoImageId: "logo.png", theme: "classic" }))
      .toMatchObject({ success: false, error: { invalidFields: ["logoImageId"] } });
  });

  test("rejects a brand color or background sent with the appearance", () => {
    expect(parseStoreAppearance({ logoImageId: null, theme: "classic", brandColor: "forest", background: "soft" }))
      .toMatchObject({ success: false, error: { invalidFields: ["brandColor", "background"] } });
  });

  test("rejects unknown fields", () => {
    expect(parseStoreAppearance({ logoImageId: null, theme: "classic", companyId: "other" }))
      .toMatchObject({ success: false, error: { invalidFields: ["companyId"] } });
  });

  test("rejects a value that is not an object", () => {
    expect(parseStoreAppearance(null)).toMatchObject({ success: false, error: { invalidFields: ["appearance"] } });
  });
});

describe("isDefaultStoreAppearance", () => {
  test("uses Clásico without logo as the default appearance", () => {
    expect(defaultStoreAppearance).toEqual({ logoImageId: null, theme: "classic" });
  });

  test("recognizes the default appearance", () => {
    expect(isDefaultStoreAppearance(defaultStoreAppearance)).toBe(true);
  });

  test("treats a different theme or a logo as customized", () => {
    expect(isDefaultStoreAppearance({ ...defaultStoreAppearance, theme: "noche" })).toBe(false);
    const parsed = parseStoreAppearance({ ...defaultStoreAppearance, logoImageId });
    expect(parsed.success && isDefaultStoreAppearance(parsed.data)).toBe(false);
  });
});

describe("parseCompanyId", () => {
  test("accepts a UUID and rejects anything else", () => {
    expect(parseCompanyId(logoImageId)).toMatchObject({ success: true });
    expect(parseCompanyId("company")).toMatchObject({ success: false });
  });
});

describe("parseUserId", () => {
  test("accepts a non-empty id and rejects anything else", () => {
    expect(parseUserId("user_1")).toMatchObject({ success: true });
    expect(parseUserId("")).toMatchObject({ success: false });
    expect(parseUserId(7)).toMatchObject({ success: false });
  });
});

describe("parseImageId", () => {
  test("accepts a UUID and rejects anything else", () => {
    expect(parseImageId(logoImageId)).toMatchObject({ success: true });
    expect(parseImageId("logo.png")).toMatchObject({ success: false, error: { invalidFields: ["imageId"] } });
  });
});
