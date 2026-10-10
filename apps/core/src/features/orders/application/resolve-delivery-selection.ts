import { err, ok } from "@shared/functional";
import { compare, type Currency, type Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { DeliverySettings, ResolveSelectedRateInput, ResolvedDeliveryRate, ResolveRateError } from "@core/src/features/delivery-settings";
import type { CompanyId } from "@shared/identity";
import type { PeruDistrictError } from "@shared/peru-geography";
import { buildRatedDeliverySnapshot, parseRatedDeliverySelection, parseDeliverySnapshot, validateDeliveryCost,
  type DeliveryAuthor, type ResolvedDelivery } from "@core/src/features/orders/domain/order-state-machine";
import type { SetDeliveryError } from "@core/src/features/orders/application/set-delivery";

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
  const price = compare(resolved.cost)(expected.data);
  if (!price.success) return err({ code: "INVALID_ORDER", message: price.error.message });
  return price.data === 0 ? ok(resolved)
    : err({ code: "TOTAL_CHANGED", message: "Delivery price changed", currentPrice: { ...resolved.cost } });
}
