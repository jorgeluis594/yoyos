import { err, ok } from "@shared/functional";
import type { Currency, Money } from "@shared/money";
import type { Result } from "@shared/result";
import { orderStateMachine, parseRatedDeliverySelection, type RatedDeliverySelection, type OrderAggregate, type OrderDomainError, type ResolvedDelivery } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId, OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ResolveRateError } from "@core/src/features/delivery-settings";
import type { PeruDistrictError } from "@shared/peru-geography";
import type { VariantId } from "@core/src/features/products/domain/product";

export type RatedSetDeliveryInput = Readonly<{ orderId: OrderId; delivery: RatedDeliverySelection; expectedPrice: Money }>;
export type SetDeliveryInput = RatedSetDeliveryInput;
export type InitialOrderDeliveryInput = Omit<RatedSetDeliveryInput, "orderId">;
export type SetDeliveryError = OrderDomainError | ResolveRateError | PeruDistrictError | Readonly<{ code: "ORDER_NOT_FOUND" | "INSUFFICIENT_STOCK" | "PERSISTENCE_UNAVAILABLE" | "DELIVERY_UNAVAILABLE" | "DELIVERY_METHOD_DISABLED" | "COURIER_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string; variantId?: string; reason?: "resolver_not_integrated" | "availability_unconfirmed" }>;
export type SetDeliveryDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, SetDeliveryError>>) => Promise<Result<T, SetDeliveryError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, SetDeliveryError>>;
  resolveRatedDelivery: (selection: RatedDeliverySelection, context: OrderAccess, currency: Currency, expectedPrice: Money) => Promise<Result<ResolvedDelivery, SetDeliveryError>>;
  saveDelivery: (id: OrderId, companyId: CompanyId, change: Pick<OrderAggregate, "delivery" | "deliveryCost" | "deliveryCharge" | "total">) => Promise<Result<null, SetDeliveryError>>;
  deductProductStock: (variantId: VariantId, quantity: PositiveInteger) => Promise<Result<null, SetDeliveryError>>;
  saveStockDeduction: (id: OrderId, companyId: CompanyId) => Promise<Result<null, SetDeliveryError>>;
}>;

export async function setOrderDelivery(input: SetDeliveryInput, context: OrderAccess, deps: SetDeliveryDependencies): Promise<Result<OrderAggregate, SetDeliveryError>> {
  if (!("expectedPrice" in input) || "chargeDeliveryToCustomer" in input)
    return err({ code: "INVALID_ORDER", message: "Delivery requires a reviewed price and does not accept a charge decision" });
  const selection = parseRatedDeliverySelection(input.delivery);
  if (!selection.success) return selection;
  return deps.transaction(context.companyId, async () => {
    const found = await deps.findOrderForUpdate(input.orderId, context.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const allowed = orderStateMachine.canSetDelivery(found.data);
    if (!allowed.success) return allowed;
    const resolved = await deps.resolveRatedDelivery(selection.data, context, found.data.total.currency, input.expectedPrice);
    if (!resolved.success) return resolved;
    const changed = orderStateMachine.setDelivery(found.data, { resolved: resolved.data,
      chargeDeliveryToCustomer: true });
    if (!changed.success) return changed;
    return persistDeliveryChange(found.data, changed.data, deps);
  });
}

export async function persistDeliveryChange(previous: OrderAggregate, changed: OrderAggregate,
  deps: Pick<SetDeliveryDependencies, "saveDelivery" | "deductProductStock" | "saveStockDeduction">): Promise<Result<OrderAggregate, SetDeliveryError>> {
  const after = orderStateMachine.getPaymentSummary(changed);
  if (!after.success) return after;
  let next = changed;
  if (after.data.status === "paid" && !previous.stockDeducted) {
    const plan = orderStateMachine.planStockDeduction(changed, false);
    if (!plan.success) return plan;
    if (plan.data.kind !== "deduct") throw new Error("Covered order has no stock deduction plan");
    for (const item of [...changed.items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      const deducted = await deps.deductProductStock(item.variantId, item.quantity);
      if (!deducted.success) return deducted;
    }
    const saved = await deps.saveStockDeduction(previous.id, previous.companyId);
    if (!saved.success) return saved;
    next = plan.data.nextOrder;
  }
  if (changed === previous) return ok(next);
  const saved = await deps.saveDelivery(previous.id, previous.companyId, next);
  return saved.success ? ok(next) : saved;
}
