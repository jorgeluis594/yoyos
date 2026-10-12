import { deliveryZonesSchema, type DeliveryOptionContract } from "@shared/contracts/delivery-settings";
import type { DeliveryZonesState } from "@core/src/features/delivery-settings/application/delivery-zones";
import type { DeliveryOption } from "@core/src/features/delivery-settings/domain/delivery-zone";

function toOptionContract(option: DeliveryOption): DeliveryOptionContract {
  const common = { id: option.id, name: option.name, enabled: option.enabled, price: option.price };
  return option.method === "home" ? { ...common, method: "home" } : { ...common, method: "agency", agencyIds: [...option.agencyIds] };
}

export function parseDeliveryZonesResponse(state: DeliveryZonesState) {
  return deliveryZonesSchema.safeParse({ ...state, zones: state.zones.map(zone => ({ ...zone, options: zone.options.map(toOptionContract) })) });
}

export function toDeliveryZonesResponse(state: DeliveryZonesState) {
  const parsed = parseDeliveryZonesResponse(state);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}
