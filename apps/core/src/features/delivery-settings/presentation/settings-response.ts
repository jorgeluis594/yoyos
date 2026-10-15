import { deliverySettingsSchema, type DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import type { DeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";

export function toDeliverySettingsResponse(settings: DeliverySettings): DeliverySettingsResponse {
  return deliverySettingsSchema.parse({ ...settings, couriers: settings.couriers.map(({ id, catalogId, name, enabled }) => ({ id, courierId: catalogId, name, enabled })) });
}
