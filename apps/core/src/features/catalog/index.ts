export { catalogSettings, catalogLegacy, catalogStorefront } from "@core/src/features/catalog/composition";
export type { CatalogSettings, CatalogSettingsAccess, CompanyId, StorefrontState, UserId } from "@core/src/features/catalog/application/catalog-settings";
export type { Storefront } from "@core/src/features/catalog/application/resolve-storefront";
export { classifyHost, type StoreHost } from "@core/src/features/catalog/domain/store-host";
export { storefrontConfig, storeUrl } from "@core/src/features/catalog/infrastructure/storefront-config";
export { toCatalogSettingsResponse } from "@core/src/features/catalog/presentation/settings-response";
