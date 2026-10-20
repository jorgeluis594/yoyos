import { request } from "@mobile/composition/auth";
import { createDeliverySettingsApi } from "@mobile/features/delivery-settings/infrastructure/delivery-settings-api";
import { createQuotationApi } from "@mobile/features/delivery-settings/infrastructure/quotation-api";

const api = createDeliverySettingsApi(request);
export const deliverySettings = { get: api.get, getCourierCatalog: api.getCourierCatalog, getAgencyCatalog: api.getAgencyCatalog, getZones: api.getZones, saveZones: api.saveZones, createQuotation: createQuotationApi(request), save: api.save };
