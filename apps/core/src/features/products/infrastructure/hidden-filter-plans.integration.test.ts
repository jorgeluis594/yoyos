import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { Client } from "pg";
import { expect, test } from "vitest";
import { prisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";
import { coverageQuery } from "@core/src/features/products/infrastructure/text-candidates";
import { indexedProductsQuery, nearestImagesQuery } from "@core/src/features/products/infrastructure/image-embeddings";
import { presenceQuery } from "@core/src/features/products/infrastructure/catalog-search-readiness";
import { catalogNames, insertProductNames } from "@core/src/features/products/infrastructure/message-candidates-fixtures";
import { defaultTextMatchLimits, searchedWordCap, searchedWords } from "@core/src/features/products/domain/message-words";
import type { EmbeddingModel, EmbeddingVector } from "@core/src/features/products/domain/image-identification";

/**
 * EXPLAIN ANALYZE of every read that gains `hidden` filtering (design section 15), as core_app under forced RLS, with 10,000 products in two shapes:
 * all visible, and 90% hidden. Gated: `HIDDEN_PLANS_BENCH=1`, optionally `HIDDEN_PLANS_BENCH_OUT=<file>` for the full plans.
 * The embeddings are the worst case of `hasIndexedProducts`: in the 90% shape only the hidden products are embedded.
 */
const bench = process.env.HIDDEN_PLANS_BENCH;
const model = "bench/hidden" as EmbeddingModel;
const dimensions = 64;
const total = 10_000;
const message = "hola buenas tardes quiero la polera con capucha oversize negra en talla M para mi hija";

async function analyze() {
  const admin = new Client({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
  await admin.connect();
  try { await admin.query('ANALYZE "Product", "ProductVariant", "ProductPhoto", "ImageEmbedding", "Image"'); } finally { await admin.end(); }
}

async function embed(ids: readonly string[]) {
  for (let from = 0; from < ids.length; from += 2_000) {
    const chunk = ids.slice(from, from + 2_000);
    await withinTransaction(async () => {
      await prisma.image.createMany({ data: chunk.map((id) => ({ id, storageKey: `images/${id}` })) });
      await prisma.productPhoto.createMany({ data: chunk.map((id) => ({ productId: id, imageId: id, position: 0 })) });
      await prisma.$executeRaw(Prisma.sql`INSERT INTO "ImageEmbedding" ("imageId", model, embedding, "createdAt")
        SELECT i.id, ${model}, ('[' || (SELECT string_agg(random()::text, ',') FROM generate_series(1, ${dimensions}) g WHERE i.id IS NOT NULL) || ']')::vector, now()
        FROM "Image" i WHERE i.id = ANY(${chunk}::uuid[])`);
      return { success: true as const, data: null };
    });
  }
}

const mirrors = {
  /** Mirrors `hasOtherOfferedProduct` in repository.ts. */
  otherOffered: (companyId: string, productId: string) => Prisma.sql`SELECT EXISTS (SELECT 1 FROM "Product" p
      WHERE p."companyId" = ${companyId}::uuid AND p.id <> ${productId}::uuid AND p.currency = 'PEN' AND p.status = 'active' AND NOT p.hidden
        AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p.id AND v."companyId" = p."companyId" AND v.status = 'active')) AS found`,
  /** Mirrors the page cut of `catalogProductRepository.list` (T1 adds `p.hidden = false`). */
  catalogList: (companyId: string) => Prisma.sql`SELECT p.id FROM (SELECT p.id, p.name, p.currency, p."companyId", p."createdAt" FROM "Product" p
      WHERE p."companyId" = ${companyId}::uuid AND p.status = 'active' AND p.hidden = false AND p.currency = 'PEN'
        AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active')
      ORDER BY p."createdAt" DESC, p.id ASC LIMIT 25 OFFSET 0) p`,
};

test.runIf(bench)("keeps the plans of the reads that filter hidden products, with all products visible and with 90% hidden", async () => {
  const out = process.env.HIDDEN_PLANS_BENCH_OUT ?? "hidden-plans.txt";
  const summary: Record<string, Record<string, number>> = {};
  const limits = defaultTextMatchLimits;
  for (const [shape, hiddenShare] of [["all visible", 0], ["90% hidden", 0.9]] as const) {
    const company = randomUUID();
    await withTenantIsolation(company, async () => await prisma.company.create({ data: { id: company, name: company, country: "PE" } }));
    const isHidden = (index: number) => index % 10 < hiddenShare * 10;
    const ids = await withTenantIsolation(company, () => insertProductNames(["Polera con capucha oversize negra edición limitada", ...catalogNames(total - 1)], isHidden));
    await withTenantIsolation(company, () => embed(ids.filter((_, index) => (hiddenShare === 0 ? true : isHidden(index)))));
    await analyze();
    // The statement runs with the words the cap allows for the offered products, as `searchProductsByCoverage` does.
    const offered = total - ids.filter((_, index) => isHidden(index)).length;
    const words = searchedWords(message).slice(0, searchedWordCap(offered, limits));
    const vector = Array.from({ length: dimensions }, () => Math.random()) as unknown as EmbeddingVector;
    const queries: Record<string, Prisma.Sql> = {
      coverageQuery: coverageQuery(company, words, limits),
      findNearestProductImages: nearestImagesQuery(vector, model, 8),
      hasIndexedProducts: indexedProductsQuery(model),
      productPresence: presenceQuery,
      hasOtherOfferedProduct: mirrors.otherOffered(company, ids[0]!),
      catalogList: mirrors.catalogList(company),
    };
    summary[shape] = {};
    /** The same statement with the visibility test removed, to compare with what ran before the filter existed. */
    const withoutFilter = (query: Prisma.Sql) => query.text.replaceAll("NOT p.hidden", "true").replaceAll("p.hidden = false", "true");
    const explain = (query: Prisma.Sql) => withTenantIsolation(company, () => withinTransaction(async () => {
      await prisma.$queryRaw`SELECT set_config('jit', 'off', true)`;
      return { success: true as const, data: await prisma.$queryRawUnsafe<Record<string, string>[]>(`EXPLAIN (ANALYZE, BUFFERS) ${query.text}`, ...query.values) };
    }));
    for (const [name, query] of Object.entries(queries)) {
      for (const [variant, text] of [["with filter", query], ["without filter", { text: withoutFilter(query), values: query.values } as Prisma.Sql]] as const) {
        const times: number[] = [];
        let plan: string[] = [];
        for (let run = 0; run < 7; run += 1) {
          const rows = await explain(text);
          plan = rows.data.map((row) => row["QUERY PLAN"]!);
          times.push(Number(/Execution Time: ([\d.]+) ms/.exec(plan.at(-1) ?? "")?.[1]));
        }
        times.sort((left, right) => left - right);
        summary[shape]![`${name} (${variant})`] = times[3]!;
        writeFileSync(out, `=== ${shape} · ${name} · ${variant} · median ${times[3]} ms\n${plan.join("\n")}\n\n`, { flag: "a" });
      }
    }
    await withTenantIsolation(company, async () => {
      await deleteSeededProducts();
      await prisma.image.deleteMany();
      await prisma.company.delete({ where: { id: company } });
    });
  }
  writeFileSync(out, `SUMMARY ${JSON.stringify(summary)}\n`, { flag: "a" });
  expect(Object.values(summary).every((shape) => Object.values(shape).every(Number.isFinite))).toBe(true);
}, 3_600_000);
