import { describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import {
  getCheckoutAppearancePreview, getPublicCheckoutAppearance, saveCheckoutAppearance,
  type AppearanceDependencies, type PreviewDependencies,
} from "@core/src/features/checkout-appearance/application/checkout-appearance";
import {
  defaultCheckoutAppearance, parseCompanyId, type CheckoutAppearance, type ImageId,
} from "@core/src/features/checkout-appearance/domain/checkout-appearance";

const companyUuid = "6f1c5a7e-3b2d-4e8a-9c10-1a2b3c4d5e6f";
const logoUuid = "0f4d2c3e-1b6a-4c5d-8e7f-9a0b1c2d3e4f";
const company = (() => { const parsed = parseCompanyId(companyUuid); if (!parsed.success) throw new Error("fixture"); return parsed.data; })();
const logo = logoUuid as ImageId;
const forest = { logoImageId: logo, brandColor: "forest", background: "brand_tint" } as const satisfies CheckoutAppearance;

function dependencies(overrides: Partial<AppearanceDependencies> = {}): AppearanceDependencies {
  return {
    load: async () => ok(null),
    save: async () => ok(null),
    imageAvailable: async () => ok(true),
    imageUrl: async () => ok("https://cdn.example/logo.png"),
    ...overrides,
  };
}

describe("saveCheckoutAppearance", () => {
  test("saves logo, color and background together", async () => {
    const save = vi.fn<AppearanceDependencies["save"]>(async () => ok(null));
    const result = await saveCheckoutAppearance(company, forest, dependencies({ save }));
    expect(result).toEqual(ok(forest));
    expect(save).toHaveBeenCalledExactlyOnceWith(company, forest);
  });

  test("saves an appearance without logo without checking images", async () => {
    const imageAvailable = vi.fn<AppearanceDependencies["imageAvailable"]>(async () => ok(true));
    const save = vi.fn<AppearanceDependencies["save"]>(async () => ok(null));
    const result = await saveCheckoutAppearance(company, defaultCheckoutAppearance, dependencies({ imageAvailable, save }));
    expect(result).toEqual(ok(defaultCheckoutAppearance));
    expect(imageAvailable).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
  });

  test("rejects a logo that is not an available image of the company and saves nothing", async () => {
    const save = vi.fn<AppearanceDependencies["save"]>(async () => ok(null));
    const result = await saveCheckoutAppearance(company, forest, dependencies({ imageAvailable: async () => ok(false), save }));
    expect(result).toMatchObject({ success: false, error: { code: "INVALID_IMAGE" } });
    expect(save).not.toHaveBeenCalled();
  });

  test("rejects an invalid appearance and saves nothing", async () => {
    const save = vi.fn<AppearanceDependencies["save"]>(async () => ok(null));
    const result = await saveCheckoutAppearance(company, { ...forest, brandColor: "#2F6B4F" }, dependencies({ save }));
    expect(result).toMatchObject({ success: false, error: { code: "INVALID_CHECKOUT_APPEARANCE", invalidFields: ["brandColor"] } });
    expect(save).not.toHaveBeenCalled();
  });

  test("returns the failure when the logo cannot be checked", async () => {
    const save = vi.fn<AppearanceDependencies["save"]>(async () => ok(null));
    const failure = { code: "PERSISTENCE_UNAVAILABLE", message: "down" } as const;
    expect(await saveCheckoutAppearance(company, forest, dependencies({ imageAvailable: async () => err(failure), save }))).toEqual(err(failure));
    expect(save).not.toHaveBeenCalled();
  });

  test("returns the failure when saving fails", async () => {
    const failure = { code: "PERSISTENCE_UNAVAILABLE", message: "down" } as const;
    expect(await saveCheckoutAppearance(company, forest, dependencies({ save: async () => err(failure) }))).toEqual(err(failure));
  });
});

describe("getPublicCheckoutAppearance", () => {
  test("returns the custom appearance with the logo URL and no identifiers", async () => {
    const result = await getPublicCheckoutAppearance(company, dependencies({ load: async () => ok(forest) }));
    expect(result).toEqual({ kind: "custom", appearance: { logoUrl: "https://cdn.example/logo.png", brandColor: "forest", background: "brand_tint" } });
  });

  test("returns default when the company has no saved appearance", async () => {
    expect(await getPublicCheckoutAppearance(company, dependencies())).toEqual({ kind: "default" });
  });

  test("returns fallback when the appearance cannot be read", async () => {
    const load = async () => err({ code: "INVALID_STORED_DATA", message: "bad row" } as const);
    expect(await getPublicCheckoutAppearance(company, dependencies({ load }))).toEqual({ kind: "fallback" });
  });

  test("keeps the appearance without logo when the logo URL cannot be resolved", async () => {
    const result = await getPublicCheckoutAppearance(company, dependencies({ load: async () => ok(forest), imageUrl: async () => err({ message: "storage down" }) }));
    expect(result).toEqual({ kind: "custom", appearance: { logoUrl: null, brandColor: "forest", background: "brand_tint" } });
  });

  test("returns no logo URL when the appearance has no logo", async () => {
    const imageUrl = vi.fn<AppearanceDependencies["imageUrl"]>(async () => ok("https://cdn.example/logo.png"));
    const stored = { ...forest, logoImageId: null };
    const result = await getPublicCheckoutAppearance(company, dependencies({ load: async () => ok(stored), imageUrl }));
    expect(result).toMatchObject({ kind: "custom", appearance: { logoUrl: null } });
    expect(imageUrl).not.toHaveBeenCalled();
  });
});

describe("getCheckoutAppearancePreview", () => {
  const wallet = { method: "digital_wallet", provider: "Yape", holder: "Ana", imageUrl: null } as const;
  const preview = (overrides: Partial<PreviewDependencies> = {}): PreviewDependencies => ({
    ...dependencies(), companyName: async () => ok("Lima Studio"), paymentMethods: async () => ok([wallet]), ...overrides,
  });

  test("returns the name, the saved appearance, the logo URL and the real payment methods", async () => {
    const result = await getCheckoutAppearancePreview(company, preview({ load: async () => ok(forest) }));
    expect(result).toEqual(ok({ companyName: "Lima Studio", appearance: forest, logoUrl: "https://cdn.example/logo.png", paymentSettings: [wallet] }));
  });

  test("uses the Yoyos default when the company has no saved appearance", async () => {
    const result = await getCheckoutAppearancePreview(company, preview());
    expect(result).toMatchObject({ success: true, data: { appearance: defaultCheckoutAppearance, logoUrl: null } });
  });

  test("returns null payment methods when the company has none", async () => {
    const result = await getCheckoutAppearancePreview(company, preview({ paymentMethods: async () => ok([]) }));
    expect(result).toMatchObject({ success: true, data: { paymentSettings: null } });
  });

  test("returns the failure when a source cannot be read", async () => {
    const failure = { code: "PERSISTENCE_UNAVAILABLE", message: "down" } as const;
    expect(await getCheckoutAppearancePreview(company, preview({ paymentMethods: async () => err(failure) }))).toEqual(err(failure));
    expect(await getCheckoutAppearancePreview(company, preview({ companyName: async () => err(failure) }))).toEqual(err(failure));
  });
});
