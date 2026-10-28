import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ProductBusinessError } from "@core/src/features/products/domain/errors";
import type { ProductId, VariantId, VariantStatus } from "@core/src/features/products/domain/product";
import type { ProductAccess, ProductReadError } from "@core/src/features/products/application/repository";
import { runVariantAction, type VariantActionDependencies } from "@core/src/features/products/application/variant-action";

export type ChangeVariantStatusInput = Readonly<{ productId: ProductId; variantId: VariantId; status: VariantStatus }>;
export type ChangeVariantStatusDone = Readonly<{ variantId: VariantId; status: VariantStatus; activeVariantCount: number }>;
export type ChangeVariantStatusError = Extract<ProductBusinessError, { code: "PRODUCT_NOT_FOUND" | "VARIANT_NOT_FOUND" | "PRODUCT_WITHOUT_OPTIONS" }> | ProductReadError;
export type ChangeVariantStatusDependencies = VariantActionDependencies<ChangeVariantStatusDone> & Readonly<{
  setVariantStatus: (variantId: VariantId, status: VariantStatus) => Promise<Result<void, ChangeVariantStatusError>>;
}>;

/** The last active variant may be deactivated and stock does not block; the structure version does not change. */
export function changeVariantStatus(input: ChangeVariantStatusInput, access: ProductAccess, deps: ChangeVariantStatusDependencies) {
  return runVariantAction({ productId: input.productId, variantId: input.variantId }, access, "change_status", deps, async (product): Promise<Result<ChangeVariantStatusDone | null, ChangeVariantStatusError>> => {
    const variant = product.variants.find((candidate) => candidate.id === input.variantId);
    if (!variant) return err({ code: "VARIANT_NOT_FOUND", message: "Variant does not exist" });
    if (!product.options.length) return err({ code: "PRODUCT_WITHOUT_OPTIONS", message: "Product has no options" });
    if (variant.status === input.status) return ok(null);
    const written = await deps.setVariantStatus(input.variantId, input.status);
    if (!written.success) return written;
    const others = product.variants.filter((candidate) => candidate.id !== input.variantId && candidate.status === "active").length;
    return ok({ variantId: input.variantId, status: input.status, activeVariantCount: others + (input.status === "active" ? 1 : 0) });
  });
}
