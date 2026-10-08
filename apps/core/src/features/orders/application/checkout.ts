import { z } from "zod";
import { ok, err } from "@shared/functional";
import type { Result } from "@shared/result";
import type { Money } from "@shared/money";
import { orderStateMachine, type OrderAggregate, type RatedDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import { persistDeliveryChange, type SetDeliveryDependencies, type SetDeliveryError } from "@core/src/features/orders/application/set-delivery";
import { resolveShippingCost, type ResolveShippingDependencies } from "@core/src/features/orders/application/resolve-delivery-selection";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import { checkoutState, checkoutView, checkExpectedTotal, parseBuyer,
  type BuyerData, type CheckoutAccess, type CheckoutError, type CheckoutOrder, type CheckoutView, type OrderBuyer, type OrderNumber,
} from "@core/src/features/orders/domain/checkout";

export type ConfirmOrderCheckoutInput = Readonly<{ buyer: BuyerData; expectedTotal: Money }>;
export type CheckoutDeliveryChange = Readonly<{ kind: "keep" }> | Readonly<{ kind: "replace"; selection: RatedDeliverySelection; expectedPrice: Money }>;
export type ConfirmCheckoutDeliveryInput = ConfirmOrderCheckoutInput & Readonly<{ delivery: CheckoutDeliveryChange }>;
export type ConfirmCheckoutDeliveryError = CheckoutError | SetDeliveryError;
export type ConfirmCheckoutDeliveryDependencies = Pick<CheckoutDependencies, "saveBuyer" | "saveConfirmed"> &
  Pick<SetDeliveryDependencies, "saveDelivery" | "deductProductStock" | "saveStockDeduction"> & ResolveShippingDependencies & Readonly<{
    transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, ConfirmCheckoutDeliveryError>>) => Promise<Result<T, ConfirmCheckoutDeliveryError>>;
    findOrderForUpdate: (access: CheckoutAccess) => Promise<Result<(CheckoutOrder & OrderAggregate) | null, ConfirmCheckoutDeliveryError>>;
  }>;
export type CheckoutMutation = Readonly<{ checkout: CheckoutView; changed: boolean }>;
export type CheckoutDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, CheckoutError>>) => Promise<Result<T, CheckoutError>>;
  findOrder: (access: CheckoutAccess) => Promise<Result<CheckoutOrder | null, CheckoutError>>;
  findOrderForUpdate: (access: CheckoutAccess) => Promise<Result<CheckoutOrder | null, CheckoutError>>;
  saveEnabled: (access: CheckoutAccess, at: Date) => Promise<Result<null, CheckoutError>>;
  saveBuyer: (access: CheckoutAccess, buyer: OrderBuyer) => Promise<Result<null, CheckoutError>>;
  saveConfirmed: (access: CheckoutAccess, at: Date) => Promise<Result<null, CheckoutError>>;
}>;

const accessSchema = z.strictObject({ companyId: z.uuid(), orderId: z.uuid() });
const deliveryChangeSchema = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("keep") }),
  z.strictObject({ kind: z.literal("replace"), selection: z.unknown(), expectedPrice: z.unknown() })]);
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
    const snapshot = { ...buyer.data, contactId: order.buyer?.contactId ?? null };
    const savedBuyer = await deps.saveBuyer(access, snapshot);
    if (!savedBuyer.success) return savedBuyer;
    const savedConfirmation = await deps.saveConfirmed(access, now);
    if (!savedConfirmation.success) return savedConfirmation;
    const confirmed = checkoutView({ ...order, buyer: snapshot, checkoutConfirmedAt: now });
    return confirmed.success ? ok({ checkout: confirmed.data, changed: true }) : confirmed;
  });
}

export async function confirmCheckoutDelivery(input: ConfirmCheckoutDeliveryInput, access: CheckoutAccess, now: Date,
  deps: ConfirmCheckoutDeliveryDependencies): Promise<Result<CheckoutMutation, ConfirmCheckoutDeliveryError>> {
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
    if (!deliveryChangeSchema.safeParse(input.delivery).success)
      return err({ code: "INVALID_CHECKOUT", message: "Choose whether to keep or replace delivery" });
    let next = order;
    if (input.delivery.kind === "keep") {
      if (!order.delivery) return err({ code: "INVALID_CHECKOUT", message: "There is no delivery to keep" });
    } else {
      const allowed = orderStateMachine.canSetDelivery(order);
      if (!allowed.success) return allowed;
      const resolved = await resolveShippingCost(input.delivery.selection, { companyId: access.companyId, author: { kind: "buyer" } },
        order.total.currency, input.delivery.expectedPrice, deps);
      if (!resolved.success) return resolved;
      const changed = orderStateMachine.setDelivery(order, { resolved: resolved.data, chargeDeliveryToCustomer: true });
      if (!changed.success) return changed;
      next = { ...changed.data, companyName: order.companyName };
    }
    const total = checkExpectedTotal(input.expectedTotal, next.total);
    if (!total.success) return total;
    const savedDelivery = await persistDeliveryChange(order, next, deps);
    if (!savedDelivery.success) return savedDelivery;
    const snapshot = { ...buyer.data, contactId: order.buyer?.contactId ?? null };
    const savedBuyer = await deps.saveBuyer(access, snapshot);
    if (!savedBuyer.success) return savedBuyer;
    const savedConfirmation = await deps.saveConfirmed(access, now);
    if (!savedConfirmation.success) return savedConfirmation;
    const confirmed = checkoutView({ ...savedDelivery.data, companyName: order.companyName, buyer: snapshot, checkoutConfirmedAt: now });
    return confirmed.success ? ok({ checkout: confirmed.data, changed: true }) : confirmed;
  });
}
