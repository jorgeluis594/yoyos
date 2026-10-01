import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import { orderStateMachine, type OrderAggregate, type OrderDomainError, type Payment, type PaymentMethod } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId, OrderId, PaymentId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

export type RegisterPaymentInput = Readonly<{ orderId: OrderId; paymentId: PaymentId; amount: Money; method: PaymentMethod; deductStockIfPartial: boolean }>;
export type StockOutcome = Readonly<{ kind: "deducted" | "not_requested" }> |
  Readonly<{ kind: "pending"; reason: "INSUFFICIENT_STOCK" | "PERSISTENCE_UNAVAILABLE" }> |
  Readonly<{ kind: "inapplicable"; reason: "ORDER_CANCELLED" }>;
export type RegisterPaymentOutput = Readonly<{ order: OrderAggregate; stock: StockOutcome }>;
export type RegisterPaymentError = OrderDomainError | Readonly<{ code: "ORDER_NOT_FOUND" | "INSUFFICIENT_STOCK" | "PERSISTENCE_UNAVAILABLE" | "PAYMENT_CONFLICT"; message: string; variantId?: string }>;
export type RegisterPaymentDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, RegisterPaymentError>>) => Promise<Result<T, RegisterPaymentError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, RegisterPaymentError>>;
  savePayment: (payment: Payment, companyId: CompanyId) => Promise<Result<null, RegisterPaymentError>>;
  deductProductStock: (variantId: VariantId, quantity: PositiveInteger) => Promise<Result<null, RegisterPaymentError>>;
  saveStockDeduction: (id: OrderId, companyId: CompanyId) => Promise<Result<null, RegisterPaymentError>>;
  clock: () => Date;
}>;

export async function registerPayment(input: RegisterPaymentInput, context: OrderAccess, deps: RegisterPaymentDependencies): Promise<Result<RegisterPaymentOutput, RegisterPaymentError>> {
  const recorded = await deps.transaction(context.companyId, async () => {
    const found = await deps.findOrderForUpdate(input.orderId, context.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const payment: Payment = { id: input.paymentId, orderId: input.orderId, amount: input.amount, method: input.method, recordedAt: deps.clock() };
    const next = orderStateMachine.registerPayment(found.data, payment);
    if (!next.success) return next;
    if (found.data.payments.some((existing) => existing.id === payment.id)) return next;
    const saved = await deps.savePayment(payment, context.companyId);
    return saved.success ? next : saved;
  });
  if (!recorded.success) return recorded;

  const deduction = await deps.transaction(context.companyId, async () => {
    const found = await deps.findOrderForUpdate(input.orderId, context.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Recorded order disappeared" });
    const state = orderStateMachine.getLifecycle(found.data);
    if (!state.success) return state;
    if (state.data.status === "cancelled") return ok<RegisterPaymentOutput>({ order: found.data, stock: { kind: "inapplicable", reason: "ORDER_CANCELLED" } });
    const plan = orderStateMachine.planStockDeduction(found.data, input.deductStockIfPartial);
    if (!plan.success) return plan;
    if (plan.data.kind === "none") return ok<RegisterPaymentOutput>({ order: found.data,
      stock: { kind: plan.data.reason === "already_deducted" ? "deducted" : "not_requested" } });
    for (const item of [...found.data.items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      const deducted = await deps.deductProductStock(item.variantId, item.quantity);
      if (!deducted.success) return deducted;
    }
    const saved = await deps.saveStockDeduction(input.orderId, context.companyId);
    return saved.success ? ok<RegisterPaymentOutput>({ order: plan.data.nextOrder, stock: { kind: "deducted" } }) : saved;
  });
  if (deduction.success) return deduction;
  if (deduction.error.code === "INSUFFICIENT_STOCK" || deduction.error.code === "PERSISTENCE_UNAVAILABLE")
    return ok({ order: recorded.data, stock: { kind: "pending", reason: deduction.error.code } });
  throw new Error("Unexpected state after recording payment", { cause: deduction.error });
}
