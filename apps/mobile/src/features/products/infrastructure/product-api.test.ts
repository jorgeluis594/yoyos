import { ok } from "@shared/functional";
import { createProductApi } from "@mobile/features/products/infrastructure/product-api";
import type { ProductId } from "@mobile/features/products/domain/product";

test("keeps the variant QR from the validated product detail", async () => {
  const productId = "00000000-0000-4000-8000-000000000001";
  const variantId = "00000000-0000-4000-8000-000000000002";
  const variantQr = "00000000-0000-4000-8000-000000000003";
  const api = createProductApi(async () => ok({ product: {
    id: productId, name: "Camisa", currency: "PEN", qrCode: "00000000-0000-4000-8000-000000000004",
    status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    variants: [{ id: variantId, productId, attributes: {}, sku: "CAM-S", salePrice: { amount: 20, currency: "PEN" }, qrCode: variantQr, status: "active", stock: { variantId, quantity: 1 } }],
  } }));
  const result = await api.get(productId as ProductId);
  expect(result.success).toBe(true);
  if (result.success) expect(result.data.variants[0].qrCode).toBe(variantQr);
});
