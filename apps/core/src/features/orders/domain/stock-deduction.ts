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
export type ShortItem = Readonly<{ variantId: VariantId; available: NonNegativeInteger }>;
/** What deduction needs from an order; OrderAggregate satisfies it through toStockOrder. */
export type StockOrder = Readonly<{ id: OrderId; createdAt: Date; cancelled: boolean; stockDeducted: boolean;
  deliveryStatus: DeliveryStatus; total: Money; items: readonly [StockLine, ...StockLine[]];
  confirmedPayments: readonly Readonly<{ amount: Money; deductStockIfPartial: boolean }>[] }>;
export type DueStockDeductionPlan =
  | Readonly<{ kind: "not_due" }>
  | Readonly<{ kind: "short"; shortItems: readonly [ShortItem, ...ShortItem[]] }>
  | Readonly<{ kind: "deduct"; lines: readonly [StockLine, ...StockLine[]] }>;
export type StockDue =
  | Readonly<{ kind: "waiting"; shortItems: readonly [ShortItem, ...ShortItem[]] }>
  | Readonly<{ kind: "deducting" }>;
export type OrderWithStockDue = Readonly<{ order: OrderAggregate; stockDue: StockDue | null }>;

export function toStockOrder(order: OrderAggregate): StockOrder {
  const [first, ...rest] = order.items;
  const line = (item: typeof first): StockLine => ({ variantId: item.variantId, quantity: item.quantity });
  return { id: order.id, createdAt: order.createdAt, cancelled: order.cancelled, stockDeducted: order.stockDeducted,
    deliveryStatus: order.deliveryStatus, total: order.total, items: [line(first), ...rest.map(line)],
    confirmedPayments: order.payments.flatMap((payment) => payment.status === "confirmed"
      ? [{ amount: payment.amount, deductStockIfPartial: payment.deductStockIfPartial }] : []) };
}

const cents = (money: Money) => Math.round(money.amount * 100);

/** Not cancelled, not deducted, delivery pending, and payments cover the total or a confirmed payment asked to deduct. */
export function isStockDeductionDue(order: StockOrder): boolean {
  if (order.cancelled || order.stockDeducted || order.deliveryStatus !== "pending") return false;
  if (order.confirmedPayments.some((payment) => payment.deductStockIfPartial)) return true;
  return order.confirmedPayments.reduce((sum, payment) => sum + cents(payment.amount), 0) >= cents(order.total);
}

function shortItemsOf(order: StockOrder, stock: VariantStock): ShortItem[] {
  return order.items.flatMap((item) => {
    const available = stock.get(item.variantId) ?? 0 as NonNegativeInteger;
    return available < item.quantity ? [{ variantId: item.variantId, available }] : [];
  });
}

export function planDueStockDeduction(order: StockOrder, stock: VariantStock): DueStockDeductionPlan {
  if (!isStockDeductionDue(order)) return { kind: "not_due" };
  const [first, ...rest] = shortItemsOf(order, stock);
  if (first) return { kind: "short", shortItems: [first, ...rest] };
  return { kind: "deduct", lines: order.items };
}

export function describeStockDue(order: StockOrder, stock: VariantStock): StockDue | null {
  const plan = planDueStockDeduction(order, stock);
  if (plan.kind === "not_due") return null;
  return plan.kind === "short" ? { kind: "waiting", shortItems: plan.shortItems } : { kind: "deducting" };
}

export function parseStockQuantity(value: unknown): Result<NonNegativeInteger, Readonly<{ code: "INVALID_STORED_DATA"; message: string }>> {
  const number = typeof value === "bigint" ? (value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : NaN) : typeof value === "number" ? value : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? ok(number as NonNegativeInteger)
    : err({ code: "INVALID_STORED_DATA", message: "Invalid stored stock quantity" });
}
