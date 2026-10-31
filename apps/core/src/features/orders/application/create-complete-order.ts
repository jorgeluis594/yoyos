import { err, map, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import type { OrderWithStockDue } from "@core/src/features/orders/domain/stock-deduction";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { DeductionOutcome } from "@core/src/features/orders/application/deduct-due-stock";
import { stockRefusalOf, type StockRefusal } from "@core/src/features/orders/application/describe-order-stock-due";
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
}>;
export type CreateCompleteOrderError = CreateOrderError | RegisterPaymentError | SetDeliveryError | FulfillOrderError | StockRefusal;
export type CreateCompleteOrderDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, CreateCompleteOrderError>>) => Promise<Result<T, CreateCompleteOrderError>>;
  create: (input: CreateOrderInput, context: OrderAccess) => Promise<Result<OrderAggregate, CreateOrderError>>;
  setDelivery: (input: SetDeliveryInput, context: OrderAccess) => Promise<Result<Readonly<{ order: OrderAggregate }>, SetDeliveryError>>;
  registerPayment: (input: RegisterPaymentInput, context: OrderAccess) => Promise<Result<RegisterPaymentOutput, RegisterPaymentError>>;
  ship: (id: CreateOrderInput["id"], context: OrderAccess) => Promise<Result<OrderAggregate, FulfillOrderError>>;
  deliver: (id: CreateOrderInput["id"], context: OrderAccess) => Promise<Result<OrderAggregate, FulfillOrderError>>;
}>;

export async function createCompleteOrder(input: CreateCompleteOrderInput, context: OrderAccess,
  deps: CreateCompleteOrderDependencies): Promise<Result<OrderWithStockDue, CreateCompleteOrderError>> {
  if (input.delivery && !("expectedPrice" in input.delivery))
    return err({ code: "INVALID_ORDER", message: "Initial delivery requires a reviewed configured rate" });
  if ((input.deliverImmediately !== undefined && typeof input.deliverImmediately !== "boolean") ||
    (input.shipImmediately !== undefined && typeof input.shipImmediately !== "boolean") ||
    new Set(input.payments?.map(payment => payment.paymentId)).size !== (input.payments?.length ?? 0))
    return err({ code: "INVALID_ORDER", message: "Invalid creation options or duplicate payment identifiers" });
  if (input.shipImmediately && input.deliverImmediately)
    return err({ code: "INVALID_ORDER", message: "Shipping immediately excludes delivering immediately" });
  if (input.shipImmediately && (!input.delivery || input.delivery.delivery.method === "store"))
    return err({ code: "INVALID_ORDER", message: "Shipping immediately requires home delivery or agency" });
  return deps.transaction(context.companyId, async () => {
    const result = await deps.create({ id: input.id, scheduledDispatchDate: input.scheduledDispatchDate, customer: input.customer, items: input.items }, context);
    if (!result.success) return result;
    let current: OrderWithStockDue = { order: result.data, stockDue: null };
    let lastOutcome: DeductionOutcome | null = null;
    if (input.delivery) {
      const delivered = await deps.setDelivery({ ...input.delivery, orderId: input.id }, context);
      if (!delivered.success) return delivered;
      current = { order: delivered.data.order, stockDue: null };
    }
    for (const payment of input.payments ?? []) {
      const paid = await deps.registerPayment({ ...payment, source: "manual", orderId: input.id }, context);
      if (!paid.success) return paid;
      current = { order: paid.data.order, stockDue: paid.data.stockDue };
      lastOutcome = paid.data.outcome ?? lastOutcome;
    }
    // Shipping and delivering deduct the stock by themselves; a short outcome of the payment listener is refused here with its own error.
    if (input.shipImmediately) return map(await deps.ship(input.id, context), (order) => ({ order, stockDue: null }));
    if (!input.deliverImmediately) return ok(current);
    const refusal = current.order.stockDeducted ? null : stockRefusalOf(lastOutcome);
    if (refusal) return err(refusal);
    return map(await deps.deliver(input.id, context), (order) => ({ order, stockDue: null }));
  });
}
