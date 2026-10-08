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
}>;
export type CreateCompleteOrderError = CreateOrderError | RegisterPaymentError | SetDeliveryError | FulfillOrderError;
export type CreateCompleteOrderDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, CreateCompleteOrderError>>) => Promise<Result<T, CreateCompleteOrderError>>;
  create: (input: CreateOrderInput, context: OrderAccess) => Promise<Result<OrderAggregate, CreateOrderError>>;
  setDelivery: (input: SetDeliveryInput, context: OrderAccess) => Promise<Result<OrderAggregate, SetDeliveryError>>;
  registerPayment: (input: RegisterPaymentInput, context: OrderAccess) => Promise<Result<RegisterPaymentOutput, RegisterPaymentError>>;
  deliver: (id: CreateOrderInput["id"], context: OrderAccess) => Promise<Result<OrderAggregate, FulfillOrderError>>;
}>;

export async function createCompleteOrder(input: CreateCompleteOrderInput, context: OrderAccess,
  deps: CreateCompleteOrderDependencies): Promise<Result<OrderAggregate, CreateCompleteOrderError>> {
  if ((input.deliverImmediately !== undefined && typeof input.deliverImmediately !== "boolean") ||
    new Set(input.payments?.map(payment => payment.paymentId)).size !== (input.payments?.length ?? 0))
    return err({ code: "INVALID_ORDER", message: "Invalid creation options or duplicate payment identifiers" });
  return deps.transaction(context.companyId, async () => {
    const result = await deps.create({ id: input.id, contactId: input.contactId, items: input.items }, context);
    if (!result.success) return result;
    let order = result.data;
    if (input.delivery) {
      const delivered = await deps.setDelivery({ ...input.delivery, orderId: input.id }, context);
      if (!delivered.success) return delivered;
      order = delivered.data;
    }
    for (const payment of input.payments ?? []) {
      const paid = await deps.registerPayment({ ...payment, source: "manual", orderId: input.id }, context);
      if (!paid.success) return paid;
      order = paid.data.order;
    }
    return input.deliverImmediately ? deps.deliver(input.id, context) : { success: true, data: order };
  });
}
