import { describe, expect, test } from "vitest";
import {
  defaultCheckoutAppearance, isDefaultCheckoutAppearance, parseCheckoutAppearance, parseCompanyId, parseImageId, parseUserId,
} from "@core/src/features/checkout-appearance/domain/checkout-appearance";
import { checkoutThemeIds } from "@core/src/features/checkout-appearance/domain/checkout-themes";

const logoImageId = "0f4d2c3e-1b6a-4c5d-8e7f-9a0b1c2d3e4f";

describe("parseCheckoutAppearance", () => {
  test("accepts a logo with each of the five themes", () => {
    for (const theme of checkoutThemeIds)
      expect(parseCheckoutAppearance({ logoImageId, theme })).toEqual({ success: true, data: { logoImageId, theme } });
  });

  test("accepts an appearance without logo", () => {
    expect(parseCheckoutAppearance({ logoImageId: null, theme: "classic" }))
      .toMatchObject({ success: true, data: { logoImageId: null } });
  });

  test.each(["neon", "Boutique", "#2F6B4F", "", null])("rejects an unknown theme naming the theme field (%s)", (theme) => {
    expect(parseCheckoutAppearance({ logoImageId: null, theme }))
      .toMatchObject({ success: false, error: { code: "INVALID_CHECKOUT_APPEARANCE", invalidFields: ["theme"] } });
  });

  test("rejects a logo id that is not a UUID", () => {
    expect(parseCheckoutAppearance({ logoImageId: "logo.png", theme: "classic" }))
      .toMatchObject({ success: false, error: { invalidFields: ["logoImageId"] } });
  });

  test("rejects a brand color or background sent with the appearance", () => {
    expect(parseCheckoutAppearance({ logoImageId: null, theme: "classic", brandColor: "forest", background: "soft" }))
      .toMatchObject({ success: false, error: { invalidFields: ["brandColor", "background"] } });
  });

  test("rejects unknown fields", () => {
    expect(parseCheckoutAppearance({ logoImageId: null, theme: "classic", companyId: "other" }))
      .toMatchObject({ success: false, error: { invalidFields: ["companyId"] } });
  });

  test("rejects a value that is not an object", () => {
    expect(parseCheckoutAppearance(null)).toMatchObject({ success: false, error: { invalidFields: ["appearance"] } });
  });
});

describe("isDefaultCheckoutAppearance", () => {
  test("uses Clásico without logo as the default appearance", () => {
    expect(defaultCheckoutAppearance).toEqual({ logoImageId: null, theme: "classic" });
  });

  test("recognizes the default appearance", () => {
    expect(isDefaultCheckoutAppearance(defaultCheckoutAppearance)).toBe(true);
  });

  test("treats a different theme or a logo as customized", () => {
    expect(isDefaultCheckoutAppearance({ ...defaultCheckoutAppearance, theme: "noche" })).toBe(false);
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

describe("parseImageId", () => {
  test("accepts a UUID and rejects anything else", () => {
    expect(parseImageId(logoImageId)).toMatchObject({ success: true });
    expect(parseImageId("logo.png")).toMatchObject({ success: false, error: { invalidFields: ["imageId"] } });
  });
});
