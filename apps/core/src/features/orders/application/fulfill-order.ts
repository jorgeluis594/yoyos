import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import { orderStateMachine, type OrderAggregate, type OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";

export type FulfillOrderError = OrderDomainError | Readonly<{ code: "ORDER_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type FulfillOrderDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, FulfillOrderError>>) => Promise<Result<T, FulfillOrderError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, FulfillOrderError>>;
  saveFulfillment: (id: OrderId, companyId: CompanyId, change: Pick<OrderAggregate, "deliveryStatus" | "completedAt">) => Promise<Result<null, FulfillOrderError>>;
  clock: () => Date;
}>;

export async function registerShipment(id: OrderId, context: OrderAccess, deps: FulfillOrderDependencies): Promise<Result<OrderAggregate, FulfillOrderError>> {
  return deps.transaction(context.companyId, async () => {
    const found = await deps.findOrderForUpdate(id, context.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const shipped = orderStateMachine.registerShipment(found.data);
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
