import { err, ok } from "@shared/functional";
import type { Currency, Money } from "@shared/money";
import type { Result } from "@shared/result";
import { orderStateMachine, parseRatedDeliverySelection, type RatedDeliverySelection, type OrderAggregate, type OrderDomainError, type ResolvedDelivery } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
import type { ResolveRateError } from "@core/src/features/delivery-settings";
import type { PeruDistrictError } from "@shared/peru-geography";
import type { TransactionEndingError } from "@core/src/shared/infrastructure/persistence-error";
import type { OrderDeliveryChanged } from "@core/src/features/orders/application/events";
import type { DeductionOutcome } from "@core/src/features/orders/application/deduct-due-stock";
import { describeOrderStockDue, orderWithStockDue, type StockEventResult, type StockReader } from "@core/src/features/orders/application/describe-order-stock-due";

export type RatedSetDeliveryInput = Readonly<{ orderId: OrderId; delivery: RatedDeliverySelection; expectedPrice: Money }>;
export type SetDeliveryInput = RatedSetDeliveryInput;
export type InitialOrderDeliveryInput = Omit<RatedSetDeliveryInput, "orderId">;
export type SetDeliveryError = OrderDomainError | ResolveRateError | PeruDistrictError | Readonly<{ code: "ORDER_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE" | "DELIVERY_UNAVAILABLE" | "DELIVERY_METHOD_DISABLED" | "INVALID_STORED_DATA"; message: string; reason?: "resolver_not_integrated" | "availability_unconfirmed" }>;
export type SetDeliveryDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, SetDeliveryError>>) => Promise<Result<T, SetDeliveryError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, SetDeliveryError>>;
  resolveRatedDelivery: (selection: RatedDeliverySelection, context: OrderAccess, currency: Currency, expectedPrice: Money) => Promise<Result<ResolvedDelivery, SetDeliveryError>>;
  saveDelivery: (id: OrderId, companyId: CompanyId, change: Pick<OrderAggregate, "delivery" | "deliveryCost" | "deliveryCharge" | "total">) => Promise<Result<null, SetDeliveryError>>;
  /** In-transaction event: the orders listener deducts the stock when the new delivery makes the order due and it fits. */
  publishStockEvent: (payload: OrderDeliveryChanged) => Promise<Result<DeductionOutcome, TransactionEndingError>>;
  findVariantStock: StockReader;
}>;

export async function setOrderDelivery(input: SetDeliveryInput, context: OrderAccess, deps: SetDeliveryDependencies): Promise<Result<StockEventResult, SetDeliveryError>> {
  if (!("expectedPrice" in input))
    return err({ code: "INVALID_ORDER", message: "Delivery requires a reviewed price" });
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
    const changed = orderStateMachine.setDelivery(found.data, { resolved: resolved.data });
    if (!changed.success) return changed;
    return persistDeliveryChange(found.data, changed.data, deps);
  });
}

/** Saves the delivery and, when it changed, lets the orders listener deduct the stock the new total may have made due. A delivery is never refused because of stock. */
export async function persistDeliveryChange(previous: OrderAggregate, changed: OrderAggregate,
  deps: Pick<SetDeliveryDependencies, "saveDelivery" | "publishStockEvent" | "findVariantStock">): Promise<Result<StockEventResult, SetDeliveryError>> {
  const after = orderStateMachine.getPaymentSummary(changed);
  if (!after.success) return after;
  if (changed === previous) {
    const described = await describeOrderStockDue([changed], { readStock: deps.findVariantStock, inSnapshot: (read) => read() });
    return described.success ? ok({ order: changed, stockDue: described.data.get(changed.id) ?? null, outcome: null }) : described;
  }
  const saved = await deps.saveDelivery(previous.id, previous.companyId, changed);
  if (!saved.success) return saved;
  const outcome = await deps.publishStockEvent({ companyId: previous.companyId, orderId: previous.id });
  if (!outcome.success) return outcome;
  return orderWithStockDue(changed, outcome.data, deps.findVariantStock);
}
