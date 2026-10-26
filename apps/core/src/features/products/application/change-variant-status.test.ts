import { describe, expect, test } from "vitest";
import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { changeVariantStatus, type ChangeVariantStatusDependencies } from "@core/src/features/products/application/change-variant-status";
import type { Product, VariantStatus } from "@core/src/features/products/domain/product";
import { lAzul, mNegro, newId, productId, shirts, simple } from "@core/src/features/products/application/variant-action-fixtures";

const access = { companyId: "00000000-0000-4000-8000-0000000000aa" as never };

function setup(stored: Product = shirts()) {
  const writes: { variantId: string; status: VariantStatus }[] = [];
  const completed: unknown[] = [];
  const deps: ChangeVariantStatusDependencies = {
    transaction: async <T, E extends { code: string; message: string }>(_companyId: unknown, work: () => Promise<Result<T, E>>) => work(),
    lockProduct: async () => ok(true),
    loadProduct: async () => ok(stored),
    setVariantStatus: async (variantId, status) => { writes.push({ variantId, status }); return ok(undefined); },
    clock: () => new Date(),
    observe: { completed: (summary) => completed.push(summary) },
  };
  return { deps, writes, completed };
}

describe("change variant status", () => {
  test("rejects changing the status of a product without options", async () => {
    const bare = simple();
    const context = setup(bare);
    const result = await changeVariantStatus({ productId, variantId: bare.variants[0].id, status: "inactive" }, access, context.deps);
    expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "PRODUCT_WITHOUT_OPTIONS" }) });
    expect(context.writes).toEqual([]);
  });

  test("deactivating an inactive variant succeeds without writing", async () => {
    const context = setup();
    expect(await changeVariantStatus({ productId, variantId: lAzul, status: "inactive" }, access, context.deps)).toEqual({ success: true, data: productId });
    expect(context.writes).toEqual([]);
    expect(context.completed).toEqual([]);
  });

  test("deactivates a variant with stock and reports how many stay active", async () => {
    const context = setup();
    expect((await changeVariantStatus({ productId, variantId: mNegro, status: "inactive" }, access, context.deps)).success).toBe(true);
    expect(context.writes).toEqual([{ variantId: mNegro, status: "inactive" }]);
    expect(context.completed).toEqual([{ variantId: mNegro, status: "inactive", activeVariantCount: 2 }]);
    expect((await changeVariantStatus({ productId, variantId: lAzul, status: "active" }, access, context.deps)).success).toBe(true);
    expect(context.completed[1]).toEqual({ variantId: lAzul, status: "active", activeVariantCount: 4 });
  });

  test("answers VARIANT_NOT_FOUND for a variant of another product", async () => {
    const context = setup();
    expect(await changeVariantStatus({ productId, variantId: newId(9) as never, status: "inactive" }, access, context.deps)).toEqual({ success: false, error: expect.objectContaining({ code: "VARIANT_NOT_FOUND" }) });
  });
});
