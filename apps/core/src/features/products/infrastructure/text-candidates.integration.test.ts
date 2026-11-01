import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { prisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { seedProduct, deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";
import { saveEmbedding } from "@core/src/features/products/infrastructure/image-embeddings";
import { coverageQuery, searchMentionsByCoverage, searchProductsByCoverage } from "@core/src/features/products/infrastructure/text-candidates";
import { findMessageCandidates } from "@core/src/features/products/application/find-message-candidates";
import { defaultTextMatchLimits, searchedWords } from "@core/src/features/products/domain/message-words";
import { catalogNames, insertProductNames } from "@core/src/features/products/infrastructure/message-candidates-fixtures";
import { hasActiveProducts } from "@core/src/features/products/infrastructure/catalog-search-readiness";
import { catalogSearchReadiness } from "@core/src/features/products/application/catalog-search-readiness";
import { hasIndexedProducts } from "@core/src/features/products/infrastructure/image-embeddings";
import type { EmbeddingModel, EmbeddingVector } from "@core/src/features/products/domain/image-identification";
import type { ProductId } from "@core/src/features/products/domain/product";
import { productNameKey } from "@core/src/features/products/domain/product-name-key";
import { defaultMentionPairBudget } from "@core/src/features/products/domain/message-words";

const model = "openai/text-test" as EmbeddingModel;
const companyA = randomUUID();
const companyB = randomUUID();

async function product(companyId: string, name: string, variants: readonly { price: number; attributes?: Record<string, string> }[], status = "active", imageId: string | null = null) {
  const id = randomUUID() as ProductId;
  await withTenantIsolation(companyId, async () => {
    // seedProduct always gives a product a variant; a product without any is written directly.
    if (!variants.length) await prisma.product.create({ data: { id, name, currency: "PEN", qrCode: id, status, createdAt: new Date(), updatedAt: new Date(),
      ...(imageId && { photos: { create: { imageId, position: 0 } } }) } });
    else await seedProduct({ id, name, qrCode: id, status, photoIds: imageId ? [imageId] : [], variants: variants.map((variant) => ({ attributes: variant.attributes, salePrice: variant.price })) });
  });
  return id;
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
});

afterAll(async () => {
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => {
    await deleteSeededProducts();
    await prisma.image.deleteMany();
    await prisma.company.delete({ where: { id } });
  });
});

test("search readiness reports no searchable photos until an active product image is embedded", async () => {
  const deps = (visualModel: EmbeddingModel | null) => ({ visualModel, hasActiveProducts, hasIndexedProducts });
  const empty = randomUUID();
  await withTenantIsolation(empty, async () => await prisma.company.create({ data: { id: empty, name: empty, country: "PE" } }));
  expect(await withTenantIsolation(empty, () => catalogSearchReadiness(deps(model)))).toEqual({ success: true, data: "no_active_products" });
  await withTenantIsolation(empty, async () => await prisma.company.delete({ where: { id: empty } }));

  const imageId = randomUUID();
  await withTenantIsolation(companyB, async () => await prisma.image.create({ data: { id: imageId, storageKey: `images/${imageId}` } }));
  await product(companyB, "Polo con foto", [{ price: 10 }], "active", imageId);
  expect(await withTenantIsolation(companyB, () => catalogSearchReadiness(deps(model)))).toEqual({ success: true, data: "no_searchable_photos" });
  await withTenantIsolation(companyB, () => saveEmbedding({ imageId: imageId as never, model, vector: [1, 0, 0] as unknown as EmbeddingVector }));
  expect(await withTenantIsolation(companyB, () => catalogSearchReadiness(deps(model)))).toEqual({ success: true, data: "ready" });
  expect(await withTenantIsolation(companyB, () => catalogSearchReadiness(deps(null)))).toEqual({ success: true, data: "no_searchable_photos" });
});

const limits = { ...defaultTextMatchLimits, timeoutMs: 1_000 };
const candidates = (companyId: string, text: string, overrides: Partial<typeof limits> = {}) => withTenantIsolation(companyId, async () => {
  const result = await findMessageCandidates(text, { searchByCoverage: (words) => searchProductsByCoverage(words, { ...limits, ...overrides }) });
  if (!result.success) throw new Error(result.error.message);
  return result.data;
});
const namesOf = async (companyId: string, ids: readonly string[]) => (await withTenantIsolation(companyId, async () => await prisma.product.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })))
  .sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id)).map(({ name }) => name);

async function freshCompany() {
  const id = randomUUID();
  await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
  return id;
}
async function dropCompany(id: string) {
  await withTenantIsolation(id, async () => {
    await deleteSeededProducts();
    await prisma.company.delete({ where: { id } });
  });
}

test("finds the products whose name appears in a whole message", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(["Polo rojo", "Polo azul", "Polo rojo básico", "Gorra roja", "Zapatilla blanca"]));
  const found = await candidates(company, "quiero el polo rojo M");
  expect(await namesOf(company, found.productIds)).toEqual(expect.arrayContaining(["Polo rojo", "Polo azul", "Polo rojo básico"]));
  expect((await namesOf(company, found.productIds))[0]).toBe("Polo rojo");
  expect(found).toMatchObject({ timedOut: false, matchCount: expect.any(Number) });
  const nothing = await candidates(company, "hola");
  expect(nothing).toMatchObject({ productIds: [], matchCount: 0, timedOut: false });
  await dropCompany(company);
});

const inactive = (name: string) => seedProduct({ name, variants: [{ status: "inactive" }] });
const rawRows = (companyId: string, text: string) => withTenantIsolation(companyId, () => withinTransaction(async () => ({ success: true as const,
  data: await prisma.$queryRaw<{ id: string; sellable: boolean; matches: number }[]>(coverageQuery(companyId, searchedWords(text), limits)) })));

test("candidates include the unavailable twin of an active product", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(["Casaca denim"]));
  await withTenantIsolation(company, () => inactive("Casaca jean"));
  const found = await candidates(company, "quiero la casaca jean en L");
  expect(await namesOf(company, found.productIds)).toEqual(["Casaca denim"]);
  expect(await namesOf(company, found.unavailableProductIds)).toEqual(["Casaca jean"]);
  await dropCompany(company);
});

test("a not-sellable product named like a sellable one up to accents and case is not returned when both match", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(["polo basico", "Gorra roja"]));
  await withTenantIsolation(company, () => inactive("Polo básico"));
  await withTenantIsolation(company, () => inactive("POLO BÁSICO"));
  const found = await candidates(company, "quiero el polo basico");
  expect(await namesOf(company, found.productIds)).toEqual(["polo basico"]);
  expect(found.unavailableProductIds).toEqual([]);
  await dropCompany(company);
});

test("a fully uppercase accented not-sellable name has the same key in SQL as in productNameKey", async () => {
  const company = await freshCompany();
  const names = ["CAMISÓN AÑEJO ÇÀ", "Camisón añejo çà"];
  await withTenantIsolation(company, () => insertProductNames([names[1]!]));
  await withTenantIsolation(company, () => inactive(names[0]!));
  expect(productNameKey(names[0]!)).toBe(productNameKey(names[1]!));
  const found = await candidates(company, "quiero el camison anejo");
  expect(found.unavailableProductIds).toEqual([]);
  expect(found.productIds).toHaveLength(1);
  await dropCompany(company);
});

test("a company whose products all have only inactive variants returns no candidates", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => inactive("Casaca jean"));
  await withTenantIsolation(company, () => inactive("Casaca denim"));
  expect(await candidates(company, "quiero la casaca jean")).toMatchObject({ productIds: [], unavailableProductIds: [], matchCount: 0, timedOut: false });
  await dropCompany(company);
});

test("at most the configured sellable and not-sellable candidates leave the statement, and matchCount counts sellable matches", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(Array.from({ length: 20 }, (_, index) => `Chompa verde modelo ${index}`)));
  for (let index = 0; index < 10; index += 1) await withTenantIsolation(company, () => inactive(`Chompa verde agotada ${index}`));
  const rows = await rawRows(company, "quiero la chompa verde");
  expect(rows.data).toHaveLength(10);
  expect(rows.data.filter(({ sellable }) => sellable)).toHaveLength(8);
  expect(rows.data.filter(({ sellable }) => !sellable)).toHaveLength(2);
  expect(rows.data.every(({ matches }) => matches === 20)).toBe(true);
  await dropCompany(company);
});

const mentionLimits = { ...limits, candidates: 5, pairBudget: defaultMentionPairBudget };
const searchMentions = (companyId: string, mentions: readonly string[], overrides: Partial<typeof mentionLimits> = {}) => withTenantIsolation(companyId, async () => {
  const result = await searchMentionsByCoverage(mentions, { ...mentionLimits, ...overrides });
  if (!result.success) throw new Error(result.error.message);
  return result.data;
});

test("ranks each mention's own products and keeps the unavailable twin apart", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(["Casaca denim", "Polo rojo", "Polo azul", "Gorra negra"]));
  await withTenantIsolation(company, () => inactive("Casaca jean"));
  const found = await searchMentions(company, ["casaca jean", "polo rojo", "zapatilla"]);
  expect(found.timedOut).toBe(false);
  expect(await namesOf(company, found.mentions[0]!.productIds)).toEqual(["Casaca denim"]);
  expect(await namesOf(company, found.mentions[0]!.unavailableProductIds)).toEqual(["Casaca jean"]);
  expect((await namesOf(company, found.mentions[1]!.productIds))[0]).toBe("Polo rojo");
  expect(found.mentions[2]).toMatchObject({ productIds: [], unavailableProductIds: [], matchCount: 0, wordsSearched: 1 });
  await dropCompany(company);
});

test("searches every mention of a message in one statement on one connection", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(Array.from({ length: 10 }, (_, index) => `Modelo${index} especial`)));
  const spy = vi.spyOn(prisma, "$queryRaw");
  const found = await searchMentions(company, Array.from({ length: 10 }, (_, index) => `modelo${index} especial`));
  const statements = spy.mock.calls.map(([query]) => (query as { strings?: readonly string[] }).strings?.join("?") ?? "");
  spy.mockRestore();
  expect(statements.filter((text) => text.includes("word_similarity"))).toHaveLength(1);
  expect(found.mentions.map(({ wordsSearched }) => wordsSearched).reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(10);
  expect(await Promise.all(found.mentions.map((mention, index) => namesOf(company, mention.productIds).then((names) => names[0] === `Modelo${index} especial`)))).toEqual(Array(10).fill(true));
  await dropCompany(company);
});

test("a mention search that runs out of budget after waiting for a connection returns a timed-out empty result", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(catalogNames(5_000)));
  const budgetMs = 400;
  const held = await holdEveryConnection();
  setTimeout(held.release, budgetMs - 5);
  const found = await searchMentions(company, ["polera negra con capucha", "casaca azul"], { timeoutMs: budgetMs });
  await held.done;
  expect(found.timedOut).toBe(true);
  expect(found.mentions).toHaveLength(2);
  expect(found.mentions.every(({ productIds, unavailableProductIds }) => !productIds.length && !unavailableProductIds.length)).toBe(true);
  await dropCompany(company);
}, 30_000);

test("a mention search that cannot get a connection within its budget returns a timed-out empty result", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(["Polo rojo"]));
  const held = await holdEveryConnection();
  const started = performance.now();
  const found = await searchMentions(company, ["polo rojo"], { timeoutMs: 200 });
  const waitedMs = performance.now() - started;
  held.release();
  await held.done;
  expect(found).toMatchObject({ timedOut: true, mentions: [{ productIds: [], unavailableProductIds: [] }] });
  expect(waitedMs).toBeLessThan(1_500);
  await dropCompany(company);
}, 30_000);

/** Occupies every connection of the pool with an open transaction until `release` is called; resolves once all are held. */
async function holdEveryConnection(connections = 10) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let acquired!: () => void;
  const allHeld = new Promise<void>((resolve) => { acquired = resolve; });
  let count = 0;
  const done = Promise.all(Array.from({ length: connections }, () => withTenantIsolation(companyA, () => withinTransaction(async () => {
    await prisma.$queryRaw`SELECT 1`;
    count += 1;
    if (count === connections) acquired();
    await gate;
    return { success: true as const, data: null };
  }, { timeout: 60_000, maxWait: 10_000 }))));
  await allHeld;
  return { release, done };
}

test("finds a long product name from a partial mention", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(["Polera con capucha oversize", "Gorra negra", "Zapatilla blanca"]));
  expect(await namesOf(company, (await candidates(company, "quiero la polera negra M")).productIds)).toContain("Polera con capucha oversize");
  await dropCompany(company);
});

test("finds «Polerón» from «poleron»", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(["Polerón", "Pantalón"]));
  expect(await namesOf(company, (await candidates(company, "quiero un poleron")).productIds)).toEqual(["Polerón"]);
  await dropCompany(company);
});

test("finds a product named with the longest words of a long message", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(["Mochila impermeable", ...catalogNames(200)]));
  const filler = "hola buenas tardes disculpe la molestia quisiera saber si tienen disponible para entrega mañana en la tarde ";
  expect(await namesOf(company, (await candidates(company, `${filler}la mochila impermeable por favor`)).productIds)).toContain("Mochila impermeable");
  await dropCompany(company);
});

test("leaves out inactive products and other companies' products from message candidates", async () => {
  const company = await freshCompany();
  const other = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(["Polo activo"]));
  await withTenantIsolation(company, () => seedProduct({ name: "Polo sin variante activa", variants: [{ status: "inactive" }] }));
  await withTenantIsolation(other, () => insertProductNames(["Polo de otra empresa"]));
  expect(await namesOf(company, (await candidates(company, "quiero un polo")).productIds)).toEqual(["Polo activo"]);
  await dropCompany(company);
  await dropCompany(other);
});

test("ranks the polera named with four words above products sharing only «con» or «negro»", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(["Polera con capucha oversize negra edición limitada", "Polo con capucha negro slim 66", "Polo con bolsillos negro", "Casaca con cierre negra", "Gorra negra"]));
  const found = await candidates(company, "hola buenas tardes quiero la polera con capucha oversize negra en talla M para mi hija, cuánto cuesta");
  expect((await namesOf(company, found.productIds))[0]).toBe("Polera con capucha oversize negra edición limitada");
  await dropCompany(company);
});

test("keeps the named product in the top eight when 1,000 names share a word with the message", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(["Polera con capucha oversize negra edición limitada", ...catalogNames(1_000, "shared")]));
  const found = await candidates(company, "quiero la polera con capucha oversize negra en talla M");
  expect(await namesOf(company, found.productIds)).toContain("Polera con capucha oversize negra edición limitada");
  expect(found.productIds).toHaveLength(8);
  await dropCompany(company);
});

test("continues without candidates when the candidate query times out", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(catalogNames(3_000)));
  const found = await candidates(company, "quiero la polera negra con capucha", { timeoutMs: 1 });
  expect(found).toMatchObject({ productIds: [], timedOut: true });
  await dropCompany(company);
});

test("applies the word cap of the company's catalog size to the statement", async () => {
  const company = await freshCompany();
  await withTenantIsolation(company, () => insertProductNames(["Polo rojo", "Polo azul"]));
  const message = "quiero comprar polo rojo azul verde negro blanco";
  expect((await candidates(company, message, { pairBudget: 25_000 })).wordsSearched).toBe(searchedWords(message).length);
  expect((await candidates(company, message, { pairBudget: 8, minWords: 1 })).wordsSearched).toBe(4);
  expect((await candidates(company, message, { pairBudget: 2, minWords: 3 })).wordsSearched).toBe(3);
  await dropCompany(company);
});

/** Production tables are analyzed by autovacuum; a freshly bulk-loaded benchmark table is analyzed by hand, as the table owner. */
async function analyzeProducts() {
  const admin = new Client({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
  await admin.connect();
  try { await admin.query('ANALYZE "Product", "ProductVariant"'); } finally { await admin.end(); }
}

const bench = process.env.CANDIDATES_BENCH;
const target = "Polera con capucha oversize negra edición limitada";
const greeting = "hola buenas tardes quiero la polera con capucha oversize negra en talla M para mi hija";
const longWords = ["agradeciendo", "anticipadamente", "disponibilidad", "comunicarse", "inmediatamente", "consultando", "respuesta", "ubicacion"];
const benchMessages: Record<string, string> = {
  "5 words": "quiero la polera oversize negra",
  "14 words": `${greeting}, cuánto cuesta`,
  "30 words": `${greeting} y además ${longWords.slice(0, 3).join(" ")} por favor dime cuánto cuesta y si hay stock ahora mismo`,
  "2000 chars": `${Array.from({ length: 40 }, (_, index) => `${longWords[index % longWords.length]}${index}`).join(" ")} ${greeting}`.padEnd(2_000, " gracias").slice(0, 2_000),
  "near forms": "quiero la polera negra o la polera negro con capucha oversize",
};

test.runIf(bench)("keeps p95 under 150 ms and the named product in the top eight for natural messages up to 10,000 products as core_app with forced RLS", async () => {
  const out = process.env.CANDIDATES_BENCH_OUT ?? "candidates-bench.jsonl";
  const benchLimits = { ...limits, pairBudget: Number(process.env.CANDIDATES_BENCH_BUDGET) || limits.pairBudget, minWords: Number(process.env.CANDIDATES_BENCH_MIN_WORDS) || limits.minWords };
  const misses: string[] = [];
  let crowded: string | null = null;
  for (const others of ["none", "20,000"]) for (const products of (process.env.CANDIDATES_BENCH_SIZES ?? "500,5000,10000").split(",").map(Number)) for (const shape of ["mixed", "shared"] as const) {
    if (others === "20,000" && !crowded) {
      crowded = await freshCompany();
      await withTenantIsolation(crowded, () => insertProductNames(catalogNames(20_000)));
      await analyzeProducts();
    }
    const owner = await freshCompany();
    await withTenantIsolation(owner, () => insertProductNames([target, ...catalogNames(products - 1, shape)]));
    await analyzeProducts();
    for (const [message, text] of Object.entries(benchMessages)) {
      const times: number[] = [];
      let last: Awaited<ReturnType<typeof candidates>> | null = null;
      for (let run = 0; run < 50; run += 1) {
        const started = performance.now();
        last = await candidates(owner, text, benchLimits);
        times.push(performance.now() - started);
      }
      times.sort((left, right) => left - right);
      const plan = await withTenantIsolation(owner, () => withinTransaction(async () => {
        await prisma.$queryRaw`SELECT set_config('jit', 'off', true)`;
        const words = searchedWords(text).slice(0, last!.wordsSearched);
        return { success: true as const, data: await prisma.$queryRaw<Record<string, string>[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${coverageQuery(owner, words, benchLimits)}`) };
      }));
      const names = await namesOf(owner, last!.productIds);
      const kept = searchedWords(text).slice(0, last!.wordsSearched);
      const targetWordsKept = ["polera", "capucha", "oversize"].filter((word) => searchedWords(text).includes(word)).every((word) => kept.includes(word));
      const cell = { products, shape, others, message, p50: Math.round(times[24]!), p95: Math.round(times[47]!), wordsSearched: last!.wordsSearched, matchCount: last!.matchCount,
        targetRank: names.indexOf(target) + 1, targetWordsKept, plan: plan.data.map((row) => row["QUERY PLAN"]) };
      writeFileSync(out, `${JSON.stringify(cell)}\n`, { flag: "a" });
      const summary = JSON.stringify({ ...cell, plan: undefined });
      if (cell.p95 >= 150) misses.push(`latency ${summary}`);
      if (targetWordsKept && cell.targetRank === 0) misses.push(`recall ${summary}`);
    }
    await dropCompany(owner);
  }
  if (crowded) await dropCompany(crowded);
  expect(misses).toEqual([]);
}, 3_600_000);
