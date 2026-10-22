import type { CompanyId } from "@shared/identity";
import { defaultStoreTheme } from "@shared/store-themes";
import { log } from "@core/src/shared/infrastructure/logger";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { products } from "@core/src/features/products/composition";
import { storeAppearance } from "@core/src/features/store-appearance/composition";
import { publicStoreAppearanceSchema, type PublicStoreAppearance } from "@core/src/features/store-appearance/presentation/store-appearance-schemas";
import { browseCatalog, getCatalogProduct, type BrowseCatalogInput, type CatalogAccess } from "@core/src/features/catalog/application/browse-catalog";
import { previewCatalogCards } from "@core/src/features/catalog/application/preview-catalog-cards";
import { readStore, readStoreCurrency } from "@core/src/features/catalog/infrastructure/catalog-store-repository";
import type { ProductId } from "@core/src/features/products/domain/product";

export type CatalogStoreAppearance = Readonly<{ kind: "default" | "custom" | "fallback"; appearance: PublicStoreAppearance }>;
const clasicoWithoutLogo: PublicStoreAppearance = { logoUrl: null, theme: defaultStoreTheme };

/** The look is decorative: any failure gives Clásico without logo, is logged and never hides the catalog. */
async function storeAppearanceOf(companyId: CompanyId): Promise<CatalogStoreAppearance> {
  try {
    const result = await storeAppearance.getPublic(companyId);
    if (result.kind !== "custom") return { kind: result.kind, appearance: clasicoWithoutLogo };
    const parsed = publicStoreAppearanceSchema.safeParse(result.appearance);
    if (parsed.success) return { kind: "custom", appearance: parsed.data };
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_appearance", errorCode: "INVALID_STORED_DATA" }, "unable_to_read_catalog");
  } catch (cause) {
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_appearance", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_catalog");
  }
  return { kind: "fallback", appearance: clasicoWithoutLogo };
}

export const catalogBrowse = {
  browse: (input: BrowseCatalogInput, access: CatalogAccess) => withTenantIsolation(access.companyId, () =>
    browseCatalog(input, access, { readStore, listCatalogProducts: products.listForCatalog })),
  getProduct: (productId: ProductId | null, access: CatalogAccess) => withTenantIsolation(access.companyId, () =>
    getCatalogProduct(productId, access, { readStore, findCatalogProduct: products.findForCatalog })),
  previewCards: (access: CatalogAccess) => withTenantIsolation(access.companyId, () =>
    previewCatalogCards(access, { readStoreCurrency, listCatalogProducts: products.listForCatalog })),
  storeAppearance: storeAppearanceOf,
};
