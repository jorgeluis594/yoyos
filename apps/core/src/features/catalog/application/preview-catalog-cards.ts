import { ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import type { BrowseCatalogError } from "@core/src/features/catalog/application/browse-catalog";
import type { CatalogCriteria, CatalogPage } from "@core/src/features/products/application/catalog-products";
import type { CatalogCard } from "@core/src/features/products/domain/catalog-product";

/** The editor's catalog view shows at most this many cards. */
export const previewCardCount = 3;

export type PreviewCatalogCardsDependencies = Readonly<{
  /** Reads the company currency without checking publication: the preview shows the look of a hidden catalog too. */
  readStoreCurrency: (companyId: CompanyId) => Promise<Result<Currency, BrowseCatalogError>>;
  listCatalogProducts: (criteria: CatalogCriteria) => Promise<Result<CatalogPage, BrowseCatalogError>>;
}>;

/** The first catalog cards of the seller's company, with the filters and order of the buyer catalog. */
export async function previewCatalogCards(access: Readonly<{ companyId: CompanyId }>, deps: PreviewCatalogCardsDependencies):
  Promise<Result<readonly CatalogCard[], BrowseCatalogError>> {
  const currency = await deps.readStoreCurrency(access.companyId);
  if (!currency.success) return currency;
  const page = await deps.listCatalogProducts({ currency: currency.data, search: null, offset: 0, limit: previewCardCount });
  return page.success ? ok(page.data.items) : page;
}
