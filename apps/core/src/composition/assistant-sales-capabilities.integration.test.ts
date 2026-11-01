import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import type { CompanyId, UserId } from "@shared/identity";
import { log } from "@core/src/shared/infrastructure/logger";
import { budgetedSnapshot } from "@core/src/shared/infrastructure/budgeted-snapshot";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { orders } from "@core/src/features/orders";
import { catalogStorefront } from "@core/src/features/catalog";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import { salesReadFailureMessage, tooManyOrdersMessage } from "@core/src/features/assistants/presentation/tools/sales-texts";
import { createSalesReadGuard, type SalesOperation } from "@core/src/composition/assistant-sales-capabilities";
import { createProductToolsDependencies } from "@core/src/composition/assistant-product-capabilities";

const companyId = randomUUID() as CompanyId;
const access: AssistantAccess = {
  companyId, userId: "user-1" as UserId, connectionId: randomUUID() as AssistantConnectionId, scopes: ["orders:read", "products:read"], lastUsedAt: null,
};

beforeAll(async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  await withTenantIsolation(companyId, async () => { await prisma.company.create({ data: { id: companyId, name: companyId, country: "PE" } }); });
});

afterAll(async () => {
  await withTenantIsolation(companyId, async () => { await prisma.company.deleteMany({ where: { id: companyId } }); });
});

afterEach(() => vi.restoreAllMocks());

// A statement limit low enough to fire on pg_sleep, with the sales shape of the budget otherwise.
const lowBudget = { maxWait: 1000, timeout: 5000, statementTimeoutMs: 100, maxStatements: 6 } as const;
const realGuard = () => createSalesReadGuard({ snapshot: budgetedSnapshot(lowBudget), slots: 2, slotWaitMs: 2000 });
const sleepIn = (bound: "period" | "catalog", name: "figures" | "stocked") =>
  (step: Parameters<Parameters<ReturnType<typeof realGuard>>[3]>[0]) => step(name, bound, async () => { await prisma.$queryRaw`SELECT pg_sleep(0.6)`; return ok(1); });
const read = (guard: ReturnType<typeof realGuard>, operation: SalesOperation, periodDays: number, work: Parameters<ReturnType<typeof realGuard>>[3]) =>
  withTenantIsolation(companyId, () => guard(operation, access, periodDays, work));

describe("the sales read guard", () => {
  test("answers the too-many-orders text for a statement timeout in a period-bound step of a period over 31 days, and the reading-failure text for one in a period of 31 days or fewer or in a catalog-bound step", async () => {
    vi.spyOn(log, "error").mockImplementation(() => undefined);
    const guard = realGuard();
    expect(await read(guard, "summary", 32, sleepIn("period", "figures"))).toEqual({ success: false, error: { code: "FAILURE", message: tooManyOrdersMessage } });
    expect(await read(guard, "summary", 366, sleepIn("period", "figures"))).toEqual({ success: false, error: { code: "FAILURE", message: tooManyOrdersMessage } });
    expect(await read(guard, "summary", 31, sleepIn("period", "figures"))).toEqual({ success: false, error: { code: "FAILURE", message: salesReadFailureMessage } });
    expect(await read(guard, "unsold", 366, sleepIn("catalog", "stocked"))).toEqual({ success: false, error: { code: "FAILURE", message: salesReadFailureMessage } });
  });

  test("answers the reading-failure text for a transaction timer or a lost database even in a period over 31 days", async () => {
    vi.spyOn(log, "error").mockImplementation(() => undefined);
    const slow = createSalesReadGuard({ snapshot: budgetedSnapshot({ maxWait: 1000, timeout: 300, statementTimeoutMs: 5000, maxStatements: 6 }), slots: 2, slotWaitMs: 2000 });
    expect(await read(slow, "summary", 366, (step) => step("figures", "period", async () => { await prisma.$queryRaw`SELECT pg_sleep(1)`; return ok(1); })))
      .toEqual({ success: false, error: { code: "FAILURE", message: salesReadFailureMessage } });
  });

  test("returns the work's result untouched when it succeeds", async () => {
    expect(await read(realGuard(), "best_sellers", 30, (step) => step("sold_variants", "period", async () => ok("figures")))).toEqual({ success: true, data: "figures" });
  });

  test("logs sales_read_failed once with operation, step, errorCode, periodDays and answer, and no input or amount", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    await read(realGuard(), "summary", 90, sleepIn("period", "figures"));
    const events = error.mock.calls.map(([fields]) => fields as Record<string, unknown>).filter((fields) => fields.event === "sales_read_failed");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      event: "sales_read_failed", companyId, operation: "summary", step: "figures", errorCode: "STATEMENT_TIMEOUT", periodDays: 90, answer: "too_many_orders", durationMs: expect.any(Number),
    });
    expect(error).toHaveBeenCalledTimes(1);
  });

  test("a failure that is not a database failure is logged as assistant_tool_failed and answered with the reading-failure text", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    const guard = createSalesReadGuard({ snapshot: async (work) => work(), slots: 1, slotWaitMs: 1 });
    expect(await guard("summary", access, 30, async () => ({ success: false as const, error: { code: "INVALID_STORED_ORDER", message: "bad row" } })))
      .toEqual({ success: false, error: { code: "FAILURE", message: salesReadFailureMessage } });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "assistant_tool_failed", tool: "resumen_de_ventas", errorCode: "INVALID_STORED_ORDER" }), "assistant_tool_failed");
  });
});

describe("the sales slots", () => {
  const gate = () => { let open!: () => void; const wait = new Promise<void>((resolve) => { open = resolve; }); return { wait, open }; };
  const passThrough = { snapshot: async <T, E extends { message: string }>(work: () => Promise<{ success: true; data: T } | { success: false; error: E }>) => work() };

  test("a third concurrent sales read waits for a slot and runs when one frees within 2,000 ms, and one that waits 2,000 ms answers the reading-failure text and logs assistant_sales_reads_busy", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const guard = createSalesReadGuard({ ...passThrough, slots: 2, slotWaitMs: 2000 });
    const first = gate(), second = gate();
    const inFlight = [guard("summary", access, 30, async () => { await first.wait; return ok(1); }), guard("best_sellers", access, 30, async () => { await second.wait; return ok(2); })];
    const thirdHolds = gate();
    let thirdStartedAt = 0;
    const started = Date.now();
    const third = guard("unsold", access, 30, async () => { thirdStartedAt = Date.now() - started; await thirdHolds.wait; return ok(3); });
    setTimeout(() => first.open(), 100);
    await vi.waitFor(() => expect(thirdStartedAt).toBeGreaterThanOrEqual(90));
    expect(warn).not.toHaveBeenCalled();

    const fourth = await guard("unsold", access, 30, async () => ok(4));
    expect(fourth).toEqual({ success: false, error: { code: "FAILURE", message: salesReadFailureMessage } });
    expect(warn).toHaveBeenCalledWith({ event: "assistant_sales_reads_busy", companyId, connectionId: access.connectionId, tool: "productos_sin_ventas", waitedMs: 2000 }, "assistant_sales_reads_busy");
    second.open();
    thirdHolds.open();
    expect(await third).toEqual({ success: true, data: 3 });
    await Promise.all(inFlight);
  }, 10_000);

  test("a sales read in flight never takes a product slot", async () => {
    const guard = createSalesReadGuard({ ...passThrough, slots: 2, slotWaitMs: 50 });
    const hold = gate();
    const inFlight = [1, 2].map(() => guard("summary", access, 30, async () => { await hold.wait; return ok(1); }));
    const products = createProductToolsDependencies({
      snapshot: async (work) => work(), describe: async () => ok({ currency: "PEN", catalog: { kind: "hidden", subdomain: "rosa" as never } }),
      search: async () => ok({ items: [], page: 1, total: 0, storeHasProducts: false }), find: async () => ok(null),
      storeUrl: () => "", appLink: () => "", slots: 1, slotWaitMs: 20,
    });
    expect((await products.search({ sort: "recent", page: 1 }, access)).success).toBe(true);
    hold.open();
    await Promise.all(inFlight);
  });
});

describe("the opener of the sales snapshot", () => {
  test("measures the overhead of the opener with the storefront read at 3 statements and without it at 2", async () => {
    const pg = await import("pg");
    const original = pg.Client.prototype.query;
    let statements: string[] = [];
    vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: unknown, ...args: unknown[]) {
      const first = args[0];
      const text = typeof first === "string" ? first : (first as { text?: string } | undefined)?.text ?? "";
      if (!/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET TRANSACTION)/i.test(text)) statements.push(text);
      return (original as (...rest: unknown[]) => unknown).apply(this, args);
    } as never);
    await withTenantIsolation(companyId, () => orders.readSalesForAssistant(async () => ok(null)));
    const bare = statements.length;
    statements = [];
    await withTenantIsolation(companyId, () => orders.readSalesForAssistant(async () => catalogStorefront.describe(companyId)));
    expect({ bare, withStorefront: statements.length }).toEqual({ bare: 2, withStorefront: 3 });
  });
});
