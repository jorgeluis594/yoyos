import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { Product, VariantId, VariantQrCode } from "@mobile/features/products/domain/product";

export type ProductLabel = Readonly<{
  productName: string;
  sku?: string;
  qrCode: VariantQrCode;
}>;

export type ProductLabelError = Readonly<{
  code: "VARIANT_NOT_FOUND";
  message: string;
}>;

export function prepareProductLabel(product: Product, variantId: VariantId): Result<ProductLabel, ProductLabelError> {
  const variant = product.variants.find((item) => item.id === variantId);
  if (!variant) return err({ code: "VARIANT_NOT_FOUND", message: "Variant does not belong to this product" });
  return ok({ productName: product.name, ...(variant.sku === undefined ? {} : { sku: variant.sku }), qrCode: variant.qrCode });
}
