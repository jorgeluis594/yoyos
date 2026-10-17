import type { CompanyId } from "@shared/identity";
import { log } from "@core/src/shared/infrastructure/logger";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { products } from "@core/src/features/products/composition";
import { checkoutAppearance } from "@core/src/features/checkout-appearance";
import { publicCheckoutAppearanceSchema, type PublicCheckoutAppearance } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";
import { browseCatalog, getCatalogProduct, type BrowseCatalogInput, type CatalogAccess } from "@core/src/features/catalog/application/browse-catalog";
import { readStore } from "@core/src/features/catalog/infrastructure/catalog-store-repository";
import type { ProductId } from "@core/src/features/products/domain/product";

/** The brand is decorative: any failure falls back to the Yoyos look and never hides the catalog. */
async function appearance(companyId: CompanyId): Promise<PublicCheckoutAppearance | null> {
  try {
    const result = await checkoutAppearance.getPublic(companyId);
    if (result.kind !== "custom") return null;
    const parsed = publicCheckoutAppearanceSchema.safeParse(result.appearance);
    if (parsed.success) return parsed.data;
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_appearance", errorCode: "INVALID_STORED_DATA" }, "unable_to_read_catalog");
  } catch (cause) {
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_appearance", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_catalog");
  }
  return null;
}

export const catalogBrowse = {
  browse: (input: BrowseCatalogInput, access: CatalogAccess) => withTenantIsolation(access.companyId, () =>
    browseCatalog(input, access, { readStore, listCatalogProducts: products.listForCatalog })),
  getProduct: (productId: ProductId | null, access: CatalogAccess) => withTenantIsolation(access.companyId, () =>
    getCatalogProduct(productId, access, { readStore, findCatalogProduct: products.findForCatalog })),
  appearance,
};
