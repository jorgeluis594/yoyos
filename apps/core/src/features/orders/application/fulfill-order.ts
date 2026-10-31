import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { orderStateMachine, type OrderAggregate, type FulfillmentChange, type OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { parseStockQuantity, type StockLine } from "@core/src/features/orders/domain/stock-deduction";

export type FulfillOrderError = OrderDomainError | Readonly<{ code: "ORDER_NOT_FOUND" | "INSUFFICIENT_STOCK" | "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string; variantId?: string }>;
export type FulfillOrderDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, FulfillOrderError>>) => Promise<Result<T, FulfillOrderError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, FulfillOrderError>>;
  saveFulfillment: (id: OrderId, companyId: CompanyId, change: FulfillmentChange) => Promise<Result<null, FulfillOrderError>>;
  /** Stock capabilities of products: lock the rows (waiting), then one guarded statement that decrements every line or none. */
  lockVariantStock: (variantIds: readonly VariantId[], mode: "wait") => Promise<Result<ReadonlyMap<VariantId, unknown>, FulfillOrderError>>;
  deductStockBulk: (lines: readonly StockLine[]) => Promise<Result<number, FulfillOrderError>>;
  saveStockDeduction: (id: OrderId, companyId: CompanyId, stockDeductedAt: Date) => Promise<Result<null, FulfillOrderError>>;
  clock: () => Date;
}>;

/** The units of the order still to take out of the stock: all of it before the deduction, only the part an edit added that did not fit after it. */
export function pendingStockLines(order: OrderAggregate): StockLine[] {
  return order.items.flatMap((item): StockLine[] => {
    const pending = item.quantity - item.stockDeductedQuantity;
    return pending > 0 ? [{ variantId: item.variantId, quantity: pending as StockLine["quantity"] }] : [];
  });
}

/** Locks the variants (variantId order), checks that every pending line fits and takes the units out all or nothing; short stock is INSUFFICIENT_STOCK. */
export async function deductPendingStock(order: OrderAggregate, at: Date, deps: FulfillOrderDependencies): Promise<Result<null, FulfillOrderError>> {
  const lines = pendingStockLines(order);
  if (lines.length === 0) return ok(null);
  const locked = await deps.lockVariantStock(order.items.map((item) => item.variantId).sort(), "wait");
  if (!locked.success) return locked;
  for (const line of [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
    const available = parseStockQuantity(locked.data.get(line.variantId) ?? 0);
    if (!available.success) return err({ code: "INVALID_STORED_DATA", message: available.error.message });
    if (available.data < line.quantity) return err({ code: "INSUFFICIENT_STOCK", message: "Not enough stock", variantId: line.variantId });
  }
  const deducted = await deps.deductStockBulk(lines);
  if (!deducted.success) return deducted;
  if (deducted.data !== lines.length) return err({ code: "INSUFFICIENT_STOCK", message: "Not enough stock", variantId: lines[0]!.variantId });
  return deps.saveStockDeduction(order.id, order.companyId, at);
}

/** Shipping and delivering deduct the stock when it is still pending (or the part an edit left pending); short stock fails and the surrounding transaction persists nothing. */
async function deductForFulfillment(order: OrderAggregate, at: Date, deps: FulfillOrderDependencies): Promise<Result<OrderAggregate, FulfillOrderError>> {
  const plan = orderStateMachine.planStockDeduction(order, true, at);
  if (!plan.success) return plan;
  if (plan.data.kind === "deduct" || (plan.data.reason === "already_deducted" && pendingStockLines(order).length > 0)) {
    const deducted = await deductPendingStock(order, at, deps);
    if (!deducted.success) return deducted;
  }
  return ok(plan.data.nextOrder);
}

export async function shipOrder(order: OrderAggregate, shippedAt: Date, deps: FulfillOrderDependencies): Promise<Result<OrderAggregate, FulfillOrderError>> {
  const deducted = await deductForFulfillment(order, shippedAt, deps);
  return deducted.success ? orderStateMachine.registerShipment(deducted.data, shippedAt) : deducted;
}

/** Delivering needs a confirmed payment, partial or full, and deducts the pending stock like shipping does. */
export async function deliverOrder(order: OrderAggregate, deliveredAt: Date, deps: FulfillOrderDependencies): Promise<Result<OrderAggregate, FulfillOrderError>> {
  const deducted = await deductForFulfillment(order, deliveredAt, deps);
  return deducted.success ? orderStateMachine.registerDelivery(deducted.data, deliveredAt) : deducted;
}

export async function registerShipment(id: OrderId, context: OrderAccess, deps: FulfillOrderDependencies): Promise<Result<OrderAggregate, FulfillOrderError>> {
  return deps.transaction(context.companyId, async () => {
    const found = await deps.findOrderForUpdate(id, context.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const shipped = await shipOrder(found.data, deps.clock(), deps);
    if (!shipped.success) return shipped;
    const saved = await deps.saveFulfillment(id, context.companyId, shipped.data);
    return saved.success ? shipped : saved;
  });
}

export async function registerDelivery(id: OrderId, context: OrderAccess, deps: FulfillOrderDependencies): Promise<Result<OrderAggregate, FulfillOrderError>> {
  return deps.transaction(context.companyId, async () => {
    const found = await deps.findOrderForUpdate(id, context.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const delivered = await deliverOrder(found.data, deps.clock(), deps);
    if (!delivered.success) return delivered;
    const saved = await deps.saveFulfillment(id, context.companyId, delivered.data);
    return saved.success ? delivered : saved;
  });
}
