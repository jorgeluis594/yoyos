import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import { checkProductStockTotal, parseStockCount } from "@core/src/features/products/domain/stock-level";
import { planVariantPatch, validateVariantPatch } from "@core/src/features/products/domain/rules";
import type { ProductBusinessError, ValidationError, ValidationIssue } from "@core/src/features/products/domain/errors";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductAccess, ProductReadError } from "@core/src/features/products/application/repository";
import type { setVariantStock } from "@core/src/features/products/application/set-variant-stock";
import { runVariantAction, type VariantActionDependencies } from "@core/src/features/products/application/variant-action";

export type UpdateVariantInput = Readonly<{ productId: ProductId; variantId: VariantId; sku?: string | null; salePrice?: number; purchasePrice?: number | null; stock?: number }>;
export type VariantFieldChanges = Readonly<{ sku?: string | null; salePrice?: Money; purchasePrice?: Money | null }>;
export type UpdateVariantDone = Readonly<{ variantId: VariantId; fields: readonly ("sku" | "salePrice" | "purchasePrice" | "stock")[] }>;
export type UpdateVariantError = Extract<ProductBusinessError, { code: "VALIDATION_ERROR" | "PRODUCT_NOT_FOUND" | "VARIANT_NOT_FOUND" | "DUPLICATE_SKU" }> | ProductReadError;
export type UpdateVariantDependencies = VariantActionDependencies<UpdateVariantDone> & Readonly<{
  /** Normalized (trimmed, lowercase) SKUs mapped to the variant that owns them. */
  findSkuOwners: (normalizedSkus: readonly string[]) => Promise<Result<ReadonlyMap<string, VariantId>, ProductReadError>>;
  /** One UPDATE of the variant; a race on the SKU index answers `DUPLICATE_SKU`. */
  updateVariantFields: (variantId: VariantId, changes: VariantFieldChanges) => Promise<Result<void, UpdateVariantError>>;
  /** The one stock write, bound to the company; runs in this transaction. */
  setVariantStock: (input: Parameters<typeof setVariantStock>[0]) => Promise<Result<void, ProductReadError>>;
}>;

export function updateVariant(input: UpdateVariantInput, access: ProductAccess, deps: UpdateVariantDependencies) {
  return runVariantAction({ productId: input.productId, variantId: input.variantId }, access, "update", deps, async (product): Promise<Result<UpdateVariantDone | null, UpdateVariantError>> => {
    const variant = product.variants.find((candidate) => candidate.id === input.variantId);
    if (!variant) return err({ code: "VARIANT_NOT_FOUND", message: "Variant does not exist" });
    const patch = { id: input.variantId, ...(input.sku === undefined ? {} : { sku: input.sku }), ...(input.salePrice === undefined ? {} : { salePrice: input.salePrice }),
      ...(input.purchasePrice === undefined ? {} : { purchasePrice: input.purchasePrice }) };
    const validated = validateVariantPatch(product, { variants: [patch] });
    const stockIssue = (reason: "INVALID_STOCK" | "INVALID_TOTAL_STOCK", message: string): ValidationIssue => ({ scope: "variant", variantId: input.variantId, field: "stock", reason, message });
    const stockIssues: ValidationIssue[] = [];
    if (input.stock !== undefined) {
      const parsed = parseStockCount(input.stock);
      if (!parsed.success) stockIssues.push(stockIssue("INVALID_STOCK", "Invalid stock"));
      else if (!checkProductStockTotal(product, input.variantId, parsed.data).success) stockIssues.push(stockIssue("INVALID_TOTAL_STOCK", "Total stock exceeds the supported range"));
    }
    if (!validated.value) return err({ code: "VALIDATION_ERROR", message: "Invalid variant", issues: [...validated.issues, ...stockIssues] as unknown as ValidationError["issues"] });
    const change = planVariantPatch(product, validated.value)?.variants[0];
    const issues: ValidationIssue[] = [...stockIssues];
    if (typeof change?.sku === "string") {
      const normalized = change.sku.trim().toLowerCase();
      const owners = await deps.findSkuOwners([normalized]);
      if (!owners.success) return owners;
      const owner = owners.data.get(normalized);
      if (owner !== undefined && owner !== input.variantId) issues.unshift({ scope: "variant", variantId: input.variantId, field: "sku", reason: "DUPLICATE_SKU", message: "SKU is already used" });
    }
    if (issues.length) return err({ code: "VALIDATION_ERROR", message: "Invalid variant", issues: issues as unknown as ValidationError["issues"] });
    const stock = input.stock !== undefined && input.stock !== variant.stock.quantity ? input.stock : undefined;
    if (!change && stock === undefined) return ok(null);
    const money = (amount: number): Money => ({ amount, currency: product.currency });
    const changes: VariantFieldChanges = {
      ...(change?.sku === undefined ? {} : { sku: change.sku }),
      ...(change?.salePrice === undefined ? {} : { salePrice: money(change.salePrice) }),
      ...(change?.purchasePrice === undefined ? {} : { purchasePrice: change.purchasePrice === null ? null : money(change.purchasePrice) }),
    };
    if (change) {
      const written = await deps.updateVariantFields(input.variantId, changes);
      if (!written.success) return written;
    }
    if (stock !== undefined) {
      const written = await deps.setVariantStock({ counts: [{ variantId: input.variantId, stock }] });
      if (!written.success) return written;
    }
    const fields = (["sku", "salePrice", "purchasePrice"] as const).filter((field) => changes[field] !== undefined);
    return ok({ variantId: input.variantId, fields: stock === undefined ? fields : [...fields, "stock"] });
  });
}
