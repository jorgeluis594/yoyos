import { describe, expect, test } from "vitest";
import {
  checkoutBrandColors, defaultCheckoutAppearance, isDefaultCheckoutAppearance, parseCheckoutAppearance, parseCompanyId, parseUserId,
} from "@core/src/features/checkout-appearance/domain/checkout-appearance";

const logoImageId = "0f4d2c3e-1b6a-4c5d-8e7f-9a0b1c2d3e4f";

describe("parseCheckoutAppearance", () => {
  test("accepts a complete appearance", () => {
    expect(parseCheckoutAppearance({ logoImageId, brandColor: "forest", background: "brand_tint" }))
      .toEqual({ success: true, data: { logoImageId, brandColor: "forest", background: "brand_tint" } });
  });

  test("accepts an appearance without logo", () => {
    expect(parseCheckoutAppearance({ logoImageId: null, brandColor: "yoyos", background: "white" }))
      .toMatchObject({ success: true, data: { logoImageId: null } });
  });

  test("accepts every color of the catalog", () => {
    for (const brandColor of checkoutBrandColors)
      expect(parseCheckoutAppearance({ logoImageId: null, brandColor, background: "neutral" })).toMatchObject({ success: true });
  });

  test.each(["#2F6B4F", "green", "Bosque", "", null])("rejects %s as brand color", (brandColor) => {
    expect(parseCheckoutAppearance({ logoImageId: null, brandColor, background: "neutral" }))
      .toMatchObject({ success: false, error: { code: "INVALID_CHECKOUT_APPEARANCE", invalidFields: ["brandColor"] } });
  });

  test("rejects a logo id that is not a UUID", () => {
    expect(parseCheckoutAppearance({ logoImageId: "logo.png", brandColor: "yoyos", background: "neutral" }))
      .toMatchObject({ success: false, error: { invalidFields: ["logoImageId"] } });
  });

  test("rejects a background outside the three options", () => {
    expect(parseCheckoutAppearance({ logoImageId: null, brandColor: "yoyos", background: "black" }))
      .toMatchObject({ success: false, error: { invalidFields: ["background"] } });
  });

  test("rejects unknown fields", () => {
    expect(parseCheckoutAppearance({ logoImageId: null, brandColor: "yoyos", background: "neutral", companyId: "other" }))
      .toMatchObject({ success: false, error: { invalidFields: ["companyId"] } });
  });

  test("rejects a value that is not an object", () => {
    expect(parseCheckoutAppearance(null)).toMatchObject({ success: false, error: { invalidFields: ["appearance"] } });
  });
});

describe("isDefaultCheckoutAppearance", () => {
  test("recognizes the Yoyos default appearance", () => {
    expect(isDefaultCheckoutAppearance(defaultCheckoutAppearance)).toBe(true);
  });

  test("treats a different color, background or logo as customized", () => {
    expect(isDefaultCheckoutAppearance({ ...defaultCheckoutAppearance, brandColor: "forest" })).toBe(false);
    expect(isDefaultCheckoutAppearance({ ...defaultCheckoutAppearance, background: "white" })).toBe(false);
    const parsed = parseCheckoutAppearance({ ...defaultCheckoutAppearance, logoImageId });
    expect(parsed.success && isDefaultCheckoutAppearance(parsed.data)).toBe(false);
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
