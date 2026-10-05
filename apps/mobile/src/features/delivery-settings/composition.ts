import { request } from "@mobile/composition/auth";
import { saveDeliverySettings, type DeliverySettingsDraft } from "@mobile/features/delivery-settings/application/delivery-settings";
import { createDeliverySettingsApi } from "@mobile/features/delivery-settings/infrastructure/delivery-settings-api";

const api = createDeliverySettingsApi(request);
export const deliverySettings = { get: api.get, save: (draft: DeliverySettingsDraft) => saveDeliverySettings(draft, api.save) };
