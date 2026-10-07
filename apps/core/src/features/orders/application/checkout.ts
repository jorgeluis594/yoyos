import { z } from "zod";
import { ok, err } from "@shared/functional";
import type { Result } from "@shared/result";
import type { Money } from "@shared/money";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { DeliverySettings } from "@core/src/features/delivery-settings";
import type { DeliverySelection, DeliverySnapshot } from "@core/src/features/orders/domain/order-state-machine";
import { checkoutDelivery, sameDelivery } from "@core/src/features/orders/domain/checkout-delivery";
import { checkoutState, checkoutView, checkExpectedTotal, parseBuyer,
  type BuyerData, type CheckoutAccess, type CheckoutError, type CheckoutOrder, type CheckoutView, type OrderBuyer, type OrderNumber,
} from "@core/src/features/orders/domain/checkout";

export type ConfirmOrderCheckoutInput = Readonly<{ buyer: BuyerData; expectedTotal: Money; delivery?: DeliverySelection }>;
export type CheckoutMutation = Readonly<{ checkout: CheckoutView; changed: boolean }>;
export type CheckoutDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, CheckoutError>>) => Promise<Result<T, CheckoutError>>;
  findOrder: (access: CheckoutAccess) => Promise<Result<CheckoutOrder | null, CheckoutError>>;
  findOrderForUpdate: (access: CheckoutAccess) => Promise<Result<CheckoutOrder | null, CheckoutError>>;
  saveEnabled: (access: CheckoutAccess, at: Date) => Promise<Result<null, CheckoutError>>;
  saveBuyer: (access: CheckoutAccess, buyer: OrderBuyer) => Promise<Result<null, CheckoutError>>;
  saveConfirmed: (access: CheckoutAccess, at: Date) => Promise<Result<null, CheckoutError>>;
  getDeliverySettings: (access: CheckoutAccess) => Promise<Result<DeliverySettings, CheckoutError>>;
  saveDeliveryRequest: (access: CheckoutAccess, delivery: DeliverySnapshot | null) => Promise<Result<null, CheckoutError>>;
}>;

const accessSchema = z.strictObject({ companyId: z.uuid(), orderId: z.uuid() });
const unavailable = () => err({ code: "CHECKOUT_UNAVAILABLE" as const, message: "Checkout is unavailable" });
function matches(order: CheckoutOrder | null, access: CheckoutAccess): order is CheckoutOrder {
  return order !== null && order.id === access.orderId && order.companyId === access.companyId;
}

export async function enableOrderCheckout(orderId: OrderId, context: OrderAccess, now: Date, deps: Pick<CheckoutDependencies, "transaction" | "findOrderForUpdate" | "saveEnabled">): Promise<Result<Readonly<{ number: OrderNumber; changed: boolean }>, CheckoutError>> {
  const access = { companyId: context.companyId, orderId };
  if (!accessSchema.safeParse(access).success || !context.userId || !z.date().safeParse(now).success) return unavailable();
  return deps.transaction<Readonly<{ number: OrderNumber; changed: boolean }>>(access.companyId, async () => {
    const found = await deps.findOrderForUpdate(access);
    if (!found.success) return found;
    if (!matches(found.data, access)) return unavailable();
    const order = found.data;
    const state = checkoutState(order);
    if (!state.success) return state;
    if (order.cancelled) return err({ code: "ORDER_CANCELLED", message: "Order is cancelled" });
    if (order.checkoutEnabledAt) return ok({ number: order.number, changed: false });
    const saved = await deps.saveEnabled(access, now);
    return saved.success ? ok({ number: order.number, changed: true }) : saved;
  });
}

export async function getOrderCheckout(access: CheckoutAccess, deps: Pick<CheckoutDependencies, "findOrder">): Promise<Result<CheckoutView, CheckoutError>> {
  if (!accessSchema.safeParse(access).success) return unavailable();
  const found = await deps.findOrder(access);
  if (!found.success) return found;
  return matches(found.data, access) ? checkoutView(found.data) : unavailable();
}

export async function confirmOrderCheckout(input: ConfirmOrderCheckoutInput, access: CheckoutAccess, now: Date, deps: Omit<CheckoutDependencies, "findOrder" | "saveEnabled">): Promise<Result<CheckoutMutation, CheckoutError>> {
  if (!accessSchema.safeParse(access).success || !z.date().safeParse(now).success) return unavailable();
  return deps.transaction<CheckoutMutation>(access.companyId, async () => {
    const found = await deps.findOrderForUpdate(access);
    if (!found.success) return found;
    if (!matches(found.data, access) || !found.data.checkoutEnabledAt) return unavailable();
    const order = found.data;
    const view = checkoutView(order);
    if (!view.success) return view;
    if (order.cancelled) return err({ code: "ORDER_CANCELLED", message: "Order is cancelled" });
    if (order.checkoutConfirmedAt) return ok({ checkout: view.data, changed: false });
    const buyer = parseBuyer(input.buyer);
    if (!buyer.success) return buyer;
    const total = checkExpectedTotal(input.expectedTotal, order.total);
    if (!total.success) return total;
    let requested = order.checkoutDeliveryRequest;
    const settings = await deps.getDeliverySettings(access);
    if (!settings.success) return settings;
    if (!input.delivery && !order.delivery && (settings.data.home.enabled || settings.data.agency.enabled || settings.data.store.enabled))
      return err({ code: "INVALID_DELIVERY", message: "Choose a delivery method" });
    if (input.delivery) {
      const resolved = checkoutDelivery(input.delivery, settings.data);
      if (!resolved.success) return resolved;
      if (!order.delivery || !sameDelivery(order.delivery, resolved.data)) {
        if (order.deliveryStatus !== "pending") return err({ code: "DELIVERY_LOCKED", message: "Delivery has progressed" });
        requested = resolved.data;
      }
    }
    if (requested !== order.checkoutDeliveryRequest) {
      const saved = await deps.saveDeliveryRequest(access, requested);
      if (!saved.success) return saved;
    }
    const snapshot = { ...buyer.data, contactId: order.buyer?.contactId ?? null };
    const savedBuyer = await deps.saveBuyer(access, snapshot);
    if (!savedBuyer.success) return savedBuyer;
    const savedConfirmation = await deps.saveConfirmed(access, now);
    if (!savedConfirmation.success) return savedConfirmation;
    const confirmed = checkoutView({ ...order, buyer: snapshot, checkoutConfirmedAt: now, checkoutDeliveryRequest: requested });
    return confirmed.success ? ok({ checkout: confirmed.data, changed: true }) : confirmed;
  });
}
