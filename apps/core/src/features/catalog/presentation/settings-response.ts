import { catalogSettingsSchema, type CatalogSettingsResponse } from "@shared/contracts/catalog";
import type { CatalogSettings } from "@core/src/features/catalog/application/catalog-settings";
import { storeDomain, storeUrl } from "@core/src/features/catalog/infrastructure/storefront-config";

export function toCatalogSettingsResponse(settings: CatalogSettings): CatalogSettingsResponse {
  return catalogSettingsSchema.parse({ published: settings.published, subdomain: settings.subdomain,
    url: settings.subdomain ? storeUrl(settings.subdomain).toString() : null, domain: storeDomain(), suggestion: settings.suggestion });
}
