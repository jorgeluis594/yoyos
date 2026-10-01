import { err, ok } from "@shared/functional";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import { orderStateMachine, type DeliveryDetails, type OrderAggregate, type OrderDomainError, type ResolvedDelivery } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId, OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

export type SetDeliveryInput = Readonly<{ orderId: OrderId; delivery: DeliveryDetails; chargeDeliveryToCustomer: boolean }>;
export type SetDeliveryError = OrderDomainError | Readonly<{ code: "ORDER_NOT_FOUND" | "INSUFFICIENT_STOCK" | "PERSISTENCE_UNAVAILABLE" | "DELIVERY_UNAVAILABLE"; message: string; variantId?: string }>;
export type SetDeliveryDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, SetDeliveryError>>) => Promise<Result<T, SetDeliveryError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, SetDeliveryError>>;
  resolveDelivery: (selection: DeliveryDetails, companyId: CompanyId, currency: Currency) => Promise<Result<ResolvedDelivery, SetDeliveryError>>;
  saveDelivery: (id: OrderId, companyId: CompanyId, change: Pick<OrderAggregate, "delivery" | "deliveryCost" | "deliveryCharge" | "total">) => Promise<Result<null, SetDeliveryError>>;
  deductProductStock: (variantId: VariantId, quantity: PositiveInteger) => Promise<Result<null, SetDeliveryError>>;
  saveStockDeduction: (id: OrderId, companyId: CompanyId) => Promise<Result<null, SetDeliveryError>>;
}>;

export async function setOrderDelivery(input: SetDeliveryInput, context: OrderAccess, deps: SetDeliveryDependencies): Promise<Result<OrderAggregate, SetDeliveryError>> {
  return deps.transaction(context.companyId, async () => {
    const found = await deps.findOrderForUpdate(input.orderId, context.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const resolved = await deps.resolveDelivery(input.delivery, context.companyId, found.data.total.currency);
    if (!resolved.success) return resolved;
    const changed = orderStateMachine.setDelivery(found.data, { resolved: resolved.data,
      chargeDeliveryToCustomer: input.chargeDeliveryToCustomer });
    if (!changed.success) return changed;
    const before = orderStateMachine.getPaymentSummary(found.data);
    const after = orderStateMachine.getPaymentSummary(changed.data);
    if (!before.success) return before;
    if (!after.success) return after;
    let next = changed.data;
    if (before.data.status === "pending" && after.data.status === "paid" && !found.data.stockDeducted) {
      const plan = orderStateMachine.planStockDeduction(changed.data, false);
      if (!plan.success) return plan;
      if (plan.data.kind !== "deduct") throw new Error("Covered order has no stock deduction plan");
      for (const item of [...changed.data.items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
        const deducted = await deps.deductProductStock(item.variantId, item.quantity);
        if (!deducted.success) return deducted;
      }
      const saved = await deps.saveStockDeduction(input.orderId, context.companyId);
      if (!saved.success) return saved;
      next = plan.data.nextOrder;
    }
    const saved = await deps.saveDelivery(input.orderId, context.companyId, next);
    return saved.success ? ok(next) : saved;
  });
}
