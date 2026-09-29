import { prepareProductLabel } from "@mobile/features/products/domain/product-label";
import type { Product, ProductId, VariantId, VariantQrCode } from "@mobile/features/products/domain/product";

const product = {
  id: "product-1" as ProductId,
  name: "Camisa",
  currency: "PEN",
  variants: [
    { id: "small" as VariantId, attributes: {}, sku: "CAM-S", qrCode: "qr-small" as VariantQrCode, salePrice: { amount: 10, currency: "PEN" as const }, stock: 1 },
    { id: "large" as VariantId, attributes: {}, qrCode: "qr-large" as VariantQrCode, salePrice: { amount: 10, currency: "PEN" as const }, stock: 2 },
  ],
} satisfies Product;

test("prepares only the requested saved variant without inventing a SKU", () => {
  expect(prepareProductLabel(product, "small" as VariantId)).toEqual({
    success: true, data: { productName: "Camisa", sku: "CAM-S", qrCode: "qr-small" as VariantQrCode },
  });
  expect(prepareProductLabel(product, "large" as VariantId)).toEqual({
    success: true, data: { productName: "Camisa", qrCode: "qr-large" as VariantQrCode },
  });
});

test("rejects a variant outside the product", () => {
  expect(prepareProductLabel(product, "other" as VariantId)).toMatchObject({
    success: false, error: { code: "VARIANT_NOT_FOUND" },
  });
  expect(prepareProductLabel({ ...product, variants: [] }, "small" as VariantId)).toMatchObject({
    success: false, error: { code: "VARIANT_NOT_FOUND" },
  });
});
