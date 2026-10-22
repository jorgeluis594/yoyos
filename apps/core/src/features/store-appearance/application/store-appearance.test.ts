import { describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import {
  getStoreAppearance, getStorePreview, getPublicStoreAppearance, saveStoreAppearance,
  type AppearanceDependencies, type PreviewDependencies,
} from "@core/src/features/store-appearance/application/store-appearance";
import {
  defaultStoreAppearance, parseCompanyId, type StoreAppearance, type ImageId,
} from "@core/src/features/store-appearance/domain/store-appearance";

const companyUuid = "6f1c5a7e-3b2d-4e8a-9c10-1a2b3c4d5e6f";
const logoUuid = "0f4d2c3e-1b6a-4c5d-8e7f-9a0b1c2d3e4f";
const company = (() => { const parsed = parseCompanyId(companyUuid); if (!parsed.success) throw new Error("fixture"); return parsed.data; })();
const logo = logoUuid as ImageId;
const boutique = { logoImageId: logo, theme: "boutique" } as const satisfies StoreAppearance;

function dependencies(overrides: Partial<AppearanceDependencies> = {}): AppearanceDependencies {
  return {
    load: async () => ok(null),
    save: async () => ok(null),
    logoOwned: async () => ok(true),
    logoUrl: async () => "https://cdn.example/logo.png",
    imageUrl: async () => ok("https://cdn.example/logo.png"),
    ...overrides,
  };
}

const unknownTheme = { code: "UNKNOWN_STORED_THEME", message: "theme outside the list" } as const;

describe("getStoreAppearance", () => {
  test("returns Clásico without logo as a readable appearance when the company never saved one", async () => {
    expect(await getStoreAppearance(company, dependencies())).toEqual(ok({ kind: "readable", appearance: defaultStoreAppearance, logoUrl: null }));
  });

  test("returns the saved theme and the resolved logo url", async () => {
    const result = await getStoreAppearance(company, dependencies({ load: async () => ok(boutique) }));
    expect(result).toEqual(ok({ kind: "readable", appearance: boutique, logoUrl: "https://cdn.example/logo.png" }));
  });

  test("returns the unknown-theme starting point when the stored theme is not one of the five", async () => {
    const logoUrl = vi.fn<AppearanceDependencies["logoUrl"]>(async () => null);
    expect(await getStoreAppearance(company, dependencies({ load: async () => err(unknownTheme), logoUrl }))).toEqual(ok({ kind: "unknown_theme" }));
    expect(logoUrl).not.toHaveBeenCalled();
  });

  test("keeps the stored theme and logo id with no logo url when the logo cannot be resolved", async () => {
    const result = await getStoreAppearance(company, dependencies({ load: async () => ok(boutique), logoUrl: async () => null }));
    expect(result).toEqual(ok({ kind: "readable", appearance: boutique, logoUrl: null }));
  });

  test("reports other unusable stored data as an error, not as the unknown-theme starting point", async () => {
    const failure = { code: "INVALID_STORED_DATA", message: "bad row" } as const;
    expect(await getStoreAppearance(company, dependencies({ load: async () => err(failure) }))).toEqual(err(failure));
    const down = { code: "PERSISTENCE_UNAVAILABLE", message: "down" } as const;
    expect(await getStoreAppearance(company, dependencies({ load: async () => err(down) }))).toEqual(err(down));
  });
});

describe("saveStoreAppearance", () => {
  test("saving returns the saved appearance with the resolved logo url", async () => {
    const save = vi.fn<AppearanceDependencies["save"]>(async () => ok(null));
    const result = await saveStoreAppearance(company, boutique, dependencies({ save }));
    expect(result).toEqual(ok({ appearance: boutique, logoUrl: "https://cdn.example/logo.png" }));
    expect(save).toHaveBeenCalledExactlyOnceWith(company, boutique);
  });

  test("saves an appearance without logo without checking images", async () => {
    const logoOwned = vi.fn<AppearanceDependencies["logoOwned"]>(async () => ok(true));
    const logoUrl = vi.fn<AppearanceDependencies["logoUrl"]>(async () => "https://cdn.example/logo.png");
    const save = vi.fn<AppearanceDependencies["save"]>(async () => ok(null));
    const result = await saveStoreAppearance(company, defaultStoreAppearance, dependencies({ logoOwned, logoUrl, save }));
    expect(result).toEqual(ok({ appearance: defaultStoreAppearance, logoUrl: null }));
    expect(logoOwned).not.toHaveBeenCalled();
    expect(logoUrl).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
  });

  test("saving rejects a logo the company does not own with INVALID_IMAGE without writing and without consulting storage", async () => {
    const save = vi.fn<AppearanceDependencies["save"]>(async () => ok(null));
    const logoUrl = vi.fn<AppearanceDependencies["logoUrl"]>(async () => null);
    const result = await saveStoreAppearance(company, boutique, dependencies({ logoOwned: async () => ok(false), logoUrl, save }));
    expect(result).toMatchObject({ success: false, error: { code: "INVALID_IMAGE" } });
    expect(save).not.toHaveBeenCalled();
    expect(logoUrl).not.toHaveBeenCalled();
  });

  test("a theme-only save keeps an unresolved stored logo and succeeds with a logo without url when the storage url fails", async () => {
    const save = vi.fn<AppearanceDependencies["save"]>(async () => ok(null));
    const result = await saveStoreAppearance(company, { ...boutique, theme: "noche" }, dependencies({ logoUrl: async () => null, save }));
    expect(result).toEqual(ok({ appearance: { logoImageId: logo, theme: "noche" }, logoUrl: null }));
    expect(save).toHaveBeenCalledExactlyOnceWith(company, { logoImageId: logo, theme: "noche" });
  });

  test("rejects an invalid appearance and saves nothing", async () => {
    const save = vi.fn<AppearanceDependencies["save"]>(async () => ok(null));
    const result = await saveStoreAppearance(company, { ...boutique, theme: "neon" }, dependencies({ save }));
    expect(result).toMatchObject({ success: false, error: { code: "INVALID_STORE_APPEARANCE", invalidFields: ["theme"] } });
    expect(save).not.toHaveBeenCalled();
  });

  test("saving answers PERSISTENCE_UNAVAILABLE without writing when the ownership read fails", async () => {
    const save = vi.fn<AppearanceDependencies["save"]>(async () => ok(null));
    const failure = { code: "PERSISTENCE_UNAVAILABLE", message: "down" } as const;
    expect(await saveStoreAppearance(company, boutique, dependencies({ logoOwned: async () => err(failure), save }))).toEqual(err(failure));
    expect(save).not.toHaveBeenCalled();
  });

  test("returns the failure when saving fails", async () => {
    const failure = { code: "PERSISTENCE_UNAVAILABLE", message: "down" } as const;
    expect(await saveStoreAppearance(company, boutique, dependencies({ save: async () => err(failure) }))).toEqual(err(failure));
  });
});

describe("getPublicStoreAppearance", () => {
  test("returns the theme and logo URL without identifiers for the public checkout", async () => {
    const result = await getPublicStoreAppearance(company, dependencies({ load: async () => ok(boutique) }));
    expect(result).toEqual({ kind: "custom", appearance: { logoUrl: "https://cdn.example/logo.png", theme: "boutique" } });
  });

  test("returns default when the company has no saved appearance", async () => {
    expect(await getPublicStoreAppearance(company, dependencies())).toEqual({ kind: "default" });
  });

  test("the public read falls back to Clásico without logo for an unknown stored theme", async () => {
    expect(await getPublicStoreAppearance(company, dependencies({ load: async () => err(unknownTheme) }))).toEqual({ kind: "fallback" });
  });

  test("returns fallback when the appearance cannot be read", async () => {
    const load = async () => err({ code: "INVALID_STORED_DATA", message: "bad row" } as const);
    expect(await getPublicStoreAppearance(company, dependencies({ load }))).toEqual({ kind: "fallback" });
  });

  test("keeps the appearance without logo when the logo URL cannot be resolved", async () => {
    const result = await getPublicStoreAppearance(company, dependencies({ load: async () => ok(boutique), imageUrl: async () => err({ message: "storage down" }) }));
    expect(result).toEqual({ kind: "custom", appearance: { logoUrl: null, theme: "boutique" } });
  });

  test("returns no logo URL when the appearance has no logo", async () => {
    const imageUrl = vi.fn<AppearanceDependencies["imageUrl"]>(async () => ok("https://cdn.example/logo.png"));
    const stored = { ...boutique, logoImageId: null };
    const result = await getPublicStoreAppearance(company, dependencies({ load: async () => ok(stored), imageUrl }));
    expect(result).toMatchObject({ kind: "custom", appearance: { logoUrl: null } });
    expect(imageUrl).not.toHaveBeenCalled();
  });
});

describe("getStorePreview", () => {
  const wallet = { method: "digital_wallet", provider: "Yape", holder: "Ana", imageUrl: null } as const;
  const preview = (overrides: Partial<PreviewDependencies> = {}): PreviewDependencies => ({
    companyName: async () => ok("Lima Studio"), paymentMethods: async () => ok([wallet]), ...overrides,
  });

  test("the preview read succeeds without reading the appearance", async () => {
    const result = await getStorePreview(company, preview());
    expect(result).toEqual(ok({ companyName: "Lima Studio", paymentMethods: [wallet] }));
  });

  test("returns null payment methods when the company has none", async () => {
    const result = await getStorePreview(company, preview({ paymentMethods: async () => ok([]) }));
    expect(result).toEqual(ok({ companyName: "Lima Studio", paymentMethods: null }));
  });

  test("the preview read shows example payment methods when the payment methods read fails", async () => {
    const failure = { code: "PERSISTENCE_UNAVAILABLE", message: "down" } as const;
    const result = await getStorePreview(company, preview({ paymentMethods: async () => err(failure) }));
    expect(result).toEqual(ok({ companyName: "Lima Studio", paymentMethods: null }));
  });

  test("fails only when the company name cannot be read", async () => {
    const failure = { code: "PERSISTENCE_UNAVAILABLE", message: "down" } as const;
    expect(await getStorePreview(company, preview({ companyName: async () => err(failure) }))).toEqual(err(failure));
  });
});
