import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { DeliveryStatus, OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

export type NonNegativeInteger = number & { readonly __brand: "NonNegativeInteger" };
/** A variant missing from the map counts as 0. */
export type VariantStock = ReadonlyMap<VariantId, NonNegativeInteger>;
export type StockLine = Readonly<{ variantId: VariantId; quantity: PositiveInteger }>;
/** A line with the units of it already taken out of the variant's stock (`deducted` never above `quantity` once an edit is settled). */
export type StockOrderLine = StockLine & Readonly<{ deducted: NonNegativeInteger }>;
export type ShortItem = Readonly<{ variantId: VariantId; available: NonNegativeInteger }>;
/** What deduction needs from an order; OrderAggregate satisfies it through toStockOrder. */
export type StockOrder = Readonly<{ id: OrderId; createdAt: Date; cancelled: boolean; stockDeducted: boolean;
  deliveryStatus: DeliveryStatus; total: Money; items: readonly [StockOrderLine, ...StockOrderLine[]];
  confirmedPayments: readonly Readonly<{ amount: Money; deductStockIfPartial: boolean }>[] }>;
export type DueStockDeductionPlan =
  | Readonly<{ kind: "not_due" }>
  | Readonly<{ kind: "short"; shortItems: readonly [ShortItem, ...ShortItem[]] }>
  | Readonly<{ kind: "deduct"; lines: readonly [StockLine, ...StockLine[]] }>;
export type StockDue =
  | Readonly<{ kind: "waiting"; shortItems: readonly [ShortItem, ...ShortItem[]] }>
  /** The stock was deducted, but an edit added units that did not fit: they are deducted when there is stock. */
  | Readonly<{ kind: "partial_waiting"; shortItems: readonly [ShortItem, ...ShortItem[]] }>
  | Readonly<{ kind: "deducting" }>;
export type OrderWithStockDue = Readonly<{ order: OrderAggregate; stockDue: StockDue | null }>;

export function toStockOrder(order: OrderAggregate): StockOrder {
  const [first, ...rest] = order.items;
  const line = (item: typeof first): StockOrderLine => ({ variantId: item.variantId, quantity: item.quantity, deducted: item.stockDeductedQuantity as NonNegativeInteger });
  return { id: order.id, createdAt: order.createdAt, cancelled: order.cancelled, stockDeducted: order.stockDeducted,
    deliveryStatus: order.deliveryStatus, total: order.total, items: [line(first), ...rest.map(line)],
    confirmedPayments: order.payments.flatMap((payment) => payment.status === "confirmed"
      ? [{ amount: payment.amount, deductStockIfPartial: payment.deductStockIfPartial }] : []) };
}

const cents = (money: Money) => Math.round(money.amount * 100);

const pendingOf = (line: StockOrderLine) => Math.max(0, line.quantity - line.deducted);

/** A deducted order with lines whose units were not all taken out yet (an edit added units that did not fit). */
export function hasPendingStock(order: StockOrder): boolean {
  return order.stockDeducted && !order.cancelled && order.deliveryStatus === "pending" && order.items.some((line) => pendingOf(line) > 0);
}

/** Not cancelled, delivery pending, and either the stock is not deducted and payments cover the total or a confirmed payment asked to deduct, or deducted lines are still pending. */
export function isStockDeductionDue(order: StockOrder): boolean {
  if (order.cancelled || order.deliveryStatus !== "pending") return false;
  if (order.stockDeducted) return hasPendingStock(order);
  if (order.confirmedPayments.some((payment) => payment.deductStockIfPartial)) return true;
  return order.confirmedPayments.reduce((sum, payment) => sum + cents(payment.amount), 0) >= cents(order.total);
}

/** The lines whose pending units do not fit. */
function shortItemsOf(order: StockOrder, stock: VariantStock): ShortItem[] {
  return order.items.flatMap((item) => {
    const available = stock.get(item.variantId) ?? 0 as NonNegativeInteger;
    return available < pendingOf(item) ? [{ variantId: item.variantId, available }] : [];
  });
}

const needed = (order: StockOrder): StockLine[] => order.items.flatMap((item) => pendingOf(item) > 0 ? [{ variantId: item.variantId, quantity: pendingOf(item) as PositiveInteger }] : []);

export function planDueStockDeduction(order: StockOrder, stock: VariantStock): DueStockDeductionPlan {
  if (!isStockDeductionDue(order)) return { kind: "not_due" };
  const [first, ...rest] = shortItemsOf(order, stock);
  if (first) return { kind: "short", shortItems: [first, ...rest] };
  const [firstLine, ...otherLines] = needed(order);
  return firstLine ? { kind: "deduct", lines: [firstLine, ...otherLines] } : { kind: "not_due" };
}

export function describeStockDue(order: StockOrder, stock: VariantStock): StockDue | null {
  const plan = planDueStockDeduction(order, stock);
  if (plan.kind === "not_due") return null;
  if (plan.kind === "deduct") return { kind: "deducting" };
  return { kind: order.stockDeducted ? "partial_waiting" : "waiting", shortItems: plan.shortItems };
}

export function parseStockQuantity(value: unknown): Result<NonNegativeInteger, Readonly<{ code: "INVALID_STORED_DATA"; message: string }>> {
  const number = typeof value === "bigint" ? (value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : NaN) : typeof value === "number" ? value : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? ok(number as NonNegativeInteger)
    : err({ code: "INVALID_STORED_DATA", message: "Invalid stored stock quantity" });
}

export type StockUnits = Readonly<{ variantId: VariantId; quantity: PositiveInteger }>;
export type StockAdjustment = Readonly<{
  /** Units that go back to the variants (decreased and removed lines), in variantId order. */
  returns: readonly StockUnits[];
  /** Units taken out now (increased and new lines, as far as the stock reaches), in variantId order. */
  deductions: readonly StockUnits[];
  /** The new deducted figure of each line whose figure changes. */
  deductedByVariant: ReadonlyMap<VariantId, NonNegativeInteger>;
  /** Lines that stay with units pending, with the stock left after this adjustment. */
  pending: readonly ShortItem[];
}>;

/**
 * Adjusts a deducted order to its edited lines by the difference only: a line that now needs fewer units than were taken returns the surplus,
 * a line that needs more takes what fits and keeps the rest pending. `removed` holds the deducted units of the lines the edit deleted.
 * Applying it twice is a no-op: the second plan sees every line settled.
 */
export function planStockAdjustment(lines: readonly StockOrderLine[], removed: ReadonlyMap<VariantId, number>, stock: VariantStock): StockAdjustment {
  const returns = new Map<VariantId, number>();
  const deductions = new Map<VariantId, number>();
  const deductedByVariant = new Map<VariantId, NonNegativeInteger>();
  const pending: ShortItem[] = [];
  for (const [variantId, units] of removed) if (units > 0) returns.set(variantId, (returns.get(variantId) ?? 0) + units);
  for (const line of lines) {
    const available = stock.get(line.variantId) ?? 0;
    if (line.deducted > line.quantity) {
      returns.set(line.variantId, (returns.get(line.variantId) ?? 0) + line.deducted - line.quantity);
      deductedByVariant.set(line.variantId, line.quantity as number as NonNegativeInteger);
      continue;
    }
    const missing = line.quantity - line.deducted;
    const taken = Math.min(missing, available);
    if (taken > 0) {
      deductions.set(line.variantId, taken);
      deductedByVariant.set(line.variantId, (line.deducted + taken) as NonNegativeInteger);
    }
    if (taken < missing) pending.push({ variantId: line.variantId, available: (available - taken) as NonNegativeInteger });
  }
  const units = (map: ReadonlyMap<VariantId, number>): StockUnits[] =>
    [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([variantId, quantity]) => ({ variantId, quantity: quantity as PositiveInteger }));
  return { returns: units(returns), deductions: units(deductions), deductedByVariant, pending };
}
