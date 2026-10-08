import { err, ok } from "@shared/functional";
import type { Currency, Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { DeliverySettings, ResolveSelectedRateInput, ResolvedDeliveryRate, ResolveRateError } from "@core/src/features/delivery-settings";
import type { CompanyId } from "@shared/identity";
import type { PeruDistrictError } from "@shared/peru-geography";
import { buildRatedDeliverySnapshot, parseRatedDeliverySelection, parseDeliverySelection, parseDeliverySnapshot, validateDeliveryCost,
  type DeliveryAuthor, type DeliverySelection, type DeliverySnapshot, type ResolvedDelivery } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { SetDeliveryError } from "@core/src/features/orders/application/set-delivery";

export type ResolveDeliveryDependencies = Readonly<{
  getSettings: (context: OrderAccess) => Promise<Result<DeliverySettings, SetDeliveryError>>;
  resolveShippingCost: (delivery: DeliverySnapshot, context: OrderAccess, currency: Currency) => Promise<Result<Money, SetDeliveryError>>;
}>;

export type ResolveShippingError = SetDeliveryError | ResolveRateError | PeruDistrictError;
export type ResolveShippingDependencies = Readonly<{
  getStoreSettings: (companyId: CompanyId) => Promise<Result<DeliverySettings, ResolveShippingError>>;
  resolveSelectedDeliveryRate: (input: ResolveSelectedRateInput) => Promise<Result<ResolvedDeliveryRate, ResolveShippingError>>;
}>;

// The assigning use case owns the transaction and keeps configuration locks until its writes finish.
export async function resolveShippingCost(input: unknown, context: Readonly<{ companyId: CompanyId; author: DeliveryAuthor }>,
  currency: Currency, expectedPrice: Money, deps: ResolveShippingDependencies): Promise<Result<ResolvedDelivery, ResolveShippingError>> {
  const parsed = parseRatedDeliverySelection(input);
  if (!parsed.success) return parsed;
  const expected = validateDeliveryCost(expectedPrice, currency);
  if (!expected.success) return expected;
  const selection = parsed.data;
  let resolved: ResolvedDelivery;
  if (selection.method === "store") {
    const found = await deps.getStoreSettings(context.companyId);
    if (!found.success) return found;
    if (!found.data.store.enabled || !found.data.store.pickupPoint)
      return err({ code: "DELIVERY_METHOD_DISABLED", message: "Store pickup is disabled" });
    const snapshot = parseDeliverySnapshot({ ...selection, pickupPoint: found.data.store.pickupPoint,
      settingsVersion: found.data.version, recordedBy: context.author });
    if (!snapshot.success) return snapshot;
    resolved = { delivery: snapshot.data, cost: { amount: 0, currency } };
  } else {
    const rate = await deps.resolveSelectedDeliveryRate({ companyId: context.companyId, rateId: selection.rateId, method: selection.method,
      districtCode: selection.method === "home" ? selection.destination.districtCode : selection.districtCode });
    if (!rate.success) return rate;
    if (rate.data.price.currency !== currency) return err({ code: "RATE_UNAVAILABLE", message: "Selected delivery rate is unavailable" });
    const price = validateDeliveryCost(rate.data.price, currency);
    if (!price.success) return price;
    const snapshot = buildRatedDeliverySnapshot(selection, rate.data, context.author);
    if (!snapshot.success) return snapshot;
    resolved = { delivery: snapshot.data, cost: price.data };
  }
  return expected.data.amount === resolved.cost.amount ? ok(resolved)
    : err({ code: "TOTAL_CHANGED", message: "Delivery price changed", currentPrice: { ...resolved.cost } });
}

export async function resolveDeliverySelection(input: DeliverySelection, context: OrderAccess, currency: Currency,
  deps: ResolveDeliveryDependencies): Promise<Result<ResolvedDelivery, SetDeliveryError>> {
  const selection = parseDeliverySelection(input);
  if (!selection.success) return selection;
  const found = await deps.getSettings(context);
  if (!found.success) return found;
  const delivery = selection.data;
  if (delivery.method === "store" ? !found.data.store.enabled : delivery.method === "home" ? !found.data.home.enabled : !found.data.agency.enabled)
    return err({ code: "DELIVERY_METHOD_DISABLED", message: "Delivery method is disabled" });
  const courier = delivery.method === "agency" ? found.data.couriers.find(courier => courier.id === delivery.courierId && courier.enabled) : undefined;
  if (delivery.method === "agency" && !courier) return err({ code: "COURIER_UNAVAILABLE", message: "Courier is unavailable" });
  const destination = delivery.method === "agency" && courier
    ? { method: delivery.method, recipient: delivery.recipient, agency: delivery.agency, courier: { id: courier.id, name: courier.name } }
    : delivery;
  const snapshot = parseDeliverySnapshot({ ...destination,
    ...(delivery.method === "store" ? { pickupPoint: found.data.store.pickupPoint } : {}),
    recordedBy: { kind: "seller", userId: context.userId } });
  if (!snapshot.success) return snapshot;
  const cost = await deps.resolveShippingCost(snapshot.data, context, currency);
  if (!cost.success) return cost;
  const validatedCost = validateDeliveryCost(cost.data, currency);
  return validatedCost.success ? ok({ delivery: snapshot.data, cost: validatedCost.data }) : validatedCost;
}
