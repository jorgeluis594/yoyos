import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { CreateOrderInput, CreateOrderError, OrderAccess } from "@core/src/features/orders/application/create-order";
import type { RegisterPaymentInput, RegisterPaymentOutput, RegisterPaymentError } from "@core/src/features/orders/application/register-payment";
import type { InitialOrderDeliveryInput, SetDeliveryInput, SetDeliveryError } from "@core/src/features/orders/application/set-delivery";
import type { FulfillOrderError } from "@core/src/features/orders/application/fulfill-order";

export type CreateCompleteOrderInput = CreateOrderInput & Readonly<{
  payments?: readonly Omit<RegisterPaymentInput, "orderId" | "source">[];
  delivery?: InitialOrderDeliveryInput;
  deliverImmediately?: boolean;
  /** Leaves the order shipped in the creation transaction; needs a confirmed payment, delivery data and stock. */
  shipImmediately?: boolean;
  /** Records the payments as sent but leaves stock to the later explicit deduction; only for orders that stay pending. */
  deferStockDeduction?: boolean;
}>;
export type CreateCompleteOrderError = CreateOrderError | RegisterPaymentError | SetDeliveryError | FulfillOrderError;
export type CreateCompleteOrderDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, CreateCompleteOrderError>>) => Promise<Result<T, CreateCompleteOrderError>>;
  create: (input: CreateOrderInput, context: OrderAccess) => Promise<Result<OrderAggregate, CreateOrderError>>;
  setDelivery: (input: SetDeliveryInput, context: OrderAccess) => Promise<Result<OrderAggregate, SetDeliveryError>>;
  registerPayment: (input: RegisterPaymentInput, context: OrderAccess) => Promise<Result<RegisterPaymentOutput, RegisterPaymentError>>;
  ship: (id: CreateOrderInput["id"], context: OrderAccess) => Promise<Result<OrderAggregate, FulfillOrderError>>;
  deliver: (id: CreateOrderInput["id"], context: OrderAccess) => Promise<Result<OrderAggregate, FulfillOrderError>>;
}>;

export async function createCompleteOrder(input: CreateCompleteOrderInput, context: OrderAccess,
  deps: CreateCompleteOrderDependencies): Promise<Result<OrderAggregate, CreateCompleteOrderError>> {
  if (input.delivery && !("expectedPrice" in input.delivery))
    return err({ code: "INVALID_ORDER", message: "Initial delivery requires a reviewed configured rate" });
  if ((input.deliverImmediately !== undefined && typeof input.deliverImmediately !== "boolean") ||
    (input.shipImmediately !== undefined && typeof input.shipImmediately !== "boolean") ||
    (input.deferStockDeduction !== undefined && typeof input.deferStockDeduction !== "boolean") ||
    new Set(input.payments?.map(payment => payment.paymentId)).size !== (input.payments?.length ?? 0))
    return err({ code: "INVALID_ORDER", message: "Invalid creation options or duplicate payment identifiers" });
  if (input.deferStockDeduction && input.deliverImmediately)
    return err({ code: "INVALID_ORDER", message: "Stock deduction cannot be deferred when delivering immediately" });
  if (input.shipImmediately && (input.deliverImmediately || input.deferStockDeduction))
    return err({ code: "INVALID_ORDER", message: "Shipping immediately excludes delivering immediately and deferring stock deduction" });
  if (input.shipImmediately && (!input.delivery || input.delivery.delivery.method === "store"))
    return err({ code: "INVALID_ORDER", message: "Shipping immediately requires home delivery or agency" });
  return deps.transaction(context.companyId, async () => {
    const result = await deps.create({ id: input.id, scheduledDispatchDate: input.scheduledDispatchDate, customer: input.customer, items: input.items }, context);
    if (!result.success) return result;
    let order = result.data;
    if (input.delivery) {
      const delivered = await deps.setDelivery({ ...input.delivery, orderId: input.id }, context);
      if (!delivered.success) return delivered;
      order = delivered.data;
    }
    for (const payment of input.payments ?? []) {
      const paid = await deps.registerPayment({ ...payment, deferStockDeduction: input.deferStockDeduction, source: "manual", orderId: input.id }, context);
      if (!paid.success) return paid;
      order = paid.data.order;
    }
    if (input.shipImmediately) return deps.ship(input.id, context);
    return input.deliverImmediately ? deps.deliver(input.id, context) : { success: true, data: order };
  });
}
