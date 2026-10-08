import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { orderStateMachine, type OrderAggregate, type CancelledOrder, type CancellationDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
import type { PublishOrderCancelled } from "@core/src/features/orders/application/events";

export type CancellationPersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type CancelOrderError = CancellationDomainError | CancellationPersistenceError | Readonly<{ code: "ORDER_NOT_FOUND"; message: string }>;
export type CancelOrderDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, CancelOrderError>>) => Promise<Result<T, CancelOrderError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, CancellationPersistenceError | CancellationDomainError>>;
  saveCancellation: (id: OrderId, companyId: CompanyId) => Promise<Result<null, CancellationPersistenceError>>;
  publishOrderCancelled: PublishOrderCancelled;
}>;

export async function cancelOrder(id: OrderId, context: OrderAccess, deps: CancelOrderDependencies): Promise<Result<CancelledOrder, CancelOrderError>> {
  const result = await deps.transaction(context.companyId, async () => {
    const found = await deps.findOrderForUpdate(id, context.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const plan = orderStateMachine.cancel(found.data);
    if (!plan.success) return plan;
    if (plan.data.emitOrderCancelled) {
      const saved = await deps.saveCancellation(id, context.companyId);
      if (!saved.success) return saved;
    }
    return plan;
  });
  if (!result.success) return result;
  if (result.data.emitOrderCancelled) await deps.publishOrderCancelled({ orderId: id, companyId: context.companyId });
  return ok(result.data.nextOrder);
}
