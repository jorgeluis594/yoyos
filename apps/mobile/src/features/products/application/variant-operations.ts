import type { Result } from "@shared/result";
import type { Product, ProductId, VariantId } from "../domain/product";

/** What a screen reads from a refused action: the product error code and, for rejected input, the issues by field. */
export type VariantActionError = Readonly<{ code: string; message: string; issues?: readonly Readonly<{ field: string; reason: string }>[] }>;
export type VariantPatch = Readonly<{ sku?: string | null; salePrice?: number; purchasePrice?: number | null }>;
/** One entry per option: an existing value, or a new one with the id the retry must repeat. */
export type CombinationValues = Readonly<{ values: (Readonly<{ optionId: string; valueId: string }> | Readonly<{ optionId: string; newValue: Readonly<{ id: string; name: string }> }>)[] }>;
type Answer = Promise<Result<Product, VariantActionError>>;

export type VariantApi = Readonly<{
  updateVariant: (productId: ProductId, variantId: VariantId, input: VariantPatch) => Answer;
  changeCombination: (productId: ProductId, variantId: VariantId, input: CombinationValues) => Answer;
  changeStatus: (productId: ProductId, variantId: VariantId, status: "active" | "inactive") => Answer;
  deleteVariant: (productId: ProductId, variantId: VariantId) => Answer;
}>;

/** The saved variant detail's four actions: each answers the refreshed product detail (§5.3–5.6). */
export function createVariantOperations(api: VariantApi) {
  return {
    updateVariant: api.updateVariant,
    changeCombination: api.changeCombination,
    changeStatus: api.changeStatus,
    deleteVariant: api.deleteVariant,
  };
}
