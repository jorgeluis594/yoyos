import { ok } from "@shared/functional";
import { createProductApi } from "@mobile/features/products/infrastructure/product-api";
import type { ProductId } from "@mobile/features/products/domain/product";

const productId = "00000000-0000-4000-8000-000000000001" as ProductId;
const variantId = "00000000-0000-4000-8000-000000000002";
const variantQr = "00000000-0000-4000-8000-000000000003";
const detail = { product: {
    id: productId, name: "Camisa", currency: "PEN", qrCode: "00000000-0000-4000-8000-000000000004",
    status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    variants: [{ id: variantId, productId, attributes: {}, sku: "CAM-S", salePrice: { amount: 20, currency: "PEN" }, qrCode: variantQr, status: "active", stock: { variantId, quantity: 1 } }],
} };

test("keeps the variant QR from the validated product detail", async () => {
  const api = createProductApi(async () => ok(detail));
  const result = await api.get(productId);
  expect(result.success).toBe(true);
  if (result.success) expect(result.data.variants[0].qrCode).toBe(variantQr);
});

test("shares a concurrent detail read, then fetches fresh data", async () => {
  let finish!: (value: ReturnType<typeof ok<typeof detail>>) => void;
  const request = jest.fn(() => new Promise<ReturnType<typeof ok<typeof detail>>>((resolve) => { finish = resolve; }));
  const api = createProductApi(request);
  const forPrint = api.get(productId);
  const forDetail = api.get(productId);
  expect(request).toHaveBeenCalledTimes(1);
  finish(ok(detail));
  expect((await forPrint).success).toBe(true);
  expect((await forDetail).success).toBe(true);
  const nextRead = api.get(productId);
  expect(request).toHaveBeenCalledTimes(2);
  finish(ok(detail));
  await nextRead;
});
