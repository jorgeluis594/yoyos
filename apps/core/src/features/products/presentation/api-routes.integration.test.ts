import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { createProductRequestSchema, productApiErrorSchema, productDetailResponseSchema, productListResponseSchema, productIssueReasonSchema, saveProductResponseSchema } from "@shared/contracts/products";
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
const request = (overrides: Record<string, unknown> = {}) => ({ id: randomUUID(), name: "Polo básico", description: null, photoIds: [], hidden: false, currency: "PEN", options: [],
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
  expect(read.product).toMatchObject({ name: "Polo básico", description: "Algodón", photos: [], structureVersion: 1, options: [] });
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

test("PATCH on the product is gone: the editor saves through PUT and single fields through the variant routes", async () => {
  const { companyId, cookie } = await seller();
  const seeded = await withTenantIsolation(companyId, () => seedProduct({ name: "Intacto" }));
  const response = await call(`/api/products/${seeded.productId}`, cookie, { name: "Editado" }, "PATCH");
  expect(response.status).toBe(404);
  expect((await detail(cookie, seeded.productId)).product.name).toBe("Intacto");
});

type Detail = Awaited<ReturnType<typeof detail>>;

/** The PUT body of the editor exactly as loaded, ready to edit. */
function formOf(read: Detail) {
  const { product } = read;
  return {
    structureVersion: product.structureVersion, name: product.name, description: product.description,
    options: product.options.map((option) => ({ id: option.id, name: option.name, values: option.values.map((value) => ({ id: value.id, name: value.name })) })) as { id: string; name: string; values: { id: string; name: string }[]; valueForExistingVariants?: string }[],
    variants: product.variants.map((variant) => ({ id: variant.id, sku: variant.sku, salePrice: variant.salePrice.amount, purchasePrice: variant.purchasePrice?.amount ?? null })),
    newVariants: [] as { values: string[]; sku: string | null; salePrice: number; purchasePrice: number | null; initialStock: number }[],
    deletedVariantIds: [] as string[],
  };
}

const put = (cookie: string, productId: string, body: unknown) => call(`/api/products/${productId}`, cookie, body, "PUT");
const labels = (read: Detail) => read.product.variants.map((variant) => combinationLabel(read.product.options, variant.combination));

async function poloWithOrder() {
  const fixture = await seller();
  const seeded = await withTenantIsolation(fixture.companyId, () => seedProduct({ name: "Polo", options: [{ name: "Talla", values: ["S", "M"] }, { name: "Color", values: ["Negro", "Azul"] }], variants: [
    { attributes: { Talla: "S", Color: "Negro" }, stock: 3 }, { attributes: { Talla: "S", Color: "Azul" } },
    { attributes: { Talla: "M", Color: "Negro" }, stock: 2 }, { attributes: { Talla: "M", Color: "Azul" } },
  ] }));
  return { ...fixture, seeded };
}

const placeOrder = async (cookie: string, variantId: string) => expect((await call("/api/orders/pending", cookie, { id: randomUUID(), items: [{ variantId, quantity: 1 }] })).status).toBe(201);

test("PUT /api/products adding XL creates XL / Negro and XL / Azul with stock 0 and keeps M / Negro with its id, QR, stock and order", async () => {
  const { cookie, seeded } = await poloWithOrder();
  const sold = seeded.variantIds[2];
  await placeOrder(cookie, sold);
  const before = await detail(cookie, seeded.productId);
  const form = formOf(before);
  const xl = { id: randomUUID(), name: "XL" };
  form.options[0].values.push(xl);
  form.newVariants.push(...[0, 1].map((color) => ({ values: [xl.id, before.product.options[1].values[color].id], sku: null, salePrice: 30, purchasePrice: null, initialStock: 0 })));
  const response = await put(cookie, seeded.productId, form);
  expect(response.status).toBe(200);
  const after = productDetailResponseSchema.parse(await response.json());
  expect(labels(after)).toEqual(["S / Negro", "S / Azul", "M / Negro", "M / Azul", "XL / Negro", "XL / Azul"]);
  expect(after.product.structureVersion).toBe(before.product.structureVersion + 1);
  const kept = after.product.variants.find((variant) => variant.id === sold);
  expect(kept).toMatchObject({ qrCode: before.product.variants[2].qrCode, stock: 2, hasOrders: true });
  expect(after.product.variants.slice(4).map((variant) => [variant.stock, variant.status, variant.hasOrders, variant.salePrice.amount])).toEqual([[0, "active", false, 30], [0, "active", false, 30]]);
  expect(await detail(cookie, seeded.productId)).toEqual(after);
});

test("PUT /api/products adding Manga with a value for the existing variants keeps the ids and gives each one Corta", async () => {
  const { cookie, seeded } = await poloWithOrder();
  const before = await detail(cookie, seeded.productId);
  const form = formOf(before);
  const manga = { id: randomUUID(), name: "Manga", values: [{ id: randomUUID(), name: "Corta" }, { id: randomUUID(), name: "Larga" }], valueForExistingVariants: "" };
  manga.valueForExistingVariants = manga.values[0].id;
  form.options.push(manga);
  form.newVariants.push({ values: [...before.product.options.map((option) => option.values[0].id), manga.values[1].id], sku: null, salePrice: 9, purchasePrice: null, initialStock: 0 });
  const response = await put(cookie, seeded.productId, form);
  expect(response.status).toBe(200);
  const after = productDetailResponseSchema.parse(await response.json());
  expect(labels(after)).toEqual(["S / Negro / Corta", "S / Negro / Larga", "S / Azul / Corta", "M / Negro / Corta", "M / Azul / Corta"]);
  expect(after.product.variants.filter((variant) => variant.id !== after.product.variants[1].id).map((variant) => variant.id)).toEqual(seeded.variantIds);
});

test("PUT /api/products turns a simple product with stock and an order into Talla S / M keeping its QR, stock and order", async () => {
  const { companyId, cookie } = await seller();
  const seeded = await withTenantIsolation(companyId, () => seedProduct({ name: "Simple", variants: [{ stock: 5, sku: "SIMPLE" }] }));
  await placeOrder(cookie, seeded.variantIds[0]);
  const before = await detail(cookie, seeded.productId);
  const form = formOf(before);
  const talla = { id: randomUUID(), name: "Talla", values: [{ id: randomUUID(), name: "S" }, { id: randomUUID(), name: "M" }], valueForExistingVariants: "" };
  talla.valueForExistingVariants = talla.values[0].id;
  form.options.push(talla);
  form.newVariants.push({ values: [talla.values[1].id], sku: null, salePrice: 10, purchasePrice: null, initialStock: 0 });
  const response = await put(cookie, seeded.productId, form);
  expect(response.status).toBe(200);
  const after = productDetailResponseSchema.parse(await response.json());
  expect(labels(after)).toEqual(["S", "M"]);
  expect(after.product.variants[0]).toMatchObject({ id: seeded.variantIds[0], qrCode: before.product.variants[0].qrCode, stock: 5, hasOrders: true, sku: "SIMPLE" });
  expect(after.product.variants[1]).toMatchObject({ stock: 0, hasOrders: false });
});

test("PUT /api/products deleting the single-valued last option makes the product simple", async () => {
  const { companyId, cookie } = await seller();
  const seeded = await withTenantIsolation(companyId, () => seedProduct({ name: "Una talla", options: [{ name: "Talla", values: ["Única"] }], variants: [{ attributes: { Talla: "Única" }, stock: 2 }] }));
  const form = formOf(await detail(cookie, seeded.productId));
  form.options = [];
  const response = await put(cookie, seeded.productId, form);
  expect(response.status).toBe(200);
  const after = productDetailResponseSchema.parse(await response.json());
  expect(after.product.options).toEqual([]);
  expect(after.product.variants).toEqual([expect.objectContaining({ id: seeded.variantIds[0], combination: [], stock: 2 })]);
  expect(await withTenantIsolation(companyId, async () => await prisma.productOptionValue.count({ where: { productId: seeded.productId } }))).toBe(0);
});

test("PUT /api/products saves a renamed value, a reorder and a new option atomically", async () => {
  const { cookie, seeded } = await poloWithOrder();
  const before = await detail(cookie, seeded.productId);
  const form = formOf(before);
  form.name = "Polo clásico";
  form.options[1].values[0].name = "Negro carbón";
  form.options[0].values.reverse();
  form.options.reverse();
  const manga = { id: randomUUID(), name: "Manga", values: [{ id: randomUUID(), name: "Corta" }], valueForExistingVariants: "" };
  manga.valueForExistingVariants = manga.values[0].id;
  form.options.push(manga);
  const response = await put(cookie, seeded.productId, form);
  expect(response.status).toBe(200);
  const after = productDetailResponseSchema.parse(await response.json());
  expect(after.product.name).toBe("Polo clásico");
  expect(after.product.options.map((option) => [option.name, option.values.map((value) => value.name)])).toEqual([["Color", ["Negro carbón", "Azul"]], ["Talla", ["M", "S"]], ["Manga", ["Corta"]]]);
  expect(labels(after)).toEqual(["Negro carbón / M / Corta", "Negro carbón / S / Corta", "Azul / M / Corta", "Azul / S / Corta"]);
  expect(after.product.structureVersion).toBe(before.product.structureVersion + 1);
  expect(new Set(after.product.variants.map((variant) => variant.id))).toEqual(new Set(seeded.variantIds));
});

test("PUT with a stale structureVersion answers 409 PRODUCT_CHANGED and keeps the values another device added", async () => {
  const { cookie, seeded } = await poloWithOrder();
  const stale = formOf(await detail(cookie, seeded.productId));
  const device = formOf(await detail(cookie, seeded.productId));
  const xl = { id: randomUUID(), name: "XL" };
  device.options[0].values.push(xl);
  device.newVariants.push(...[0, 1].map((color) => ({ values: [xl.id, device.options[1].values[color].id], sku: null, salePrice: 5, purchasePrice: null, initialStock: 0 })));
  expect((await put(cookie, seeded.productId, device)).status).toBe(200);
  const rejected = await put(cookie, seeded.productId, { ...stale, name: "Desde el teléfono viejo" });
  expect(rejected.status).toBe(409);
  expect(productApiErrorSchema.parse(await rejected.json()).code).toBe("PRODUCT_CHANGED");
  const after = await detail(cookie, seeded.productId);
  expect(after.product.name).toBe("Polo");
  expect(labels(after)).toEqual(["S / Negro", "S / Azul", "M / Negro", "M / Azul", "XL / Negro", "XL / Azul"]);
});

test("PUT deleting value Azul whose M / Azul has an order answers 422 VARIANT_HAS_ORDERS and writes nothing", async () => {
  const { cookie, seeded } = await poloWithOrder();
  await placeOrder(cookie, seeded.variantIds[3]);
  const before = await detail(cookie, seeded.productId);
  const form = formOf(before);
  form.name = "No debe guardarse";
  form.options[1].values = form.options[1].values.filter((value) => value.name !== "Azul");
  form.deletedVariantIds = [seeded.variantIds[1], seeded.variantIds[3]];
  form.variants = form.variants.filter((variant) => !form.deletedVariantIds.includes(variant.id));
  const response = await put(cookie, seeded.productId, form);
  expect(response.status).toBe(422);
  const body = productApiErrorSchema.parse(await response.json());
  expect(body.issues).toEqual([expect.objectContaining({ scope: "variant", variantId: seeded.variantIds[3], reason: "VARIANT_HAS_ORDERS" })]);
  expect(await detail(cookie, seeded.productId)).toEqual(before);
});

test("PUT marking Azul with its variants and deleting Color turns the remaining variants into Talla-only variants", async () => {
  const { companyId, cookie, seeded } = await poloWithOrder();
  const before = await detail(cookie, seeded.productId);
  const form = formOf(before);
  form.options = form.options.filter((option) => option.name !== "Color");
  form.deletedVariantIds = [seeded.variantIds[1], seeded.variantIds[3]];
  form.variants = form.variants.filter((variant) => !form.deletedVariantIds.includes(variant.id));
  const response = await put(cookie, seeded.productId, form);
  expect(response.status).toBe(200);
  const after = productDetailResponseSchema.parse(await response.json());
  expect(after.product.options.map((option) => option.name)).toEqual(["Talla"]);
  expect(after.product.variants.map((variant) => variant.id)).toEqual([seeded.variantIds[0], seeded.variantIds[2]]);
  expect(labels(after)).toEqual(["S", "M"]);
  expect(await withTenantIsolation(companyId, async () => await prisma.productVariant.count({ where: { productId: seeded.productId } }))).toBe(2);
  expect(await withTenantIsolation(companyId, async () => await prisma.productOptionValue.count({ where: { productId: seeded.productId } }))).toBe(2);
});

test("PUT adding XL and then removing both XL rows stores no XL", async () => {
  const { companyId, cookie, seeded } = await poloWithOrder();
  const before = await detail(cookie, seeded.productId);
  const form = formOf(before);
  form.options[0].values.push({ id: randomUUID(), name: "XL" });
  const response = await put(cookie, seeded.productId, form);
  expect(response.status).toBe(200);
  const after = productDetailResponseSchema.parse(await response.json());
  expect(after.product.options[0].values.map((value) => value.name)).toEqual(["S", "M"]);
  expect(after.product.structureVersion).toBe(before.product.structureVersion);
  expect(await withTenantIsolation(companyId, async () => await prisma.productOptionValue.count({ where: { productId: seeded.productId, name: "XL" } }))).toBe(0);
});

test("PUT returns 422 with option, value and variant issues together", async () => {
  const { cookie, seeded } = await poloWithOrder();
  const form = formOf(await detail(cookie, seeded.productId));
  form.options[0].name = "  ";
  form.options[1].values[1].name = form.options[1].values[0].name;
  form.variants[0].salePrice = -1;
  form.newVariants.push({ values: [form.options[0].values[0].id], sku: null, salePrice: 1, purchasePrice: null, initialStock: 0 });
  const response = await put(cookie, seeded.productId, form);
  expect(response.status).toBe(422);
  const body = productApiErrorSchema.parse(await response.json());
  expect(body.code).toBe("VALIDATION_ERROR");
  expect(body.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ scope: "option", optionIndex: 0, field: "name", reason: "REQUIRED" }),
    expect.objectContaining({ scope: "value", optionIndex: 1, valueIndex: 1, reason: "DUPLICATE_VALUE" }),
    expect.objectContaining({ scope: "variant", variantId: seeded.variantIds[0], field: "salePrice", reason: "INVALID_PRICE" }),
    expect.objectContaining({ scope: "newVariant", index: 0, field: "values", reason: "INVALID_COMBINATION" }),
  ]));
});

test("PUT answers 422 DUPLICATE_SKU when another product holds the SKU and 400 for an unknown field", async () => {
  const { companyId, cookie, seeded } = await poloWithOrder();
  await withTenantIsolation(companyId, () => seedProduct({ name: "Dueño", variants: [{ sku: "OCUPADO" }] }));
  const form = formOf(await detail(cookie, seeded.productId));
  form.variants[0].sku = "ocupado";
  const duplicate = await put(cookie, seeded.productId, form);
  expect(duplicate.status).toBe(422);
  expect(productApiErrorSchema.parse(await duplicate.json()).issues).toEqual([expect.objectContaining({ scope: "variant", variantId: seeded.variantIds[0], field: "sku", reason: "DUPLICATE_SKU" })]);
  expect((await put(cookie, seeded.productId, { ...formOf(await detail(cookie, seeded.productId)), color: "rojo" })).status).toBe(400);
  expect((await put(cookie, "no-es-uuid", formOf(await detail(cookie, seeded.productId)))).status).toBe(400);
});

test("PUT on a product of another company answers 404", async () => {
  const mine = await seller();
  const other = await poloWithOrder();
  const form = formOf(await detail(other.cookie, other.seeded.productId));
  const response = await put(mine.cookie, other.seeded.productId, { ...form, name: "Robado" });
  expect(response.status).toBe(404);
  expect(productApiErrorSchema.parse(await response.json()).code).toBe("PRODUCT_NOT_FOUND");
  expect((await detail(other.cookie, other.seeded.productId)).product.name).toBe("Polo");
  expect((await put(mine.cookie, randomUUID(), form)).status).toBe(404);
});

async function publishCatalog(companyId: string, published: boolean) {
  await withTenantIsolation(companyId, async () => { await prisma.company.update({ where: { id: companyId }, data: { catalogSubdomain: `t0-${randomUUID().slice(0, 8)}`, catalogPublished: published } }); });
}
const hide = (cookie: string, read: Detail, hidden?: boolean) => put(cookie, read.product.id, { ...formOf(read), ...(hidden === undefined ? {} : { hidden }) });

test("creating a hidden product stores it hidden", async () => {
  const { cookie } = await seller();
  const body = request({ hidden: true });
  expect((await call("/api/products", cookie, body)).status).toBe(201);
  expect((await detail(cookie, body.id)).product).toMatchObject({ hidden: true, structureVersion: 1 });
  expect((await call("/api/products", cookie, { ...request(), hidden: undefined })).status).toBe(400);
});

test("saving with hidden true hides the product and returns it hidden", async () => {
  const { cookie, seeded } = await poloWithOrder();
  const before = await detail(cookie, seeded.productId);
  expect(before.product.hidden).toBe(false);
  const response = await hide(cookie, before, true);
  expect(response.status).toBe(200);
  const saved = saveProductResponseSchema.parse(await response.json());
  expect(saved.product.hidden).toBe(true);
  expect(saved.product.structureVersion).toBe(before.product.structureVersion);
  expect((await detail(cookie, seeded.productId)).product.hidden).toBe(true);
});

test("saving without hidden keeps the stored visibility", async () => {
  const { cookie, seeded } = await poloWithOrder();
  const form = formOf(await detail(cookie, seeded.productId));
  expect((await put(cookie, seeded.productId, { ...form, hidden: true })).status).toBe(200);
  const typo = await put(cookie, seeded.productId, { ...form, description: "Con corrección" });
  expect(typo.status).toBe(200);
  expect(saveProductResponseSchema.parse(await typo.json()).product).toMatchObject({ hidden: true, description: "Con corrección" });
  expect((await put(cookie, seeded.productId, { ...form, description: "Con corrección", hidden: false })).status).toBe(200);
  expect((await detail(cookie, seeded.productId)).product.hidden).toBe(false);
});

test("hiding the last offered product of a published catalog returns catalogEmptied true", async () => {
  const { cookie, companyId, seeded } = await poloWithOrder();
  await publishCatalog(companyId, true);
  const other = await withTenantIsolation(companyId, () => seedProduct({ name: "Casaca jean", hidden: true }));
  const response = await hide(cookie, await detail(cookie, seeded.productId), true);
  expect(saveProductResponseSchema.parse(await response.json()).catalogEmptied).toBe(true);
  // Showing the other one and hiding Polo again leaves another offered product, so there is nothing to announce.
  expect((await hide(cookie, await detail(cookie, seeded.productId), false)).status).toBe(200);
  expect((await hide(cookie, await detail(cookie, other.productId), false)).status).toBe(200);
  const second = await hide(cookie, await detail(cookie, seeded.productId), true);
  expect(saveProductResponseSchema.parse(await second.json()).catalogEmptied).toBe(false);
});

test("hiding the last offered product of an unpublished catalog returns catalogEmptied false", async () => {
  const { cookie, companyId, seeded } = await poloWithOrder();
  await publishCatalog(companyId, false);
  const response = await hide(cookie, await detail(cookie, seeded.productId), true);
  expect(saveProductResponseSchema.parse(await response.json())).toMatchObject({ catalogEmptied: false, product: { hidden: true } });
});

test("hiding a product without active variants or saving an already hidden one returns catalogEmptied false", async () => {
  const { cookie, companyId } = await seller();
  await publishCatalog(companyId, true);
  const inactive = await withTenantIsolation(companyId, () => seedProduct({ name: "Sin variantes", variants: [{ attributes: { Talla: "S" }, status: "inactive" }, { attributes: { Talla: "M" }, status: "inactive" }] }));
  const sold = await withTenantIsolation(companyId, () => seedProduct({ name: "Casaca jean" }));
  const first = await hide(cookie, await detail(cookie, inactive.productId), true);
  expect(saveProductResponseSchema.parse(await first.json()).catalogEmptied).toBe(false);
  expect((await hide(cookie, await detail(cookie, sold.productId), true)).status).toBe(200);
  const again = await hide(cookie, await detail(cookie, sold.productId), true);
  expect(saveProductResponseSchema.parse(await again.json()).catalogEmptied).toBe(false);
});

test("product list returns hidden for each product", async () => {
  const { cookie, companyId } = await seller();
  await withTenantIsolation(companyId, async () => { await seedProduct({ name: "A visible" }); await seedProduct({ name: "B oculto", hidden: true }); });
  const list = productListResponseSchema.parse(await (await call("/api/products?sort=name", cookie)).json());
  expect(list.items.map((item) => [item.name, item.hidden])).toEqual([["A visible", false], ["B oculto", true]]);
});

test("another company cannot read or change a product's visibility", async () => {
  const mine = await seller();
  const other = await poloWithOrder();
  const form = formOf(await detail(other.cookie, other.seeded.productId));
  expect((await put(mine.cookie, other.seeded.productId, { ...form, hidden: true })).status).toBe(404);
  expect((await call(`/api/products/${other.seeded.productId}`, mine.cookie)).status).toBe(404);
  expect((await detail(other.cookie, other.seeded.productId)).product.hidden).toBe(false);
});

test("readiness reports all products hidden", async () => {
  const { cookie, companyId } = await seller();
  const readiness = async () => ((await (await call("/api/products/search-readiness", cookie)).json()) as { version: number; state: string });
  expect((await readiness()).state).toBe("no_active_products");
  await withTenantIsolation(companyId, async () => { await seedProduct({ name: "Casaca jean", hidden: true }); });
  expect(await readiness()).toEqual({ version: 1, state: "all_products_hidden" });
});
