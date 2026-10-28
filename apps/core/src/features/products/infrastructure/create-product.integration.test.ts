import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { productEditing, productGetDependencies } from "@core/src/features/products/product-editing";
import { getProduct } from "@core/src/features/products/application/get";
import type { CreateInput } from "@core/src/features/products/application/create";
import { findForeignOptionIds, findSkuOwners, insertProduct, productRepository } from "@core/src/features/products/infrastructure/repository";
import { deleteSeededProducts, seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import type { Product, ProductId } from "@core/src/features/products/domain/product";
import { combinationKey } from "@core/src/features/products/domain/product-structure";

const companyA = randomUUID();
const companyB = randomUUID();

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

async function countedStatements<T>(work: () => Promise<T>): Promise<{ result: T; statements: string[]; elapsedMs: number }> {
  sent.length = 0;
  counting = true;
  const started = performance.now();
  try {
    const result = await work();
    return { result, elapsedMs: performance.now() - started, statements: sent.filter((text) => !/^(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION)\b/i.test(text) && !/set_config\('app\.company_id'/.test(text)) };
  } finally { counting = false; }
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
});

afterAll(async () => {
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => {
    await deleteSeededProducts();
    await prisma.company.deleteMany({ where: { id } });
  });
  (pg.Client.prototype as unknown as { query: unknown }).query = originalQuery;
});

const names = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({ id: randomUUID(), name: `${prefix}${index}` }));

function grid(shape: readonly number[], sku: string): CreateInput {
  const options = shape.map((count, index) => ({ id: randomUUID(), name: `Opción ${index}`, values: names(`V${index}-`, count) }));
  let combinations: string[][] = [[]];
  for (const option of options) combinations = combinations.flatMap((prefix) => option.values.map((value) => [...prefix, value.id]));
  return { id: randomUUID() as ProductId, name: "Polo", currency: "PEN", options,
    variants: combinations.map((values, index) => ({ values, sku: `${sku}-${index}`, salePrice: 10, initialStock: 1 })) as unknown as CreateInput["variants"] };
}

test("creates a product with options, values, links and stock in one transaction", async () => {
  await withTenantIsolation(companyA, async () => {
    const input = grid([3, 2], "TX");
    const created = await productEditing.create(input);
    expect(created.success).toBe(true);
    if (!created.success) return;
    const loaded = await productRepository.get(created.data);
    if (!loaded.success || !loaded.data) throw new Error("Product was not loaded");
    const product = loaded.data;
    expect(product).toMatchObject({ structureVersion: 1, status: "active" });
    expect(product.options.map((option) => [option.name, option.values.map((value) => value.name)])).toEqual([["Opción 0", ["V0-0", "V0-1", "V0-2"]], ["Opción 1", ["V1-0", "V1-1"]]]);
    expect(product.variants).toHaveLength(6);
    expect(product.variants.every((variant) => variant.status === "active" && variant.stock.quantity === 1 && Object.keys(variant.combination).length === 2)).toBe(true);
    expect(new Set(product.variants.map((variant) => variant.qrCode)).size).toBe(6);
    expect(product.variants.map((variant) => variant.sku)).toEqual(input.variants.map((variant) => variant.sku));
    const keys = await prisma.productVariant.findMany({ where: { productId: created.data }, select: { id: true, combinationKey: true } });
    expect(keys.map((row) => row.combinationKey).sort()).toEqual(product.variants.map((variant) => combinationKey(variant.combination)).sort());
    expect(await prisma.productVariantOptionValue.count({ where: { productId: created.data } })).toBe(12);
  });
});

test("a failing insert leaves no option, value, link or stock behind", async () => {
  await withTenantIsolation(companyA, async () => {
    const input = grid([2, 2], "ROLL");
    const first = await productEditing.create(input);
    expect(first.success).toBe(true);
    const before = await Promise.all([prisma.productOption.count(), prisma.productOptionValue.count(), prisma.productVariantOptionValue.count(), prisma.productStock.count()]);
    const again = await productEditing.create({ ...grid([2, 2], "ROLL"), variants: input.variants });
    expect(again.success).toBe(false);
    expect(await Promise.all([prisma.productOption.count(), prisma.productOptionValue.count(), prisma.productVariantOptionValue.count(), prisma.productStock.count()])).toEqual(before);
  });
});

test("an option id used by another product is a 422 ID_CONFLICT issue and a primary-key race answers 409 ID_CONFLICT", async () => {
  const input = grid([2], "IDS");
  await withTenantIsolation(companyA, async () => {
    expect((await productEditing.create(input)).success).toBe(true);
    const clash = grid([2], "IDS2");
    const reused = { ...clash, options: [{ ...clash.options[0], id: input.options[0].id, values: [{ ...clash.options[0].values[0], id: input.options[0].values[0].id }, clash.options[0].values[1]] }] };
    const rejected = await productEditing.create({ ...reused, variants: clash.variants.map((variant, index) => ({ ...variant, values: [reused.options[0].values[index].id] })) as unknown as CreateInput["variants"] });
    expect(rejected).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR", issues: [
      { scope: "option", optionIndex: 0, field: "id", reason: "ID_CONFLICT" },
      { scope: "value", optionIndex: 0, valueIndex: 0, field: "id", reason: "ID_CONFLICT" },
    ] } });
  });
  // Another company cannot see these ids, so the domain check passes and the primary key answers.
  await withTenantIsolation(companyB, async () => {
    const stolen = grid([1], "IDS3");
    const race = await productEditing.create({ ...stolen, options: [{ ...stolen.options[0], id: input.options[0].id }] });
    expect(race).toMatchObject({ success: false, error: { code: "ID_CONFLICT" } });
    const seeded = await seedProduct({ variants: [{ attributes: { Color: "Rojo" } }] });
    const product = await productRepository.get(seeded.productId as ProductId);
    if (!product.success || !product.data) throw new Error("Product was not loaded");
    const duplicate: Product = { ...product.data, id: randomUUID() as ProductId, qrCode: randomUUID(),
      variants: product.data.variants.map((variant) => ({ ...variant, id: randomUUID() as Product["variants"][0]["id"], qrCode: randomUUID(), sku: undefined, stock: { variantId: randomUUID() as never, quantity: 0 } })) as unknown as Product["variants"] };
    // Same option and value ids inside the same company: the second aggregate repeats them.
    expect(await insertProduct({ ...duplicate, variants: duplicate.variants.map((variant) => ({ ...variant, stock: { ...variant.stock, variantId: variant.id } })) as unknown as Product["variants"] }))
      .toMatchObject({ success: false, error: { code: "ID_CONFLICT" } });
  });
});

test("findSkuOwners matches SKUs ignoring case and surrounding spaces", async () => {
  await withTenantIsolation(companyA, async () => {
    const owner = await seedProduct({ variants: [{ sku: "  Polo-Rojo " }] });
    const found = await findSkuOwners(["polo-rojo", "other"]);
    expect(found).toEqual({ success: true, data: new Map([["polo-rojo", owner.variantIds[0]]]) });
    expect(await findSkuOwners([])).toEqual({ success: true, data: new Map() });
  });
  await withTenantIsolation(companyB, async () => {
    expect(await findSkuOwners(["polo-rojo"])).toEqual({ success: true, data: new Map() });
    expect(await findForeignOptionIds([randomUUID()])).toEqual({ success: true, data: new Set() });
  });
});

test("create issues the same statement count for two and for one hundred variants, under the ceiling and the timeout", async () => {
  await withTenantIsolation(companyA, async () => {
    const small = await countedStatements(() => productEditing.create(grid([2, 1, 1], "SM")));
    const large = await countedStatements(() => productEditing.create(grid([5, 5, 4], "LG")));
    expect(small.result.success && large.result.success).toBe(true);
    expect(large.statements.length).toBe(small.statements.length);
    expect(small.statements.length).toBeLessThanOrEqual(10);
    expect(large.elapsedMs).toBeLessThan(10_000);
    expect(await prisma.productVariant.count({ where: { sku: { startsWith: "LG-" } } })).toBe(100);
  });
});

test("list summaries cover only active variants without loading options", async () => {
  await withTenantIsolation(companyA, async () => {
    const mixed = await seedProduct({ name: "ZZ mixed", options: [{ name: "Talla", values: ["S", "M", "L"] }], variants: [
      { attributes: { Talla: "S" }, salePrice: 5, stock: 7, status: "inactive", sku: "ZZ-S" },
      { attributes: { Talla: "M" }, salePrice: 12, stock: 2, sku: "ZZ-M" },
      { attributes: { Talla: "L" }, salePrice: 15, stock: 1 },
    ] });
    const dead = await seedProduct({ name: "ZZ dead", options: [{ name: "Talla", values: ["S", "M"] }], variants: [
      { attributes: { Talla: "S" }, salePrice: 5, stock: 3, status: "inactive" }, { attributes: { Talla: "M" }, salePrice: 6, stock: 4, status: "inactive" },
    ] });
    const single = await seedProduct({ name: "ZZ single", variants: [{ salePrice: 9, sku: "ZZ-ONE", stock: 4 }] });
    const listed = await countedStatements(() => productRepository.list({ search: "ZZ", sort: "name", page: 1, pageSize: 20 }));
    expect(listed.statements.some((text) => text.includes('"ProductOption"') || text.includes('"ProductVariantOptionValue"'))).toBe(false);
    expect(listed.statements, listed.statements.join("\n")).toHaveLength(2);
    if (!listed.result.success) throw new Error("Listing failed");
    const byId = new Map(listed.result.data.items.map((item) => [item.id as string, item]));
    expect(byId.get(mixed.productId)).toMatchObject({ variantCount: 3, activeVariantCount: 2, minSalePrice: { amount: 12, currency: "PEN" }, hasDifferentPrices: true, totalStock: 3 });
    expect(byId.get(mixed.productId)?.sku).toBeUndefined();
    expect(byId.get(dead.productId)).toMatchObject({ variantCount: 2, activeVariantCount: 0, minSalePrice: null, hasDifferentPrices: false, totalStock: 0 });
    expect(byId.get(single.productId)).toMatchObject({ variantCount: 1, activeVariantCount: 1, sku: "ZZ-ONE", totalStock: 4 });
    const soldOut = await productRepository.list({ search: "ZZ", stock: "sold_out", sort: "name", page: 1, pageSize: 20 });
    expect(soldOut.success && soldOut.data.items.map((item) => item.id)).toEqual([dead.productId]);
    const inStock = await productRepository.list({ search: "ZZ", stock: "in_stock", sort: "name", page: 1, pageSize: 20 });
    expect(inStock.success && inStock.data.items.map((item) => item.id).sort()).toEqual([mixed.productId, single.productId].sort());
  });
});

test("the detail read sees one snapshot while a save commits between its queries", async () => {
  await withTenantIsolation(companyA, async () => {
    const { productId: seededId } = await seedProduct({ name: "Snapshot antes", options: [{ name: "Talla", values: ["S", "M"] }], variants: [
      { attributes: { Talla: "S" }, salePrice: 5, stock: 1 }, { attributes: { Talla: "M" }, salePrice: 6, stock: 1 },
    ] });
    const productId = seededId as ProductId;
    let seenBetweenQueries: string | undefined;
    const read = await getProduct(productId, { ...productGetDependencies, findOrderedVariantIds: async (ids) => {
      // A save in another connection commits after the product was read and before the orders are read.
      await systemPrisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.company_id', ${companyA}, true)`;
        await tx.product.update({ where: { id: productId }, data: { name: "Snapshot después" } });
      });
      seenBetweenQueries = (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).name;
      return productGetDependencies.findOrderedVariantIds(ids);
    } });
    expect(seenBetweenQueries).toBe("Snapshot antes");
    expect(read.success && read.data?.product.name).toBe("Snapshot antes");
    const next = await getProduct(productId, productGetDependencies);
    expect(next.success && next.data?.product.name).toBe("Snapshot después");
  });
});
