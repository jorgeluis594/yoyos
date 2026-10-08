import { err, ok } from "@shared/functional";
import type { Currency, Money } from "@shared/money";
import type { Result } from "@shared/result";
import { orderStateMachine, parseDeliverySelection, parseRatedDeliverySelection, type RatedDeliverySelection, type DeliverySelection, type OrderAggregate, type OrderDomainError, type ResolvedDelivery } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId, OrderId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ResolveRateError } from "@core/src/features/delivery-settings";
import type { PeruDistrictError } from "@shared/peru-geography";
import type { VariantId } from "@core/src/features/products/domain/product";

export type LegacySetDeliveryInput = Readonly<{ orderId: OrderId; delivery: DeliverySelection; chargeDeliveryToCustomer: boolean }>;
export type RatedSetDeliveryInput = Readonly<{ orderId: OrderId; delivery: RatedDeliverySelection; expectedPrice: Money }>;
export type SetDeliveryInput = LegacySetDeliveryInput | RatedSetDeliveryInput;
export type InitialOrderDeliveryInput = Omit<LegacySetDeliveryInput, "orderId"> | Omit<RatedSetDeliveryInput, "orderId">;
export type SetDeliveryError = OrderDomainError | ResolveRateError | PeruDistrictError | Readonly<{ code: "ORDER_NOT_FOUND" | "INSUFFICIENT_STOCK" | "PERSISTENCE_UNAVAILABLE" | "DELIVERY_UNAVAILABLE" | "DELIVERY_METHOD_DISABLED" | "COURIER_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string; variantId?: string; reason?: "resolver_not_integrated" | "availability_unconfirmed" }>;
export type SetDeliveryDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, SetDeliveryError>>) => Promise<Result<T, SetDeliveryError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, SetDeliveryError>>;
  resolveDelivery: (selection: DeliverySelection, context: OrderAccess, currency: Currency) => Promise<Result<ResolvedDelivery, SetDeliveryError>>;
  resolveRatedDelivery: (selection: RatedDeliverySelection, context: OrderAccess, currency: Currency, expectedPrice: Money) => Promise<Result<ResolvedDelivery, SetDeliveryError>>;
  saveDelivery: (id: OrderId, companyId: CompanyId, change: Pick<OrderAggregate, "delivery" | "deliveryCost" | "deliveryCharge" | "total">) => Promise<Result<null, SetDeliveryError>>;
  deductProductStock: (variantId: VariantId, quantity: PositiveInteger) => Promise<Result<null, SetDeliveryError>>;
  saveStockDeduction: (id: OrderId, companyId: CompanyId) => Promise<Result<null, SetDeliveryError>>;
}>;

export async function setOrderDelivery(input: SetDeliveryInput, context: OrderAccess, deps: SetDeliveryDependencies): Promise<Result<OrderAggregate, SetDeliveryError>> {
  const selection = "expectedPrice" in input ? parseRatedDeliverySelection(input.delivery) : parseDeliverySelection(input.delivery);
  if (!selection.success) return selection;
  if ("expectedPrice" in input && "chargeDeliveryToCustomer" in input) return err({ code: "INVALID_ORDER", message: "Rated delivery does not accept a charge decision" });
  if (!("expectedPrice" in input) && typeof input.chargeDeliveryToCustomer !== "boolean") return err({ code: "INVALID_ORDER", message: "Invalid delivery charge decision" });
  return deps.transaction(context.companyId, async () => {
    const found = await deps.findOrderForUpdate(input.orderId, context.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const allowed = orderStateMachine.canSetDelivery(found.data);
    if (!allowed.success) return allowed;
    const resolved = "expectedPrice" in input
      ? await deps.resolveRatedDelivery(input.delivery, context, found.data.total.currency, input.expectedPrice)
      : await deps.resolveDelivery(input.delivery, context, found.data.total.currency);
    if (!resolved.success) return resolved;
    const changed = orderStateMachine.setDelivery(found.data, { resolved: resolved.data,
      chargeDeliveryToCustomer: "expectedPrice" in input ? true : input.chargeDeliveryToCustomer });
    if (!changed.success) return changed;
    const after = orderStateMachine.getPaymentSummary(changed.data);
    if (!after.success) return after;
    let next = changed.data;
    if (after.data.status === "paid" && !found.data.stockDeducted) {
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
