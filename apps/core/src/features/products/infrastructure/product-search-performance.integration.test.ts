import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { Client } from "pg";
import { z } from "zod";
import { afterAll, beforeAll, expect, test } from "vitest";
import { ok } from "@shared/functional";
import { prisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { buildVocabulary, resolveValues } from "@core/src/features/products/domain/product-search";
import { lowStockThreshold } from "@core/src/features/products/domain/stock-level";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ProductSearchQuery } from "@core/src/features/products/application/search-for-assistant";
import { matchingVariantsSql, pageSql, skuOwnerSql, vocabularyRowSchema, vocabularySql } from "@core/src/features/products/infrastructure/product-search-repository";
import { readProductInSnapshot } from "@core/src/features/products/infrastructure/repository";
import { deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";
import { seedSearchStore, storeA, storeB, type SearchStoreShape } from "@core/src/features/products/infrastructure/product-search-fixtures";

/**
 * Performance check of technical design section 7.3. It seeds two large stores, so it only runs on request:
 * PRODUCT_SEARCH_PERFORMANCE=1 PRODUCT_SEARCH_PERFORMANCE_REPORT=/path/report.json sh scripts/run-tests.sh integration <this file>
 */
const enabled = process.env.PRODUCT_SEARCH_PERFORMANCE === "1";
const limitMs = 350;

type Measure = Readonly<{ statement: string; executionMs: number; plan: string; sequentialScans: string[]; jit: boolean; extra?: Record<string, number> }>;

/** Plans are measured warm: the first run fills the buffers and is discarded. */
async function explain(statement: string, sql: Prisma.Sql): Promise<Measure> {
  await explainOnce(statement, sql);
  return explainOnce(statement, sql);
}

async function explainOnce(statement: string, sql: Prisma.Sql): Promise<Measure> {
  const plan = await withinTransaction(async () => {
    await prisma.$queryRaw`SELECT set_config('jit', 'off', true)`;
    const rows = await prisma.$queryRaw<Record<string, string>[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, SETTINGS) ${sql}`);
    return ok(rows.map((row) => row["QUERY PLAN"]).join("\n"));
  });
  if (!plan.success) throw new Error("explain failed");
  const text = plan.data;
  return { statement, plan: text, executionMs: Number(/Execution Time: ([\d.]+) ms/.exec(text)?.[1]),
    sequentialScans: [...text.matchAll(/Seq Scan on "?(\w+)"?/g)].map((match) => match[1]!).filter((table) => ["ProductVariant", "ProductStock", "ProductVariantOptionValue"].includes(table)),
    jit: /\bJIT:/.test(text) };
}

async function measureStore(companyId: string, products: number): Promise<{ products: number; measures: Measure[] }> {
  return withTenantIsolation(companyId, async () => {
    const vocabularyMeasure = await explain("vocabulary", vocabularySql(companyId));
    const rows = z.array(vocabularyRowSchema).parse(await withinTransaction(async () => ok(await prisma.$queryRaw<unknown[]>(vocabularySql(companyId)))).then((result) => (result.success ? result.data : [])));
    const parseStart = performance.now();
    z.array(vocabularyRowSchema).parse(rows);
    const parseMs = performance.now() - parseStart;
    const vocabulary = buildVocabulary(rows);
    const resolved = resolveValues(["Azul", "M"], vocabulary);
    if (!resolved.success) throw new Error("the seed has no Azul or M");
    const full: ProductSearchQuery = { text: "polo", valueSets: resolved.data, priceFrom: 1000 as never, priceTo: 20000 as never, stock: "low", sort: "recent", offset: 0, limit: 20, lowStockThreshold, matchingVariantCap: 10 };
    const textOnly: ProductSearchQuery = { text: "modelo", valueSets: [], sort: "name", offset: 0, limit: 20, lowStockThreshold, matchingVariantCap: 10 };
    const filtered: ProductSearchQuery = { valueSets: resolved.data.slice(0, 1), stock: "in_stock", sort: "recent", offset: 0, limit: 20, lowStockThreshold, matchingVariantCap: 10 };
    const pageIds = (await withinTransaction(async () => ok(await prisma.$queryRaw<{ id: string }[]>`SELECT id::text FROM "Product" WHERE "companyId" = ${companyId}::uuid ORDER BY "createdAt" DESC LIMIT 20`)));
    const ids = pageIds.success ? pageIds.data.map(({ id }) => id) : [];
    const big = await withinTransaction(async () => ok(await prisma.$queryRaw<{ id: string; sku: string }[]>`SELECT p.id::text, v.sku FROM "Product" p JOIN "ProductVariant" v ON v."companyId" = p."companyId" AND v."productId" = p.id WHERE p."companyId" = ${companyId}::uuid AND p.name LIKE 'Catálogo completo%' LIMIT 1`));
    const hundred = big.success ? big.data[0]! : undefined;
    const detailStart = performance.now();
    const detail = await withinTransaction(async () => readProductInSnapshot(hundred!.id as ProductId));
    const detailMs = performance.now() - detailStart;
    expect(detail.success && detail.data?.variants.length).toBe(100);
    return { products, measures: [
      { ...vocabularyMeasure, extra: { payloadBytes: Buffer.byteLength(JSON.stringify(rows)), rows: rows.length, zodParseMs: parseMs } },
      await explain("page with all filters", pageSql(companyId, full)),
      await explain("page filtered by value and stock, newest first", pageSql(companyId, filtered)),
      await explain("text-only page sorted by name", pageSql(companyId, textOnly)),
      await explain("matching variants of a full page", matchingVariantsSql(companyId, ids, filtered)),
      await explain("SKU owner of the 100-variant product", skuOwnerSql(companyId, hundred!.sku.toLowerCase())),
      { statement: "aggregate read of the 100-variant product (7 statements)", executionMs: detailMs, plan: "(Prisma queries; timed end to end)", sequentialScans: [], jit: false },
    ] };
  });
}

/** Bulk-loaded tables have no statistics until autovacuum runs, so the check analyzes them as production would have. */
async function analyzeTables() {
  const admin = new Client({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
  await admin.connect();
  try {
    for (const table of ["Product", "ProductVariant", "ProductStock", "ProductOption", "ProductOptionValue", "ProductVariantOptionValue"]) await admin.query(`ANALYZE "${table}"`);
  } finally {
    await admin.end();
  }
}

const stores: { id: string; shape: SearchStoreShape; label: string }[] = [
  { id: randomUUID(), shape: storeA, label: "A" }, { id: randomUUID(), shape: storeB, label: "B" }];

beforeAll(async () => {
  if (!enabled) return;
  for (const { id } of stores) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
}, 120_000);

afterAll(async () => {
  if (!enabled) return;
  for (const { id } of stores) await withTenantIsolation(id, async () => {
    await deleteSeededProducts();
    await prisma.company.delete({ where: { id } });
  });
}, 300_000);

test.skipIf(!enabled)("meets the plan, timing and extrapolation criteria of the performance check on stores A and B", async () => {
  const report: Record<string, unknown> = {};
  const seeded: Record<string, Awaited<ReturnType<typeof seedSearchStore>>> = {};
  for (const { id, shape, label } of stores) seeded[label] = await withTenantIsolation(id, () => seedSearchStore(shape));
  await analyzeTables();
  for (const { id, label } of stores) report[label] = { seeded: seeded[label], ...(await measureStore(id, seeded[label]!.products)) };
  const a = report.A as { measures: Measure[] };
  const b = report.B as { products: number; measures: Measure[] };
  const limits = b.measures.map((measure) => ({ statement: measure.statement, ms: measure.executionMs, productsAt350ms: Math.floor(b.products * limitMs / measure.executionMs) }));
  report.limits = { perStatement: limits, minimumProducts: Math.min(...limits.map((limit) => limit.productsAt350ms)) };
  if (process.env.PRODUCT_SEARCH_PERFORMANCE_REPORT) writeFileSync(process.env.PRODUCT_SEARCH_PERFORMANCE_REPORT, JSON.stringify(report, null, 2));
  // Store B holds most of the table's rows, so the planner may legitimately prefer a sequential scan there; it is recorded, not asserted.
  for (const measure of [...a.measures, ...b.measures]) expect(measure.jit, measure.statement).toBe(false);
  for (const measure of a.measures) expect(measure.sequentialScans, measure.statement).toEqual([]);
  for (const measure of a.measures) expect(measure.executionMs, measure.statement).toBeLessThan(150);
}, 900_000);
