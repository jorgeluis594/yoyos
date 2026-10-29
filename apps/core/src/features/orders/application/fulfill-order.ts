import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import { orderStateMachine, type OrderAggregate, type FulfillmentChange, type OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId, OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

export type FulfillOrderError = OrderDomainError | Readonly<{ code: "ORDER_NOT_FOUND" | "INSUFFICIENT_STOCK" | "PERSISTENCE_UNAVAILABLE"; message: string; variantId?: string }>;
export type FulfillOrderDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, FulfillOrderError>>) => Promise<Result<T, FulfillOrderError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, FulfillOrderError>>;
  saveFulfillment: (id: OrderId, companyId: CompanyId, change: FulfillmentChange) => Promise<Result<null, FulfillOrderError>>;
  deductProductStock: (variantId: VariantId, quantity: PositiveInteger) => Promise<Result<null, FulfillOrderError>>;
  saveStockDeduction: (id: OrderId, companyId: CompanyId) => Promise<Result<null, FulfillOrderError>>;
  clock: () => Date;
}>;

/** Shipping deducts the stock when it is still pending; short stock fails and the surrounding transaction persists nothing. */
export async function shipOrder(order: OrderAggregate, shippedAt: Date, deps: FulfillOrderDependencies): Promise<Result<OrderAggregate, FulfillOrderError>> {
  const plan = orderStateMachine.planStockDeduction(order, true);
  if (!plan.success) return plan;
  if (plan.data.kind === "deduct") {
    for (const item of [...order.items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      const deducted = await deps.deductProductStock(item.variantId, item.quantity);
      if (!deducted.success) return deducted;
    }
    const saved = await deps.saveStockDeduction(order.id, order.companyId);
    if (!saved.success) return saved;
  }
  return orderStateMachine.registerShipment(plan.data.nextOrder, shippedAt);
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
    const delivered = orderStateMachine.registerDelivery(found.data, deps.clock());
    if (!delivered.success) return delivered;
    const saved = await deps.saveFulfillment(id, context.companyId, delivered.data);
    return saved.success ? delivered : saved;
  });
}
