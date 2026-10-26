import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import { planUpdate, validateUpdate } from "@core/src/features/products/domain/rules";
import type { ProductBusinessError, ValidationError, ValidationIssue } from "@core/src/features/products/domain/errors";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductAccess, ProductReadError } from "@core/src/features/products/application/repository";
import { runVariantAction, type VariantActionDependencies } from "@core/src/features/products/application/variant-action";

export type UpdateVariantInput = Readonly<{ productId: ProductId; variantId: VariantId; sku?: string | null; salePrice?: number; purchasePrice?: number | null }>;
export type VariantFieldChanges = Readonly<{ sku?: string | null; salePrice?: Money; purchasePrice?: Money | null }>;
export type UpdateVariantDone = Readonly<{ variantId: VariantId; fields: readonly ("sku" | "salePrice" | "purchasePrice")[] }>;
export type UpdateVariantError = Extract<ProductBusinessError, { code: "VALIDATION_ERROR" | "PRODUCT_NOT_FOUND" | "VARIANT_NOT_FOUND" | "DUPLICATE_SKU" }> | ProductReadError;
export type UpdateVariantDependencies = VariantActionDependencies<UpdateVariantDone> & Readonly<{
  /** Normalized (trimmed, lowercase) SKUs mapped to the variant that owns them. */
  findSkuOwners: (normalizedSkus: readonly string[]) => Promise<Result<ReadonlyMap<string, VariantId>, ProductReadError>>;
  /** One UPDATE of the variant; a race on the SKU index answers `DUPLICATE_SKU`. */
  updateVariantFields: (variantId: VariantId, changes: VariantFieldChanges) => Promise<Result<void, UpdateVariantError>>;
}>;

export function updateVariant(input: UpdateVariantInput, access: ProductAccess, deps: UpdateVariantDependencies) {
  return runVariantAction({ productId: input.productId, variantId: input.variantId }, access, "update", deps, async (product): Promise<Result<UpdateVariantDone | null, UpdateVariantError>> => {
    const variant = product.variants.find((candidate) => candidate.id === input.variantId);
    if (!variant) return err({ code: "VARIANT_NOT_FOUND", message: "Variant does not exist" });
    const patch = { id: input.variantId, ...(input.sku === undefined ? {} : { sku: input.sku }), ...(input.salePrice === undefined ? {} : { salePrice: input.salePrice }),
      ...(input.purchasePrice === undefined ? {} : { purchasePrice: input.purchasePrice }) };
    const validated = validateUpdate(product, { variants: [patch] });
    if (!validated.value) return err({ code: "VALIDATION_ERROR", message: "Invalid variant", issues: validated.issues as ValidationError["issues"] });
    const change = planUpdate(product, validated.value)?.variants[0];
    if (!change) return ok(null);
    if (typeof change.sku === "string") {
      const normalized = change.sku.trim().toLowerCase();
      const owners = await deps.findSkuOwners([normalized]);
      if (!owners.success) return owners;
      const owner = owners.data.get(normalized);
      if (owner !== undefined && owner !== input.variantId) {
        const issue: ValidationIssue = { scope: "variant", variantId: input.variantId, field: "sku", reason: "DUPLICATE_SKU", message: "SKU is already used" };
        return err({ code: "VALIDATION_ERROR", message: "Invalid variant", issues: [issue] });
      }
    }
    const money = (amount: number): Money => ({ amount, currency: product.currency });
    const changes: VariantFieldChanges = {
      ...(change.sku === undefined ? {} : { sku: change.sku }),
      ...(change.salePrice === undefined ? {} : { salePrice: money(change.salePrice) }),
      ...(change.purchasePrice === undefined ? {} : { purchasePrice: change.purchasePrice === null ? null : money(change.purchasePrice) }),
    };
    const written = await deps.updateVariantFields(input.variantId, changes);
    if (!written.success) return written;
    return ok({ variantId: input.variantId, fields: (["sku", "salePrice", "purchasePrice"] as const).filter((field) => changes[field] !== undefined) });
  });
}
