import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { newValueIds, planCombinationChange, type CombinationEntry, type CombinationPlan } from "@core/src/features/products/domain/variant-rules";
import type { ProductBusinessError } from "@core/src/features/products/domain/errors";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductAccess, ProductReadError } from "@core/src/features/products/application/repository";
import { runVariantAction, type VariantActionDependencies } from "@core/src/features/products/application/variant-action";

export type ChangeVariantCombinationInput = Readonly<{ productId: ProductId; variantId: VariantId; values: readonly CombinationEntry[] }>;
export type ChangeVariantCombinationDone = Readonly<{ variantId: VariantId; createdValue: boolean; removedValues: number }>;
export type ChangeVariantCombinationError = Extract<ProductBusinessError, { code: "VALIDATION_ERROR" | "PRODUCT_NOT_FOUND" | "VARIANT_NOT_FOUND" | "DUPLICATE_COMBINATION" | "ID_CONFLICT" | "PRODUCT_WITHOUT_OPTIONS" }> | ProductReadError;
export type ChangeVariantCombinationDependencies = VariantActionDependencies<ChangeVariantCombinationDone> & Readonly<{
  /** Option and value ids that already exist in the database. */
  findForeignOptionIds: (ids: readonly string[]) => Promise<Result<ReadonlySet<string>, ProductReadError>>;
  /** Moves the variant, adds the new value, removes the emptied ones and bumps the structure version. */
  applyCombinationChange: (productId: ProductId, plan: CombinationPlan, updatedAt: Date) => Promise<Result<void, ChangeVariantCombinationError>>;
}>;

export function changeVariantCombination(input: ChangeVariantCombinationInput, access: ProductAccess, deps: ChangeVariantCombinationDependencies) {
  return runVariantAction({ productId: input.productId, variantId: input.variantId }, access, "change_combination", deps, async (product): Promise<Result<ChangeVariantCombinationDone | null, ChangeVariantCombinationError>> => {
    // A retry repeats a value this product already has: only genuinely new ids need the lookup in other products.
    const own = new Set<string>(product.options.flatMap((option) => option.values.map((value) => value.id)));
    const candidates = newValueIds(input.values).filter((id) => !own.has(id));
    const foreign = candidates.length ? await deps.findForeignOptionIds(candidates) : ok<ReadonlySet<string>>(new Set());
    if (!foreign.success) return foreign;
    const planned = planCombinationChange(product, input.variantId, input.values, foreign.data);
    if (!planned.success) return err(planned.error);
    if (!planned.data) return ok(null);
    const written = await deps.applyCombinationChange(product.id, planned.data, deps.clock());
    if (!written.success) return written;
    return ok({ variantId: input.variantId, createdValue: planned.data.newValue !== undefined, removedValues: planned.data.deleteValueIds.length });
  });
}
