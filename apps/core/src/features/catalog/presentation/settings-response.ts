import { catalogSettingsSchema, type CatalogSettingsResponse } from "@shared/contracts/catalog";
import type { CatalogSettings } from "@core/src/features/catalog/application/catalog-settings";

export function catalogUrl(companyId: string) {
  return new URL(`/catalogo/${companyId}`, process.env.BETTER_AUTH_URL ?? "http://localhost:3000").toString();
}

export function toCatalogSettingsResponse(settings: CatalogSettings, companyId: string): CatalogSettingsResponse {
  return catalogSettingsSchema.parse({ published: settings.published, url: catalogUrl(companyId) });
}
