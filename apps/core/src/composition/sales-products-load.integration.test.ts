import { writeFileSync } from "node:fs";
import pg from "pg";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ok } from "@shared/functional";
import { prisma, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { windowOf } from "@core/src/features/assistants/domain/sales-period";
import { listUnsoldProducts } from "@core/src/features/assistants/domain/product-sales-projection";
import { orders } from "@core/src/features/orders";
import { products } from "@core/src/features/products/composition";
import { saleDatesSql, soldVariantsSql } from "@core/src/features/orders/infrastructure/sold-variants-repository";
import { describeVariantsSql, stockedSql } from "@core/src/features/products/infrastructure/product-sales-repository";
import { salesReadBudget } from "@core/src/features/orders/infrastructure/sales-read";
import { removeStores, salesLoadEnabled, seedSalesLoadFixture, type SalesLoadFixture } from "@core/tests/support/sales-load-fixture";

// Opt-in: `SALES_LOAD=1 sh scripts/run-tests.sh integration src/composition/sales-products-load.integration.test.ts` seeds four years of history (minutes).
// `SALES_LOAD_SCALE=0.02` shrinks the fixture for a dry run of the mechanics; the time and page bounds apply to the full fixture only.
const scale = Number(process.env.SALES_LOAD_SCALE ?? 1);
const dryRun = scale < 1;
/** Half the statement budget: a statement at the maximum period, in its worst shape, must leave room for the variance of production hardware. */
const halfBudgetMs = salesReadBudget.statementTimeoutMs / 2;
/** Set from the measured run (123,828 buffers with the firstAfter probe, up to 12,037 pages read cold, for 12,140 variants) with 25% headroom; the pull request records the measured values. */
const pageBound = { buffers: 193_000, pagesRead: 15_100 } as const;
const itemDateIndex = "OrderItem_companyId_variantId_orderCreatedAt_orderId_idx";

let admin: pg.Client;
let fixture: SalesLoadFixture;
const measurements: Record<string, unknown>[] = [];

type PlanNode = { "Node Type": string; "Index Name"?: string; "Relation Name"?: string; "Heap Fetches"?: number; "Shared Hit Blocks"?: number; "Shared Read Blocks"?: number; Plans?: PlanNode[] };
type Explained = Readonly<{ time: number; hit: number; read: number; heapFetches: number; probeIndexes: readonly string[]; indexOnly: readonly string[]; seqScans: readonly string[]; nodeTypes: readonly string[] }>;
const nodesOf = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodesOf)];

/** `EXPLAIN (ANALYZE, BUFFERS)` of a statement as `core_app` under the forced policy of the company, inside the snapshot the reads run in. */
async function explain(companyId: string, statement: Prisma.Sql): Promise<Explained> {
  const run = await withTenantIsolation(companyId, () => withinTransaction(async () => {
    await prisma.$queryRaw`SELECT set_config('jit', 'off', true)`;
    return ok(await prisma.$queryRaw<{ "QUERY PLAN": { Plan: PlanNode; "Execution Time": number }[] }[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`));
  }, { isolationLevel: "RepeatableRead", timeout: 60_000, statementTimeoutMs: 30_000 }));
  const rows = run.success ? run.data : [];
  const [{ Plan, "Execution Time": time }] = rows[0]!["QUERY PLAN"];
  const nodes = nodesOf(Plan);
  return {
    time, hit: Plan["Shared Hit Blocks"] ?? 0, read: Plan["Shared Read Blocks"] ?? 0,
    heapFetches: nodes.reduce((sum, node) => sum + (node["Heap Fetches"] ?? 0), 0),
    probeIndexes: [...new Set(nodes.flatMap((node) => (node["Index Name"] ? [node["Index Name"]] : [])))],
    indexOnly: [...new Set(nodes.filter((node) => node["Node Type"] === "Index Only Scan").map((node) => node["Index Name"] ?? ""))],
    seqScans: nodes.filter((node) => node["Node Type"].endsWith("Seq Scan")).map((node) => node["Relation Name"] ?? ""),
    nodeTypes: [...new Set(nodes.map((node) => node["Node Type"]))],
  };
}

/** First and repeated run of a statement, the way the production note asks them: milliseconds and buffers, not only milliseconds. */
async function record(name: string, companyId: string, statement: Prisma.Sql): Promise<Readonly<{ first: Explained; repeated: Explained }>> {
  const first = await explain(companyId, statement);
  const repeats = [await explain(companyId, statement), await explain(companyId, statement)];
  const repeated = repeats.reduce((best, run) => (run.time < best.time ? run : best));
  measurements.push({ statement: name, firstMs: Math.round(first.time), repeatedMs: Math.round(repeated.time), firstHit: first.hit, firstRead: first.read, repeatedHit: repeated.hit, heapFetches: repeated.heapFetches });
  return { first, repeated };
}

/** The ids of the store's products with stock and their variants, as the unsold tool reads them for a window. */
const stockedFor = (companyId: string, before: Date) => withTenantIsolation(companyId, () => orders.readSalesForAssistant(async () => products.listStockedForAssistant({ createdBefore: before })));

describe.skipIf(!salesLoadEnabled)("the product sales reads on the history fixture", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
    await admin.connect();
    const started = Date.now();
    fixture = await seedSalesLoadFixture(admin, { scale });
    console.info(JSON.stringify({ fixtureSeededInMs: Date.now() - started, scale, storeOrders: fixture.store.orders, storeItems: fixture.store.items, variants: fixture.store.variants }));
  }, 3_600_000);

  afterAll(async () => {
    console.info(`SALES_PRODUCTS_LOAD ${JSON.stringify(measurements, null, 1)}`);
    // The test runner hides the output of a passing run: this file keeps the measured values for the pull request.
    if (process.env.SALES_LOAD_REPORT) writeFileSync(process.env.SALES_LOAD_REPORT, JSON.stringify(measurements, null, 1));
    if (fixture) await removeStores(admin, fixture.companyIds);
    await admin.end();
  }, 3_600_000);

  const year = windowOf({ from: "2027-01-01", through: "2028-01-01" });

  test("a 366-day ranking reads sold variants and descriptions of 12,000 sold variants within half the statement budget", async () => {
    const { store } = fixture;
    const sold = await record("sold_variants_366_days", store.companyId, soldVariantsSql(store.companyId, { window: year }));
    const read = await withTenantIsolation(store.companyId, () => orders.readSalesForAssistant(async () => orders.summarizeSoldVariants({ window: year }, { companyId: store.companyId as never, userId: store.sellerId as never })));
    expect(read.success).toBe(true);
    const variantIds = read.success ? read.data.variants.map((variant) => variant.variantId) : [];
    console.info(JSON.stringify({ soldVariantsInYear: variantIds.length }));
    const described = await record("descriptions_of_sold_variants", store.companyId, describeVariantsSql(store.companyId, { by: "variants", variantIds, text: "producto 1" }));
    if (!dryRun) {
      expect(variantIds.length).toBeGreaterThan(10_000);
      // Margin on the repeated run; the first run reads about 24,000 pages from outside shared buffers, so its milliseconds follow the host's disk cache (387 to 1,451 ms
      // were measured on a shared host) and the cold run is judged by the buffers it touches: the measured 135,738 plus 25%.
      expect(sold.first.hit + sold.first.read).toBeLessThanOrEqual(170_000);
      expect(sold.repeated.time).toBeLessThanOrEqual(halfBudgetMs * 0.8);
      expect(described.repeated.time).toBeLessThanOrEqual(salesReadBudget.statementTimeoutMs / 4);
    }
  });

  test("the 30-day sold variants are not slower on four years of history than on one (within 1.5 times plus 50 ms)", async () => {
    const month = windowOf(fixture.windows.month);
    const best = async (companyId: string) => {
      const times: number[] = [];
      for (let run = 0; run < 5; run += 1) times.push((await explain(companyId, soldVariantsSql(companyId, { window: month }))).time);
      return Math.min(...times);
    };
    // The plan must not depend on the ANALYZE sample: after three more passes the items of the window are still probed by index, never read by a table scan.
    for (let pass = 0; pass < 3; pass += 1) {
      await admin.query('ANALYZE "OrderItem"');
      await admin.query('ANALYZE "Order"');
      const planned = await explain(fixture.store.companyId, soldVariantsSql(fixture.store.companyId, { window: month }));
      expect({ pass, seqScans: planned.seqScans, nodeTypes: planned.nodeTypes }).toMatchObject({ seqScans: expect.not.arrayContaining(["OrderItem"]) });
      expect({ pass, probeIndexes: planned.probeIndexes, nodeTypes: planned.nodeTypes }).toMatchObject({ probeIndexes: expect.arrayContaining(["OrderItem_companyId_orderId_variantId_key"]) });
    }
    const fourYears = await best(fixture.store.companyId);
    const oneYear = await best(fixture.oneYearStore.companyId);
    measurements.push({ statement: "sold_variants_30_days", fourYearsMs: Math.round(fourYears), oneYearMs: Math.round(oneYear) });
    expect(fourYears).toBeLessThanOrEqual(oneYear * 1.5 + 50);
  });

  describe.each([{ label: "30 days", period: { from: "2027-12-03", through: "2028-01-01" } }, { label: "366 days", period: { from: "2027-01-01", through: "2028-01-01" } }])("productos_sin_ventas, $label", ({ label, period }) => {
    const window = windowOf(period);

    test("reads the stocked products and the item dates of the checked variants within half the statement budget, with the stale 80-variant page first", async () => {
      const { store } = fixture;
      const stockedStatement = await record(`stocked_${label}`, store.companyId, stockedSql(store.companyId, { createdBefore: window.before }));
      const stocked = await stockedFor(store.companyId, window.before);
      expect(stocked.success).toBe(true);
      const checked = stocked.success ? stocked.data.checked : [];
      const variantIds = checked.flatMap((product) => product.variantIds);
      console.info(JSON.stringify({ label, checkedProducts: checked.length, checkedVariants: variantIds.length }));
      // The past-period shape adds the `firstAfter` probe for every unsold variant: both shapes are measured and bounded.
      const shapes = [false, true] as const;
      const datesStatements = [];
      for (const needFirstAfter of shapes) datesStatements.push(await record(`item_dates_${label}_first_after_${needFirstAfter}`, store.companyId, saleDatesSql(store.companyId, { window, variantIds, needFirstAfter })));
      const dates = await withTenantIsolation(store.companyId, () => orders.readSalesForAssistant(async () => orders.findVariantSaleDates({ window, variantIds, needFirstAfter: false }, { companyId: store.companyId as never, userId: store.sellerId as never })));
      expect(dates.success).toBe(true);
      const list = listUnsoldProducts(
        checked.map((product) => ({ ...product, id: product.id })), dates.success ? dates.data : [], { page: 1, periodEndedBeforeToday: false },
      );
      // The wide product and the stale products have the most stock, so they are the first page; each of their variants has 3,000 old valid sales to walk past.
      const worstShape = new Set([...store.staleProductIds, store.wideProductId]);
      expect(list.items.slice(0, 20).every((item) => worstShape.has(item.product.id))).toBe(true);
      expect(list.items.slice(0, 20).some((item) => item.product.id === store.wideProductId)).toBe(true);
      expect(list.items[0]!.lastBefore).not.toBeNull();
      if (!dryRun) {
        expect(variantIds.length).toBeGreaterThan(8_000);
        expect(stockedStatement.repeated.time).toBeLessThanOrEqual(halfBudgetMs);
        for (const statement of datesStatements) expect(statement.repeated.time).toBeLessThanOrEqual(halfBudgetMs);
      }
    });
  });

  test("the item-dates statement for 12,000 checked variants costs the same at one year and at four (within 1.5 times plus 50 ms) and its probes are index-only scans of the item date index", async () => {
    const window = windowOf({ from: "2027-12-03", through: "2028-01-01" });
    const timesOf = async (companyId: string) => {
      const stocked = await stockedFor(companyId, window.before);
      const variantIds = stocked.success ? stocked.data.checked.flatMap((product) => product.variantIds) : [];
      const runs = [];
      for (let run = 0; run < 3; run += 1) runs.push(await explain(companyId, saleDatesSql(companyId, { window, variantIds, needFirstAfter: false })));
      return runs.reduce((best, current) => (current.time < best.time ? current : best));
    };
    const fourYears = await timesOf(fixture.store.companyId);
    const oneYear = await timesOf(fixture.oneYearStore.companyId);
    measurements.push({ statement: "item_dates_four_vs_one_year", fourYearsMs: Math.round(fourYears.time), oneYearMs: Math.round(oneYear.time), probeIndexes: fourYears.probeIndexes, nodeTypes: fourYears.nodeTypes });
    expect(fourYears.indexOnly).toContain(itemDateIndex);
    expect(fourYears.heapFetches).toBe(0);
    expect(fourYears.time).toBeLessThanOrEqual(oneYear.time * 1.5 + 50);
  });

  test("the item-dates statement for 12,000 checked variants touches at most the page bound after the buffers of OrderItem, its index and Order are evicted", async () => {
    const { store } = fixture;
    const window = windowOf({ from: "2027-12-03", through: "2028-01-01" });
    const stocked = await stockedFor(store.companyId, window.before);
    const variantIds = stocked.success ? stocked.data.checked.flatMap((product) => product.variantIds) : [];
    await admin.query("CREATE EXTENSION IF NOT EXISTS pg_buffercache");
    // An eviction that fails fails the test: a "cold" run that was warm would pass the page bound for nothing.
    const evict = async () => {
      for (const relation of ["OrderItem", itemDateIndex, "Order", "Order_pkey"]) {
        const evicted = await admin.query<{ evicted: number }>(`SELECT buffers_evicted AS evicted FROM pg_buffercache_evict_relation('"${relation}"'::regclass)`);
        expect(evicted.rowCount).toBe(1);
      }
    };
    for (const needFirstAfter of [false, true] as const) {
      await evict();
      const cold = await explain(store.companyId, saleDatesSql(store.companyId, { window, variantIds, needFirstAfter }));
      const warm = await explain(store.companyId, saleDatesSql(store.companyId, { window, variantIds, needFirstAfter }));
      measurements.push({ statement: `item_dates_pages_first_after_${needFirstAfter}`, variants: variantIds.length, coldMs: Math.round(cold.time), coldHit: cold.hit, coldRead: cold.read, warmHit: warm.hit, heapFetches: cold.heapFetches });
      expect(cold.indexOnly).toContain(itemDateIndex);
      expect(cold.heapFetches).toBe(0);
      if (!dryRun) {
        expect(cold.hit + cold.read).toBeLessThanOrEqual(pageBound.buffers);
        expect(cold.read).toBeLessThanOrEqual(pageBound.pagesRead);
      }
    }
  });
});


