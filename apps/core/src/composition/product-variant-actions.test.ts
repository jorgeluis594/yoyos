import { beforeEach, describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { ProductId } from "@core/src/features/products/domain/product";

const editing = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@core/src/composition/product-editing", async (importOriginal) => ({
  ...await importOriginal<typeof import("@core/src/composition/product-editing")>(),
  productEditing: { get: editing.get },
}));

const { log } = await import("@core/src/shared/infrastructure/logger");
const { withDetail } = await import("@core/src/composition/product-variant-actions");
const { withTenantIsolation } = await import("@core/src/shared/infrastructure/persistance");

const productId = "00000000-0000-4000-8000-000000000001" as ProductId;
const company = "00000000-0000-4000-8000-0000000000aa";

describe("withDetail", () => {
  beforeEach(() => { vi.restoreAllMocks(); editing.get.mockReset(); });

  test("a failed reload after the committed write is logged once with the product and the error code", async () => {
    const logged = vi.spyOn(log, "error").mockImplementation(() => undefined);
    editing.get.mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
    const result = await withTenantIsolation(company, () => withDetail(ok(productId)));
    expect(result).toEqual(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ event: "product_variant_action_reload_failed", companyId: company, productId, errorCode: "PERSISTENCE_UNAVAILABLE" }), "product_variant_action_reload_failed");
  });

  test("a product that vanished between the write and the reload answers PRODUCT_NOT_FOUND and is logged", async () => {
    const logged = vi.spyOn(log, "error").mockImplementation(() => undefined);
    editing.get.mockResolvedValue(ok(null));
    const result = await withTenantIsolation(company, () => withDetail(ok(productId)));
    expect(result).toMatchObject({ success: false, error: { code: "PRODUCT_NOT_FOUND" } });
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ event: "product_variant_action_reload_failed", errorCode: "PRODUCT_NOT_FOUND" }), "product_variant_action_reload_failed");
  });

  test("a rejected write is passed through without reading or logging", async () => {
    const logged = vi.spyOn(log, "error").mockImplementation(() => undefined);
    const rejected = err({ code: "VARIANT_NOT_FOUND", message: "Variant does not exist" });
    expect(await withDetail(rejected)).toBe(rejected);
    expect(editing.get).not.toHaveBeenCalled();
    expect(logged).not.toHaveBeenCalled();
  });
});
