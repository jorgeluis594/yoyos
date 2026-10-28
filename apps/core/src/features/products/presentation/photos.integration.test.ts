import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { productApiErrorSchema, productDetailResponseSchema } from "@shared/contracts/products";

// The images module reads R2_* at import time, so the URL base is set before the app is imported.
process.env.R2_ENDPOINT ??= "http://127.0.0.1:9";
process.env.R2_BUCKET ??= "test-images";
process.env.R2_ACCESS_KEY_ID ??= "test";
process.env.R2_SECRET_ACCESS_KEY ??= "test";
process.env.R2_PUBLIC_BASE_URL = "http://127.0.0.1:9/test-images";
const { app } = await import("@core/src/app");
const { prisma, systemPrisma, withTenantIsolation } = await import("@core/src/shared/infrastructure/persistance");
const { deleteSeededProducts, seedProduct } = await import("@core/src/features/products/infrastructure/product-seed");
const { products } = await import("@core/src/features/products/composition");
const { productEditing } = await import("@core/src/features/products/product-editing");
const { findSellableVariants } = await import("@core/src/features/products/infrastructure/order-stock");
const { catalogBrowse } = await import("@core/src/features/catalog/browse-composition");
const { findVariantImages } = await import("@core/src/features/products/infrastructure/variant-photo-repository");

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Product photos test server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const fixtures: { cleanup: () => Promise<void> }[] = [];

async function call(path: string, cookie: string, input?: unknown, method?: string) {
  return fetch(`${base}${path}`, { method: method ?? (input === undefined ? "GET" : "POST"), headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}

async function seller() {
  const companyId = randomUUID();
  const email = `product-photos-${randomUUID()}@example.test`;
  const password = "test-password-123";
  await withTenantIsolation(companyId, async () => { await prisma.company.create({ data: { id: companyId, name: "Photos", country: "PE" } }); });
  const headers = { origin, "content-type": "application/json" };
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers, body: JSON.stringify({ name: "Seller", email, password }) });
  expect(signup.status).toBe(200);
  const userId = (await signup.json()).user.id as string;
  await systemPrisma.user.update({ where: { id: userId }, data: { emailVerified: true, companyId } });
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers, body: JSON.stringify({ email, password }) });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Product photos test session missing");
  const result = { companyId, cookie, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      await deleteSeededProducts();
      await prisma.image.deleteMany();
      await systemPrisma.user.delete({ where: { id: userId } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
  fixtures.push(result);
  return result;
}

afterAll(async () => {
  for (const entry of fixtures.reverse()) await entry.cleanup();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await systemPrisma.$disconnect();
});

const storageKey = (id: string) => `images/${id}`;
const urlOf = (id: string) => `http://127.0.0.1:9/test-images/${encodeURIComponent(storageKey(id))}`;
const images = (companyId: string, count: number) => withTenantIsolation(companyId, async () => {
  const ids = Array.from({ length: count }, () => randomUUID());
  for (const id of ids) await prisma.image.create({ data: { id, storageKey: storageKey(id) } });
  return ids;
});
const createBody = (photoIds: readonly string[], overrides: Record<string, unknown> = {}) => ({ id: randomUUID(), name: "Polo", description: null, photoIds, currency: "PEN", options: [],
  variants: [{ values: [], sku: null, salePrice: 25, purchasePrice: null, initialStock: 3 }], ...overrides });
const detail = async (cookie: string, id: string) => {
  const response = await call(`/api/products/${id}`, cookie);
  expect(response.status).toBe(200);
  return productDetailResponseSchema.parse(await response.json());
};
type Detail = Awaited<ReturnType<typeof detail>>;
/** The PUT body of the editor exactly as loaded, ready to edit. */
const formOf = (read: Detail, overrides: Record<string, unknown> = {}) => ({
  structureVersion: read.product.structureVersion, name: read.product.name, description: read.product.description, options: [] as unknown[],
  variants: read.product.variants.map((variant) => ({ id: variant.id, sku: variant.sku, salePrice: variant.salePrice.amount, purchasePrice: variant.purchasePrice?.amount ?? null })),
  newVariants: [] as unknown[], deletedVariantIds: [] as string[], ...overrides,
});
const put = (cookie: string, productId: string, body: unknown) => call(`/api/products/${productId}`, cookie, body, "PUT");
const photoIdsOf = (read: Detail) => read.product.photos.map((photo) => photo.id);

test("PUT /api/products/:id stores the photo list and answers it in the detail in order", async () => {
  const { cookie, companyId } = await seller();
  const [a, b, c] = await images(companyId, 3);
  const body = createBody([a, b, c]);
  expect((await call("/api/products", cookie, body)).status).toBe(201);
  const created = await detail(cookie, body.id);
  expect(created.product.photos).toEqual([a, b, c].map((id) => ({ id, url: urlOf(id) })));
  const updated = await put(cookie, body.id, formOf(created, { photoIds: [c, a] }));
  expect(updated.status).toBe(200);
  const read = productDetailResponseSchema.parse(await updated.json());
  expect(photoIdsOf(read)).toEqual([c, a]);
  expect(read.product.structureVersion).toBe(created.product.structureVersion);
  expect(photoIdsOf(await detail(cookie, body.id))).toEqual([c, a]);
});

test("PUT /api/products/:id without photoIds keeps photos added by another save", async () => {
  const { cookie, companyId } = await seller();
  const [a, b, c] = await images(companyId, 3);
  const body = createBody([a]);
  expect((await call("/api/products", cookie, body)).status).toBe(201);
  const stale = await detail(cookie, body.id);
  expect((await put(cookie, body.id, formOf(stale, { photoIds: [a, b, c] }))).status).toBe(200);
  const priced = await put(cookie, body.id, formOf(stale, { variants: stale.product.variants.map((variant) => ({ id: variant.id, sku: variant.sku, salePrice: 31, purchasePrice: null })) }));
  expect(priced.status).toBe(200);
  const read = await detail(cookie, body.id);
  expect(photoIdsOf(read)).toEqual([a, b, c]);
  expect(read.product.variants[0].salePrice.amount).toBe(31);
});

test("PUT /api/products/:id with a repeated photo answers 422 DUPLICATE_PHOTO with its index", async () => {
  const { cookie, companyId } = await seller();
  const [a] = await images(companyId, 1);
  const body = createBody([a]);
  expect((await call("/api/products", cookie, body)).status).toBe(201);
  const read = await detail(cookie, body.id);
  const response = await put(cookie, body.id, formOf(read, { photoIds: [a, a] }));
  expect(response.status).toBe(422);
  const error = productApiErrorSchema.parse(await response.json());
  expect(error.issues).toEqual([expect.objectContaining({ scope: "photo", field: "photoIds", index: 1, reason: "DUPLICATE_PHOTO" })]);
  expect(photoIdsOf(await detail(cookie, body.id))).toEqual([a]);
});

test("a photo of another company answers PHOTO_NOT_FOUND at its index on create and save and nothing is written", async () => {
  const mine = await seller();
  const theirs = await seller();
  const [own] = await images(mine.companyId, 1);
  const [foreign] = await images(theirs.companyId, 1);
  const rejected = createBody([own, foreign]);
  const response = await call("/api/products", mine.cookie, rejected);
  expect(response.status).toBe(422);
  expect(productApiErrorSchema.parse(await response.json()).issues).toEqual([expect.objectContaining({ scope: "photo", index: 1, reason: "PHOTO_NOT_FOUND" })]);
  expect((await call(`/api/products/${rejected.id}`, mine.cookie)).status).toBe(404);
  const body = createBody([own]);
  expect((await call("/api/products", mine.cookie, body)).status).toBe(201);
  const read = await detail(mine.cookie, body.id);
  const save = await put(mine.cookie, body.id, formOf(read, { photoIds: [own, foreign] }));
  expect(save.status).toBe(422);
  expect(productApiErrorSchema.parse(await save.json()).issues).toEqual([expect.objectContaining({ scope: "photo", index: 1, reason: "PHOTO_NOT_FOUND" })]);
  expect(photoIdsOf(await detail(mine.cookie, body.id))).toEqual([own]);
});

test("POST /api/products with nine photos answers 422 TOO_MANY_PHOTOS and creates nothing", async () => {
  const { cookie, companyId } = await seller();
  const nine = await images(companyId, 9);
  const body = createBody(nine);
  const response = await call("/api/products", cookie, body);
  expect(response.status).toBe(422);
  expect(productApiErrorSchema.parse(await response.json()).issues).toEqual([expect.objectContaining({ scope: "product", field: "photoIds", reason: "TOO_MANY_PHOTOS", maximum: 8 })]);
  expect((await call(`/api/products/${body.id}`, cookie)).status).toBe(404);
  const eight = createBody(nine.slice(0, 8));
  expect((await call("/api/products", cookie, eight)).status).toBe(201);
  expect((await detail(cookie, eight.id)).product.photos).toHaveLength(8);
});

test("two saves with different photo lists leave the last one", async () => {
  const { cookie, companyId } = await seller();
  const [a, b, c] = await images(companyId, 3);
  const body = createBody([a]);
  expect((await call("/api/products", cookie, body)).status).toBe(201);
  const read = await detail(cookie, body.id);
  expect((await put(cookie, body.id, formOf(read, { photoIds: [a, b] }))).status).toBe(200);
  expect((await put(cookie, body.id, formOf(read, { photoIds: [c] }))).status).toBe(200);
  expect(photoIdsOf(await detail(cookie, body.id))).toEqual([c]);
});

test("after a save that moves C first, catalog cards, cart lines and the checkout of an open order show C", async () => {
  const { cookie, companyId } = await seller();
  const [a, b, c] = await images(companyId, 3);
  const body = createBody([a, b, c]);
  expect((await call("/api/products", cookie, body)).status).toBe(201);
  const read = await detail(cookie, body.id);
  expect((await put(cookie, body.id, formOf(read, { photoIds: [c, a, b] }))).status).toBe(200);
  const variantId = read.product.variants[0].id;
  await withTenantIsolation(companyId, async () => {
    const cards = await products.listForCatalog({ currency: "PEN", search: null, offset: 0, limit: 10 });
    expect(cards.success && cards.data.items.map((card) => card.imageUrl)).toEqual([urlOf(c)]);
    const found = await products.findForCatalog(body.id as never, "PEN");
    expect(found.success && found.data?.photoUrls).toEqual([c, a, b].map(urlOf));
    const sellable = await findSellableVariants([variantId]);
    expect(sellable.success && sellable.data.map((item) => item.primaryImageId)).toEqual([c]);
    const checkout = await findVariantImages([variantId as never]);
    expect(checkout).toEqual({ success: true, data: [{ variantId, imageId: c }] });
    const listed = await productEditing.list({ page: 1, pageSize: 20, sort: "recent" } as never, { includeImages: true });
    expect(listed.success && listed.data.items.map((item) => item.image?.id)).toEqual([c]);
  });
});

test("product list, catalog cards and checkout thumbnails show no photo for a product without photos", async () => {
  const { companyId } = await seller();
  const seeded = await withTenantIsolation(companyId, () => seedProduct({ name: "Sin foto" }));
  await withTenantIsolation(companyId, async () => {
    const cards = await products.listForCatalog({ currency: "PEN", search: null, offset: 0, limit: 10 });
    expect(cards.success && cards.data.items.map((card) => card.imageUrl)).toEqual([null]);
    const found = await products.findForCatalog(seeded.productId as never, "PEN");
    expect(found.success && found.data?.photoUrls).toEqual([]);
    const sellable = await findSellableVariants([seeded.variantIds[0]]);
    expect(sellable.success && sellable.data.map((item) => item.primaryImageId)).toEqual([null]);
    expect(await findVariantImages([seeded.variantIds[0] as never])).toEqual({ success: true, data: [{ variantId: seeded.variantIds[0], imageId: null }] });
    const listed = await productEditing.list({ page: 1, pageSize: 20, sort: "recent" } as never, { includeImages: true });
    expect(listed.success && listed.data.items.map((item) => item.image)).toEqual([undefined]);
  });
});

test("the store appearance preview cards show each product's primary photo", async () => {
  const { cookie, companyId } = await seller();
  const [a, b, c] = await images(companyId, 3);
  const first = createBody([a, b]);
  const second = createBody([b, c]);
  const none = createBody([]);
  for (const body of [first, second, none]) expect((await call("/api/products", cookie, body)).status).toBe(201);
  const read = await detail(cookie, first.id);
  expect((await put(cookie, first.id, formOf(read, { photoIds: [b, a] }))).status).toBe(200);
  const cards = await catalogBrowse.previewCards({ companyId: companyId as never });
  expect(cards.success).toBe(true);
  if (!cards.success) return;
  const urlByName = new Map(cards.data.map((card) => [card.id as string, card.imageUrl]));
  expect(urlByName.get(first.id)).toBe(urlOf(b));
  expect(urlByName.get(second.id)).toBe(urlOf(b));
  expect(urlByName.get(none.id)).toBeNull();
});

test("the catalog product page data lists every photo in saved order", async () => {
  const { cookie, companyId } = await seller();
  const [a, b, c] = await images(companyId, 3);
  const body = createBody([b, c, a]);
  expect((await call("/api/products", cookie, body)).status).toBe(201);
  await withTenantIsolation(companyId, async () => {
    const found = await products.findForCatalog(body.id as never, "PEN");
    expect(found.success && found.data?.photoUrls).toEqual([b, c, a].map(urlOf));
  });
});
