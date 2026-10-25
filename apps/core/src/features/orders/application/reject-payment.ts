import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import { orderStateMachine, type OrderAggregate, type OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import { parseRejectionReason, type Payment, type PaymentError } from "@core/src/features/orders/domain/payment";
import type { CompanyId, OrderId, PaymentId } from "@core/src/features/orders/domain/order";

export type RejectPaymentInput = Readonly<{ orderId: OrderId; paymentId: PaymentId; reason: string | null }>;
export type RejectPaymentError = OrderDomainError | PaymentError
  | Readonly<{ code: "ORDER_NOT_FOUND" | "PAYMENT_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type RejectPaymentOutput = Readonly<{ order: OrderAggregate; applied: boolean }>;
export type RejectPaymentDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, RejectPaymentError>>) => Promise<Result<T, RejectPaymentError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, RejectPaymentError>>;
  updatePayment: (payment: Payment, companyId: CompanyId, expectedStatus: "reported") => Promise<Result<null, RejectPaymentError>>;
  clock: () => Date;
}>;

export async function rejectPayment(input: RejectPaymentInput, context: OrderAccess,
  deps: RejectPaymentDependencies): Promise<Result<RejectPaymentOutput, RejectPaymentError>> {
  return deps.transaction(context.companyId, async () => {
    const found = await deps.findOrderForUpdate(input.orderId, context.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const existing = found.data.payments.find((item) => item.id === input.paymentId);
    if (!existing) return err({ code: "PAYMENT_NOT_FOUND", message: "Payment is not available" });
    if (existing.status === "rejected") return ok({ order: found.data, applied: false });
    const reason = parseRejectionReason(input.reason);
    if (!reason.success) return reason;
    const next = orderStateMachine.rejectReportedPayment(found.data, input.paymentId,
      { rejectedBy: context.userId, rejectedAt: deps.clock(), reason: reason.data });
    if (!next.success) return next;
    const payment = next.data.order.payments.find((item) => item.id === input.paymentId);
    if (!payment || payment.status !== "rejected") return err({ code: "INVALID_PAYMENT", message: "Invalid rejected payment" });
    if (next.data.applied) {
      const saved = await deps.updatePayment(payment, context.companyId, "reported");
      if (!saved.success) return saved;
    }
    return ok(next.data);
  });
}
