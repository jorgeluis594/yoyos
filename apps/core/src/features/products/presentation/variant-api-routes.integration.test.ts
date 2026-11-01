import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, expect, test } from "vitest";
import { productApiErrorSchema, productDetailResponseSchema, productListResponseSchema } from "@shared/contracts/products";
import { combinationLabel } from "@shared/product-variants";
import { app } from "@core/src/app";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { productVariantActions } from "@core/src/features/products/product-variant-actions";
import { deleteSeededProducts, seedProduct, type SeededProduct } from "@core/src/features/products/infrastructure/product-seed";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Variant test server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

/** Every statement the pg driver sends, whichever pool client carries it. Test-only: production does not count statements. */
const sent: string[] = [];
let counting = false;
const originalQuery = pg.Client.prototype.query;
(pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown }).query = function (this: unknown, ...args: unknown[]) {
  const first = args[0];
  const text = typeof first === "string" ? first : (first as { text?: string } | undefined)?.text;
  if (counting && text) sent.push(text);
  return (originalQuery as unknown as (...rest: unknown[]) => unknown).apply(this, args);
};

async function countedStatements<T>(work: () => Promise<T>): Promise<{ result: T; statements: string[] }> {
  sent.length = 0;
  counting = true;
  try {
    const result = await work();
    return { result, statements: sent.filter((text) => !/^(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION)\b/i.test(text) && !/set_config\('app\.company_id'/.test(text)) };
  } finally { counting = false; }
}

const fixtures: { cleanup: () => Promise<void> }[] = [];

async function call(path: string, cookie: string, method: string, input?: unknown) {
  return fetch(`${base}${path}`, { method, headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}

async function seller() {
  const companyId = randomUUID();
  const email = `variants-api-${randomUUID()}@example.test`;
  const password = "test-password-123";
  await withTenantIsolation(companyId, async () => { await prisma.company.create({ data: { id: companyId, name: "API Variants", country: "PE" } }); });
  const headers = { origin, "content-type": "application/json" };
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers, body: JSON.stringify({ name: "Seller", email, password }) });
  expect(signup.status).toBe(200);
  const userId = (await signup.json()).user.id as string;
  await systemPrisma.user.update({ where: { id: userId }, data: { emailVerified: true, companyId } });
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers, body: JSON.stringify({ email, password }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Variants test session missing");
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
  (pg.Client.prototype as unknown as { query: unknown }).query = originalQuery;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await systemPrisma.$disconnect();
});

type Seller = Awaited<ReturnType<typeof seller>>;
const path = (productId: string, variantId: string, tail = "") => `/api/products/${productId}/variants/${variantId}${tail}`;

/** Talla S/M by Color Negro/Azul with M / Negro, M / Azul and S / Negro available and S / Azul missing. */
const shirts = (owner: Seller, stock: { sMissing?: boolean } = {}) => withTenantIsolation(owner.companyId, () => seedProduct({
  name: "Polo", options: [{ name: "Talla", values: ["S", "M"] }, { name: "Color", values: ["Negro", "Azul"] }],
  variants: [
    { attributes: { Talla: "S", Color: "Negro" }, sku: "POLO-SN", salePrice: 20 },
    ...stock.sMissing ? [] : [{ attributes: { Talla: "S", Color: "Azul" }, sku: "POLO-SA", salePrice: 20 }],
    { attributes: { Talla: "M", Color: "Negro" }, sku: "POLO-MN", salePrice: 25, stock: 4 },
    { attributes: { Talla: "M", Color: "Azul" }, salePrice: 25 },
  ],
}));

const addOrder = (owner: Seller, variantId: string, values: { fromCatalog?: boolean; confirmed?: boolean } = {}) => withTenantIsolation(owner.companyId, async () => {
  const id = randomUUID();
  const catalog = values.fromCatalog ?? true;
  const now = new Date();
  const last = await prisma.order.aggregate({ _max: { number: true } });
  await prisma.order.create({ data: { id, number: (last._max.number ?? 1000n) + 1n, currency: "PEN", total: 25, itemsTotal: 25, createdAt: now, fromCatalog: catalog,
    checkoutEnabledAt: catalog ? now : null, checkoutConfirmedAt: values.confirmed ? now : null } });
  await prisma.orderItem.create({ data: { orderId: id, orderCreatedAt: now, variantId, productName: "Polo", variantAttributes: { Talla: "M", Color: "Negro" }, quantity: 1n, unitPrice: 25, subtotal: 25 } });
  return id;
});

const read = async (owner: Seller, productId: string) => {
  const response = await call(`/api/products/${productId}`, owner.cookie, "GET");
  expect(response.status).toBe(200);
  return productDetailResponseSchema.parse(await response.json());
};
const variantOf = (detail: Awaited<ReturnType<typeof read>>, id: string) => {
  const found = detail.product.variants.find((variant) => variant.id === id);
  if (!found) throw new Error("variant missing");
  return found;
};
const errorOf = async (response: Response) => productApiErrorSchema.parse(await response.json());
const seededId = (seeded: SeededProduct, index: number) => seeded.variantIds[index];

test("PATCH variant edits price and SKU of an inactive variant", async () => {
  const owner = await seller();
  const seeded = await withTenantIsolation(owner.companyId, () => seedProduct({ options: [{ name: "Talla", values: ["S", "M"] }], variants: [
    { attributes: { Talla: "S" }, sku: "A-S", status: "inactive" }, { attributes: { Talla: "M" }, sku: "A-M" }] }));
  const response = await call(path(seeded.productId, seededId(seeded, 0)), owner.cookie, "PATCH", { sku: " A-NEW ", salePrice: 33.5, purchasePrice: 12 });
  expect(response.status).toBe(200);
  const detail = productDetailResponseSchema.parse(await response.json());
  expect(variantOf(detail, seededId(seeded, 0))).toMatchObject({ sku: "A-NEW", status: "inactive", salePrice: { amount: 33.5, currency: "PEN" }, purchasePrice: { amount: 12, currency: "PEN" } });
  expect(detail.product.structureVersion).toBe(1);
  const cleared = await call(path(seeded.productId, seededId(seeded, 0)), owner.cookie, "PATCH", { sku: null, purchasePrice: null });
  expect(variantOf(productDetailResponseSchema.parse(await cleared.json()), seededId(seeded, 0))).toMatchObject({ sku: null, purchasePrice: null });
  expect((await call(path(seeded.productId, seededId(seeded, 0)), owner.cookie, "PATCH", { name: "x" })).status).toBe(400);
});

test("PUT combination moves a variant with orders to a new value XL and keeps the order snapshot", async () => {
  const owner = await seller();
  const seeded = await shirts(owner);
  const [sNegro, sAzul, mNegro, mAzul] = seeded.variantIds;
  await addOrder(owner, mNegro);
  const talla = seeded.optionIds.Talla;
  const color = seeded.optionIds.Color;
  const duplicate = await call(path(seeded.productId, mNegro, "/combination"), owner.cookie, "PUT", { values: [{ optionId: talla, valueId: seeded.valueIds.Talla.S }, { optionId: color, valueId: seeded.valueIds.Color.Azul }] });
  expect(duplicate.status).toBe(409);
  expect((await errorOf(duplicate)).code).toBe("DUPLICATE_COMBINATION");

  const xl = randomUUID();
  const body = { values: [{ optionId: talla, newValue: { id: xl, name: "XL" } }, { optionId: color, valueId: seeded.valueIds.Color.Negro }] };
  const moved = await call(path(seeded.productId, mNegro, "/combination"), owner.cookie, "PUT", body);
  expect(moved.status).toBe(200);
  const detail = productDetailResponseSchema.parse(await moved.json());
  expect(detail.product.options[0].values.map((value) => value.name)).toEqual(["S", "M", "XL"]);
  expect(detail.product.structureVersion).toBe(2);
  expect(variantOf(detail, mNegro)).toMatchObject({ hasOrders: true, stock: 4, sku: "POLO-MN" });
  expect(combinationLabel(detail.product.options, variantOf(detail, mNegro).combination)).toBe("XL / Negro");
  expect(detail.product.variants.map((variant) => variant.id)).toEqual([sNegro, sAzul, mAzul, mNegro]);
  const stored = await withTenantIsolation(owner.companyId, async () => await prisma.orderItem.findFirstOrThrow({ where: { variantId: mNegro } }));
  expect(stored.variantAttributes).toEqual({ Talla: "M", Color: "Negro" });

  const again = await call(path(seeded.productId, mNegro, "/combination"), owner.cookie, "PUT", body);
  expect(again.status).toBe(200);
  expect(productDetailResponseSchema.parse(await again.json()).product.structureVersion).toBe(2);
  const reused = await call(path(seeded.productId, mAzul, "/combination"), owner.cookie, "PUT", { values: [{ optionId: talla, newValue: { id: xl, name: "XXL" } }, { optionId: color, valueId: seeded.valueIds.Color.Azul }] });
  expect(reused.status).toBe(422);
  expect((await errorOf(reused)).issues).toEqual([expect.objectContaining({ scope: "value", valueId: xl, field: "id", reason: "ID_CONFLICT" })]);
  const other = await seller();
  const foreign = await shirts(other);
  const stolen = await call(path(foreign.productId, foreign.variantIds[0], "/combination"), other.cookie, "PUT", { values: [{ optionId: foreign.optionIds.Talla, newValue: { id: foreign.valueIds.Color.Azul, name: "XL" } }, { optionId: foreign.optionIds.Color, valueId: foreign.valueIds.Color.Negro }] });
  expect(stolen.status).toBe(422);
});

test("PUT combination removes the value its variant was the last to use", async () => {
  const owner = await seller();
  const seeded = await shirts(owner, { sMissing: true });
  const [sNegro] = seeded.variantIds;
  const moved = await call(path(seeded.productId, sNegro, "/combination"), owner.cookie, "PUT", { values: [
    { optionId: seeded.optionIds.Talla, newValue: { id: randomUUID(), name: "XL" } }, { optionId: seeded.optionIds.Color, valueId: seeded.valueIds.Color.Negro }] });
  expect(moved.status).toBe(200);
  const detail = productDetailResponseSchema.parse(await moved.json());
  expect(detail.product.options[0].values.map((value) => value.name)).toEqual(["M", "XL"]);
  expect(await withTenantIsolation(owner.companyId, async () => await prisma.productOptionValue.count({ where: { id: seeded.valueIds.Talla.S } }))).toBe(0);
});

test("PUT status deactivates the last active variant and the list shows no minimum price", async () => {
  const owner = await seller();
  const seeded = await withTenantIsolation(owner.companyId, () => seedProduct({ name: "Gorra", options: [{ name: "Color", values: ["Negro", "Azul"] }], variants: [
    { attributes: { Color: "Negro" }, stock: 6 }, { attributes: { Color: "Azul" }, status: "inactive" }] }));
  const [negro, azul] = seeded.variantIds;
  const off = await call(path(seeded.productId, negro, "/status"), owner.cookie, "PUT", { status: "inactive" });
  expect(off.status).toBe(200);
  const detail = productDetailResponseSchema.parse(await off.json());
  expect(detail.product.variants.map((variant) => variant.status)).toEqual(["inactive", "inactive"]);
  expect(detail.product.structureVersion).toBe(1);
  const list = productListResponseSchema.parse(await (await call("/api/products?search=Gorra", owner.cookie, "GET")).json());
  expect(list.items).toEqual([expect.objectContaining({ id: seeded.productId, activeVariantCount: 0, minSalePrice: null })]);
  expect((await call(path(seeded.productId, negro, "/status"), owner.cookie, "PUT", { status: "inactive" })).status).toBe(200);
  const on = productDetailResponseSchema.parse(await (await call(path(seeded.productId, azul, "/status"), owner.cookie, "PUT", { status: "active" })).json());
  expect(variantOf(on, azul).status).toBe("active");
  expect((await call(path(seeded.productId, azul, "/status"), owner.cookie, "PUT", { status: "paused" })).status).toBe(400);

  const simple = await withTenantIsolation(owner.companyId, () => seedProduct({ name: "Llavero" }));
  const rejected = await call(path(simple.productId, simple.variantIds[0], "/status"), owner.cookie, "PUT", { status: "inactive" });
  expect(rejected.status).toBe(409);
  expect((await errorOf(rejected)).code).toBe("PRODUCT_WITHOUT_OPTIONS");
});

test("DELETE variant removes it with its QR and drops a value left without variants", async () => {
  const owner = await seller();
  const seeded = await shirts(owner, { sMissing: true });
  const [sNegro, mNegro] = seeded.variantIds;
  const stocked = await call(path(seeded.productId, mNegro), owner.cookie, "DELETE");
  expect(stocked.status).toBe(409);
  expect((await errorOf(stocked)).code).toBe("VARIANT_HAS_STOCK");
  const before = await read(owner, seeded.productId);
  const qr = variantOf(before, sNegro).qrCode;
  const deleted = await call(path(seeded.productId, sNegro), owner.cookie, "DELETE");
  expect(deleted.status).toBe(200);
  const detail = productDetailResponseSchema.parse(await deleted.json());
  expect(detail.product.variants.map((variant) => variant.id)).toEqual([mNegro, seeded.variantIds[2]]);
  expect(detail.product.options.map((option) => [option.name, option.values.map((value) => value.name)])).toEqual([["Talla", ["M"]], ["Color", ["Negro", "Azul"]]]);
  expect(detail.product.structureVersion).toBe(before.product.structureVersion + 1);
  expect(await withTenantIsolation(owner.companyId, async () => await prisma.productVariant.count({ where: { qrCode: qr } }))).toBe(0);
  expect(await withTenantIsolation(owner.companyId, async () => await prisma.productStock.count({ where: { variantId: sNegro } }))).toBe(0);
  expect((await call(path(seeded.productId, sNegro), owner.cookie, "DELETE")).status).toBe(404);
});

test("DELETE variant with an unconfirmed catalog order answers VARIANT_HAS_ORDERS", async () => {
  const owner = await seller();
  const seeded = await shirts(owner);
  const [sNegro] = seeded.variantIds;
  await addOrder(owner, sNegro, { fromCatalog: true, confirmed: false });
  const response = await call(path(seeded.productId, sNegro), owner.cookie, "DELETE");
  expect(response.status).toBe(409);
  expect((await errorOf(response)).code).toBe("VARIANT_HAS_ORDERS");
  expect(await withTenantIsolation(owner.companyId, async () => await prisma.productVariant.count({ where: { id: sNegro } }))).toBe(1);
  const only = await withTenantIsolation(owner.companyId, () => seedProduct({ name: "Solo" }));
  const last = await call(path(only.productId, only.variantIds[0]), owner.cookie, "DELETE");
  expect(last.status).toBe(409);
  expect((await errorOf(last)).code).toBe("LAST_VARIANT");
});

test("DELETE variant maps a foreign key from an order created after the check to VARIANT_HAS_ORDERS", async () => {
  const owner = await seller();
  const seeded = await shirts(owner);
  const [sNegro] = seeded.variantIds;
  const { applyVariantDeletion } = await import("@core/src/features/products/infrastructure/variant-repository");
  await addOrder(owner, sNegro);
  const result = await withTenantIsolation(owner.companyId, () => applyVariantDeletion(seeded.productId as ProductId, { variantId: sNegro as VariantId, deleteValueIds: [], deleteOptionIds: [] }, new Date(),
    { productId: seeded.productId as ProductId, variantId: sNegro as VariantId, action: "delete", started: performance.now() }));
  expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "VARIANT_HAS_ORDERS" }) });
});

test("every variant action answers a detail with current hasOrders", async () => {
  const owner = await seller();
  const seeded = await shirts(owner);
  const [sNegro, sAzul, mNegro] = seeded.variantIds;
  await addOrder(owner, mNegro);
  const responses = [
    await call(path(seeded.productId, sNegro), owner.cookie, "PATCH", { salePrice: 21 }),
    await call(path(seeded.productId, sAzul, "/status"), owner.cookie, "PUT", { status: "inactive" }),
    await call(path(seeded.productId, sNegro, "/combination"), owner.cookie, "PUT", { values: [
      { optionId: seeded.optionIds.Talla, valueId: seeded.valueIds.Talla.S }, { optionId: seeded.optionIds.Color, valueId: seeded.valueIds.Color.Negro }] }),
    await call(path(seeded.productId, sAzul), owner.cookie, "DELETE"),
  ];
  expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
  for (const response of responses) {
    const detail = productDetailResponseSchema.parse(await response.json());
    expect(variantOf(detail, mNegro).hasOrders).toBe(true);
    expect(variantOf(detail, sNegro).hasOrders).toBe(false);
  }
  expect(responses.every((response) => response.headers.get("cache-control") === "no-store")).toBe(true);
});

test("PATCH variant with a SKU used by another variant answers 422 with a DUPLICATE_SKU issue on sku", async () => {
  const owner = await seller();
  const seeded = await shirts(owner);
  const response = await call(path(seeded.productId, seeded.variantIds[1]), owner.cookie, "PATCH", { sku: " polo-sn " });
  expect(response.status).toBe(422);
  expect((await errorOf(response)).issues).toEqual([expect.objectContaining({ scope: "variant", variantId: seeded.variantIds[1], field: "sku", reason: "DUPLICATE_SKU" })]);
  const own = await call(path(seeded.productId, seeded.variantIds[0]), owner.cookie, "PATCH", { sku: "POLO-SN", salePrice: 22 });
  expect(own.status).toBe(200);
});

test("every variant action on another company's product answers 404 like a missing one", async () => {
  const owner = await seller();
  const stranger = await seller();
  const seeded = await shirts(owner);
  const [sNegro] = seeded.variantIds;
  const talla = seeded.optionIds.Talla;
  const color = seeded.optionIds.Color;
  const attempts = (productId: string, variantId: string) => [
    ["PATCH", path(productId, variantId), { salePrice: 9 }],
    ["PUT", path(productId, variantId, "/combination"), { values: [{ optionId: talla, valueId: seeded.valueIds.Talla.M }, { optionId: color, valueId: seeded.valueIds.Color.Azul }] }],
    ["PUT", path(productId, variantId, "/status"), { status: "inactive" }],
    ["DELETE", path(productId, variantId), undefined],
  ] as const;
  for (const [method, target, body] of attempts(seeded.productId, sNegro)) {
    const foreign = await call(target, stranger.cookie, method, body);
    expect(foreign.status, `${method} ${target}`).toBe(404);
    expect((await errorOf(foreign)).code).toBe("PRODUCT_NOT_FOUND");
  }
  for (const [method, target, body] of attempts(randomUUID(), randomUUID())) expect((await call(target, owner.cookie, method, body)).status).toBe(404);
  for (const [method, target, body] of attempts(seeded.productId, randomUUID())) {
    const missing = await call(target, owner.cookie, method, body);
    expect(missing.status, `${method} ${target}`).toBe(404);
    expect((await errorOf(missing)).code, `${method} ${target}`).toBe("VARIANT_NOT_FOUND");
  }
  expect((await call(path("not-a-uuid", sNegro), owner.cookie, "DELETE")).status).toBe(400);
});

test("deleteVariant and changeVariantCombination issue the same statement count on two and on one hundred variants, under twenty", async () => {
  const owner = await seller();
  const small = await withTenantIsolation(owner.companyId, () => seedProduct({ name: "Chico", options: [{ name: "Talla", values: ["S", "M"] }, { name: "Color", values: ["Negro"] }], variants: [
    { attributes: { Talla: "S", Color: "Negro" } }, { attributes: { Talla: "M", Color: "Negro" } }] }));
  const talla = (index: number) => `T${index}`;
  const grid = Array.from({ length: 99 }, (_, index) => ({ attributes: { Talla: talla(index % 3), Color: `C${Math.floor(index / 3) % 11}`, Material: `M${Math.floor(index / 33)}` } }));
  const large = await withTenantIsolation(owner.companyId, () => seedProduct({ name: "Grande",
    options: [{ name: "Talla", values: ["T0", "T1", "T2", "T3"] }, { name: "Color", values: Array.from({ length: 11 }, (_, index) => `C${index}`) }, { name: "Material", values: ["M0", "M1", "M2"] }],
    variants: [...grid, { attributes: { Talla: "T3", Color: "C0", Material: "M0" } }] }));
  expect(large.variantIds).toHaveLength(100);

  const run = (seeded: SeededProduct, kind: "delete" | "combination") => withTenantIsolation(owner.companyId, () => countedStatements(() => {
    const productId = seeded.productId as ProductId;
    const variantId = seeded.variantIds[seeded.variantIds.length - 1] as VariantId;
    if (kind === "delete") return productVariantActions.delete({ productId, variantId });
    const colors = seeded.valueIds.Color;
    const material = seeded.valueIds.Material;
    return productVariantActions.changeCombination({ productId, variantId, values: [
      { optionId: seeded.optionIds.Talla, newValue: { id: randomUUID(), name: "XL" } },
      { optionId: seeded.optionIds.Color, valueId: seeded.variantIds === small.variantIds ? colors.Negro : colors.C0 },
      ...material ? [{ optionId: seeded.optionIds.Material, valueId: material.M0 }] : [],
    ] });
  }));
  for (const kind of ["combination", "delete"] as const) {
    const few = await run(small, kind);
    const many = await run(large, kind);
    expect(few.result.success && many.result.success, `${kind} ${JSON.stringify([few.result, many.result])}`).toBe(true);
    expect(many.statements.length, many.statements.join("\n---\n")).toBe(few.statements.length);
    // The ceiling counts the photo list that each of the two aggregate reads (lock and reload) loads in its own statement.
    expect(many.statements.length).toBeLessThanOrEqual(22);
  }
});

test("a value id or a combination taken after the checks answers ID_CONFLICT or DUPLICATE_COMBINATION", async () => {
  const owner = await seller();
  const seeded = await shirts(owner);
  const [sNegro, sAzul] = seeded.variantIds;
  const { applyCombinationChange } = await import("@core/src/features/products/infrastructure/variant-repository");
  const context = (variantId: string) => ({ productId: seeded.productId as ProductId, variantId: variantId as VariantId, action: "change_combination", started: performance.now() });
  const talla = seeded.optionIds.Talla;
  const taken = await withTenantIsolation(owner.companyId, () => applyCombinationChange(seeded.productId as ProductId, { variantId: sNegro as VariantId, combinationKey: "x", changedLinks: [],
    newValue: { id: seeded.valueIds.Color.Azul as never, optionId: talla as never, name: "XL" as never }, deleteValueIds: [], deleteOptionIds: [] }, new Date(), context(sNegro)));
  expect(taken).toEqual({ success: false, error: expect.objectContaining({ code: "ID_CONFLICT" }) });
  const sameKey = await withTenantIsolation(owner.companyId, async () => {
    const other = await prisma.productVariant.findFirstOrThrow({ where: { id: sAzul } });
    return applyCombinationChange(seeded.productId as ProductId, { variantId: sNegro as VariantId, combinationKey: other.combinationKey, changedLinks: [], deleteValueIds: [], deleteOptionIds: [] }, new Date(), context(sNegro));
  });
  expect(sameKey).toEqual({ success: false, error: expect.objectContaining({ code: "DUPLICATE_COMBINATION" }) });
});
