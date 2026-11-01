import { describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { SavedProduct } from "@core/src/features/products/application/save-product";
import { catalogEmptied, resolveCatalogEmptied, type StorefrontReading } from "@core/src/features/products/presentation/catalog-emptied";

const saved = (hidLastOffered: boolean, currency = "PEN") => ({ hidLastOffered, detail: { product: { id: "p1", currency } } }) as unknown as SavedProduct;
const access = { companyId: "c1" as CompanyId };
const published = (currency: "PEN" | "USD"): StorefrontReading => ({ currency, catalog: { kind: "published" } });

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock("@core/src/shared/infrastructure/logger", () => ({ log: logs }));

describe("catalog emptied", () => {
  test("is true only when the catalog is published and the product is in the store currency", () => {
    expect(catalogEmptied(saved(true), { published: true, currency: "PEN" })).toBe(true);
    expect(catalogEmptied(saved(true), { published: false, currency: "PEN" })).toBe(false);
    expect(catalogEmptied(saved(true, "USD"), { published: true, currency: "PEN" })).toBe(false);
    expect(catalogEmptied(saved(false), { published: true, currency: "PEN" })).toBe(false);
  });

  test("reads the storefront only when the save hid the last offered product", async () => {
    const describeStorefront = vi.fn(async () => ok(published("PEN")));
    expect(await resolveCatalogEmptied(saved(false), access, describeStorefront)).toBe(false);
    expect(describeStorefront).not.toHaveBeenCalled();
    expect(await resolveCatalogEmptied(saved(true), access, describeStorefront)).toBe(true);
    expect(describeStorefront).toHaveBeenCalledWith("c1");
    expect(logs.info).toHaveBeenCalledWith(expect.objectContaining({ event: "product_catalog_emptied", companyId: "c1", productId: "p1" }), "product_catalog_emptied");
    expect(await resolveCatalogEmptied(saved(true), access, async () => ok({ currency: "PEN", catalog: { kind: "hidden" } }))).toBe(false);
  });

  test("a failed storefront read gives no notice and logs the failure", async () => {
    const result = await resolveCatalogEmptied(saved(true), access, async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
    expect(result).toBe(false);
    expect(logs.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "product_catalog_emptied_check_failed", companyId: "c1", productId: "p1", errorCode: "PERSISTENCE_UNAVAILABLE" }), "product_catalog_emptied_check_failed");
  });
});
