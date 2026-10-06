import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import { orderStateMachine, type OrderAggregate, type OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { Payment, PaymentError } from "@core/src/features/orders/domain/payment";
import type { CompanyId, OrderId, PaymentId } from "@core/src/features/orders/domain/order";

export type VoidPaymentInput = Readonly<{ orderId: OrderId; paymentId: PaymentId }>;
export type VoidPaymentError = OrderDomainError | PaymentError | Readonly<{ code: "ORDER_NOT_FOUND" | "PAYMENT_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type VoidPaymentDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, VoidPaymentError>>) => Promise<Result<T, VoidPaymentError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, VoidPaymentError>>;
  updatePayment: (payment: Payment, companyId: CompanyId, expectedStatus: "confirmed") => Promise<Result<null, VoidPaymentError>>;
  saveCompletion: (id: OrderId, companyId: CompanyId, completedAt: null) => Promise<Result<null, VoidPaymentError>>;
  clock: () => Date;
}>;

export async function voidPayment(input: VoidPaymentInput, context: OrderAccess,
  deps: VoidPaymentDependencies): Promise<Result<OrderAggregate, VoidPaymentError>> {
  return deps.transaction(context.companyId, async () => {
    const found = await deps.findOrderForUpdate(input.orderId, context.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const existing = found.data.payments.find((item) => item.id === input.paymentId);
    if (!existing) return err({ code: "PAYMENT_NOT_FOUND", message: "Payment is not available" });
    if (existing.status === "voided") return ok(found.data);
    const next = orderStateMachine.voidConfirmedPayment(found.data, input.paymentId, context.userId, deps.clock());
    if (!next.success) return next;
    const payment = next.data.payments.find((item) => item.id === input.paymentId);
    if (!payment || payment.status !== "voided") return err({ code: "INVALID_PAYMENT", message: "Invalid voided payment" });
    const saved = await deps.updatePayment(payment, context.companyId, "confirmed");
    if (!saved.success) return saved;
    if (found.data.completedAt && !next.data.completedAt) {
      const completed = await deps.saveCompletion(input.orderId, context.companyId, null);
      if (!completed.success) return completed;
    }
    return ok(next.data);
  });
}
