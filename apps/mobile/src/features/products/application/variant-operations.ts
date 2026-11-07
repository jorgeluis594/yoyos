import type { Result } from "@shared/result";
import type { Product, ProductId, VariantId } from "../domain/product";

/** Every code the three actions can answer: the transport ones, where the outcome may be unknown, and the product ones, which are definitive. */
// Kept by hand: it must list every code of the error unions in infrastructure/product-api.ts (MobileTransportCode and the variant action errors).
// The application layer cannot import them, and the composition fails to typecheck if the adapter answers a code missing here.
export type VariantActionCode =
  | "UNAUTHENTICATED" | "COMPANY_REQUIRED" | "NETWORK_ERROR" | "SERVICE_UNAVAILABLE" | "RATE_LIMITED" | "SERVER_ERROR" | "INVALID_RESPONSE"
  | "OPERATION_CANCELLED" | "SECURE_STORAGE_ERROR" | "API_ERROR"
  | "INVALID_INPUT" | "VALIDATION_ERROR" | "DUPLICATE_SKU" | "PRODUCT_WITHOUT_OPTIONS"
  | "VARIANT_HAS_ORDERS" | "VARIANT_HAS_STOCK" | "LAST_VARIANT" | "PRODUCT_NOT_FOUND" | "VARIANT_NOT_FOUND";
/** What a screen reads from a refused action: the error code and, for rejected input, the issues by field. */
export type VariantActionError = Readonly<{ code: VariantActionCode; message: string; issues?: readonly Readonly<{ field: string; reason: string }>[] }>;
export type VariantPatch = Readonly<{ sku?: string | null; salePrice?: number; purchasePrice?: number | null; stock?: number }>;
type Answer = Promise<Result<Product, VariantActionError>>;

export type VariantApi = Readonly<{
  updateVariant: (productId: ProductId, variantId: VariantId, input: VariantPatch) => Answer;
  changeStatus: (productId: ProductId, variantId: VariantId, status: "active" | "inactive") => Answer;
  deleteVariant: (productId: ProductId, variantId: VariantId) => Answer;
}>;

/** The inline editor's three actions: each answers the refreshed product detail (§5.3–5.6). */
export function createVariantOperations(api: VariantApi) {
  return {
    updateVariant: api.updateVariant,
    changeStatus: api.changeStatus,
    deleteVariant: api.deleteVariant,
  };
}
