import { deliverySettingsSchema, type DeliverySettingsResponse, type SaveDeliverySettingsRequest } from "@shared/contracts/delivery-settings";
import { parseCourierInputs, type DeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";

export function toDeliverySettingsResponse(settings: DeliverySettings): DeliverySettingsResponse {
  return deliverySettingsSchema.parse({ ...settings, couriers: settings.couriers.map(({ id, catalogId, name, enabled }) => ({ id, courierId: catalogId, name, enabled })) });
}

export function toCourierInputs(couriers: SaveDeliverySettingsRequest["couriers"]) {
  return parseCourierInputs(couriers.map(courier => courier.kind === "new" ? { kind: courier.kind, catalogId: courier.courierId, enabled: courier.enabled } : courier));
}
