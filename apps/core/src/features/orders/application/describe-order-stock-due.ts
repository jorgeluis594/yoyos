import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransactionEndingError } from "@core/src/shared/infrastructure/persistence-error";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { describeStockDue, isStockDeductionDue, parseStockQuantity, toStockOrder, type NonNegativeInteger, type OrderWithStockDue, type StockDue } from "@core/src/features/orders/domain/stock-deduction";
import type { DeductionOutcome } from "@core/src/features/orders/application/deduct-due-stock";

/** What a use case that published a stock event answers: the order, its `stockDue`, and what the listener did (null on a replay that published nothing). */
export type StockEventResult = OrderWithStockDue & Readonly<{ outcome: DeductionOutcome | null }>;
export type StockReader = (variantIds: readonly VariantId[]) => Promise<Result<ReadonlyMap<VariantId, unknown>, TransactionEndingError>>;

/** A missing row counts as 0. An unreadable quantity is a data fault that the deduction path reports; the order then reads as being deducted. */
function describeWith(order: OrderAggregate, rows: ReadonlyMap<VariantId, unknown>): StockDue | null {
  const stock = new Map<VariantId, NonNegativeInteger>();
  for (const [variantId, raw] of rows) {
    const quantity = parseStockQuantity(raw);
    if (!quantity.success) return isStockDeductionDue(toStockOrder(order)) ? { kind: "deducting" } : null;
    stock.set(variantId, quantity.data);
  }
  return describeStockDue(toStockOrder(order), stock);
}

/**
 * The producer's order and its `stockDue`, from the outcome of the event it published. `failed` is the only outcome that reads stock (inside the producer's transaction).
 * `deducted` returns the order as deducted.
 */
export async function orderWithStockDue(order: OrderAggregate, outcome: DeductionOutcome, readStock: StockReader): Promise<Result<StockEventResult, TransactionEndingError>> {
  switch (outcome.kind) {
    case "deducted": return ok({ order: { ...order, stockDeducted: true }, stockDue: null, outcome });
    case "not_due": return ok({ order, stockDue: null, outcome });
    case "short": return ok({ order, stockDue: { kind: "waiting", shortItems: outcome.shortItems }, outcome });
    case "skipped_locked":
    case "failed": {
      if (!isStockDeductionDue(toStockOrder(order))) return ok({ order, stockDue: null, outcome });
      const rows = await readStock(order.items.map((item) => item.variantId));
      return rows.success ? ok({ order, stockDue: describeWith(order, rows.data), outcome }) : err(rows.error);
    }
  }
}

export type DescribeOrderStockDueDependencies = Readonly<{
  readStock: StockReader;
  /** Runs the read against one snapshot (joins the active transaction when there is one). */
  inSnapshot: <T>(read: () => Promise<T>) => Promise<T>;
}>;

/** `stockDue` of each order. Only due orders cost a stock read, once for all of them; with none due nothing is read. */
export async function describeOrderStockDue(orders: readonly OrderAggregate[], deps: DescribeOrderStockDueDependencies):
  Promise<Result<ReadonlyMap<OrderId, StockDue | null>, TransactionEndingError>> {
  const due = orders.filter((order) => isStockDeductionDue(toStockOrder(order)));
  const described = new Map<OrderId, StockDue | null>(orders.map((order) => [order.id, null]));
  if (due.length === 0) return ok(described);
  const variantIds = [...new Set(due.flatMap((order) => order.items.map((item) => item.variantId)))];
  const rows = await deps.inSnapshot(() => deps.readStock(variantIds));
  if (!rows.success) return err(rows.error);
  for (const order of due) described.set(order.id, describeWith(order, rows.data));
  return ok(described);
}

export type StockRefusal = Readonly<{ code: "INSUFFICIENT_STOCK"; message: string; variantId: string }>
  | Readonly<{ code: "INVALID_STORED_DATA" | "PERSISTENCE_UNAVAILABLE"; message: string }>;

/**
 * Why an order that has to be deducted right now (delivered at creation, immediate sale) was not: short stock names the first short variant;
 * a data fault is INVALID_STORED_DATA; a contended or failed statement is PERSISTENCE_UNAVAILABLE, so the seller retries. Never "no stock" when stock is enough.
 */
export function stockRefusalOf(outcome: DeductionOutcome | null): StockRefusal | null {
  if (outcome === null) return null;
  if (outcome.kind === "short") return { code: "INSUFFICIENT_STOCK", message: "Not enough stock", variantId: outcome.shortItems[0].variantId };
  if (outcome.kind === "skipped_locked") return { code: "PERSISTENCE_UNAVAILABLE", message: "Stock is being updated" };
  if (outcome.kind !== "failed") return null;
  return outcome.errorCode === "INVALID_STORED_DATA" || outcome.errorCode === "UNEXPECTED_ROW_COUNT"
    ? { code: "INVALID_STORED_DATA", message: "Invalid stored stock data" } : { code: "PERSISTENCE_UNAVAILABLE", message: "Unable to deduct stock" };
}
