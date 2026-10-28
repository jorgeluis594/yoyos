import { describe, expect, test } from "vitest";
import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { updateVariant, type UpdateVariantDependencies } from "@core/src/features/products/application/update-variant";
import type { VariantId } from "@core/src/features/products/domain/product";
import { lAzul, mNegro, productId, shirts } from "@core/src/features/products/application/variant-action-fixtures";

const access = { companyId: "00000000-0000-4000-8000-0000000000aa" as never };

function setup(owners: Record<string, VariantId> = {}) {
  const writes: unknown[] = [];
  const completed: unknown[] = [];
  const deps: UpdateVariantDependencies = {
    transaction: async <T, E extends { code: string; message: string }>(_companyId: unknown, work: () => Promise<Result<T, E>>) => work(),
    lockProduct: async () => ok(true),
    loadProduct: async () => ok(shirts()),
    findSkuOwners: async (skus) => ok(new Map(skus.flatMap((sku) => owners[sku] ? [[sku, owners[sku]] as const] : []))),
    updateVariantFields: async (variantId, changes) => { writes.push({ variantId, changes }); return ok(undefined); },
    clock: () => new Date(),
    observe: { completed: (summary) => completed.push(summary) },
  };
  return { deps, writes, completed };
}

describe("update variant", () => {
  test("writes only the changed fields, also on an inactive variant", async () => {
    const context = setup();
    const result = await updateVariant({ productId, variantId: lAzul, sku: " L-AZ ", salePrice: 30, purchasePrice: null }, access, context.deps);
    expect(result).toEqual({ success: true, data: productId });
    expect(context.writes).toEqual([{ variantId: lAzul, changes: { sku: "L-AZ", salePrice: { amount: 30, currency: "PEN" } } }]);
    expect(context.completed).toEqual([{ variantId: lAzul, fields: ["sku", "salePrice"] }]);
  });

  test("returns without writing when nothing changes", async () => {
    const context = setup();
    expect((await updateVariant({ productId, variantId: mNegro, sku: "polo-mn", salePrice: 20 }, access, context.deps)).success).toBe(true);
    expect((await updateVariant({ productId, variantId: mNegro }, access, context.deps)).success).toBe(true);
    expect(context.writes).toEqual([]);
  });

  test("reports a SKU owned by another variant as a DUPLICATE_SKU issue on sku", async () => {
    const context = setup({ "polo-x": lAzul });
    const result = await updateVariant({ productId, variantId: mNegro, sku: "POLO-X" }, access, context.deps);
    expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "VALIDATION_ERROR",
      issues: [expect.objectContaining({ scope: "variant", variantId: mNegro, field: "sku", reason: "DUPLICATE_SKU" })] }) });
    const own = setup({ "polo-mn": mNegro });
    expect((await updateVariant({ productId, variantId: mNegro, sku: "POLO-MN", salePrice: 21 }, access, own.deps)).success).toBe(true);
  });

  test("validates prices before looking SKUs up", async () => {
    const context = setup();
    const result = await updateVariant({ productId, variantId: mNegro, salePrice: 0, purchasePrice: 1.234 }, access, context.deps);
    expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "VALIDATION_ERROR", issues: [
      expect.objectContaining({ scope: "variant", variantId: mNegro, field: "salePrice", reason: "INVALID_PRICE" }),
      expect.objectContaining({ field: "purchasePrice", reason: "INVALID_PRECISION" })] }) });
  });

  test("answers VARIANT_NOT_FOUND for a variant that is not in the product", async () => {
    const result = await updateVariant({ productId, variantId: "00000000-0000-4000-8000-0000000000ee" as VariantId, salePrice: 3 }, access, setup().deps);
    expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "VARIANT_NOT_FOUND" }) });
  });
});
