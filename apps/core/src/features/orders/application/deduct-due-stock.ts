import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ContainedFailure, ContainedFailureCode, TransactionEndingError } from "@core/src/shared/application/contained-failure";
import type { CompanyId, OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { ProductStockIncreased } from "@core/src/features/products/application/events";
import { isStockDeductionDue, parseStockQuantity, planDueStockDeduction, planStockAdjustment, type NonNegativeInteger, type ShortItem, type StockLine, type StockOrder, type StockUnits, type VariantStock } from "@core/src/features/orders/domain/stock-deduction";

export type OrderStockTrigger = "payment_confirmed" | "order_delivery_changed" | "order_edited" | "order_stock_deduction_overdue";
export type DeductionStage = "load_order" | "lock_stock" | "deduct_stock" | "save_deduction" | "list_waiting" | "lock_orders" | "return_stock" | "save_line_deductions";
/** Data faults vs statement-level database errors; the creation paths map them to different HTTP answers. */
export type DeductionErrorCode = ContainedFailureCode;
export type DeductionOutcome =
  | Readonly<{ kind: "not_due" }>
  /** `deductedAt` is the time stored as the order's stockDeductedAt when it had none. */
  | Readonly<{ kind: "deducted"; stock: VariantStock; deductedAt: Date }>
  | Readonly<{ kind: "short"; shortItems: readonly [ShortItem, ...ShortItem[]] }>
  /** An edited order that already had its stock deducted was settled by the difference. `deductedByVariant` is the new deducted figure of the lines that changed. */
  | Readonly<{ kind: "adjusted"; returnedUnits: number; deductedUnits: number; pending: readonly ShortItem[];
    deductedByVariant: ReadonlyMap<VariantId, NonNegativeInteger>; returnedVariantIds: readonly VariantId[] }>
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
  | Readonly<{ kind: "adjusted"; companyId: CompanyId; orderId: OrderId; trigger: OrderStockTrigger; returnedUnits: number; deductedUnits: number; pendingLines: number; durationMs: number }>
  | Readonly<{ kind: "skipped_invalid"; companyId: CompanyId; orderId: OrderId }>;

/** What every capability answers when it fails: the transaction ended, or a statement/data fault the savepoint can undo. */
type Failure = TransactionEndingError | ContainedFailure;
export type DeductDueStockDependencies = Readonly<{
  /** Narrow read: core order fields, items and confirmed payments; one query. A row that does not validate comes back as `ok: false`. */
  loadStockOrders: (ids: readonly OrderId[], companyId: CompanyId) => Promise<Result<readonly StockOrderRow[], Failure>>;
  /** One statement: locks the orders not held elsewhere, returns them in createdAt, id order. */
  lockOrdersSkipLocked: (ids: readonly OrderId[], companyId: CompanyId) => Promise<Result<readonly OrderId[], Failure>>;
  /** One statement in variantId order; "skip_locked" omits rows held by another transaction. */
  lockVariantStock: (variantIds: readonly VariantId[], mode: "wait" | "skip_locked") => Promise<Result<ReadonlyMap<VariantId, unknown>, Failure>>;
  /** One guarded statement: decrements every row or none; returns the updated row count. */
  deductStockBulk: (lines: readonly StockLine[]) => Promise<Result<number, Failure>>;
  /** One statement: puts every item of the orders at its full quantity, sets stockDeducted, and stockDeductedAt where still unset; returns the updated order count. */
  saveStockDeductions: (ids: readonly OrderId[], companyId: CompanyId, stockDeductedAt: Date) => Promise<Result<number, Failure>>;
  /** One statement: adds the units back to the stock rows (locked by the caller); returns the updated row count. */
  restoreStock: (units: readonly StockUnits[]) => Promise<Result<number, Failure>>;
  /** One statement: stores the deducted figure of each line (by variant) of the order; returns the updated row count. */
  saveLineDeductions: (orderId: OrderId, companyId: CompanyId, deducted: ReadonlyMap<VariantId, NonNegativeInteger>) => Promise<Result<number, Failure>>;
  /** Full due rule and "every pending line fits" in SQL, driven by the partial index; createdAt, id order. */
  listWaitingOrderIds: (companyId: CompanyId, variantIds: readonly VariantId[], limit: number) => Promise<Result<readonly OrderId[], Failure>>;
  /** Sets the transaction-local statement and lock timeouts for the statements that follow. */
  limitStatementsToMs: (ms: number) => Promise<void>;
  emit: (event: StockEvent) => void;
  waitingOrdersBatchSize: number;
  waitingOrdersBudgetMs: number;
  clock: () => Date;
}>;

const fault = (errorCode: DeductionErrorCode, stage: DeductionStage, candidates?: number): ContainedFailure =>
  ({ code: "CONTAINED_FAILURE", errorCode, stage, message: `Contained failure ${errorCode} at ${stage}`, ...(candidates === undefined ? {} : { candidates }) });

/** A capability answer, with the failing step named on a contained failure. A transaction-ending error passes through as it is. */
async function step<T>(stage: DeductionStage, call: () => Promise<Result<T, Failure>>, candidates?: () => number): Promise<Result<T, Failure>> {
  const result = await call();
  if (result.success || result.error.code !== "CONTAINED_FAILURE") return result;
  return err({ ...result.error, stage, ...(candidates ? { candidates: candidates() } : {}) });
}

function stockMap(rows: ReadonlyMap<VariantId, unknown>, variantIds: readonly VariantId[]): Map<VariantId, NonNegativeInteger> | "invalid" {
  const stock = new Map<VariantId, NonNegativeInteger>();
  for (const variantId of variantIds) {
    if (!rows.has(variantId)) continue;
    const quantity = parseStockQuantity(rows.get(variantId));
    if (!quantity.success) return "invalid";
    stock.set(variantId, quantity.data);
  }
  return stock;
}

const variantsOf = (orders: readonly StockOrder[]): VariantId[] => [...new Set(orders.flatMap((order) => order.items.map((item) => item.variantId)))].sort();

/** The payload of order_edited: `returns` are the deducted units of the lines the edit deleted (read before deleting them). */
export type DeductDueStockPayload = Readonly<{ companyId: CompanyId; orderId: OrderId; returns?: readonly StockUnits[] }>;

/**
 * Handles the three order events. Precondition: the publisher's transaction already holds the order's row lock.
 * A data fault or a failed statement comes back as a ContainedFailure result, so the publisher's savepoint rolls back and reports it as the `failed` outcome.
 */
export function deductDueOrderStock(trigger: OrderStockTrigger, deps: DeductDueStockDependencies):
  (payload: DeductDueStockPayload) => Promise<Result<DeductionOutcome, Failure>> {
  return async (payload) => {
    const started = deps.clock().getTime();
    const loaded = await step("load_order", () => deps.loadStockOrders([payload.orderId], payload.companyId));
    if (!loaded.success) return loaded;
    const [row] = loaded.data;
    if (!row) return ok({ kind: "not_due" });
    if (!row.ok) return err(fault("INVALID_STORED_DATA", "load_order"));
    const order = row.order;
    if (trigger === "order_edited" && order.stockDeducted && !order.cancelled && order.deliveryStatus === "pending") return adjustDeductedOrder(order, payload, started, deps);
    if (!isStockDeductionDue(order)) return ok({ kind: "not_due" });
    const variantIds = order.items.map((item) => item.variantId).sort();
    const overdue = trigger === "order_stock_deduction_overdue";
    const locked = await step("lock_stock", () => deps.lockVariantStock(variantIds, overdue ? "skip_locked" : "wait"));
    if (!locked.success) return locked;
    if (overdue && variantIds.some((id) => !locked.data.has(id))) return ok({ kind: "skipped_locked" });
    const stock = stockMap(locked.data, variantIds);
    if (stock === "invalid") return err(fault("INVALID_STORED_DATA", "lock_stock"));
    const plan = planDueStockDeduction(order, stock);
    if (plan.kind === "not_due") return ok({ kind: "not_due" });
    if (plan.kind === "short") {
      deps.emit({ kind: "waiting", companyId: payload.companyId, orderId: order.id, trigger, shortItemCount: plan.shortItems.length });
      return ok({ kind: "short", shortItems: plan.shortItems });
    }
    const count = await step("deduct_stock", () => deps.deductStockBulk(plan.lines));
    if (!count.success) return count;
    if (count.data !== plan.lines.length) return err(fault("UNEXPECTED_ROW_COUNT", "deduct_stock"));
    const deductedAt = deps.clock();
    const saved = await step("save_deduction", () => deps.saveStockDeductions([order.id], payload.companyId, deductedAt));
    if (!saved.success) return saved;
    if (saved.data !== 1) return err(fault("UNEXPECTED_ROW_COUNT", "save_deduction"));
    const after = new Map(stock);
    for (const line of plan.lines) after.set(line.variantId, ((after.get(line.variantId) ?? 0) - line.quantity) as NonNegativeInteger);
    deps.emit({ kind: "deducted", companyId: payload.companyId, orderId: order.id, trigger, itemCount: order.items.length, durationMs: deps.clock().getTime() - started });
    return ok({ kind: "deducted", stock: after, deductedAt });
  };
}

/**
 * An edit of an order whose stock is deducted: under the order lock and the variant rows (variantId order), settles each line by the difference.
 * Surplus units go back, what the stock reaches is taken, and the rest stays pending (the order stays deducted). Stock never fails the edit.
 */
async function adjustDeductedOrder(order: StockOrder, payload: DeductDueStockPayload, started: number, deps: DeductDueStockDependencies): Promise<Result<DeductionOutcome, Failure>> {
  const removed = new Map<VariantId, number>();
  for (const units of payload.returns ?? []) removed.set(units.variantId, (removed.get(units.variantId) ?? 0) + units.quantity);
  const variantIds = [...new Set([...order.items.map((item) => item.variantId), ...removed.keys()])].sort();
  const locked = await step("lock_stock", () => deps.lockVariantStock(variantIds, "wait"));
  if (!locked.success) return locked;
  const stock = stockMap(locked.data, variantIds);
  if (stock === "invalid") return err(fault("INVALID_STORED_DATA", "lock_stock"));
  const plan = planStockAdjustment(order.items, removed, stock);
  if (plan.deductions.length > 0) {
    const count = await step("deduct_stock", () => deps.deductStockBulk(plan.deductions));
    if (!count.success) return count;
    if (count.data !== plan.deductions.length) return err(fault("UNEXPECTED_ROW_COUNT", "deduct_stock"));
  }
  if (plan.returns.length > 0) {
    const count = await step("return_stock", () => deps.restoreStock(plan.returns));
    if (!count.success) return count;
    if (count.data !== plan.returns.length) return err(fault("UNEXPECTED_ROW_COUNT", "return_stock"));
  }
  if (plan.deductedByVariant.size > 0) {
    const count = await step("save_line_deductions", () => deps.saveLineDeductions(order.id, payload.companyId, plan.deductedByVariant));
    if (!count.success) return count;
    if (count.data !== plan.deductedByVariant.size) return err(fault("UNEXPECTED_ROW_COUNT", "save_line_deductions"));
  }
  const sum = (units: readonly StockUnits[]) => units.reduce((total, item) => total + item.quantity, 0);
  const returnedUnits = sum(plan.returns);
  const deductedUnits = sum(plan.deductions);
  if (plan.pending.length > 0) deps.emit({ kind: "waiting", companyId: payload.companyId, orderId: order.id, trigger: "order_edited", shortItemCount: plan.pending.length });
  deps.emit({ kind: "adjusted", companyId: payload.companyId, orderId: order.id, trigger: "order_edited", returnedUnits, deductedUnits, pendingLines: plan.pending.length,
    durationMs: deps.clock().getTime() - started });
  return ok({ kind: "adjusted", returnedUnits, deductedUnits, pending: plan.pending, deductedByVariant: plan.deductedByVariant, returnedVariantIds: plan.returns.map((units) => units.variantId) });
}

/** The producer's view of a contained failure while deducting one order. */
export function containedDeductionOutcome(failure: ContainedFailure): DeductionOutcome {
  return { kind: "failed", stage: (failure.stage ?? "deduct_stock") as DeductionStage, errorCode: failure.errorCode };
}

/** The producer's view of a contained failure while serving: a timeout is the budget running out; anything else is a failure. Counts what was listed before it. */
export function containedServeOutcome(failure: ContainedFailure): ServeOutcome {
  const timeout = failure.errorCode === "STATEMENT_TIMEOUT" || failure.errorCode === "LOCK_TIMEOUT";
  return { candidates: failure.candidates ?? 0, deducted: 0, skippedLocked: 0, skippedInvalid: 0, budgetExhausted: timeout,
    failed: timeout ? null : { stage: (failure.stage ?? "deduct_stock") as DeductionStage, errorCode: failure.errorCode } };
}

/**
 * Handles product_stock_increased in the restoration's transaction: serves the waiting orders that now fit, oldest first, in a fixed number of statements.
 * Every statement runs with timeouts set to the budget left; running out of budget is a contained STATEMENT_TIMEOUT.
 */
export function serveWaitingOrders(deps: DeductDueStockDependencies):
  (payload: ProductStockIncreased) => Promise<Result<ServeOutcome, Failure>> {
  return async (payload) => {
    const started = deps.clock().getTime();
    let listed = 0;
    const budgeted = async <T>(stage: DeductionStage, call: () => Promise<Result<T, Failure>>): Promise<Result<T, Failure>> => {
      const left = deps.waitingOrdersBudgetMs - (deps.clock().getTime() - started);
      if (left <= 0) return err(fault("STATEMENT_TIMEOUT", stage, listed));
      await deps.limitStatementsToMs(Math.max(50, left));
      return step(stage, call, () => listed);
    };
    const candidatesResult = await budgeted("list_waiting", () => deps.listWaitingOrderIds(payload.companyId, payload.variantIds, deps.waitingOrdersBatchSize));
    if (!candidatesResult.success) return candidatesResult;
    const candidates = candidatesResult.data;
    listed = candidates.length;
    const outcome = (partial: Partial<ServeOutcome>): ServeOutcome => ({ candidates: candidates.length, deducted: 0, skippedLocked: 0, skippedInvalid: 0, budgetExhausted: false, failed: null, ...partial });
    if (candidates.length === 0) return ok(outcome({}));
    const lockedResult = await budgeted("lock_orders", () => deps.lockOrdersSkipLocked(candidates, payload.companyId));
    if (!lockedResult.success) return lockedResult;
    const lockedIds = lockedResult.data;
    const skippedLocked = candidates.length - lockedIds.length;
    let rows: readonly StockOrderRow[] = [];
    if (lockedIds.length > 0) {
      const loaded = await budgeted("load_order", () => deps.loadStockOrders(lockedIds, payload.companyId));
      if (!loaded.success) return loaded;
      rows = loaded.data;
    }
    const orders: StockOrder[] = [];
    let skippedInvalid = 0;
    for (const row of rows) {
      if (row.ok) orders.push(row.order);
      else { skippedInvalid += 1; deps.emit({ kind: "skipped_invalid", companyId: payload.companyId, orderId: row.id }); }
    }
    // The candidate list is oldest first; the locked ids come back in the same order.
    const position = new Map(lockedIds.map((id, index) => [id, index]));
    orders.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
    if (orders.length === 0) return ok(outcome({ skippedLocked, skippedInvalid }));
    const variantIds = variantsOf(orders);
    const stockResult = await budgeted("lock_stock", () => deps.lockVariantStock(variantIds, "skip_locked"));
    if (!stockResult.success) return stockResult;
    const lockedStock = stockResult.data;
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
    if (planned.length === 0) return ok(outcome(skipped));
    const lines = [...totals].map(([variantId, quantity]): StockLine => ({ variantId, quantity: quantity as PositiveInteger }));
    const count = await budgeted("deduct_stock", () => deps.deductStockBulk(lines));
    if (!count.success) return count;
    if (count.data !== lines.length) return err(fault("UNEXPECTED_ROW_COUNT", "deduct_stock", listed));
    const saved = await budgeted("save_deduction", () => deps.saveStockDeductions(planned.map((order) => order.id), payload.companyId, deps.clock()));
    if (!saved.success) return saved;
    if (saved.data !== planned.length) return err(fault("UNEXPECTED_ROW_COUNT", "save_deduction", listed));
    return ok(outcome({ ...skipped, deducted: planned.length }));
  };
}
