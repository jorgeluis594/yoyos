import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { createOrderInTransaction, type CreateOrderDependencies, type CreateOrderError, type CreateOrderInput, type OrderAccess } from "@core/src/features/orders/application/create-order";
import { orderStateMachine, type OrderAggregate, type FulfillmentChange, type OrderDomainError, type Payment } from "@core/src/features/orders/domain/order-state-machine";
import { confirmPayment } from "@core/src/features/orders/domain/payment";
import type { PaymentError } from "@core/src/features/orders/domain/payment";
import type { CompanyId, OrderId, PaymentId } from "@core/src/features/orders/domain/order";
import type { TransactionEndingError } from "@core/src/shared/application/contained-failure";
import type { PaymentConfirmed } from "@core/src/features/orders/application/events";
import type { DeductionOutcome } from "@core/src/features/orders/application/deduct-due-stock";
import { stockRefusalOf, type StockRefusal } from "@core/src/features/orders/application/describe-order-stock-due";

/** An immediate sale delivers at once, so it needs the stock deducted now: short or unreadable stock refuses it (nothing persists). */
export type RegisterImmediateSaleError = CreateOrderError | OrderDomainError | PaymentError | StockRefusal;
export type RegisterImmediateSaleDependencies = Omit<CreateOrderDependencies, "transaction"> & Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, RegisterImmediateSaleError>>) => Promise<Result<T, RegisterImmediateSaleError>>;
  savePayment: (payment: Payment, companyId: CompanyId) => Promise<Result<null, RegisterImmediateSaleError>>;
  publishPaymentConfirmed: (payload: PaymentConfirmed) => Promise<Result<DeductionOutcome, TransactionEndingError>>;
  saveFulfillment: (id: OrderId, companyId: CompanyId, change: FulfillmentChange) => Promise<Result<null, RegisterImmediateSaleError>>;
  newPaymentId: () => PaymentId;
}>;

export async function registerImmediateSale(input: CreateOrderInput, context: OrderAccess, deps: RegisterImmediateSaleDependencies): Promise<Result<OrderAggregate, RegisterImmediateSaleError>> {
  return deps.transaction(context.companyId, async () => {
    const created = await createOrderInTransaction(input, context, deps);
    if (!created.success) return created;
    const confirmed = confirmPayment({ id: deps.newPaymentId(), orderId: input.id, source: "manual", amount: created.data.total,
      method: "digital_wallet", deductStockIfPartial: false, confirmedBy: context.userId, confirmedAt: deps.clock() }, null);
    if (!confirmed.success) return confirmed;
    const payment = confirmed.data;
    const paid = orderStateMachine.registerPayment(created.data, payment);
    if (!paid.success) return paid;
    const savedPayment = await deps.savePayment(payment, context.companyId);
    if (!savedPayment.success) return savedPayment;
    const outcome = await deps.publishPaymentConfirmed({ companyId: context.companyId, orderId: input.id, paymentId: payment.id });
    if (!outcome.success) return outcome;
    if (outcome.data.kind !== "deducted")
      return err(stockRefusalOf(outcome.data) ?? { code: "INVALID_STORED_DATA", message: "Immediate sale was not deducted" });
    const completedAt = deps.clock();
    const delivered = orderStateMachine.registerDelivery({ ...paid.data, stockDeducted: true }, completedAt);
    if (!delivered.success) return delivered;
    const fulfilled = await deps.saveFulfillment(input.id, context.companyId, delivered.data);
    return fulfilled.success ? ok(delivered.data) : fulfilled;
  });
}
