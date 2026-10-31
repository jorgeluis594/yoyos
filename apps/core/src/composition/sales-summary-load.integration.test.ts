import pg from "pg";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { orders } from "@core/src/features/orders";
import type { CompanyId, UserId } from "@core/src/features/orders/domain/order";
import type { SummarizeSalesInput } from "@core/src/features/orders/application/summarize-sales";
import { salesFiguresStatement } from "@core/src/features/orders/infrastructure/sales-summary-repository";
import { previousPeriod, windowOf, type SalesPeriod } from "@core/src/features/assistants/domain/sales-period";
import { removeStores, salesLoadEnabled, seedSalesLoadFixture, type SalesLoadFixture } from "@core/tests/support/sales-load-fixture";

// Opt-in: `SALES_LOAD=1 sh scripts/run-tests.sh integration src/composition/sales-summary-load.integration.test.ts` seeds four years of history (minutes).
// `SALES_LOAD_SCALE=0.02` shrinks it for a dry run, where the cost bounds are not asserted.
const scale = Number(process.env.SALES_LOAD_SCALE ?? 1);
const dryRun = scale < 1;
const orderIndex = "Order_companyId_createdAt_id_key";
const halfStatementBudgetMs = 750;

let admin: pg.Client;
let fixture: SalesLoadFixture;

type PlanNode = { "Index Name"?: string; "Node Type": string; "Shared Hit Blocks"?: number; "Shared Read Blocks"?: number; Plans?: PlanNode[] };
const nodesOf = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodesOf)];

/** `EXPLAIN (ANALYZE, BUFFERS)` of the summary statement as `core_app` under the forced RLS policy of the company, the way the read runs. */
async function explain(companyId: string, input: SummarizeSalesInput) {
  const rows = await withTenantIsolation(companyId, async () => await prisma.$queryRaw<{ "QUERY PLAN": { Plan: PlanNode; "Execution Time": number }[] }[]>(
    Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${salesFiguresStatement(input, companyId as CompanyId)}`));
  const [{ Plan, "Execution Time": time }] = rows[0]!["QUERY PLAN"];
  return { time, indexes: nodesOf(Plan).flatMap((node) => (node["Index Name"] ? [node["Index Name"]] : [])), hit: Plan["Shared Hit Blocks"] ?? 0, read: Plan["Shared Read Blocks"] ?? 0 };
}

const windows = (current: Pick<SalesPeriod, "from" | "through">, previous: Pick<SalesPeriod, "from" | "through">): SummarizeSalesInput => ({ current: windowOf(current), previous: windowOf(previous) });

/** The whole read as the tool runs it: one snapshot, the orders operation, rows validated; the time a call waits for the figures. */
async function callMs(companyId: string, input: SummarizeSalesInput): Promise<number> {
  const started = performance.now();
  const read = await withTenantIsolation(companyId, () => orders.readSalesForAssistant(() => orders.summarizeSales(input, { companyId: companyId as CompanyId, userId: "load" as UserId })));
  if (!read.success) throw new Error(read.error.message);
  return performance.now() - started;
}
async function best(times: number, run: () => Promise<number>): Promise<number> {
  const all: number[] = [];
  for (let index = 0; index < times; index += 1) all.push(await run());
  return Math.min(...all);
}

describe.skipIf(!salesLoadEnabled)("the sales summary on the history fixture", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
    await admin.connect();
    fixture = await seedSalesLoadFixture(admin, { scale });
  }, 3_600_000);

  afterAll(async () => {
    if (fixture) await removeStores(admin, fixture.companyIds);
    await admin.end();
  }, 3_600_000);

  test("a 366-day summary of the worst case-2 shape reads figures within half the statement budget on four years of history with other companies' rows", async () => {
    const { current, previous } = fixture.windows.worstSummary;
    const input = windows(current, previous);
    const statement = await explain(fixture.store.companyId, input);
    const first = await callMs(fixture.store.companyId, input);
    const repeated = await best(3, () => callMs(fixture.store.companyId, input));
    console.info(JSON.stringify({ worstSummary366Days: { statementMs: Math.round(statement.time), firstCallMs: Math.round(first), repeatedCallMs: Math.round(repeated), indexes: statement.indexes } }));
    if (!dryRun) {
      expect(statement.time).toBeLessThanOrEqual(halfStatementBudgetMs);
      expect(repeated).toBeLessThanOrEqual(halfStatementBudgetMs);
    }
  }, 600_000);

  test("the 30-day summary is not slower on four years of history than on one (within 1.5 times plus 50 ms) and its two windows read Order_companyId_createdAt_id_key", async () => {
    const input = windows({ from: "2027-06-01", through: "2027-06-30" }, { from: "2027-05-01", through: "2027-05-31" });
    expect((await explain(fixture.store.companyId, input)).indexes).toContain(orderIndex);
    const measure = async (companyId: string) => {
      const times: number[] = [];
      for (let run = 0; run < 5; run += 1) times.push((await explain(companyId, input)).time);
      return Math.min(...times);
    };
    const fourYears = await measure(fixture.store.companyId);
    const oneYear = await measure(fixture.oneYearStore.companyId);
    console.info(JSON.stringify({ summary30Days: { fourYearsMs: Math.round(fourYears), oneYearMs: Math.round(oneYear) } }));
    if (!dryRun) expect(fourYears).toBeLessThanOrEqual(oneYear * 1.5 + 50);
  }, 600_000);

  test("records, for every statement, the time of the first and repeated run and the buffers read", async () => {
    const shapes = {
      summary30Days: windows({ from: "2027-06-01", through: "2027-06-30" }, { from: "2027-05-01", through: "2027-05-31" }),
      summary366Days: windows(fixture.windows.worstSummary.current, fixture.windows.worstSummary.previous),
      summary366DaysCase2: (() => { const period = { from: "2027-01-01", through: "2027-12-31", cutToToday: false }; return windows(period, previousPeriod(period)); })(),
    };
    const rows: Record<string, unknown> = {};
    for (const [name, input] of Object.entries(shapes)) {
      const first = await explain(fixture.store.companyId, input);
      const repeated = await explain(fixture.store.companyId, input);
      rows[name] = { firstMs: Math.round(first.time), repeatedMs: Math.round(repeated.time), buffersHit: repeated.hit, buffersRead: first.read, indexes: first.indexes };
    }
    console.info(JSON.stringify({ salesSummaryStatements: rows }));
    expect(Object.keys(rows)).toHaveLength(3);
  }, 600_000);
});
