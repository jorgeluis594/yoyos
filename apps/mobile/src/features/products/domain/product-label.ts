import { err, ok } from "@shared/functional";
import { combinationLabel } from "@shared/product-variants";
import type { Result } from "@shared/result";
import type { Product, VariantId, VariantQrCode } from "@mobile/features/products/domain/product";

export type ProductLabel = Readonly<{ productName: string; /** «L / Azul» in the saved option order; absent for a product without options. */ combination?: string; sku?: string; qrCode: VariantQrCode }>;
export type ProductLabelError = Readonly<{ code: "VARIANT_NOT_FOUND" | "VARIANT_SELECTION_REQUIRED"; message: string }>;

export function prepareProductLabel(product: Product, variantId: VariantId): Result<ProductLabel, ProductLabelError> {
  const variant = product.variants.find((candidate) => candidate.id === variantId);
  if (!variant) return err({ code: "VARIANT_NOT_FOUND", message: "Variant does not belong to this product" });
  const combination = combinationLabel(product.options, variant.combination);
  return ok({ productName: product.name, ...(combination ? { combination } : {}), ...(variant.sku === undefined ? {} : { sku: variant.sku }), qrCode: variant.qrCode });
}
