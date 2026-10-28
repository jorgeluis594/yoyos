import { err, ok } from "@shared/functional";
import { createProductApi } from "@mobile/features/products/infrastructure/product-api";
import type { ProductId } from "@mobile/features/products/domain/product";

const productId = "00000000-0000-4000-8000-000000000001" as ProductId;
const variantId = "00000000-0000-4000-8000-000000000002";
const variantQr = "00000000-0000-4000-8000-000000000003";
const detail = { product: {
    id: productId, name: "Camisa", description: null, imageId: null, currency: "PEN", qrCode: "00000000-0000-4000-8000-000000000004",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", structureVersion: 1, options: [],
    variants: [{ id: variantId, combination: [], sku: "CAM-S", salePrice: { amount: 20, currency: "PEN" }, purchasePrice: null, qrCode: variantQr, status: "active", stock: 1, hasOrders: false }],
}, image: null };

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
  const item = { id: productId, name: "Camisa", variantCount: 1, activeVariantCount: 1, minSalePrice: { amount: 20, currency: "PEN" }, hasDifferentPrices: false, totalStock: 0 };
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

test("uploads product photos through the shared image client", async () => {
  global.fetch = jest.fn(async () => ({ blob: async () => new Blob(["x"]) })) as unknown as typeof fetch;
  const request = jest.fn(async (_path: string, _init?: RequestInit) => ok<unknown>({ id: "00000000-0000-4000-8000-000000000005", url: "https://cdn.example/a.jpg" }));
  const result = await createProductApi(request, () => 0).uploadImage("file:///a.jpg");
  expect(result).toMatchObject({ success: true, data: { id: "00000000-0000-4000-8000-000000000005" } });
  expect(request.mock.calls[0]?.[0]).toBe("/api/images");
  expect(((request.mock.calls[0]?.[1]?.body) as FormData).get("file")).toHaveProperty("type", "image/jpeg");
});

const optionId = "00000000-0000-4000-8000-000000000010";
const valueId = "00000000-0000-4000-8000-000000000011";
const withOptions = (status: string) => ({ ...detail, product: { ...detail.product, structureVersion: 3,
  options: [{ id: optionId, name: "Talla", values: [{ id: valueId, name: "L" }] }],
  variants: [{ ...detail.product.variants[0], combination: [{ optionId, valueId }], status, hasOrders: true }] } });

test("maps options, combination, structure version and hasOrders from the detail", async () => {
  const result = await createProductApi(async () => ok(withOptions("active")), () => 0).get(productId);
  expect(result).toMatchObject({ success: true, data: { structureVersion: 3, options: [{ name: "Talla", values: [{ name: "L" }] }],
    variants: [{ combination: [{ optionId, valueId }], status: "active", hasOrders: true, stock: 1 }] } });
});

test("an unknown variant status is shown as Desactivada", async () => {
  for (const status of ["inactive", "archived", ""]) {
    const result = await createProductApi(async () => ok(withOptions(status)), () => 0).get(productId);
    expect(result).toMatchObject({ success: true, data: { variants: [{ status: "inactive" }] } });
  }
});

test("a list item without active variants has no price", async () => {
  const request = jest.fn().mockResolvedValue(ok({ page: 1, pageSize: 20, total: 1, items: [{ id: productId, name: "Camisa", variantCount: 2, activeVariantCount: 0, minSalePrice: null, hasDifferentPrices: false, totalStock: 0 }] }));
  const result = await createProductApi(request, () => 0).list({ page: 1, pageSize: 20 });
  expect(result).toMatchObject({ success: true, data: { items: [{ activeVariantCount: 0, price: null }] } });
});

const failure = (status: number, code: string, issues?: unknown) => err({ code: "API_ERROR" as const, message: "HTTP failure", http: { status, body: { code, error: "x", ...(issues ? { issues } : {}) } } });
const createBody = { id: productId, name: "Camisa", description: null, imageId: null, currency: "PEN" as const, options: [], variants: [{ values: [], sku: null, salePrice: 1, purchasePrice: null, initialStock: 0 }] };

test("maps issues by option, value and variant", async () => {
  const issues = [
    { scope: "option", optionIndex: 1, optionId: "o", field: "name", reason: "DUPLICATE_OPTION", message: "x" },
    { scope: "value", optionIndex: 0, valueIndex: 2, valueId: "v", field: "name", reason: "TOO_LONG", maxLength: 30 },
    { scope: "newVariant", index: 4, field: "sku", reason: "DUPLICATE_SKU" },
    { scope: "product", field: "options", reason: "TOO_MANY_OPTIONS", maximum: 3 },
  ];
  const result = await createProductApi(async () => failure(422, "VALIDATION_ERROR", issues), () => 0).create(createBody);
  expect(result).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR", issues } });
});

test("maps every productApiErrorCode to its status and an unknown code to a generic error", async () => {
  const create = (status: number, code: string) => createProductApi(async () => failure(status, code), () => 0).create(createBody);
  for (const [code, status] of [["DUPLICATE_SKU", 409], ["PRODUCT_ID_CONFLICT", 409], ["ID_CONFLICT", 409], ["DUPLICATE_COMBINATION", 409], ["IMAGE_NOT_FOUND", 404], ["VALIDATION_ERROR", 422], ["INVALID_INPUT", 400]] as const)
    expect(await create(status, code)).toMatchObject({ success: false, error: { code } });
  for (const [code, status] of [["SERVICE_UNAVAILABLE", 503], ["INTERNAL_ERROR", 500]] as const)
    expect(await create(status, code)).toMatchObject({ success: false, error: { code: code === "INTERNAL_ERROR" ? "SERVER_ERROR" : code } });
  // A known code with the wrong status is a broken server; an unknown code, or one this call does not take, is generic.
  expect(await create(500, "DUPLICATE_SKU")).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  expect(await create(409, "FUTURE_CODE")).toMatchObject({ success: false, error: { code: "API_ERROR" } });
  expect(await create(409, "PRODUCT_CHANGED")).toMatchObject({ success: false, error: { code: "API_ERROR" } });
  const get = (status: number, code: string) => createProductApi(async () => failure(status, code), () => 0).get(productId);
  expect(await get(404, "PRODUCT_NOT_FOUND")).toMatchObject({ success: false, error: { code: "PRODUCT_NOT_FOUND" } });
});

test("the create request carries the editor contract with nullable fields", async () => {
  const request = jest.fn().mockResolvedValue(ok({ id: productId }));
  expect(await createProductApi(request, () => 0).create(createBody)).toEqual({ success: true, data: productId });
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual(createBody);
  expect(await createProductApi(request, () => 0).create({ ...createBody, variants: [] } as never)).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
});

const saveBody = { structureVersion: 1, name: "Camisa", description: null, imageId: null, options: [], variants: [], newVariants: [], deletedVariantIds: [] };

test("the editor save is a PUT that answers the full detail", async () => {
  const request = jest.fn().mockResolvedValue(ok(withOptions("active")));
  const result = await createProductApi(request, () => 0).save(productId, saveBody);
  expect(request.mock.calls[0][0]).toBe(`/api/products/${productId}`);
  expect(request.mock.calls[0][1]).toMatchObject({ method: "PUT" });
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual(saveBody);
  expect(result).toMatchObject({ success: true, data: { structureVersion: 3, variants: [{ id: variantId }] } });
});

test("the editor save maps its rejections by code", async () => {
  const save = (status: number, code: string) => createProductApi(async () => failure(status, code), () => 0).save(productId, saveBody);
  for (const [code, status] of [["PRODUCT_CHANGED", 409], ["DUPLICATE_SKU", 409], ["DUPLICATE_COMBINATION", 409], ["VARIANT_HAS_ORDERS", 409], ["ID_CONFLICT", 409], ["PRODUCT_NOT_FOUND", 404], ["VALIDATION_ERROR", 422]] as const)
    expect(await save(status, code)).toMatchObject({ success: false, error: { code } });
  expect(await save(409, "PRODUCT_ID_CONFLICT")).toMatchObject({ success: false, error: { code: "API_ERROR" } });
  expect(await save(200, "PRODUCT_CHANGED")).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
});

const variantUrl = `/api/products/${productId}/variants/${variantId}`;

test("the four variant actions use their routes and answer the refreshed detail", async () => {
  const request = jest.fn().mockResolvedValue(ok(withOptions("inactive")));
  const api = createProductApi(request, () => 0);
  const vid = variantId as never;
  expect(await api.updateVariant(productId, vid, { sku: "X", salePrice: 10, purchasePrice: null })).toMatchObject({ success: true, data: { variants: [{ status: "inactive" }] } });
  await api.changeCombination(productId, vid, { values: [{ optionId, newValue: { id: "00000000-0000-4000-8000-000000000012", name: "XL" } }] });
  await api.changeStatus(productId, vid, "inactive");
  await api.deleteVariant(productId, vid);
  expect(request.mock.calls.map(([path, init]) => [path, init.method])).toEqual([
    [variantUrl, "PATCH"], [`${variantUrl}/combination`, "PUT"], [`${variantUrl}/status`, "PUT"], [variantUrl, "DELETE"],
  ]);
  expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ status: "inactive" });
});

test("the variant actions map their rejections by code and refuse a code of another action", async () => {
  const api = (status: number, code: string) => createProductApi(async () => failure(status, code), () => 0);
  const vid = variantId as never;
  for (const [code, status] of [["VARIANT_HAS_ORDERS", 409], ["VARIANT_HAS_STOCK", 409], ["LAST_VARIANT", 409], ["VARIANT_NOT_FOUND", 404], ["PRODUCT_NOT_FOUND", 404]] as const)
    expect(await api(status, code).deleteVariant(productId, vid)).toMatchObject({ success: false, error: { code } });
  expect(await api(409, "DUPLICATE_COMBINATION").changeCombination(productId, vid, { values: [] })).toMatchObject({ success: false, error: { code: "DUPLICATE_COMBINATION" } });
  expect(await api(409, "DUPLICATE_SKU").updateVariant(productId, vid, { sku: "X" })).toMatchObject({ success: false, error: { code: "DUPLICATE_SKU" } });
  expect(await api(409, "PRODUCT_WITHOUT_OPTIONS").changeStatus(productId, vid, "active")).toMatchObject({ success: false, error: { code: "PRODUCT_WITHOUT_OPTIONS" } });
  expect(await api(409, "DUPLICATE_SKU").deleteVariant(productId, vid)).toMatchObject({ success: false, error: { code: "API_ERROR" } });
});
