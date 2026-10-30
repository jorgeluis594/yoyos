import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { TransactionEndingError } from "@core/src/shared/application/contained-failure";
import { orderStateMachine, type OrderAggregate, type OrderDomainError, type Payment, type PaymentMethod, type WalletProvider } from "@core/src/features/orders/domain/order-state-machine";
import { confirmPayment } from "@core/src/features/orders/domain/payment";
import type { PaymentError } from "@core/src/features/orders/domain/payment";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId, OrderId, PaymentId } from "@core/src/features/orders/domain/order";
import type { PaymentConfirmed } from "@core/src/features/orders/application/events";
import type { DeductionOutcome } from "@core/src/features/orders/application/deduct-due-stock";
import { describeOrderStockDue, orderWithStockDue, type StockEventResult, type StockReader } from "@core/src/features/orders/application/describe-order-stock-due";

export type RegisterPaymentInput = Readonly<{ orderId: OrderId; paymentId: PaymentId; source?: "manual" | "buyer_report";
  amount: Money; method: PaymentMethod; walletProvider?: WalletProvider; deductStockIfPartial: boolean }>;
export type RegisterPaymentOutput = StockEventResult;
/** A payment is never rejected because of stock: only a transaction-ending failure comes from the deduction. */
export type RegisterPaymentError = OrderDomainError | PaymentError | Readonly<{ code: "ORDER_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE" | "PAYMENT_CONFLICT"; message: string }>;
export type RegisterPaymentDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, RegisterPaymentError>>) => Promise<Result<T, RegisterPaymentError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, RegisterPaymentError>>;
  savePayment: (payment: Payment, companyId: CompanyId) => Promise<Result<null, RegisterPaymentError>>;
  updatePayment: (payment: Payment, companyId: CompanyId, expectedStatus: "reported") => Promise<Result<null, RegisterPaymentError>>;
  saveCompletion: (id: OrderId, companyId: CompanyId, completedAt: Date) => Promise<Result<null, RegisterPaymentError>>;
  /** In-transaction event: the orders listener deducts the stock when the order is due and fits, and answers with what happened. */
  publishPaymentConfirmed: (payload: PaymentConfirmed) => Promise<Result<DeductionOutcome, TransactionEndingError>>;
  findVariantStock: StockReader;
  clock: () => Date;
}>;

export async function registerPayment(input: RegisterPaymentInput, context: OrderAccess, deps: RegisterPaymentDependencies): Promise<Result<RegisterPaymentOutput, RegisterPaymentError>> {
  return deps.transaction(context.companyId, async () => {
    const found = await deps.findOrderForUpdate(input.orderId, context.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const existing = found.data.payments.find((item) => item.id === input.paymentId) ?? null;
    const confirmed = confirmPayment({ id: input.paymentId, orderId: input.orderId, source: input.source ?? "manual", amount: input.amount,
      method: input.method, walletProvider: input.walletProvider, deductStockIfPartial: input.deductStockIfPartial,
      confirmedBy: context.userId, confirmedAt: deps.clock() }, existing);
    if (!confirmed.success) return confirmed;
    const payment = confirmed.data;
    const next = orderStateMachine.registerPayment(found.data, payment);
    if (!next.success) return next;
    if (existing?.status === "confirmed") {
      // A replay publishes nothing: the order is described as it stands.
      const described = await describeOrderStockDue([found.data], { readStock: deps.findVariantStock, inSnapshot: (read) => read() });
      return described.success ? ok({ order: found.data, stockDue: described.data.get(found.data.id) ?? null, outcome: null }) : described;
    }
    const saved = existing?.status === "reported"
      ? await deps.updatePayment(payment, context.companyId, "reported") : await deps.savePayment(payment, context.companyId);
    if (!saved.success) return saved;
    if (next.data.completedAt && !found.data.completedAt) {
      const completed = await deps.saveCompletion(input.orderId, context.companyId, next.data.completedAt);
      if (!completed.success) return completed;
    }
    const outcome = await deps.publishPaymentConfirmed({ companyId: context.companyId, orderId: input.orderId, paymentId: input.paymentId });
    if (!outcome.success) return outcome;
    return orderWithStockDue(next.data, outcome.data, deps.findVariantStock);
  });
}
