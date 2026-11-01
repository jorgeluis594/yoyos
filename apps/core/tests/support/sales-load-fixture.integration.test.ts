import pg from "pg";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { windowOf } from "@core/src/features/assistants/domain/sales-period";
import { visibleOrder } from "@core/src/features/orders/infrastructure/order-visibility";
import { removeStores, salesLoadEnabled, seedSalesLoadFixture, type SalesLoadFixture } from "@core/tests/support/sales-load-fixture";

// Opt-in: `SALES_LOAD=1 sh scripts/run-tests.sh integration tests/support` seeds four years of history (minutes). `SALES_LOAD_SCALE=0.02` shrinks it for a dry run.
const scale = Number(process.env.SALES_LOAD_SCALE ?? 1);
const dryRun = scale < 1;
const orderIndex = "Order_companyId_createdAt_id_key";
const itemDateIndex = "OrderItem_companyId_variantId_orderCreatedAt_orderId_idx";

let admin: pg.Client;
let fixture: SalesLoadFixture;

type PlanNode = { "Index Name"?: string; "Node Type": string; Plans?: PlanNode[] };
const nodesOf = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodesOf)];

/** `EXPLAIN` of a statement as `core_app` under the forced RLS policy of the company, the way the reads run. */
async function explain(companyId: string, statement: Prisma.Sql, analyze = false) {
  const options = analyze ? Prisma.sql`ANALYZE, BUFFERS, FORMAT JSON` : Prisma.sql`FORMAT JSON`;
  const rows = await withTenantIsolation(companyId, async () => await prisma.$queryRaw<{ "QUERY PLAN": { Plan: PlanNode; "Execution Time"?: number }[] }[]>(Prisma.sql`EXPLAIN (${options}) ${statement}`));
  const [{ Plan, "Execution Time": time }] = rows[0]!["QUERY PLAN"];
  return { nodes: nodesOf(Plan), indexes: nodesOf(Plan).flatMap((node) => (node["Index Name"] ? [node["Index Name"]] : [])), time: time ?? 0 };
}

/** The window read of the sales reads: the orders of a period that are visible and not cancelled, bounds typed `timestamp` so the index stays usable. */
const windowRead = (companyId: string, period: Readonly<{ from: string; through: string }>) => {
  const { from, before } = windowOf(period);
  return Prisma.sql`SELECT o.id, o.total FROM "Order" o WHERE o."companyId" = ${companyId}::uuid AND o."createdAt" >= ${from.toISOString()}::timestamp
    AND o."createdAt" < ${before.toISOString()}::timestamp AND ${visibleOrder} AND NOT o.cancelled`;
};

describe.skipIf(!salesLoadEnabled)("the sales history fixture", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
    await admin.connect();
    const started = Date.now();
    fixture = await seedSalesLoadFixture(admin, { scale });
    const counts = await admin.query(`SELECT (SELECT count(*) FROM "Order" WHERE "companyId" = $1)::int AS store_orders, (SELECT count(*) FROM "OrderItem" WHERE "companyId" = $1)::int AS store_items,
      (SELECT count(*) FROM "Payment" WHERE "companyId" = $1)::int AS store_payments, (SELECT count(*) FROM "Order" WHERE "companyId" = ANY($2::uuid[]))::int AS all_orders`, [fixture.store.companyId, fixture.companyIds]);
    console.info(JSON.stringify({ fixtureSeededInMs: Date.now() - started, scale, ...counts.rows[0], variants: fixture.store.variants }));
  }, 3_600_000);

  afterAll(async () => {
    if (fixture) await removeStores(admin, fixture.companyIds);
    await admin.end();
  }, 3_600_000);

  test("both new indexes are valid (pg_index.indisvalid) and the dropped one is gone", async () => {
    const rows = (await admin.query<{ name: string; valid: boolean }>(`SELECT c.relname AS name, i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = ANY($1)`, [[orderIndex, itemDateIndex, "OrderItem_companyId_variantId_idx"]])).rows;
    expect(Object.fromEntries(rows.map((row) => [row.name, row.valid]))).toEqual({ [itemDateIndex]: true, [orderIndex]: true });
  });

  test("a window read of 31 days or fewer, run as core_app under RLS, uses Order_companyId_createdAt_id_key on four years of history", async () => {
    const { indexes } = await explain(fixture.store.companyId, windowRead(fixture.store.companyId, fixture.windows.month));
    expect(indexes).toContain(orderIndex);
    expect((await explain(fixture.store.companyId, windowRead(fixture.store.companyId, { from: "2027-06-01", through: "2027-06-01" }))).indexes).toContain(orderIndex);
  });

  test("a 31-day window read costs no more on four years of history than on one (within 1.5 times plus 50 ms)", async () => {
    const best = async (companyId: string) => {
      const times: number[] = [];
      for (let run = 0; run < 5; run += 1) times.push((await explain(companyId, windowRead(companyId, fixture.windows.month), true)).time);
      return Math.min(...times);
    };
    const fourYears = await best(fixture.store.companyId);
    const oneYear = await best(fixture.oneYearStore.companyId);
    console.info(JSON.stringify({ window31DaysFourYearsMs: fourYears, window31DaysOneYearMs: oneYear }));
    expect(fourYears).toBeLessThanOrEqual(oneYear * 1.5 + 50);
  });

  test("the per-variant probes use the item date index and the product foreign key and findOrderedVariantIds stay on it after the old index is dropped", async () => {
    const variantIds = (await admin.query<{ id: string }>(`SELECT id FROM "ProductVariant" WHERE "companyId" = $1 ORDER BY id LIMIT 200`, [fixture.store.companyId])).rows.map((row) => row.id);
    const { from } = windowOf(fixture.windows.month);
    const probe = Prisma.sql`SELECT v.id, (SELECT i."orderCreatedAt" FROM "OrderItem" i WHERE i."companyId" = ${fixture.store.companyId}::uuid AND i."variantId" = v.id
        AND i."orderCreatedAt" < ${from.toISOString()}::timestamp ORDER BY i."orderCreatedAt" DESC LIMIT 1) AS last_before FROM unnest(${variantIds}::uuid[]) AS v(id)`;
    const probed = await explain(fixture.store.companyId, probe);
    expect(probed.indexes).toContain(itemDateIndex);
    expect(probed.nodes.some((node) => node["Node Type"] === "Index Only Scan" && node["Index Name"] === itemDateIndex)).toBe(true);
    const ordered = await explain(fixture.store.companyId, Prisma.sql`SELECT ids.variant_id AS id FROM unnest(${variantIds}::uuid[]) AS ids(variant_id)
      WHERE EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."companyId" = ${fixture.store.companyId}::uuid AND oi."variantId" = ids.variant_id)`);
    expect(ordered.indexes).toEqual([itemDateIndex]);
    const foreignKey = await explain(fixture.store.companyId, Prisma.sql`SELECT 1 FROM "OrderItem" WHERE "companyId" = ${fixture.store.companyId}::uuid AND "variantId" = ${variantIds[0]}::uuid LIMIT 1`);
    expect(foreignKey.indexes).toEqual([itemDateIndex]);
  });

  test("seeds the volumes of the design", () => {
    if (dryRun) return;
    expect(fixture.store.orders).toBeGreaterThan(240_000);
    expect(fixture.store.items / fixture.store.orders).toBeGreaterThanOrEqual(2);
    expect(fixture.store.variants).toBeGreaterThanOrEqual(12_000);
    expect(fixture.otherStores).toHaveLength(20);
  });
});
