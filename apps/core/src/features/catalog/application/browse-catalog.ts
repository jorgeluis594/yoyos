import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import { catalogPageSize, maxCatalogPages, type CatalogSearch } from "@core/src/features/catalog/domain/catalog";
import type { CatalogCriteria, CatalogPage } from "@core/src/features/products/application/catalog-products";
import type { ProductReadError } from "@core/src/features/products/application/repository";
import type { CatalogProduct } from "@core/src/features/products/domain/catalog-product";
import type { ProductId } from "@core/src/features/products/domain/product";

export type CatalogAccess = Readonly<{ companyId: CompanyId }>;
export type CatalogStore = Readonly<{ name: string; currency: Currency }>;
/** `pages` is how many pages are shown, so a reload or a return from a product restores everything loaded. */
export type BrowseCatalogInput = Readonly<{ search: CatalogSearch | null; pages: number }>;
export type BrowseCatalogError =
  | Readonly<{ code: "CATALOG_UNAVAILABLE"; message: string }>
  | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>
  | ProductReadError;
type StoreDependencies = Readonly<{
  /** Null when the catalog is hidden or the company does not exist. */
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
  const store = await deps.readStore(companyId);
  if (!store.success) return store;
  return store.data ? ok(store.data) : catalogUnavailable;
}

export async function browseCatalog(input: BrowseCatalogInput, access: CatalogAccess, deps: BrowseCatalogDependencies):
  Promise<Result<CatalogPage & Readonly<{ storeName: string }>, BrowseCatalogError>> {
  const store = await publishedStore(access.companyId, deps);
  if (!store.success) return store;
  const page = await deps.listCatalogProducts({ currency: store.data.currency, search: input.search, offset: 0, limit: input.pages * catalogPageSize });
  // The page cap stops «Ver más» from linking past what the query accepts.
  return page.success ? ok({ ...page.data, hasMore: page.data.hasMore && input.pages < maxCatalogPages, storeName: store.data.name }) : page;
}

/** The product page keeps the store it already read when the product is gone, so it can still be shown in the store's theme. */
export type CatalogProductResult =
  | Readonly<{ kind: "found"; storeName: string; product: CatalogProduct }>
  | Readonly<{ kind: "unavailable"; storeName: string }>;

/** A malformed id (`null`) is still checked against the catalog, so a hidden one reads as unavailable and not as a missing product. */
export async function getCatalogProduct(productId: ProductId | null, access: CatalogAccess, deps: GetCatalogProductDependencies):
  Promise<Result<CatalogProductResult, BrowseCatalogError>> {
  const store = await publishedStore(access.companyId, deps);
  if (!store.success) return store;
  const product = productId ? await deps.findCatalogProduct(productId, store.data.currency) : ok(null);
  if (!product.success) return product;
  return ok(product.data ? { kind: "found", storeName: store.data.name, product: product.data } : { kind: "unavailable", storeName: store.data.name });
}
