import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { ContainedFailureSignal, type TransactionEndingError } from "@core/src/shared/infrastructure/persistence-error";
import { containedDeductionOutcome, containedServeOutcome, deductDueOrderStock, serveWaitingOrders, type DeductDueStockDependencies, type OrderStockTrigger, type StockEvent, type StockOrderRow } from "@core/src/features/orders/application/deduct-due-stock";
import type { StockOrder } from "@core/src/features/orders/domain/stock-deduction";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = id(900) as CompanyId;
const v = (n: number) => id(100 + n) as VariantId;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const ending: TransactionEndingError = { code: "PERSISTENCE_UNAVAILABLE", message: "closed", transactionEnding: true };
function order(n: number, items: [number, number][], overrides: Partial<StockOrder> = {}): StockOrder {
  const [first, ...rest] = items.map(([variant, quantity]) => ({ variantId: v(variant), quantity: quantity as never }));
  return { id: id(n) as OrderId, createdAt: new Date(2026, 9, n), cancelled: false, stockDeducted: false, deliveryStatus: "pending", total: money(100),
    items: [first!, ...rest], confirmedPayments: [{ amount: money(100), deductStockIfPartial: false }], ...overrides };
}

function fixture(orders: StockOrder[], stock: Record<number, unknown>, options: { held?: number[]; heldStock?: number[]; invalid?: number[]; batch?: number; budget?: number } = {}) {
  const quantities = new Map(Object.entries(stock).map(([variant, quantity]) => [v(Number(variant)), quantity]));
  const statements: string[] = [];
  const limits: number[] = [];
  const events: StockEvent[] = [];
  const deducted = new Set<string>();
  let now = 0;
  const tick = (ms: number) => { now += ms; };
  const deps: DeductDueStockDependencies = {
    loadStockOrders: async (ids): Promise<Result<readonly StockOrderRow[], TransactionEndingError>> => {
      statements.push("load");
      return ok(ids.flatMap((orderId) => {
        const found = orders.find((candidate) => candidate.id === orderId);
        if (!found) return [];
        return options.invalid?.includes(Number(found.id.slice(-12))) ? [{ ok: false as const, id: found.id }] : [{ ok: true as const, order: found }];
      }));
    },
    lockOrdersSkipLocked: async (ids) => { statements.push("lock_orders"); return ok(ids.filter((orderId) => !options.held?.includes(Number(orderId.slice(-12))))); },
    lockVariantStock: async (variantIds, mode) => {
      statements.push(`lock_stock:${mode}`);
      return ok(new Map(variantIds.filter((variantId) => quantities.has(variantId) && !(mode === "skip_locked" && options.heldStock?.some((n) => v(n) === variantId)))
        .map((variantId) => [variantId, quantities.get(variantId)])));
    },
    deductStockBulk: async (lines) => {
      statements.push("deduct");
      if (lines.some((line) => Number(quantities.get(line.variantId) ?? 0) < line.quantity)) return ok(0);
      for (const line of lines) quantities.set(line.variantId, Number(quantities.get(line.variantId)) - line.quantity);
      return ok(lines.length);
    },
    saveStockDeductions: async (ids) => { statements.push("save"); for (const orderId of ids) deducted.add(orderId); return ok(ids.length); },
    listWaitingOrderIds: async (_company, _variants, limit) => { statements.push("list"); return ok(orders.filter((candidate) => !deducted.has(candidate.id)).map((candidate) => candidate.id).slice(0, limit)); },
    limitStatementsToMs: async (ms) => { limits.push(ms); },
    emit: (event) => events.push(event),
    waitingOrdersBatchSize: options.batch ?? 100, waitingOrdersBudgetMs: options.budget ?? 500,
    clock: () => new Date(now),
  };
  return { deps, statements, limits, events, deducted, quantities, tick };
}
const deduct = (f: ReturnType<typeof fixture>, trigger: OrderStockTrigger, n: number) => deductDueOrderStock(trigger, f.deps)({ companyId: company, orderId: id(n) as OrderId });
const serve = (f: ReturnType<typeof fixture>, variants: number[]) => serveWaitingOrders(f.deps)({ companyId: company, variantIds: variants.map(v) as never });

test("deducts every item of a due order that fits and marks it deducted", async () => {
  const f = fixture([order(1, [[1, 2], [2, 1]])], { 1: 5, 2: 1 });
  const result = await deduct(f, "payment_confirmed", 1);
  expect(result).toMatchObject({ success: true, data: { kind: "deducted" } });
  expect([...f.quantities]).toEqual([[v(1), 3], [v(2), 0]]);
  expect(f.deducted.has(id(1))).toBe(true);
  expect(f.statements).toEqual(["load", "lock_stock:wait", "deduct", "save"]);
  expect(f.events[0]).toMatchObject({ kind: "deducted", trigger: "payment_confirmed", itemCount: 2 });
});

test("leaves a due order with a short item undeducted and writes nothing", async () => {
  const f = fixture([order(1, [[1, 4]])], { 1: 3 });
  expect(await deduct(f, "order_delivery_changed", 1)).toEqual(ok({ kind: "short", shortItems: [{ variantId: v(1), available: 3 }] }));
  expect(f.statements).toEqual(["load", "lock_stock:wait"]);
  expect(f.quantities.get(v(1))).toBe(3);
});

test("does nothing for an order that is not due", async () => {
  const f = fixture([order(1, [[1, 1]], { confirmedPayments: [] })], { 1: 3 });
  expect(await deduct(f, "payment_confirmed", 1)).toEqual(ok({ kind: "not_due" }));
  expect(f.statements).toEqual(["load"]);
});

test("returns failed without throwing when the order's stored data is invalid", async () => {
  const f = fixture([order(1, [[1, 1]])], { 1: "bad" });
  const thrown = await deduct(f, "payment_confirmed", 1).catch((error) => error);
  expect(thrown).toBeInstanceOf(ContainedFailureSignal);
  expect(containedDeductionOutcome({ code: "CONTAINED_FAILURE", errorCode: thrown.errorCode, stage: thrown.stage, message: "", cause: null }))
    .toEqual({ kind: "failed", stage: "lock_stock", errorCode: "INVALID_STORED_DATA" });
  const invalidOrder = fixture([order(1, [[1, 1]])], { 1: 3 }, { invalid: [1] });
  expect(await deduct(invalidOrder, "payment_confirmed", 1).catch((error) => error)).toMatchObject({ stage: "load_order", errorCode: "INVALID_STORED_DATA" });
});

test("returns a transaction-ending failure so the producer rolls back", async () => {
  const f = fixture([order(1, [[1, 1]])], { 1: 3 });
  const result = await deductDueOrderStock("payment_confirmed", { ...f.deps, deductStockBulk: async () => err(ending) })({ companyId: company, orderId: id(1) as OrderId });
  expect(result).toEqual(err(ending));
});

test("contains a lock timeout on the stock rows and reports it as failed", async () => {
  const f = fixture([order(1, [[1, 1]])], { 1: 3 });
  const timeout = Object.assign(new Error("canceling statement due to lock timeout 55P03"), { name: "DriverAdapterError", cause: { kind: "postgres" } });
  const thrown = await deductDueOrderStock("payment_confirmed", { ...f.deps, lockVariantStock: async () => { throw timeout; } })({ companyId: company, orderId: id(1) as OrderId }).catch((error) => error);
  expect(thrown).toBeInstanceOf(ContainedFailureSignal);
  expect(containedDeductionOutcome({ code: "CONTAINED_FAILURE", errorCode: thrown.errorCode, stage: thrown.stage, message: "", cause: null }))
    .toEqual({ kind: "failed", stage: "lock_stock", errorCode: "LOCK_TIMEOUT" });
});

test("the overdue trigger skips a locked stock row instead of waiting", async () => {
  const f = fixture([order(1, [[1, 1], [2, 1]])], { 1: 3, 2: 3 }, { heldStock: [2] });
  expect(await deduct(f, "order_stock_deduction_overdue", 1)).toEqual(ok({ kind: "skipped_locked" }));
  expect(f.statements).toEqual(["load", "lock_stock:skip_locked"]);
});

test("serves waiting orders oldest first and skips one that does not fit", async () => {
  const f = fixture([order(10, [[1, 5]]), order(12, [[1, 2]]), order(13, [[1, 1]])], { 1: 3 });
  const result = await serve(f, [1]);
  expect(result).toMatchObject({ success: true, data: { candidates: 3, deducted: 2 } });
  expect([...f.deducted]).toEqual([id(12), id(13)]);
  expect(f.quantities.get(v(1))).toBe(0);
});

test("serves a waiting order with a deactivated variant", async () => {
  // Inactive variants keep their ProductStock row, which is all the lock statement looks at.
  const f = fixture([order(1, [[1, 1]])], { 1: 1 });
  expect(await serve(f, [1])).toMatchObject({ success: true, data: { deducted: 1 } });
});

test("skips a waiting order locked by another transaction", async () => {
  const f = fixture([order(1, [[1, 1]]), order(2, [[1, 1]])], { 1: 5 }, { held: [1] });
  expect(await serve(f, [1])).toMatchObject({ success: true, data: { candidates: 2, deducted: 1, skippedLocked: 1 } });
  expect([...f.deducted]).toEqual([id(2)]);
});

test("skips a waiting order with invalid stored data and serves the others", async () => {
  const f = fixture([order(1, [[1, 1]]), order(2, [[1, 1]])], { 1: 5 }, { invalid: [1] });
  expect(await serve(f, [1])).toMatchObject({ success: true, data: { deducted: 1, skippedInvalid: 1 } });
  expect(f.events.some((event) => event.kind === "skipped_invalid")).toBe(true);
});

test("sets each serving statement's timeout to the budget left", async () => {
  const f = fixture([order(1, [[1, 1]])], { 1: 5 }, { budget: 500 });
  const list = f.deps.listWaitingOrderIds;
  await serveWaitingOrders({ ...f.deps, listWaitingOrderIds: async (...args) => { f.tick(120); return list(...args); } })({ companyId: company, variantIds: [v(1)] });
  expect(f.limits[0]).toBe(500);
  expect(f.limits.slice(1).every((ms) => ms === 380)).toBe(true);
  expect(f.limits).toHaveLength(6);
});

test("reports a statement timeout while serving as budget exhausted", async () => {
  const timeout = Object.assign(new Error("57014 canceling statement due to statement timeout"), { name: "DriverAdapterError", cause: { kind: "postgres" } });
  const f = fixture([order(1, [[1, 1]])], { 1: 5 });
  const thrown = await serveWaitingOrders({ ...f.deps, listWaitingOrderIds: async () => { throw timeout; } })({ companyId: company, variantIds: [v(1)] }).catch((error) => error);
  expect(containedServeOutcome({ code: "CONTAINED_FAILURE", errorCode: thrown.errorCode, stage: thrown.stage, message: "", cause: null }))
    .toMatchObject({ budgetExhausted: true, failed: null });
});

test("stops before the next statement when the budget is spent", async () => {
  const f = fixture([order(1, [[1, 1]])], { 1: 5 }, { budget: 100 });
  const list = f.deps.listWaitingOrderIds;
  const thrown = await serveWaitingOrders({ ...f.deps, listWaitingOrderIds: async (...args) => { f.tick(150); return list(...args); } })({ companyId: company, variantIds: [v(1)] }).catch((error) => error);
  expect(thrown).toMatchObject({ errorCode: "STATEMENT_TIMEOUT", stage: "lock_orders" });
  expect(f.statements).toEqual(["list"]);
});

test("deducts every served order with one bulk statement", async () => {
  const f = fixture([order(1, [[1, 1], [2, 1]]), order(2, [[1, 1]]), order(3, [[2, 1]])], { 1: 5, 2: 5 });
  await serve(f, [1, 2]);
  expect(f.statements.filter((statement) => statement === "deduct")).toHaveLength(1);
  expect(f.statements).toEqual(["list", "lock_orders", "load", "lock_stock:skip_locked", "deduct", "save"]);
  expect([...f.quantities]).toEqual([[v(1), 3], [v(2), 3]]);
});
