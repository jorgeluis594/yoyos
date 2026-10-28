import { describe, expect, test } from "vitest";
import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { deleteVariant, type DeleteVariantDependencies } from "@core/src/features/products/application/delete-variant";
import type { VariantDeletionPlan } from "@core/src/features/products/domain/variant-rules";
import type { Product, VariantId } from "@core/src/features/products/domain/product";
import { lAzul, large, lNegro, mAzul, productId, shirts, simple, when } from "@core/src/features/products/application/variant-action-fixtures";

const access = { companyId: "00000000-0000-4000-8000-0000000000aa" as never };

function setup(stored: Product, ordered: readonly VariantId[] = []) {
  const writes: VariantDeletionPlan[] = [];
  const completed: unknown[] = [];
  const deps: DeleteVariantDependencies = {
    transaction: async <T, E extends { code: string; message: string }>(_companyId: unknown, work: () => Promise<Result<T, E>>) => work(),
    lockProduct: async () => ok(true),
    loadProduct: async () => ok(stored),
    findOrderedVariantIds: async (ids) => ok(new Set(ids.filter((id) => ordered.includes(id)))),
    applyVariantDeletion: async (_id, plan) => { writes.push(plan); return ok(undefined); },
    clock: () => when,
    observe: { completed: (summary) => completed.push(summary) },
  };
  return { deps, writes, completed };
}

describe("delete variant", () => {
  test("reports orders before stock before last variant", async () => {
    const bare = simple();
    const only = bare.variants[0].id;
    const stocked: Product = { ...bare, variants: [{ ...bare.variants[0], stock: { variantId: only, quantity: 3 } }] };
    const all = setup(stocked, [only]);
    expect(await deleteVariant({ productId, variantId: only }, access, all.deps)).toEqual({ success: false, error: expect.objectContaining({ code: "VARIANT_HAS_ORDERS" }) });
    const noOrders = setup(stocked);
    expect(await deleteVariant({ productId, variantId: only }, access, noOrders.deps)).toEqual({ success: false, error: expect.objectContaining({ code: "VARIANT_HAS_STOCK" }) });
    const last = setup(bare);
    expect(await deleteVariant({ productId, variantId: only }, access, last.deps)).toEqual({ success: false, error: expect.objectContaining({ code: "LAST_VARIANT" }) });
    expect([all.writes, noOrders.writes, last.writes]).toEqual([[], [], []]);
  });

  test("deletes a variant and the values left without variants", async () => {
    const stored = shirts();
    const withoutM: Product = { ...stored, variants: stored.variants.filter((variant) => variant.id !== mAzul) as unknown as Product["variants"] };
    const context = setup(withoutM);
    expect((await deleteVariant({ productId, variantId: lNegro }, access, context.deps)).success).toBe(true);
    expect(context.writes).toEqual([{ variantId: lNegro, deleteValueIds: [], deleteOptionIds: [] }]);
    const lastLarge = setup({ ...stored, variants: stored.variants.filter((variant) => variant.id !== mAzul && variant.id !== lNegro) as unknown as Product["variants"] });
    expect((await deleteVariant({ productId, variantId: lAzul }, access, lastLarge.deps)).success).toBe(false); // it still has stock 6
    const empty = stored.variants.map((variant) => variant.id === lAzul ? { ...variant, stock: { ...variant.stock, quantity: 0 } } : variant);
    const free = setup({ ...stored, variants: empty.filter((variant) => variant.id !== lNegro) as unknown as Product["variants"] });
    expect((await deleteVariant({ productId, variantId: lAzul }, access, free.deps)).success).toBe(true);
    expect(free.writes).toEqual([{ variantId: lAzul, deleteValueIds: [large], deleteOptionIds: [] }]);
    expect(free.completed).toEqual([{ variantId: lAzul, removedValues: 1, removedOptions: 0 }]);
  });

  test("answers VARIANT_NOT_FOUND when the variant is gone", async () => {
    const context = setup(shirts());
    expect(await deleteVariant({ productId, variantId: "00000000-0000-4000-8000-0000000000ee" as VariantId }, access, context.deps)).toEqual({ success: false, error: expect.objectContaining({ code: "VARIANT_NOT_FOUND" }) });
  });
});
