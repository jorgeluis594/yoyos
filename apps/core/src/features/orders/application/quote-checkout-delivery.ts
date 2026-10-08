import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { DeliverySettings } from "@core/src/features/delivery-settings";
import type { OrderId } from "@core/src/features/orders/domain/order";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import { checkoutDelivery, deliverySelection } from "@core/src/features/orders/domain/checkout-delivery";
import { setOrderDelivery, type SetDeliveryDependencies, type SetDeliveryError } from "@core/src/features/orders/application/set-delivery";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";

export type QuoteCheckoutDeliveryInput = Readonly<{ orderId: OrderId; cost: Money; chargeDeliveryToCustomer: boolean }>;
export type QuoteCheckoutDeliveryDependencies = Omit<SetDeliveryDependencies, "resolveDelivery"> & Readonly<{
  getSettings: (access: OrderAccess) => Promise<Result<DeliverySettings, SetDeliveryError>>;
  clearRequest: (orderId: OrderId, companyId: OrderAccess["companyId"]) => Promise<Result<null, SetDeliveryError>>;
}>;

export async function quoteCheckoutDelivery(input: QuoteCheckoutDeliveryInput, access: OrderAccess, deps: QuoteCheckoutDeliveryDependencies): Promise<Result<OrderAggregate, SetDeliveryError>> {
  return deps.transaction(access.companyId, async () => {
    const found = await deps.findOrderForUpdate(input.orderId, access.companyId);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is unavailable" });
    const request = found.data.checkoutDeliveryRequest;
    if (!request || !found.data.checkoutConfirmedAt) return err({ code: "INVALID_TRANSITION", message: "No delivery quote is pending" });
    const settings = await deps.getSettings(access);
    if (!settings.success) return settings;
    const selected = deliverySelection(request);
    const resolved = checkoutDelivery(selected, settings.data);
    if (!resolved.success) return err({ code: resolved.error.code === "COURIER_UNAVAILABLE" ? "COURIER_UNAVAILABLE" : "DELIVERY_METHOD_DISABLED", message: "Delivery is no longer available" });
    const updated = await setOrderDelivery({ orderId: input.orderId, delivery: selected, chargeDeliveryToCustomer: input.chargeDeliveryToCustomer }, access,
      { ...deps, resolveDelivery: async () => ok({ delivery: resolved.data, cost: input.cost }) });
    if (!updated.success) return updated;
    const cleared = await deps.clearRequest(input.orderId, access.companyId);
    return cleared.success ? ok({ ...updated.data, checkoutDeliveryRequest: null }) : cleared;
  });
}
