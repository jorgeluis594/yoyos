import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { orderStateMachine, type OrderAggregate, type OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import { reportPayment as createReport, type ImageId, type Payment, type PaymentError } from "@core/src/features/orders/domain/payment";
import type { CompanyId, OrderId, PaymentId } from "@core/src/features/orders/domain/order";

export type BuyerPaymentAccess = Readonly<{ kind: "buyer"; companyId: CompanyId; orderId: OrderId }>;
export type ReportPaymentInput = Readonly<{ paymentId: PaymentId; receiptImageId: ImageId }>;
export type ReportPaymentError = OrderDomainError | PaymentError | Readonly<{ code: "ORDER_NOT_FOUND" | "RECEIPT_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type ReportPaymentDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, ReportPaymentError>>) => Promise<Result<T, ReportPaymentError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, ReportPaymentError>>;
  findReceipt: (id: string) => Promise<Result<string | null, ReportPaymentError>>;
  savePayment: (payment: Payment, companyId: CompanyId) => Promise<Result<null, ReportPaymentError>>;
  clock: () => Date;
}>;

export async function reportPayment(input: ReportPaymentInput, access: BuyerPaymentAccess,
  deps: ReportPaymentDependencies): Promise<Result<OrderAggregate, ReportPaymentError>> {
  return deps.transaction(access.companyId, async () => {
    const found = await deps.findOrderForUpdate(access.orderId, access.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const existing = found.data.payments.find((item) => item.id === input.paymentId) ?? null;
    const reported = createReport({ id: input.paymentId, orderId: access.orderId, currency: found.data.total.currency,
      receiptImageId: input.receiptImageId, reportedAt: deps.clock() }, existing);
    if (!reported.success) return reported;
    if (existing) return ok(found.data);
    if (reported.data.status !== "reported") return err({ code: "INVALID_TRANSITION", message: "Payment is not a report" });
    const receipt = await deps.findReceipt(input.receiptImageId);
    if (!receipt.success) return receipt;
    if (!receipt.data) return err({ code: "RECEIPT_NOT_FOUND", message: "Receipt image is not available" });
    const next = orderStateMachine.addReportedPayment(found.data, reported.data);
    if (!next.success) return next;
    const saved = await deps.savePayment(reported.data, access.companyId);
    return saved.success ? ok(next.data) : saved;
  });
}
