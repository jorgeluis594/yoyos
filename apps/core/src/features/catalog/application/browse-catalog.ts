import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import { catalogPageSize, type CatalogSearch } from "@core/src/features/catalog/domain/catalog";
import type { CatalogCriteria, CatalogPage } from "@core/src/features/products/application/catalog-products";
import type { ProductReadError } from "@core/src/features/products/application/repository";
import type { CatalogProduct } from "@core/src/features/products/domain/catalog-product";
import type { ProductId } from "@core/src/features/products/domain/product";

export type CatalogAccess = Readonly<{ companyId: CompanyId }>;
export type CatalogStore = Readonly<{ name: string; currency: Currency }>;
/** `pages` is how many pages are shown, so a reload or a return from a product restores everything loaded. */
export type BrowseCatalogInput = Readonly<{ search: CatalogSearch | null; pages: number }>;
export type BrowseCatalogError =
  | Readonly<{ code: "CATALOG_UNAVAILABLE" | "PRODUCT_UNAVAILABLE"; message: string }>
  | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>
  | ProductReadError;
type StoreDependencies = Readonly<{
  readPublished: (companyId: CompanyId) => Promise<Result<boolean, BrowseCatalogError>>;
  readStore: (companyId: CompanyId) => Promise<Result<CatalogStore | null, BrowseCatalogError>>;
}>;
export type BrowseCatalogDependencies = StoreDependencies & Readonly<{
  listCatalogProducts: (criteria: CatalogCriteria) => Promise<Result<CatalogPage, BrowseCatalogError>>;
}>;
export type GetCatalogProductDependencies = StoreDependencies & Readonly<{
  findCatalogProduct: (id: ProductId, currency: Currency) => Promise<Result<CatalogProduct | null, BrowseCatalogError>>;
}>;

const catalogUnavailable = err({ code: "CATALOG_UNAVAILABLE" as const, message: "Catalog is not available" });

async function publishedStore(companyId: CompanyId, deps: StoreDependencies): Promise<Result<CatalogStore, BrowseCatalogError>> {
  const published = await deps.readPublished(companyId);
  if (!published.success) return published;
  if (!published.data) return catalogUnavailable;
  const store = await deps.readStore(companyId);
  if (!store.success) return store;
  return store.data ? ok(store.data) : catalogUnavailable;
}

export async function browseCatalog(input: BrowseCatalogInput, access: CatalogAccess, deps: BrowseCatalogDependencies):
  Promise<Result<CatalogPage & Readonly<{ storeName: string }>, BrowseCatalogError>> {
  const store = await publishedStore(access.companyId, deps);
  if (!store.success) return store;
  const page = await deps.listCatalogProducts({ currency: store.data.currency, search: input.search, offset: 0, limit: input.pages * catalogPageSize });
  return page.success ? ok({ ...page.data, storeName: store.data.name }) : page;
}

export async function getCatalogProduct(productId: ProductId, access: CatalogAccess, deps: GetCatalogProductDependencies):
  Promise<Result<Readonly<{ storeName: string; product: CatalogProduct }>, BrowseCatalogError>> {
  const store = await publishedStore(access.companyId, deps);
  if (!store.success) return store;
  const product = await deps.findCatalogProduct(productId, store.data.currency);
  if (!product.success) return product;
  return product.data ? ok({ storeName: store.data.name, product: product.data }) : err({ code: "PRODUCT_UNAVAILABLE", message: "Product is not available" });
}
