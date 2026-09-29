import { ok } from "@shared/functional";
import { createProductApi } from "@mobile/features/products/infrastructure/product-api";
import type { ProductId } from "@mobile/features/products/domain/product";

const productId = "00000000-0000-4000-8000-000000000001";
const variantId = "00000000-0000-4000-8000-000000000002";
const qrCode = "00000000-0000-4000-8000-000000000003";

test("keeps the validated variant QR from the saved product response", async () => {
  const request = jest.fn().mockResolvedValue(ok({ product: {
    id: productId, name: "Camisa", currency: "PEN", qrCode: "00000000-0000-4000-8000-000000000004",
    status: "active", createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z",
    variants: [{ id: variantId, productId, attributes: {}, sku: "CAM-S", salePrice: { amount: 10, currency: "PEN" },
      qrCode, status: "active", stock: { variantId, quantity: 3 } }],
  } }));
  const result = await createProductApi(request).get(productId as ProductId);
  expect(result).toMatchObject({ success: true, data: { variants: [{ qrCode, sku: "CAM-S" }] } });
});
