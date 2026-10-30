import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import type { DispatchDate } from "@shared/dispatch-date";
import { orderStateMachine, type DispatchScheduleChange, type FulfillmentChange, type OrderAggregate, type OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import { shipOrder, type FulfillOrderDependencies } from "@core/src/features/orders/application/fulfill-order";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";

export type UpdateOrderShippingInput = Readonly<{ orderId: OrderId; scheduledDispatchDate?: DispatchDate | null; status?: "shipped" | "delivered" }>;
export type UpdateOrderShippingError = OrderDomainError | Readonly<{ code: "ORDER_NOT_FOUND" | "INSUFFICIENT_STOCK" | "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string; variantId?: string }>;
export type UpdateOrderShippingDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, UpdateOrderShippingError>>) => Promise<Result<T, UpdateOrderShippingError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, UpdateOrderShippingError>>;
  saveDispatchSchedule: (id: OrderId, companyId: CompanyId, change: DispatchScheduleChange) => Promise<Result<null, UpdateOrderShippingError>>;
  saveFulfillment: (id: OrderId, companyId: CompanyId, change: FulfillmentChange) => Promise<Result<null, UpdateOrderShippingError>>;
  lockVariantStock: FulfillOrderDependencies["lockVariantStock"];
  deductStockBulk: FulfillOrderDependencies["deductStockBulk"];
  saveStockDeduction: FulfillOrderDependencies["saveStockDeduction"];
  clock: () => Date;
}>;

// Schedule first, then transition, in one transaction: any failure rolls both back.
export async function updateOrderShipping(input: UpdateOrderShippingInput, context: OrderAccess, deps: UpdateOrderShippingDependencies): Promise<Result<OrderAggregate, UpdateOrderShippingError>> {
  if (input.scheduledDispatchDate === undefined && input.status === undefined) return err({ code: "INVALID_ORDER", message: "Nothing to update" });
  return deps.transaction(context.companyId, async () => {
    const found = await deps.findOrderForUpdate(input.orderId, context.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    let order = found.data;
    if (input.scheduledDispatchDate !== undefined && input.scheduledDispatchDate !== order.scheduledDispatchDate) {
      const scheduled = orderStateMachine.scheduleDispatch(order, input.scheduledDispatchDate);
      if (!scheduled.success) return scheduled;
      const saved = await deps.saveDispatchSchedule(order.id, context.companyId, scheduled.data);
      if (!saved.success) return saved;
      order = scheduled.data;
    }
    if (input.status !== undefined && input.status !== order.deliveryStatus) {
      const now = deps.clock();
      const moved = input.status === "shipped" ? await shipOrder(order, now, deps) : orderStateMachine.registerDelivery(order, now);
      if (!moved.success) return moved;
      const saved = await deps.saveFulfillment(order.id, context.companyId, moved.data);
      if (!saved.success) return saved;
      order = moved.data;
    }
    return { success: true, data: order };
  });
}
