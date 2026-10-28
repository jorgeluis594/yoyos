import { randomUUID } from "node:crypto";
import pg from "pg";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import { prisma, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { log } from "@core/src/shared/infrastructure/logger";
import { productVariantActions } from "@core/src/features/products/product-variant-actions";
import { productEditing, productSaveDependencies, productTransaction } from "@core/src/features/products/product-editing";
import { saveProduct, type SaveProductError, type SaveProductInput } from "@core/src/features/products/application/save-product";
import { applyStructureChange, productRepository } from "@core/src/features/products/infrastructure/repository";
import { deleteSeededProducts, seedProduct, type SeededProduct } from "@core/src/features/products/infrastructure/product-seed";
import type { ProductStructureChange } from "@core/src/features/products/domain/product-structure";
import type { OptionId, OptionValueId, Product, ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { CompanyId } from "@shared/identity";

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
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await deleteSeededProducts();
    await prisma.image.deleteMany();
    await prisma.company.deleteMany({ where: { id } });
  });
  (pg.Client.prototype as unknown as { query: unknown }).query = originalQuery;
});

const asCompany = <T>(companyId: string, work: () => Promise<T>) => withTenantIsolation(companyId, work);
let orderNumber = 1001n;
async function orderWith(variantIds: readonly string[]) {
  const id = randomUUID();
  await prisma.order.create({ data: { id, number: orderNumber++, currency: "PEN", total: 10, itemsTotal: 10, createdAt: new Date(), fromCatalog: true, checkoutEnabledAt: new Date() } });
  for (const variantId of [...variantIds].sort()) await prisma.orderItem.create({ data: { orderId: id, variantId, productName: "Polo", variantAttributes: {}, quantity: 1n, unitPrice: 10, subtotal: 10 } });
  return id;
}

async function load(productId: string): Promise<Product> {
  const loaded = await productRepository.get(productId as ProductId);
  if (!loaded.success || !loaded.data) throw new Error("Product was not loaded");
  return loaded.data;
}

/** The form exactly as loaded, ready to edit. */
function formOf(product: Product): SaveProductInput {
  return {
    productId: product.id, structureVersion: product.structureVersion, name: product.name, description: product.description ?? null,
    options: product.options.map((option) => ({ id: option.id, name: option.name, values: option.values.map((value) => ({ id: value.id, name: value.name })) })),
    variants: product.variants.map((variant) => ({ id: variant.id, sku: variant.sku ?? null, salePrice: variant.salePrice.amount, purchasePrice: variant.purchasePrice?.amount ?? null })),
    newVariants: [], deletedVariantIds: [],
  };
}

const sizes = (count: number) => Array.from({ length: count }, (_, index) => `T${index}`);

/** `withExtra` adds a third option with one value on every variant, which a save can remove whole. */
async function seedGrid(shape: readonly [number, number], withExtra = false): Promise<SeededProduct> {
  const [tallas, colores] = shape;
  const variants = sizes(tallas).flatMap((talla) => sizes(colores).map((color, index) => ({ attributes: { Talla: talla, Color: `C${index}`, ...withExtra ? { Extra: "E" } : {} }, sku: `${randomUUID().slice(0, 8)}`, salePrice: 10 })));
  return seedProduct({ name: "Polo", options: [{ name: "Talla", values: sizes(tallas) }, { name: "Color", values: sizes(colores).map((_, index) => `C${index}`) }, ...withExtra ? [{ name: "Extra", values: ["E"] }] : []], variants });
}

/** One save that touches every kind of statement: deletes a value with its variants and a whole option, adds an option with a value and a new variant, renames, reprices and re-SKUs every saved variant. */
function heavySave(product: Product): SaveProductInput {
  const form = formOf(product);
  const lastSize = product.options[0].values.at(-1)!;
  const dropped = new Set<string>(product.variants.filter((variant) => variant.combination[product.options[0].id] === lastSize.id).map((variant) => variant.id));
  const manga = { id: randomUUID(), name: "Manga", values: [{ id: randomUUID(), name: "Corta" }, { id: randomUUID(), name: "Larga" }], valueForExistingVariants: "" };
  manga.valueForExistingVariants = manga.values[0].id;
  const kept = product.variants.filter((variant) => !dropped.has(variant.id));
  const first = kept[0];
  return {
    ...form,
    name: "Polo renombrado",
    options: [
      { ...form.options[0], name: "Talla única", values: form.options[0].values.filter((value) => value.id !== lastSize.id).map((value, index) => ({ ...value, name: index === 0 ? `${value.name} bis` : value.name })).reverse() },
      form.options[1], manga,
    ],
    // The option "Extra" is left out of the list: its links, its value and the option go.
    variants: form.variants.filter((variant) => !dropped.has(variant.id)).map((variant) => ({ ...variant, sku: `N-${variant.id.slice(0, 8)}`, salePrice: 11, purchasePrice: 5 })),
    deletedVariantIds: [...dropped] as VariantId[],
    newVariants: [{ values: [first.combination[product.options[0].id], first.combination[product.options[1].id], manga.values[1].id], sku: null, salePrice: 12, purchasePrice: null, initialStock: 0 }],
  };
}

test("save issues the same statement count for two and for one hundred variants, under the ceiling and the timeout", async () => {
  const counts: number[] = [];
  for (const shape of [[2, 1], [10, 10]] as const) {
    await asCompany(companyA, async () => {
      const seeded = await seedGrid(shape, true);
      const product = await load(seeded.productId);
      expect(product.variants).toHaveLength(shape[0] * shape[1]);
      const { result, statements, elapsedMs } = await countedStatements(() => productEditing.save(heavySave(product)));
      if (!result.success) throw new Error(JSON.stringify(result.error));
      counts.push(statements.length);
      expect(statements.length, statements.join("\n")).toBeLessThanOrEqual(37);
      expect(elapsedMs).toBeLessThan(10_000);
      const saved = await load(seeded.productId);
      expect(saved).toMatchObject({ name: "Polo renombrado", structureVersion: 2 });
      expect(saved.options.map((option) => option.name)).toEqual(["Talla única", "Color", "Manga"]);
      expect(saved.variants).toHaveLength(shape[0] === 2 ? 2 : 91);
    });
  }
  expect(counts[0]).toBe(counts[1]);
});

test("swapping SKUs between two variants in one save succeeds", async () => {
  await asCompany(companyA, async () => {
    const seeded = await seedProduct({ name: "Canje", options: [{ name: "Talla", values: ["S", "M"] }], variants: [{ attributes: { Talla: "S" }, sku: "AAA" }, { attributes: { Talla: "M" }, sku: "BBB" }] });
    const product = await load(seeded.productId);
    const form = formOf(product);
    const saved = await productEditing.save({ ...form, variants: [{ ...form.variants[0], sku: "BBB" }, { ...form.variants[1], sku: "AAA" }] });
    expect(saved.success).toBe(true);
    expect((await load(seeded.productId)).variants.map((variant) => variant.sku)).toEqual(["BBB", "AAA"]);
    expect((await load(seeded.productId)).structureVersion).toBe(1);
  });
});

test("adding an option rekeys every saved variant without a duplicate-key error", async () => {
  await asCompany(companyA, async () => {
    const seeded = await seedGrid([3, 3]);
    const product = await load(seeded.productId);
    const form = formOf(product);
    const manga = { id: randomUUID(), name: "Manga", values: [{ id: randomUUID(), name: "Corta" }], valueForExistingVariants: "" };
    manga.valueForExistingVariants = manga.values[0].id;
    const saved = await productEditing.save({ ...form, options: [...form.options, manga] });
    if (!saved.success) throw new Error(JSON.stringify(saved.error));
    const after = await load(seeded.productId);
    expect(after.structureVersion).toBe(2);
    expect(after.variants.map((variant) => variant.id)).toEqual(product.variants.map((variant) => variant.id));
    expect(after.variants.every((variant) => variant.combination[manga.id as OptionId] === manga.values[0].id as OptionValueId)).toBe(true);
    const keys = await prisma.productVariant.findMany({ where: { productId: seeded.productId }, select: { combinationKey: true } });
    expect(new Set(keys.map((row) => row.combinationKey)).size).toBe(9);
    expect(keys.every((row) => row.combinationKey.split(",").includes(manga.values[0].id.toLowerCase()))).toBe(true);
  });
});

test("a rekeying save and a two-item order on the same product both finish without deadlock", async () => {
  const seeded = await asCompany(companyA, () => seedGrid([4, 4]));
  const product = await asCompany(companyA, () => load(seeded.productId));
  const form = formOf(product);
  const addManga = (): SaveProductInput => {
    const value = { id: randomUUID(), name: "Corta" };
    return { ...form, options: [...form.options, { id: randomUUID(), name: "Manga", values: [value], valueForExistingVariants: value.id }] };
  };
  const first = seeded.variantIds[0];
  const last = seeded.variantIds.at(-1)!;
  const outcomes = await Promise.all(Array.from({ length: 6 }, (_, round) => round % 2 === 0
    ? asCompany(companyA, () => productEditing.save(addManga())).then((result) => (result.success ? "saved" : result.error.code))
    : asCompany(companyA, () => withinTransaction(async () => { await orderWith([last, first]); return ok(null); })).then(() => "ordered")));
  expect(outcomes.filter((outcome) => outcome === "ordered")).toHaveLength(3);
  // Only one save can win the structure version; the others are stale. None may fail with a lock conflict.
  expect(outcomes.filter((outcome) => outcome !== "ordered").every((outcome) => outcome === "saved" || outcome === "PRODUCT_CHANGED")).toBe(true);
  expect(outcomes).toContain("saved");
});

test("rolls back a save when a deleted variant gained an order", async () => {
  await asCompany(companyA, async () => {
    const seeded = await seedProduct({ name: "Con pedido", options: [{ name: "Talla", values: ["S", "M"] }], variants: [{ attributes: { Talla: "S" } }, { attributes: { Talla: "M" } }] });
    const product = await load(seeded.productId);
    const form = formOf(product);
    // The orders lookup answers before the order exists, as in a race: the foreign key is the last guard.
    const stale = { ...productSaveDependencies(companyA, seeded.productId), findOrderedVariantIds: async () => ok(new Set<VariantId>()) };
    await orderWith([seeded.variantIds[1]]);
    const result = await saveProduct({ ...form, name: "No debe guardarse", options: [{ ...form.options[0], values: [form.options[0].values[0]] }],
      variants: form.variants.slice(0, 1), deletedVariantIds: [seeded.variantIds[1] as VariantId] }, { companyId: companyA as CompanyId }, stale);
    expect(result).toMatchObject({ success: false, error: { code: "VARIANT_HAS_ORDERS" } });
    const after = await load(seeded.productId);
    expect(after).toMatchObject({ name: "Con pedido", structureVersion: 1 });
    expect(after.variants).toHaveLength(2);
    expect(after.options[0].values).toHaveLength(2);
  });
});

test("another company cannot save a product it does not own", async () => {
  const seeded = await asCompany(companyA, () => seedProduct({ name: "Mío", options: [{ name: "Talla", values: ["S"] }], variants: [{ attributes: { Talla: "S" } }] }));
  const product = await asCompany(companyA, () => load(seeded.productId));
  const result = await asCompany(companyB, () => productEditing.save({ ...formOf(product), name: "Robado" }));
  expect(result).toMatchObject({ success: false, error: { code: "PRODUCT_NOT_FOUND" } });
  expect((await asCompany(companyA, () => load(seeded.productId))).name).toBe("Mío");
});

function emptyChange(productId: string): ProductStructureChange {
  return { productId: productId as ProductId, insertOptions: [], insertValues: [], renameOrMoveOptions: [], renameOrMoveValues: [], insertLinks: [], deleteLinksOfOptionIds: [],
    deleteValueIds: [], deleteOptionIds: [], rekeyVariants: [], variantFieldChanges: [], insertVariants: [], deleteVariantIds: [], product: {} };
}

async function applied(change: ProductStructureChange): Promise<SaveProductError | null> {
  const result = await productTransaction(companyA, () => applyStructureChange(change));
  return result.success ? null : result.error as SaveProductError;
}

test("the combination unique index rejects a duplicate combination", async () => {
  await asCompany(companyA, async () => {
    const seeded = await seedProduct({ name: "Duplicado", options: [{ name: "Talla", values: ["S"] }], variants: [{ attributes: { Talla: "S" } }] });
    const product = await load(seeded.productId);
    const combination = product.variants[0].combination;
    const error = await applied({ ...emptyChange(seeded.productId), insertVariants: [{ id: randomUUID() as VariantId, combination, combinationKey: Object.values(combination)[0].toLowerCase(), salePrice: 1, qrCode: randomUUID(), initialStock: 0 }] });
    expect(error).toMatchObject({ code: "DUPLICATE_COMBINATION" });
  });
});

test("the SKU index rejects a SKU another product already holds", async () => {
  await asCompany(companyA, async () => {
    await seedProduct({ name: "Dueño", variants: [{ sku: "Ocupado" }] });
    const other = await seedProduct({ name: "Otro", variants: [{ sku: null }] });
    const error = await applied({ ...emptyChange(other.productId), variantFieldChanges: [{ id: other.variantIds[0] as VariantId, sku: " ocupado" }] });
    expect(error).toMatchObject({ code: "DUPLICATE_SKU" });
  });
});

test("an option id used by another product answers 409 ID_CONFLICT from the primary key", async () => {
  await asCompany(companyA, async () => {
    const owner = await seedProduct({ name: "Dueño", options: [{ name: "Talla", values: ["S"] }], variants: [{ attributes: { Talla: "S" } }] });
    const mine = await seedProduct({ name: "Mío" });
    const error = await applied({ ...emptyChange(mine.productId), insertOptions: [{ id: owner.optionIds.Talla as OptionId, name: "Talla" as never, position: 0 }] });
    expect(error).toMatchObject({ code: "ID_CONFLICT" });
  });
});

test("a lock timeout is logged once as lock_conflict and answers PERSISTENCE_UNAVAILABLE", async () => {
  const seeded = await asCompany(companyA, () => seedProduct({ name: "Bloqueado", options: [{ name: "Talla", values: ["S"] }], variants: [{ attributes: { Talla: "S" } }] }));
  const product = await asCompany(companyA, () => load(seeded.productId));
  const errorLog = vi.spyOn(log, "error").mockImplementation(() => undefined);
  let release!: () => void;
  let locked!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { locked = resolve; });
  const holder = asCompany(companyA, () => withinTransaction(async () => {
    await prisma.$queryRaw`SELECT id FROM "Product" WHERE id = ${seeded.productId}::uuid FOR UPDATE`;
    locked();
    await held;
    return ok(null);
  }));
  try {
    await ready;
    const result = await asCompany(companyA, () => productEditing.save({ ...formOf(product), name: "Nunca" }));
    expect(result).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    const failures = errorLog.mock.calls.map(([entry]) => entry as Record<string, unknown>).filter((entry) => entry.event === "product_save_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ stage: "lock_conflict", errorCode: "PERSISTENCE_UNAVAILABLE", productId: seeded.productId });
  } finally {
    release();
    await holder;
    errorLog.mockRestore();
  }
  expect((await asCompany(companyA, () => load(seeded.productId))).name).toBe("Bloqueado");
}, 30_000);

test("a lock timeout in a variant action is logged once as lock_conflict with the variant action event", async () => {
  const seeded = await asCompany(companyA, () => seedProduct({ name: "Bloqueado", options: [{ name: "Talla", values: ["S", "M"] }], variants: [{ attributes: { Talla: "S" } }, { attributes: { Talla: "M" } }] }));
  const errorLog = vi.spyOn(log, "error").mockImplementation(() => undefined);
  let release!: () => void;
  let locked!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { locked = resolve; });
  const holder = asCompany(companyA, () => withinTransaction(async () => {
    await prisma.$queryRaw`SELECT id FROM "Product" WHERE id = ${seeded.productId}::uuid FOR UPDATE`;
    locked();
    await held;
    return ok(null);
  }));
  try {
    await ready;
    const result = await asCompany(companyA, () => productVariantActions.changeStatus({ productId: seeded.productId as ProductId, variantId: seeded.variantIds[0] as VariantId, status: "inactive" }));
    expect(result).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    const failures = errorLog.mock.calls.map(([entry]) => entry as Record<string, unknown>).filter((entry) => entry.event === "product_variant_action_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ stage: "lock_conflict", action: "change_status", variantId: seeded.variantIds[0] });
  } finally {
    release();
    await holder;
    errorLog.mockRestore();
  }
}, 30_000);

test("a save that sets 8 photos uses the same number of statements as one that sets 1", async () => {
  const counts: number[] = [];
  for (const photoCount of [1, 8]) {
    await asCompany(companyA, async () => {
      const images = Array.from({ length: photoCount }, () => randomUUID());
      for (const id of images) await prisma.image.create({ data: { id, storageKey: `images/${id}` } });
      const seeded = await seedProduct({ name: "Fotos", variants: [{ salePrice: 10 }] });
      const product = await load(seeded.productId);
      // The images module needs storage to resolve URLs; the reload only has to read the aggregate.
      const deps = { ...productSaveDependencies(companyA, seeded.productId), reload: async () => ok({ product: await load(seeded.productId), orderedVariantIds: new Set<VariantId>(), photos: [] }) };
      const { result, statements } = await countedStatements(() => saveProduct({ ...formOf(product), photoIds: images as never }, { companyId: companyA as CompanyId }, deps));
      if (!result.success) throw new Error(JSON.stringify(result.error));
      counts.push(statements.length);
      expect((await load(seeded.productId)).photoIds).toEqual(images);
    });
  }
  expect(counts[0]).toBe(counts[1]);
});

test("a lock timeout during the photo lookup is reported once by the save transaction", async () => {
  const seeded = await asCompany(companyA, () => seedProduct({ name: "Foto bloqueada", variants: [{ salePrice: 10 }] }));
  const product = await asCompany(companyA, () => load(seeded.productId));
  const errorLog = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const timeout = new Prisma.PrismaClientKnownRequestError("canceling statement due to lock timeout 55P03", { code: "P2010", clientVersion: "7.10.0" });
  try {
    const deps = { ...productSaveDependencies(companyA, seeded.productId), findImages: async () => { throw timeout; } };
    const result = await asCompany(companyA, () => saveProduct({ ...formOf(product), photoIds: [randomUUID() as never] }, { companyId: companyA as CompanyId }, deps));
    expect(result).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    const failures = errorLog.mock.calls.map(([entry]) => entry as Record<string, unknown>).filter((entry) => entry.event === "product_save_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ stage: "lock_conflict", errorCode: "PERSISTENCE_UNAVAILABLE", productId: seeded.productId });
  } finally {
    errorLog.mockRestore();
  }
  expect((await asCompany(companyA, () => load(seeded.productId))).photoIds).toEqual([]);
});
