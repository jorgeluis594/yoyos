import { err, ok } from "@shared/functional";
import type { Currency, Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { DeliverySettings } from "@core/src/features/delivery-settings";
import { parseDeliverySelection, parseDeliverySnapshot, validateDeliveryCost, type DeliverySelection, type DeliverySnapshot, type ResolvedDelivery } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { SetDeliveryError } from "@core/src/features/orders/application/set-delivery";

export type ResolveDeliveryDependencies = Readonly<{
  getSettings: (context: OrderAccess) => Promise<Result<DeliverySettings, SetDeliveryError>>;
  resolveCost: (delivery: DeliverySnapshot, context: OrderAccess, currency: Currency) => Promise<Result<Money, SetDeliveryError>>;
}>;

export async function resolveDeliverySelection(input: DeliverySelection, context: OrderAccess, currency: Currency,
  deps: ResolveDeliveryDependencies): Promise<Result<ResolvedDelivery, SetDeliveryError>> {
  const selection = parseDeliverySelection(input);
  if (!selection.success) return selection;
  const found = await deps.getSettings(context);
  if (!found.success) return found;
  const delivery = selection.data;
  if (delivery.method === "agency" || (delivery.method === "store" ? !found.data.store.enabled : !found.data.home.enabled))
    return err({ code: "DELIVERY_METHOD_DISABLED", message: "Delivery method is disabled" });
  const snapshot = parseDeliverySnapshot({ ...delivery,
    ...(delivery.method === "store" ? { pickupPoint: found.data.store.pickupPoint } : {}),
    recordedBy: { kind: "seller", userId: context.userId } });
  if (!snapshot.success) return snapshot;
  const cost = await deps.resolveCost(snapshot.data, context, currency);
  if (!cost.success) return cost;
  const validatedCost = validateDeliveryCost(cost.data, currency);
  return validatedCost.success ? ok({ delivery: snapshot.data, cost: validatedCost.data }) : validatedCost;
}
