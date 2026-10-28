import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { planVariantDeletion, type VariantDeletionPlan } from "@core/src/features/products/domain/variant-rules";
import type { ProductBusinessError } from "@core/src/features/products/domain/errors";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductAccess, ProductReadError } from "@core/src/features/products/application/repository";
import { runVariantAction, type VariantActionDependencies } from "@core/src/features/products/application/variant-action";

export type DeleteVariantInput = Readonly<{ productId: ProductId; variantId: VariantId }>;
export type DeleteVariantDone = Readonly<{ variantId: VariantId; removedValues: number; removedOptions: number }>;
export type DeleteVariantError = Extract<ProductBusinessError, { code: "PRODUCT_NOT_FOUND" | "VARIANT_NOT_FOUND" | "VARIANT_HAS_ORDERS" | "VARIANT_HAS_STOCK" | "LAST_VARIANT" }> | ProductReadError;
export type DeleteVariantDependencies = VariantActionDependencies<DeleteVariantDone> & Readonly<{
  /** The variants that any order references, confirmed or not. */
  findOrderedVariantIds: (ids: readonly VariantId[]) => Promise<Result<ReadonlySet<VariantId>, ProductReadError>>;
  /** Deletes stock and variant, then the emptied values and options, and bumps the structure version. An FK violation answers `VARIANT_HAS_ORDERS`. */
  applyVariantDeletion: (productId: ProductId, plan: VariantDeletionPlan, updatedAt: Date) => Promise<Result<void, DeleteVariantError>>;
}>;

export function deleteVariant(input: DeleteVariantInput, access: ProductAccess, deps: DeleteVariantDependencies) {
  return runVariantAction({ productId: input.productId, variantId: input.variantId }, access, "delete", deps, async (product): Promise<Result<DeleteVariantDone | null, DeleteVariantError>> => {
    if (!product.variants.some((variant) => variant.id === input.variantId)) return err({ code: "VARIANT_NOT_FOUND", message: "Variant does not exist" });
    const ordered = await deps.findOrderedVariantIds([input.variantId]);
    if (!ordered.success) return ordered;
    const planned = planVariantDeletion(product, input.variantId, ordered.data.has(input.variantId));
    if (!planned.success) return err(planned.error);
    const written = await deps.applyVariantDeletion(product.id, planned.data, deps.clock());
    if (!written.success) return written;
    return ok({ variantId: input.variantId, removedValues: planned.data.deleteValueIds.length, removedOptions: planned.data.deleteOptionIds.length });
  });
}
