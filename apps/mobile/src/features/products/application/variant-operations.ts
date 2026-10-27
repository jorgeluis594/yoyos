import type { createProductApi } from "../infrastructure/product-api";

type ProductApi = ReturnType<typeof createProductApi>;

/** The saved variant detail's four actions: each answers the refreshed product detail (§5.3–5.6). */
export function createVariantOperations(api: ProductApi) {
  return {
    updateVariant: api.updateVariant,
    changeCombination: api.changeCombination,
    changeStatus: api.changeStatus,
    deleteVariant: api.deleteVariant,
  };
}
