import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, expect, test } from "vitest";
import { prisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { seedProduct, deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";
import { saveEmbedding } from "@core/src/features/products/infrastructure/image-embeddings";
import { coverageQuery, findTextCandidates, searchProductsByCoverage } from "@core/src/features/products/infrastructure/text-candidates";
import { findMessageCandidates } from "@core/src/features/products/application/find-message-candidates";
import { defaultTextMatchLimits, searchedWords } from "@core/src/features/products/domain/message-words";
import { catalogNames, insertProductNames } from "@core/src/features/products/infrastructure/message-candidates-fixtures";
import { hasActiveProducts } from "@core/src/features/products/infrastructure/catalog-search-readiness";
import { catalogSearchReadiness } from "@core/src/features/products/application/catalog-search-readiness";
import { hasIndexedProducts } from "@core/src/features/products/infrastructure/image-embeddings";
import { loadSellableVariants } from "@core/src/features/products/infrastructure/order-stock";
import type { EmbeddingModel, EmbeddingVector } from "@core/src/features/products/domain/image-identification";
import type { ProductId } from "@core/src/features/products/domain/product";

const model = "openai/text-test" as EmbeddingModel;
const companyA = randomUUID();
const companyB = randomUUID();
const options = { limit: 8, minSimilarity: 0.3 };

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

test("text candidates come only from the company's active sellable products with their price range", async () => {
  const basic = await product(companyA, "Polo básico", [{ price: 35, attributes: { Talla: "S" } }, { price: 40, attributes: { Talla: "M" } }]);
  await product(companyA, "Polo sin variantes", []);
  await product(companyA, "Gorra", [{ price: 20 }]);
  await product(companyB, "Polo de otra empresa", [{ price: 1 }]);
  const result = await withTenantIsolation(companyA, () => findTextCandidates([{ mention: "polo basico" }, { mention: "zapatillas" }], options));
  expect(result.success).toBe(true);
  if (!result.success) return;
  expect(result.data).toHaveLength(2);
  expect(result.data[0]!.map(({ productId, name, minPrice, maxPrice }) => ({ productId, name, minPrice, maxPrice })))
    .toEqual([{ productId: basic, name: "Polo básico", minPrice: { amount: 35, currency: "PEN" }, maxPrice: { amount: 40, currency: "PEN" } }]);
  expect(result.data[0]![0]!.similarity).toBeGreaterThan(0.3);
  expect(result.data[1]).toEqual([]);
});

test("loads the sellable variants of several products in one call, in saved option order, and omits products without variants", async () => {
  const sizes = await product(companyA, "Camisa", [{ price: 50, attributes: { Talla: "M" } }, { price: 55, attributes: { Talla: "L" } }]);
  const bare = await product(companyA, "Camisa sin variantes", []);
  const loaded = await withTenantIsolation(companyA, () => loadSellableVariants([sizes, bare]));
  expect(loaded.success && loaded.data.map(({ productId, name, variants }) => ({ productId, name, sizes: variants.map(({ variantAttributes }) => variantAttributes.Talla) })))
    .toEqual([{ productId: sizes, name: "Camisa", sizes: ["M", "L"] }]);
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
  expect((await candidates(company, message, { pairBudget: 40_000 })).wordsSearched).toBe(searchedWords(message).length);
  expect((await candidates(company, message, { pairBudget: 8, minWords: 1 })).wordsSearched).toBe(4);
  expect((await candidates(company, message, { pairBudget: 2, minWords: 3 })).wordsSearched).toBe(3);
  await dropCompany(company);
});

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
  let crowded: string | null = null;
  for (const others of ["none", "20,000"]) for (const products of [500, 5_000, 10_000]) for (const shape of ["mixed", "shared"] as const) {
    if (others === "20,000" && !crowded) {
      crowded = await freshCompany();
      await withTenantIsolation(crowded, () => insertProductNames(catalogNames(20_000)));
    }
    const owner = await freshCompany();
    await withTenantIsolation(owner, () => insertProductNames([target, ...catalogNames(products - 1, shape)]));
    for (const [message, text] of Object.entries(benchMessages)) {
      const times: number[] = [];
      let last: Awaited<ReturnType<typeof candidates>> | null = null;
      for (let run = 0; run < 50; run += 1) {
        const started = performance.now();
        last = await candidates(owner, text);
        times.push(performance.now() - started);
      }
      times.sort((left, right) => left - right);
      const plan = await withTenantIsolation(owner, () => withinTransaction(async () => {
        await prisma.$queryRaw`SELECT set_config('jit', 'off', true)`;
        const words = searchedWords(text).slice(0, last!.wordsSearched);
        return { success: true as const, data: await prisma.$queryRaw<Record<string, string>[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${coverageQuery(owner, words, limits)}`) };
      }));
      const names = await namesOf(owner, last!.productIds);
      const kept = searchedWords(text).slice(0, last!.wordsSearched);
      const targetWordsKept = ["polera", "capucha", "oversize"].every((word) => kept.includes(word));
      const cell = { products, shape, others, message, p50: Math.round(times[24]!), p95: Math.round(times[47]!), wordsSearched: last!.wordsSearched, matchCount: last!.matchCount,
        targetRank: names.indexOf(target) + 1, targetWordsKept, plan: plan.data.map((row) => row["QUERY PLAN"]) };
      writeFileSync(out, `${JSON.stringify(cell)}\n`, { flag: "a" });
      expect(cell.p95, JSON.stringify({ ...cell, plan: undefined })).toBeLessThan(150);
      if (targetWordsKept) expect(cell.targetRank, JSON.stringify({ ...cell, plan: undefined })).toBeGreaterThan(0);
    }
    await dropCompany(owner);
  }
  if (crowded) await dropCompany(crowded);
}, 3_600_000);
