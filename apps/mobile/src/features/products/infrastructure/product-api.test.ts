import { err, ok } from "@shared/functional";
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
  const api = createProductApi(async () => ok(detail), () => 0);
  const result = await api.get(productId);
  expect(result.success).toBe(true);
  if (result.success) expect(result.data.variants[0].qrCode).toBe(variantQr);
});

test("shares one concurrent detail read within a session, then fetches fresh data", async () => {
  let finish!: (value: ReturnType<typeof ok<typeof detail>>) => void;
  const request = jest.fn()
    .mockImplementationOnce(() => new Promise<ReturnType<typeof ok<typeof detail>>>((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(ok(detail));
  const api = createProductApi(request, () => 0);
  const forPrint = api.get(productId);
  const forDetail = api.get(productId);
  expect(request).toHaveBeenCalledTimes(1);
  finish(ok(detail));
  expect((await forPrint).success).toBe(true);
  expect((await forDetail).success).toBe(true);
  expect((await api.get(productId)).success).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
});

test("does not share a pending detail read across sessions", async () => {
  let generation = 0;
  let finish!: (value: ReturnType<typeof ok<typeof detail>>) => void;
  const request = jest.fn()
    .mockImplementationOnce(() => new Promise<ReturnType<typeof ok<typeof detail>>>((resolve) => { finish = resolve; }))
    .mockImplementationOnce(async () => err({ code: "UNAUTHENTICATED" as const, message: "Session expired" }));
  const api = createProductApi(request, () => generation);
  const formerSession = api.get(productId);
  generation++;
  const currentSession = await api.get(productId);
  expect(request).toHaveBeenCalledTimes(2);
  expect(currentSession).toMatchObject({ success: false, error: { code: "UNAUTHENTICATED" } });
  finish(ok(detail));
  expect((await formerSession).success).toBe(true);
});

test("requests stock filter and sort, and maps listing thumbnails", async () => {
  const imageId = "00000000-0000-4000-8000-000000000005";
  const item = { id: productId, name: "Camisa", variantCount: 1, minSalePrice: { amount: 20, currency: "PEN" }, hasDifferentPrices: false, totalStock: 0 };
  const request = jest.fn().mockResolvedValue(ok({ page: 1, pageSize: 20, total: 2, items: [
    { ...item, image: { id: imageId, url: "https://cdn.example/camisa.webp" } },
    { ...item, id: "00000000-0000-4000-8000-000000000006" },
  ] }));
  const result = await createProductApi(request, () => 0).list({ search: " camisa ", stock: "sold_out", sort: "name", page: 1, pageSize: 20 });
  expect(request.mock.calls[0][0]).toBe("/api/products?page=1&pageSize=20&search=camisa&stock=sold_out&sort=name");
  expect(result).toMatchObject({ success: true, data: { total: 2 } });
  if (!result.success) return;
  expect(result.data.items.map((product) => product.photo ?? null)).toEqual([{ id: imageId, url: "https://cdn.example/camisa.webp" }, null]);
});
