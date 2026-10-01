import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { orderStateMachine, type OrderAggregate, type OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-pending-order";
import type { CompanyId, OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

export type CancelOrderError = OrderDomainError | Readonly<{ code: "ORDER_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type CancelOrderDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, CancelOrderError>>) => Promise<Result<T, CancelOrderError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, CancelOrderError>>;
  restoreProductStock: (variantId: VariantId, quantity: PositiveInteger) => Promise<Result<null, CancelOrderError>>;
  saveCancellation: (id: OrderId, companyId: CompanyId, stockDeducted: false) => Promise<Result<null, CancelOrderError>>;
}>;

export async function cancelOrder(id: OrderId, context: OrderAccess, deps: CancelOrderDependencies): Promise<Result<OrderAggregate, CancelOrderError>> {
  return deps.transaction(context.companyId, async () => {
    const found = await deps.findOrderForUpdate(id, context.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const plan = orderStateMachine.cancel(found.data);
    if (!plan.success) return plan;
    if (found.data.cancelled) return ok(found.data);
    if (plan.data.restoreStock) {
      for (const item of [...found.data.items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
        const restored = await deps.restoreProductStock(item.variantId, item.quantity);
        if (!restored.success) return restored;
      }
    }
    const saved = await deps.saveCancellation(id, context.companyId, false);
    return saved.success ? ok(plan.data.nextOrder) : saved;
  });
}
