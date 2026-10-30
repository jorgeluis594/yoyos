import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { ContainedFailureSignal, type ContainedFailureCode, type TransactionEndingError } from "@core/src/shared/infrastructure/persistence-error";
import type { ContainedFailure } from "@core/src/shared/infrastructure/persistance";
import type { CompanyId, OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { ProductStockIncreased } from "@core/src/features/products/application/events";
import { atStage } from "@core/src/shared/infrastructure/persistence-error";
import { isStockDeductionDue, parseStockQuantity, planDueStockDeduction, type NonNegativeInteger, type ShortItem, type StockLine, type StockOrder, type VariantStock } from "@core/src/features/orders/domain/stock-deduction";

export type OrderStockTrigger = "payment_confirmed" | "order_delivery_changed" | "order_stock_deduction_overdue";
export type DeductionStage = "load_order" | "lock_stock" | "deduct_stock" | "save_deduction" | "list_waiting" | "lock_orders";
/** Data faults vs statement-level database errors; the creation paths map them to different HTTP answers. */
export type DeductionErrorCode = ContainedFailureCode;
export type DeductionOutcome =
  | Readonly<{ kind: "not_due" }>
  | Readonly<{ kind: "deducted"; stock: VariantStock }>
  | Readonly<{ kind: "short"; shortItems: readonly [ShortItem, ...ShortItem[]] }>
  /** Only for order_stock_deduction_overdue: a stock row was held elsewhere. */
  | Readonly<{ kind: "skipped_locked" }>
  | Readonly<{ kind: "failed"; stage: DeductionStage; errorCode: DeductionErrorCode }>;
export type ServeOutcome = Readonly<{ candidates: number; deducted: number; skippedLocked: number; skippedInvalid: number;
  budgetExhausted: boolean; failed: Readonly<{ stage: DeductionStage; errorCode: DeductionErrorCode }> | null }>;
export type StockOrderRow = Readonly<{ ok: true; order: StockOrder }> | Readonly<{ ok: false; id: OrderId }>;
/** What the listeners report; the composition turns it into after-commit logs. */
export type StockEvent =
  | Readonly<{ kind: "deducted"; companyId: CompanyId; orderId: OrderId; trigger: OrderStockTrigger; itemCount: number; durationMs: number }>
  | Readonly<{ kind: "waiting"; companyId: CompanyId; orderId: OrderId; trigger: OrderStockTrigger; shortItemCount: number }>
  | Readonly<{ kind: "served"; companyId: CompanyId; variantCount: number; candidates: number; deducted: number; skippedLocked: number;
    skippedInvalid: number; budgetExhausted: boolean; durationMs: number }>
  | Readonly<{ kind: "skipped_invalid"; companyId: CompanyId; orderId: OrderId }>;

export type DeductDueStockDependencies = Readonly<{
  /** Narrow read: core order fields, items and confirmed payments; one query. A row that does not validate comes back as `ok: false`. */
  loadStockOrders: (ids: readonly OrderId[], companyId: CompanyId) => Promise<Result<readonly StockOrderRow[], TransactionEndingError>>;
  /** One statement: locks the orders not held elsewhere, returns them in createdAt, id order. */
  lockOrdersSkipLocked: (ids: readonly OrderId[], companyId: CompanyId) => Promise<Result<readonly OrderId[], TransactionEndingError>>;
  /** One statement in variantId order; "skip_locked" omits rows held by another transaction. */
  lockVariantStock: (variantIds: readonly VariantId[], mode: "wait" | "skip_locked") => Promise<Result<ReadonlyMap<VariantId, unknown>, TransactionEndingError>>;
  /** One guarded statement: decrements every row or none; returns the updated row count. */
  deductStockBulk: (lines: readonly StockLine[]) => Promise<Result<number, TransactionEndingError>>;
  /** One statement: sets stockDeducted where still false; returns the updated count. */
  saveStockDeductions: (ids: readonly OrderId[], companyId: CompanyId) => Promise<Result<number, TransactionEndingError>>;
  /** Full due rule and "every item fits" in SQL, driven by the partial index; createdAt, id order. */
  listWaitingOrderIds: (companyId: CompanyId, variantIds: readonly VariantId[], limit: number) => Promise<Result<readonly OrderId[], TransactionEndingError>>;
  /** Sets the transaction-local statement and lock timeouts for the statements that follow. */
  limitStatementsToMs: (ms: number) => Promise<void>;
  emit: (event: StockEvent) => void;
  waitingOrdersBatchSize: number;
  waitingOrdersBudgetMs: number;
  clock: () => Date;
}>;

const contained = (code: DeductionErrorCode, stage: DeductionStage) => new ContainedFailureSignal(code, stage);

/** Unwraps a dependency result: a transaction-ending error is thrown as itself so the publisher returns it. */
class TransactionEnding extends Error { constructor(readonly error: TransactionEndingError) { super(error.message); } }
async function step<T>(stage: DeductionStage, call: () => Promise<Result<T, TransactionEndingError>>): Promise<T> {
  const result = await atStage(stage, call);
  if (!result.success) throw new TransactionEnding(result.error);
  return result.data;
}
async function endingAsResult<T>(work: () => Promise<T>): Promise<Result<T, TransactionEndingError>> {
  try { return ok(await work()); }
  catch (cause) { if (cause instanceof TransactionEnding) return err(cause.error); throw cause; }
}

function stockMap(rows: ReadonlyMap<VariantId, unknown>, variantIds: readonly VariantId[], stage: DeductionStage): Map<VariantId, NonNegativeInteger> {
  const stock = new Map<VariantId, NonNegativeInteger>();
  for (const variantId of variantIds) {
    if (!rows.has(variantId)) continue;
    const quantity = parseStockQuantity(rows.get(variantId));
    if (!quantity.success) throw contained("INVALID_STORED_DATA", stage);
    stock.set(variantId, quantity.data);
  }
  return stock;
}

const variantsOf = (orders: readonly StockOrder[]): VariantId[] => [...new Set(orders.flatMap((order) => order.items.map((item) => item.variantId)))].sort();

/**
 * Handles the three order events. Precondition: the publisher's transaction holds the order's row lock.
 * Contained failures are thrown as ContainedFailureSignal so the publisher's savepoint rolls back; see containedDeductionOutcome.
 */
export function deductDueOrderStock(trigger: OrderStockTrigger, deps: DeductDueStockDependencies):
  (payload: Readonly<{ companyId: CompanyId; orderId: OrderId }>) => Promise<Result<DeductionOutcome, TransactionEndingError>> {
  return (payload) => endingAsResult(async () => {
    const started = deps.clock().getTime();
    const [row] = await step("load_order", () => deps.loadStockOrders([payload.orderId], payload.companyId));
    if (!row) return { kind: "not_due" } as const;
    if (!row.ok) throw contained("INVALID_STORED_DATA", "load_order");
    const order = row.order;
    if (!isStockDeductionDue(order)) return { kind: "not_due" } as const;
    const variantIds = order.items.map((item) => item.variantId).sort();
    const locked = await step("lock_stock", () => deps.lockVariantStock(variantIds, trigger === "order_stock_deduction_overdue" ? "skip_locked" : "wait"));
    if (trigger === "order_stock_deduction_overdue" && variantIds.some((id) => !locked.has(id))) return { kind: "skipped_locked" } as const;
    const stock = stockMap(locked, variantIds, "lock_stock");
    const plan = planDueStockDeduction(order, stock);
    if (plan.kind === "not_due") return { kind: "not_due" } as const;
    if (plan.kind === "short") {
      deps.emit({ kind: "waiting", companyId: payload.companyId, orderId: order.id, trigger, shortItemCount: plan.shortItems.length });
      return { kind: "short", shortItems: plan.shortItems } as const;
    }
    const count = await step("deduct_stock", () => deps.deductStockBulk(plan.lines));
    if (count !== plan.lines.length) throw contained("UNEXPECTED_ROW_COUNT", "deduct_stock");
    const saved = await step("save_deduction", () => deps.saveStockDeductions([order.id], payload.companyId));
    if (saved !== 1) throw contained("UNEXPECTED_ROW_COUNT", "save_deduction");
    const after = new Map(stock);
    for (const line of plan.lines) after.set(line.variantId, ((after.get(line.variantId) ?? 0) - line.quantity) as NonNegativeInteger);
    deps.emit({ kind: "deducted", companyId: payload.companyId, orderId: order.id, trigger, itemCount: order.items.length, durationMs: deps.clock().getTime() - started });
    return { kind: "deducted", stock: after } as const;
  });
}

/** The producer's view of a contained failure while deducting one order. */
export function containedDeductionOutcome(failure: ContainedFailure): DeductionOutcome {
  return { kind: "failed", stage: (failure.stage ?? "deduct_stock") as DeductionStage, errorCode: failure.errorCode };
}

/** The producer's view of a contained failure while serving: a timeout is the budget running out; anything else is a failure. */
export function containedServeOutcome(failure: ContainedFailure): ServeOutcome {
  const timeout = failure.errorCode === "STATEMENT_TIMEOUT" || failure.errorCode === "LOCK_TIMEOUT";
  return { candidates: 0, deducted: 0, skippedLocked: 0, skippedInvalid: 0, budgetExhausted: timeout,
    failed: timeout ? null : { stage: (failure.stage ?? "deduct_stock") as DeductionStage, errorCode: failure.errorCode } };
}

/**
 * Handles product_stock_increased in the restoration's transaction: serves the waiting orders that now fit, oldest first, in a fixed number of statements.
 * Every statement runs with timeouts set to the budget left; running out of budget is a contained STATEMENT_TIMEOUT.
 */
export function serveWaitingOrders(deps: DeductDueStockDependencies):
  (payload: ProductStockIncreased) => Promise<Result<ServeOutcome, TransactionEndingError>> {
  return (payload) => endingAsResult(async () => {
    const started = deps.clock().getTime();
    const budgeted = async <T>(stage: DeductionStage, call: () => Promise<Result<T, TransactionEndingError>>): Promise<T> => {
      const left = deps.waitingOrdersBudgetMs - (deps.clock().getTime() - started);
      if (left <= 0) throw contained("STATEMENT_TIMEOUT", stage);
      await deps.limitStatementsToMs(Math.max(50, left));
      return step(stage, call);
    };
    const candidates = await budgeted("list_waiting", () => deps.listWaitingOrderIds(payload.companyId, payload.variantIds, deps.waitingOrdersBatchSize));
    const outcome = (partial: Partial<ServeOutcome>): ServeOutcome => ({ candidates: candidates.length, deducted: 0, skippedLocked: 0, skippedInvalid: 0, budgetExhausted: false, failed: null, ...partial });
    const finish = (result: ServeOutcome) => {
      deps.emit({ kind: "served", companyId: payload.companyId, variantCount: payload.variantIds.length, candidates: result.candidates, deducted: result.deducted,
        skippedLocked: result.skippedLocked, skippedInvalid: result.skippedInvalid, budgetExhausted: result.budgetExhausted, durationMs: deps.clock().getTime() - started });
      return result;
    };
    if (candidates.length === 0) return finish(outcome({}));
    const lockedIds = await budgeted("lock_orders", () => deps.lockOrdersSkipLocked(candidates, payload.companyId));
    const skippedLocked = candidates.length - lockedIds.length;
    const rows = lockedIds.length === 0 ? [] : await budgeted("load_order", () => deps.loadStockOrders(lockedIds, payload.companyId));
    const orders: StockOrder[] = [];
    let skippedInvalid = 0;
    for (const row of rows) {
      if (row.ok) orders.push(row.order);
      else { skippedInvalid += 1; deps.emit({ kind: "skipped_invalid", companyId: payload.companyId, orderId: row.id }); }
    }
    // The queue order of the candidate list is oldest first; the locked ids come back in the same order.
    const position = new Map(lockedIds.map((id, index) => [id, index]));
    orders.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
    if (orders.length === 0) return finish(outcome({ skippedLocked, skippedInvalid }));
    const variantIds = variantsOf(orders);
    const lockedStock = await budgeted("lock_stock", () => deps.lockVariantStock(variantIds, "skip_locked"));
    const running = new Map<VariantId, NonNegativeInteger>();
    const invalidVariants = new Set<VariantId>();
    for (const variantId of variantIds) {
      if (!lockedStock.has(variantId)) continue;
      const quantity = parseStockQuantity(lockedStock.get(variantId));
      if (quantity.success) running.set(variantId, quantity.data); else invalidVariants.add(variantId);
    }
    const planned: StockOrder[] = [];
    const totals = new Map<VariantId, number>();
    let lockedElsewhere = 0;
    let invalidStock = 0;
    for (const order of orders) {
      if (order.items.some((item) => invalidVariants.has(item.variantId))) { invalidStock += 1; continue; }
      if (order.items.some((item) => !running.has(item.variantId))) { lockedElsewhere += 1; continue; }
      const plan = planDueStockDeduction(order, running);
      if (plan.kind !== "deduct") continue;
      for (const line of plan.lines) {
        running.set(line.variantId, ((running.get(line.variantId) ?? 0) - line.quantity) as NonNegativeInteger);
        totals.set(line.variantId, (totals.get(line.variantId) ?? 0) + line.quantity);
      }
      planned.push(order);
    }
    const skipped = { skippedLocked: skippedLocked + lockedElsewhere, skippedInvalid: skippedInvalid + invalidStock };
    if (planned.length === 0) return finish(outcome(skipped));
    const lines = [...totals].map(([variantId, quantity]): StockLine => ({ variantId, quantity: quantity as PositiveInteger }));
    const count = await budgeted("deduct_stock", () => deps.deductStockBulk(lines));
    if (count !== lines.length) throw contained("UNEXPECTED_ROW_COUNT", "deduct_stock");
    const saved = await budgeted("save_deduction", () => deps.saveStockDeductions(planned.map((order) => order.id), payload.companyId));
    if (saved !== planned.length) throw contained("UNEXPECTED_ROW_COUNT", "save_deduction");
    return finish(outcome({ ...skipped, deducted: planned.length }));
  });
}
