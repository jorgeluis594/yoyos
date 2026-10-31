import { err } from "@shared/functional";
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

/** Shipping and delivering deduct the stock when it is still pending; short stock fails and the surrounding transaction persists nothing. */
async function deductPendingStock(order: OrderAggregate, at: Date, deps: FulfillOrderDependencies): Promise<Result<OrderAggregate, FulfillOrderError>> {
  const plan = orderStateMachine.planStockDeduction(order, true, at);
  if (!plan.success) return plan;
  if (plan.data.kind === "deduct") {
    const variantIds = order.items.map((item) => item.variantId).sort();
    const locked = await deps.lockVariantStock(variantIds, "wait");
    if (!locked.success) return locked;
    for (const item of [...order.items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      const available = parseStockQuantity(locked.data.get(item.variantId) ?? 0);
      if (!available.success) return err({ code: "INVALID_STORED_DATA", message: available.error.message });
      if (available.data < item.quantity) return err({ code: "INSUFFICIENT_STOCK", message: "Not enough stock", variantId: item.variantId });
    }
    const lines = order.items.map((item): StockLine => ({ variantId: item.variantId, quantity: item.quantity }));
    const deducted = await deps.deductStockBulk(lines);
    if (!deducted.success) return deducted;
    if (deducted.data !== lines.length) return err({ code: "INSUFFICIENT_STOCK", message: "Not enough stock", variantId: lines[0]!.variantId });
    const saved = await deps.saveStockDeduction(order.id, order.companyId, at);
    if (!saved.success) return saved;
  }
  return { success: true, data: plan.data.nextOrder };
}

export async function shipOrder(order: OrderAggregate, shippedAt: Date, deps: FulfillOrderDependencies): Promise<Result<OrderAggregate, FulfillOrderError>> {
  const deducted = await deductPendingStock(order, shippedAt, deps);
  return deducted.success ? orderStateMachine.registerShipment(deducted.data, shippedAt) : deducted;
}

/** Delivering needs a confirmed payment, partial or full, and deducts pending stock like shipping does. */
export async function deliverOrder(order: OrderAggregate, deliveredAt: Date, deps: FulfillOrderDependencies): Promise<Result<OrderAggregate, FulfillOrderError>> {
  const deducted = await deductPendingStock(order, deliveredAt, deps);
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
