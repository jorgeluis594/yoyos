import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { ProductId } from "@core/src/features/products/domain/product";
import { deleteSeededProducts, seedProduct, type SeedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { assistantReadBudget, assistantSnapshot } from "@core/src/features/products/infrastructure/assistant-read";
import { findSkuOwner, readVocabulary, searchPage } from "@core/src/features/products/infrastructure/product-search-repository";
import { readProductInSnapshot } from "@core/src/features/products/infrastructure/repository";
import { searchForAssistant, type AssistantProductSearch } from "@core/src/features/products/application/search-for-assistant";
import { findForAssistant } from "@core/src/features/products/application/find-for-assistant";

const store = randomUUID();
const otherStore = randomUUID();
const extraStores: string[] = [];

const searchDeps = { snapshot: assistantSnapshot("search"), readVocabulary, searchPage };
const findDeps = { snapshot: assistantSnapshot("detail"), findSkuOwner, readProduct: readProductInSnapshot };

const search = (companyId: string, input: Partial<AssistantProductSearch> = {}) =>
  withTenantIsolation(companyId, () => searchForAssistant({ sort: "recent", page: 1, ...input }, searchDeps));
const find = (companyId: string, reference: Parameters<typeof findForAssistant>[0]) =>
  withTenantIsolation(companyId, () => findForAssistant(reference, findDeps));

async function newStore() {
  const id = randomUUID();
  extraStores.push(id);
  await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
  return id;
}

const seed = (companyId: string, product: SeedProduct) => withTenantIsolation(companyId, () => seedProduct(product));
const variant = (talla: string, color: string, salePrice: number, stock: number, sku?: string, status: "active" | "inactive" = "active") =>
  ({ attributes: { Talla: talla, Color: color }, salePrice, stock, sku: sku ?? null, status });

const names = (page: { items: readonly { name: string }[] }) => page.items.map((item) => item.name);
const pageOf = async (companyId: string, input: Partial<AssistantProductSearch> = {}) => {
  const found = await search(companyId, input);
  if (!found.success) throw new Error(`search failed: ${found.error.code}`);
  return found.data;
};

let poloId: string;
let casacaId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  for (const id of [store, otherStore]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
  poloId = (await seed(store, { name: "Polo básico", createdAt: new Date("2026-10-01"), variants: [
    variant("M", "Azul", 39.9, 2, "POL-M-AZ"), variant("L", "Rojo", 45, 10, "POL-L-RJ")] })).productId;
  casacaId = (await seed(store, { name: "Casaca", createdAt: new Date("2026-10-02"), variants: [variant("M", "Azul", 120, 0, "CAS-M-AZ")] })).productId;
  await seed(otherStore, { name: "Polo ajeno", variants: [variant("M", "Azul", 10, 5, "AJENO-1"), variant("S", "Celeste", 10, 5, "AJENO-2")] });
});

afterAll(async () => {
  for (const id of [store, otherStore, ...extraStores]) await withTenantIsolation(id, async () => {
    await deleteSeededProducts();
    await prisma.company.delete({ where: { id } });
  });
});

test("returns both products for «azul» and «m» with their M / Azul variant", async () => {
  const page = await pageOf(store, { values: ["azul", "m"] });
  expect(names(page)).toEqual(["Casaca", "Polo básico"]);
  expect(page.items.map((item) => item.matching?.variants.map((line) => line.values))).toEqual([[["M", "Azul"]], [["M", "Azul"]]]);
});

test("returns only the product whose same active variant meets every variant filter", async () => {
  const page = await pageOf(store, { values: ["azul", "m"], stock: "in_stock" });
  expect(names(page)).toEqual(["Polo básico"]);
  // Polo has an M variant and a Rojo variant, but no variant that is both M and Rojo with stock 10 and price up to 40.
  expect((await pageOf(store, { values: ["m", "rojo"] })).total).toBe(0);
  expect((await pageOf(store, { values: ["azul"], priceFromCents: 4000 })).total).toBe(1);
});

test("matches the price range on the sale price of the active variant, both ends inclusive", async () => {
  const page = await pageOf(store, { priceFromCents: 4000, priceToCents: 13000, sort: "name" });
  expect(names(page)).toEqual(["Casaca", "Polo básico"]);
  const lines = Object.fromEntries(page.items.map((item) => [item.name, item.matching?.variants.map((line) => line.values.join(" / "))]));
  expect(lines).toEqual({ Casaca: ["M / Azul"], "Polo básico": ["L / Rojo"] });
  expect(names(await pageOf(store, { priceFromCents: 3990, priceToCents: 3990 }))).toEqual(["Polo básico"]);
  expect(names(await pageOf(store, { priceFromCents: 12000, priceToCents: 12000 }))).toEqual(["Casaca"]);
  expect((await pageOf(store, { priceFromCents: 3991, priceToCents: 4499 })).total).toBe(0);
});

test("returns a product for agotado, stock bajo and con stock through different variants", async () => {
  expect(names(await pageOf(store, { stock: "sold_out" }))).toEqual(["Casaca"]);
  expect(names(await pageOf(store, { stock: "low" }))).toEqual(["Polo básico"]);
  expect(names(await pageOf(store, { stock: "in_stock", sort: "name" }))).toEqual(["Polo básico"]);
  const id = await newStore();
  await seed(id, { name: "Mixto", variants: [variant("S", "Negro", 10, 0), variant("M", "Negro", 10, 3), variant("L", "Negro", 10, 4)] });
  const mixed = async (stock: "sold_out" | "low" | "in_stock") => (await pageOf(id, { stock })).items[0]?.matching?.variants.map((line) => [line.values[0], line.level]);
  expect(await mixed("sold_out")).toEqual([["S", "sold_out"]]);
  expect(await mixed("low")).toEqual([["M", "low"]]);
  expect(await mixed("in_stock")).toEqual([["M", "low"], ["L", "available"]]);
});

test("never matches a deactivated variant", async () => {
  const id = await newStore();
  await seed(id, { name: "Con baja", variants: [variant("M", "Verde", 10, 5, undefined, "inactive"), variant("S", "Negro", 99, 5)] });
  expect((await pageOf(id, { priceFromCents: 1000, priceToCents: 1000 })).total).toBe(0);
  expect((await pageOf(id, { stock: "in_stock", values: ["Negro"] })).total).toBe(1);
  const rejected = await search(id, { values: ["Verde"] });
  expect(rejected).toMatchObject({ success: false, error: { code: "VALUE_REJECTED", rejection: { kind: "unknown_value", written: "Verde" } } });
});

test("returns a product without active variants for en_catalogo no and not for sí", async () => {
  const id = await newStore();
  await seed(id, { name: "Oculto", variants: [variant("M", "Azul", 10, 1, "OCU-1", "inactive")] });
  await seed(id, { name: "Visible", variants: [variant("M", "Azul", 10, 1)] });
  expect(names(await pageOf(id, { inCatalog: false }))).toEqual(["Oculto"]);
  expect(names(await pageOf(id, { inCatalog: true }))).toEqual(["Visible"]);
  const hidden = (await pageOf(id, { inCatalog: false })).items[0]!;
  expect(hidden).toMatchObject({ variantCount: 1, inactiveCount: 1, active: { kind: "none", sku: { kind: "single", sku: "OCU-1" } } });
  expect(await search(id, { inCatalog: false, stock: "low" })).toMatchObject({ success: false, error: { code: "VARIANT_FILTER_OUTSIDE_CATALOG" } });
});

test("matches text on the name or any SKU ignoring case and accents, as one phrase", async () => {
  expect(names(await pageOf(store, { text: "POLO BASICO" }))).toEqual(["Polo básico"]);
  expect(names(await pageOf(store, { text: "cas-m" }))).toEqual(["Casaca"]);
  expect(names(await pageOf(store, { text: "pol-l-rj" }))).toEqual(["Polo básico"]);
  expect((await pageOf(store, { text: "polo casaca" })).total).toBe(0);
  expect(names(await pageOf(store, { text: "100%" }))).toEqual([]);
});

test("pages 45 products as 20, 20 and 5 with total 45, newest first and by name", async () => {
  const id = await newStore();
  for (let index = 0; index < 45; index++)
    await seed(id, { name: `Producto ${String(index).padStart(2, "0")}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)), variants: [variant("M", "Azul", 10, 5)] });
  const pages = await Promise.all([1, 2, 3].map((page) => pageOf(id, { page })));
  expect(pages.map((page) => [page.items.length, page.total, page.page])).toEqual([[20, 45, 1], [20, 45, 2], [5, 45, 3]]);
  expect(pages[0]!.items[0]!.name).toBe("Producto 44");
  expect(pages[2]!.items.at(-1)!.name).toBe("Producto 00");
  expect(new Set(pages.flatMap(names)).size).toBe(45);
  expect(names(await pageOf(id, { sort: "name" }))[0]).toBe("Producto 00");
  expect((await pageOf(id, { page: 4 })).items).toEqual([]);
  expect((await pageOf(id, { page: 4 })).storeHasProducts).toBe(true);
});

test("builds the vocabulary from active variants only, without ids", async () => {
  const rows = await withTenantIsolation(store, () => assistantSnapshot("search")(readVocabulary));
  expect(rows.success && rows.data.map(({ optionName, valueName }) => `${optionName}: ${valueName}`).sort())
    .toEqual(["Color: Azul", "Color: Rojo", "Talla: L", "Talla: M"]);
  expect(rows.success && rows.data.every((row) => Object.keys(row).sort().join() === "optionName,position,productRank,valueName")).toBe(true);
  const rejected = await search(store, { values: ["Celeste"] });
  expect(rejected).toMatchObject({ success: false, error: { code: "VALUE_REJECTED", rejection: { kind: "unknown_value", written: "Celeste" } } });
});

test("finds the variant and product of a SKU in one lookup", async () => {
  const found = await find(store, { by: "sku", sku: "pol-m-az " });
  expect(found.success && found.data?.product.id).toBe(poloId);
  expect(found.success && found.data?.searchedVariantId).toBe(
    found.success ? found.data?.product.variants.find((candidate) => candidate.sku === "POL-M-AZ")?.id : undefined);
  expect(await find(store, { by: "sku", sku: "NO-EXISTE" })).toEqual(ok(null));
  expect(await find(store, { by: "id", id: casacaId as ProductId })).toMatchObject({ success: true, data: { searchedVariantId: null } });
  expect(await find(store, { by: "id", id: randomUUID() as ProductId })).toEqual(ok(null));
});

test("never reads another store's products, values or SKUs", async () => {
  expect(names(await pageOf(store))).not.toContain("Polo ajeno");
  expect(await find(store, { by: "sku", sku: "AJENO-1" })).toEqual(ok(null));
  expect(await search(store, { values: ["Celeste"] })).toMatchObject({ success: false, error: { code: "VALUE_REJECTED" } });
  expect((await pageOf(otherStore, { values: ["Celeste"] })).total).toBe(1);
  expect(await withTenantIsolation(otherStore, () => findForAssistant({ by: "id", id: poloId as ProductId }, findDeps))).toEqual(ok(null));
});

test("reports stored data that fails its schema as invalid stored data", async () => {
  const id = await newStore();
  await seed(id, { name: "Stock imposible", variants: [{ ...variant("M", "Azul", 10, 1), stock: 2n ** 53n + 1n }] });
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  try {
    expect(await search(id)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "invalid_stored_product_data", stage: "summaries" }), "invalid_stored_product_data");
  } finally {
    error.mockRestore();
  }
});

/** Holds an exclusive lock on the variants so any statement that reads them waits past its limit. */
async function withVariantsLocked<T>(run: (admin: Client) => Promise<T>): Promise<T> {
  const locker = new Client({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
  const observer = new Client({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
  await Promise.all([locker.connect(), observer.connect()]);
  try {
    await locker.query("BEGIN");
    await locker.query(`LOCK TABLE "ProductVariant" IN ACCESS EXCLUSIVE MODE`);
    return await run(observer);
  } finally {
    await locker.query("ROLLBACK");
    await Promise.all([locker.end(), observer.end()]);
  }
}

const runningStatements = async (observer: Client) =>
  (await observer.query(`SELECT count(*)::int AS running FROM pg_stat_activity WHERE usename = 'core_app' AND state = 'active' AND pid <> pg_backend_pid() AND query ILIKE '%ProductVariant%'`)).rows[0].running as number;

test("answers STATEMENT_TIMEOUT when a search statement exceeds its limit and leaves no statement running", async () => {
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  try {
    await withVariantsLocked(async (observer) => {
      const started = performance.now();
      expect(await search(store, { stock: "low" })).toMatchObject({ success: false, error: { code: "STATEMENT_TIMEOUT" } });
      expect(performance.now() - started).toBeLessThan(assistantReadBudget.timeout);
      expect(await runningStatements(observer)).toBe(0);
    });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "product_search_failed", operation: "search", errorCode: "STATEMENT_TIMEOUT" }), "product_search_failed");
  } finally {
    error.mockRestore();
  }
});

test("answers STATEMENT_TIMEOUT, not PERSISTENCE_UNAVAILABLE, when a detail read exceeds its limit", async () => {
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  try {
    await withVariantsLocked(async (observer) => {
      expect(await find(store, { by: "id", id: poloId as ProductId })).toMatchObject({ success: false, error: { code: "STATEMENT_TIMEOUT" } });
      expect(await runningStatements(observer)).toBe(0);
    });
    const events = error.mock.calls.map(([fields]) => (fields as { event?: string }).event);
    expect(events).toContain("product_search_failed");
    expect(events).not.toContain("product_read_persistence_failed");
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ operation: "detail" }), "product_search_failed");
  } finally {
    error.mockRestore();
  }
});

// Transaction control (BEGIN, SET TRANSACTION ISOLATION LEVEL, COMMIT) is not counted: it runs before the statement limit is set and does no work.
test("issues at most maxStatements statements for the worst-case search and the detail by SKU of a 100-variant product", async () => {
  const id = await newStore();
  const tallas = Array.from({ length: 10 }, (_, index) => `T${index}`);
  const colores = Array.from({ length: 10 }, (_, index) => `C${index}`);
  const big = await seed(id, { name: "Cien variantes", variants: tallas.flatMap((talla) => colores.map((color) => variant(talla, color, 20, 2, `big-${talla}-${color}`))) });
  const pg = await import("pg");
  const original = pg.Client.prototype.query;
  let statements: string[] = [];
  const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: unknown, ...args: unknown[]) {
    const first = args[0];
    const text = typeof first === "string" ? first : (first as { text?: string } | undefined)?.text ?? "";
    if (!/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET TRANSACTION)/i.test(text)) statements.push(text);
    return (original as (...rest: unknown[]) => unknown).apply(this, args);
  } as never);
  try {
    const worst = { text: "cien", values: ["T1", "Color: C2"], priceFromCents: 1000, priceToCents: 3000, stock: "low" as const, inCatalog: true };
    const searched = await search(id, worst);
    expect(searched.success && searched.data.total).toBe(1);
    // The storefront read of the composition joins the same snapshot with one more statement.
    const storefront = 1;
    const searchCount = statements.length + storefront;
    expect(searchCount).toBeLessThanOrEqual(assistantReadBudget.maxStatements);
    statements = [];
    const found = await find(id, { by: "sku", sku: "BIG-T9-C9" });
    expect(found.success && found.data?.product.id).toBe(big.productId);
    expect(found.success && found.data?.product.variants).toHaveLength(100);
    const detailCount = statements.length + storefront;
    expect(detailCount).toBeLessThanOrEqual(assistantReadBudget.maxStatements);
    console.info(JSON.stringify({ worstCaseSearchStatements: searchCount, detailStatements: detailCount, maxStatements: assistantReadBudget.maxStatements }));
  } finally {
    spy.mockRestore();
  }
});
