import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { createProductRequestSchema, productApiErrorSchema, productDetailResponseSchema, productListResponseSchema, productIssueReasonSchema } from "@shared/contracts/products";
import { combinationLabel } from "@shared/product-variants";
import { app } from "@core/src/app";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { deleteSeededProducts, seedProduct } from "@core/src/features/products/infrastructure/product-seed";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Products test server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

const fixtures: { cleanup: () => Promise<void> }[] = [];

async function call(path: string, cookie: string, input?: unknown, method?: string) {
  return fetch(`${base}${path}`, { method: method ?? (input === undefined ? "GET" : "POST"), headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}

async function seller() {
  const companyId = randomUUID();
  const email = `products-api-${randomUUID()}@example.test`;
  const password = "test-password-123";
  await withTenantIsolation(companyId, async () => { await prisma.company.create({ data: { id: companyId, name: "API Products", country: "PE" } }); });
  const headers = { origin, "content-type": "application/json" };
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers, body: JSON.stringify({ name: "Seller", email, password }) });
  expect(signup.status).toBe(200);
  const userId = (await signup.json()).user.id as string;
  await systemPrisma.user.update({ where: { id: userId }, data: { emailVerified: true, companyId } });
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers, body: JSON.stringify({ email, password }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Products test session missing");
  const result = { companyId, cookie, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      await prisma.orderItem.deleteMany();
      await prisma.order.deleteMany();
      await deleteSeededProducts();
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

const options = () => [
  { id: randomUUID(), name: "Talla", values: ["S", "M", "L"].map((name) => ({ id: randomUUID(), name })) },
  { id: randomUUID(), name: "Color", values: ["Negro", "Azul"].map((name) => ({ id: randomUUID(), name })) },
];
const request = (overrides: Record<string, unknown> = {}) => ({ id: randomUUID(), name: "Polo básico", description: null, imageId: null, currency: "PEN", options: [],
  variants: [{ values: [], sku: null, salePrice: 25, purchasePrice: null, initialStock: 3 }], ...overrides });
const variantsOf = (opts: ReturnType<typeof options>, pairs: readonly (readonly [number, number])[]) => pairs.map(([size, color]) => ({
  values: [opts[0].values[size].id, opts[1].values[color].id], sku: null, salePrice: 25, purchasePrice: null, initialStock: 2 }));
const detail = async (cookie: string, id: string) => {
  const response = await call(`/api/products/${id}`, cookie);
  expect(response.status).toBe(200);
  return productDetailResponseSchema.parse(await response.json());
};

test("POST /api/products creates a product without options with one variant", async () => {
  const { cookie } = await seller();
  const body = request({ description: "Algodón", variants: [{ values: [], sku: "POLO-0", salePrice: 25.5, purchasePrice: 10, initialStock: 4 }] });
  expect(createProductRequestSchema.safeParse(body).success).toBe(true);
  const created = await call("/api/products", cookie, body);
  expect(created.status).toBe(201);
  expect(await created.json()).toEqual({ id: body.id });
  const read = await detail(cookie, body.id);
  expect(read.product).toMatchObject({ name: "Polo básico", description: "Algodón", imageId: null, structureVersion: 1, options: [] });
  expect(read.product.variants).toEqual([expect.objectContaining({ combination: [], sku: "POLO-0", status: "active", stock: 4, hasOrders: false,
    salePrice: { amount: 25.5, currency: "PEN" }, purchasePrice: { amount: 10, currency: "PEN" } })]);
  expect((await call("/api/products", cookie, body)).status).toBe(409);
});

test("POST /api/products creates the six combinations in saved order", async () => {
  const { cookie } = await seller();
  const opts = options();
  const pairs = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]] as const;
  const body = request({ options: opts, variants: variantsOf(opts, pairs) });
  expect((await call("/api/products", cookie, body)).status).toBe(201);
  const read = await detail(cookie, body.id);
  expect(read.product.options.map((option) => [option.name, option.values.map((value) => value.name)])).toEqual([["Talla", ["S", "M", "L"]], ["Color", ["Negro", "Azul"]]]);
  expect(read.product.variants.map((variant) => combinationLabel(read.product.options, variant.combination))).toEqual(["S / Negro", "S / Azul", "M / Negro", "M / Azul", "L / Negro", "L / Azul"]);
  expect(new Set(read.product.variants.map((variant) => variant.qrCode)).size).toBe(6);
});

test("POST /api/products stores five variants in saved order and drops the value nobody uses", async () => {
  const { cookie } = await seller();
  const opts = options();
  const pairs = [[0, 0], [1, 0], [1, 1], [2, 0], [2, 1]] as const; // no S / Azul
  const body = request({ options: opts, variants: variantsOf(opts, pairs) });
  expect((await call("/api/products", cookie, body)).status).toBe(201);
  const read = await detail(cookie, body.id);
  expect(read.product.variants).toHaveLength(5);
  expect(read.product.structureVersion).toBe(1);
  expect(read.product.variants.every((variant) => variant.stock === 2)).toBe(true);

  const color = [{ id: randomUUID(), name: "Negro" }, { id: randomUUID(), name: "Azul" }];
  const oneColor = request({ options: [{ id: randomUUID(), name: "Color", values: color }], variants: [{ values: [color[0].id], sku: null, salePrice: 5, purchasePrice: null, initialStock: 0 }] });
  expect((await call("/api/products", cookie, oneColor)).status).toBe(201);
  expect((await detail(cookie, oneColor.id)).product.options[0].values.map((value) => value.name)).toEqual(["Negro"]);
});

test("POST /api/products answers 422 with option, value and variant issues together", async () => {
  const { cookie } = await seller();
  const many = Array.from({ length: 4 }, (_, index) => ({ id: randomUUID(), name: `Opción ${index}`, values: Array.from({ length: index === 0 ? 31 : 1 }, (_, valueIndex) => ({ id: randomUUID(), name: `V${valueIndex}` })) }));
  const variants = Array.from({ length: 101 }, () => ({ values: [], sku: null, salePrice: 1, purchasePrice: null, initialStock: 0 }));
  const response = await call("/api/products", cookie, request({ options: many, variants }));
  expect(response.status).toBe(422);
  const body = productApiErrorSchema.parse(await response.json());
  expect(body.code).toBe("VALIDATION_ERROR");
  const reasons = new Set((body.issues ?? []).map((issue) => issue.reason));
  for (const reason of ["TOO_MANY_OPTIONS", "TOO_MANY_VALUES", "TOO_MANY_VARIANTS"]) expect(reasons.has(reason)).toBe(true);
  expect((body.issues ?? []).every((issue) => productIssueReasonSchema.safeParse(issue.reason).success)).toBe(true);
  expect(body.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ scope: "product", field: "options", reason: "TOO_MANY_OPTIONS", maximum: 3 }),
    expect.objectContaining({ scope: "option", optionIndex: 0, field: "values", reason: "TOO_MANY_VALUES", maximum: 30 }),
  ]));
});

test("POST /api/products reports a repeated SKU on both rows and accepts it in another company", async () => {
  const first = await seller();
  const second = await seller();
  const opts = options();
  const repeated = request({ options: [opts[0]], variants: [0, 1].map((index) => ({ values: [opts[0].values[index].id], sku: "POLO-01", salePrice: 5, purchasePrice: null, initialStock: 0 })) });
  const rejected = await call("/api/products", first.cookie, repeated);
  expect(rejected.status).toBe(422);
  const issues = productApiErrorSchema.parse(await rejected.json()).issues ?? [];
  expect(issues.filter((issue) => issue.reason === "DUPLICATE_SKU")).toEqual([
    expect.objectContaining({ scope: "newVariant", index: 0, field: "sku" }), expect.objectContaining({ scope: "newVariant", index: 1, field: "sku" }),
  ]);
  const single = (id = randomUUID()) => request({ id, variants: [{ values: [], sku: "POLO-01", salePrice: 5, purchasePrice: null, initialStock: 0 }] });
  expect((await call("/api/products", first.cookie, single())).status).toBe(201);
  const taken = await call("/api/products", first.cookie, single());
  expect(taken.status).toBe(422);
  expect(productApiErrorSchema.parse(await taken.json()).issues).toEqual([expect.objectContaining({ scope: "newVariant", index: 0, field: "sku", reason: "DUPLICATE_SKU" })]);
  expect((await call("/api/products", second.cookie, single())).status).toBe(201);
});

test("POST /api/products rejects unknown fields and a missing session", async () => {
  const { cookie } = await seller();
  const unknown = await call("/api/products", cookie, { ...request(), companyId: randomUUID() });
  expect(unknown.status).toBe(400);
  expect(productApiErrorSchema.parse(await unknown.json()).issues).toEqual([expect.objectContaining({ field: "companyId", reason: "UNKNOWN_FIELD" })]);
  expect((await call("/api/products", cookie, { ...request(), variants: [] })).status).toBe(400);
  expect((await fetch(`${base}/api/products`, { headers: { origin } })).status).toBe(401);
});

test("detail reports hasOrders, status and structureVersion", async () => {
  const { companyId, cookie } = await seller();
  const seeded = await withTenantIsolation(companyId, () => seedProduct({ name: "Con pedidos", structureVersion: 4, options: [{ name: "Talla", values: ["S", "M"] }], variants: [
    { attributes: { Talla: "S" }, stock: 5 }, { attributes: { Talla: "M" }, status: "inactive", stock: 1 },
  ] }));
  const sold = seeded.variantIds[0];
  const order = await call("/api/orders/pending", cookie, { id: randomUUID(), items: [{ variantId: sold, quantity: 1 }] });
  expect(order.status).toBe(201);
  const read = await detail(cookie, seeded.productId);
  expect(read.product.structureVersion).toBe(4);
  expect(read.product.variants.map((variant) => [variant.id, variant.status, variant.hasOrders])).toEqual([[seeded.variantIds[0], "active", true], [seeded.variantIds[1], "inactive", false]]);
  expect(read.product.options[0].values.map((value) => value.name)).toEqual(["S", "M"]);
});

test("list reports active variants and no minimum price when every variant is inactive", async () => {
  const { companyId, cookie } = await seller();
  const seeded = await withTenantIsolation(companyId, () => seedProduct({ name: "Sin activas", options: [{ name: "Talla", values: ["S", "M"] }], variants: [
    { attributes: { Talla: "S" }, status: "inactive", salePrice: 8 }, { attributes: { Talla: "M" }, status: "inactive", salePrice: 9, stock: 2 },
  ] }));
  const response = await call("/api/products?search=Sin%20activas", cookie);
  expect(response.status).toBe(200);
  const list = productListResponseSchema.parse(await response.json());
  expect(list.items).toEqual([expect.objectContaining({ id: seeded.productId, variantCount: 2, activeVariantCount: 0, minSalePrice: null, totalStock: 0 })]);
});

test("a product of another company answers 404 like a missing one", async () => {
  const mine = await seller();
  const other = await seller();
  const seeded = await withTenantIsolation(other.companyId, () => seedProduct({ name: "Ajeno" }));
  expect((await call(`/api/products/${seeded.productId}`, mine.cookie)).status).toBe(404);
  expect((await call(`/api/products/${randomUUID()}`, mine.cookie)).status).toBe(404);
  expect((await call(`/api/products/${seeded.productId}`, other.cookie)).status).toBe(200);
});

test("PATCH keeps editing name, description, photo, prices and SKUs without touching the structure", async () => {
  const { companyId, cookie } = await seller();
  const seeded = await withTenantIsolation(companyId, () => seedProduct({ name: "Editable", options: [{ name: "Talla", values: ["S", "M"] }], variants: [
    { attributes: { Talla: "S" }, salePrice: 10 }, { attributes: { Talla: "M" }, salePrice: 12 },
  ] }));
  const response = await call(`/api/products/${seeded.productId}`, cookie, { name: "Editado", variants: [{ id: seeded.variantIds[0], salePrice: 11, sku: "ED-S" }] }, "PATCH");
  expect(response.status).toBe(200);
  const read = await detail(cookie, seeded.productId);
  expect(read.product).toMatchObject({ name: "Editado", structureVersion: 1 });
  expect(read.product.variants[0]).toMatchObject({ sku: "ED-S", salePrice: { amount: 11 } });
  const foreign = await call(`/api/products/${seeded.productId}`, cookie, { variants: [{ id: randomUUID(), salePrice: 1 }] }, "PATCH");
  expect(foreign.status).toBe(422);
  expect(productApiErrorSchema.parse(await foreign.json()).issues).toEqual([expect.objectContaining({ scope: "variant", reason: "VARIANT_NOT_FOUND", field: "id" })]);
});
