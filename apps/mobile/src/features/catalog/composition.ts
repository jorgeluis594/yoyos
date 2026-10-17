import { request } from "@mobile/composition/auth";
import { createCatalogSettingsApi } from "@mobile/features/catalog/infrastructure/catalog-settings-api";

export const catalogSettings = createCatalogSettingsApi(request);
