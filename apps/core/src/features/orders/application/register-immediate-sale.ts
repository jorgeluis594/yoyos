import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { createOrderInTransaction, type CreateOrderDependencies, type CreateOrderError, type CreateOrderInput, type OrderAccess } from "@core/src/features/orders/application/create-order";
import { orderStateMachine, type OrderAggregate, type OrderDomainError, type Payment } from "@core/src/features/orders/domain/order-state-machine";
import { confirmPayment } from "@core/src/features/orders/domain/payment";
import type { PaymentError } from "@core/src/features/orders/domain/payment";
import type { CompanyId, OrderId, PaymentId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

export type RegisterImmediateSaleError = CreateOrderError | OrderDomainError | PaymentError | Readonly<{ code: "INSUFFICIENT_STOCK"; message: string; variantId?: string }>;
export type RegisterImmediateSaleDependencies = Omit<CreateOrderDependencies, "transaction"> & Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, RegisterImmediateSaleError>>) => Promise<Result<T, RegisterImmediateSaleError>>;
  savePayment: (payment: Payment, companyId: CompanyId) => Promise<Result<null, RegisterImmediateSaleError>>;
  deductProductStock: (variantId: VariantId, quantity: PositiveInteger) => Promise<Result<null, RegisterImmediateSaleError>>;
  saveStockDeduction: (id: OrderId, companyId: CompanyId) => Promise<Result<null, RegisterImmediateSaleError>>;
  saveFulfillment: (id: OrderId, companyId: CompanyId, change: Pick<OrderAggregate, "deliveryStatus" | "deliveredAt" | "completedAt">) => Promise<Result<null, RegisterImmediateSaleError>>;
  newPaymentId: () => PaymentId;
}>;

export async function registerImmediateSale(input: CreateOrderInput, context: OrderAccess, deps: RegisterImmediateSaleDependencies): Promise<Result<OrderAggregate, RegisterImmediateSaleError>> {
  return deps.transaction(context.companyId, async () => {
    const created = await createOrderInTransaction(input, context, deps);
    if (!created.success) return created;
    const confirmed = confirmPayment({ id: deps.newPaymentId(), orderId: input.id, source: "manual", amount: created.data.total,
      method: "digital_wallet", confirmedBy: context.userId, confirmedAt: deps.clock() }, null);
    if (!confirmed.success) return confirmed;
    const payment = confirmed.data;
    const paid = orderStateMachine.registerPayment(created.data, payment);
    if (!paid.success) return paid;
    const savedPayment = await deps.savePayment(payment, context.companyId);
    if (!savedPayment.success) return savedPayment;
    const plan = orderStateMachine.planStockDeduction(paid.data, false);
    if (!plan.success) return plan;
    if (plan.data.kind !== "deduct") throw new Error("New immediate sale has no stock deduction plan");
    for (const item of [...paid.data.items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      const deducted = await deps.deductProductStock(item.variantId, item.quantity);
      if (!deducted.success) return deducted;
    }
    const stockSaved = await deps.saveStockDeduction(input.id, context.companyId);
    if (!stockSaved.success) return stockSaved;
    const completedAt = deps.clock();
    const delivered = orderStateMachine.registerDelivery(plan.data.nextOrder, completedAt);
    if (!delivered.success) return delivered;
    const fulfilled = await deps.saveFulfillment(input.id, context.companyId, delivered.data);
    return fulfilled.success ? ok(delivered.data) : fulfilled;
  });
}
