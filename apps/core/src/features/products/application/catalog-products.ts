import { ok } from "@shared/functional";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import type { ListImageDependencies } from "@core/src/features/products/application/list";
import type { ProductReadError } from "@core/src/features/products/application/repository";
import { toCatalogCard, toCatalogProduct, type CatalogCard, type CatalogProduct, type StoredCatalogCard, type StoredCatalogProduct } from "@core/src/features/products/domain/catalog-product";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";

/** `search` is already normalized by the catalog; `currency` is the business's, other products are hidden. */
export type CatalogCriteria = Readonly<{ currency: Currency; search: string | null; offset: number; limit: number }>;
export type CatalogPage = Readonly<{ items: readonly CatalogCard[]; hasMore: boolean }>;
export type CatalogProductRepository = Readonly<{
  list(criteria: CatalogCriteria): Promise<Result<Readonly<{ rows: readonly StoredCatalogCard[]; hasMore: boolean }>, ProductReadError>>;
  find(id: ProductId, currency: Currency): Promise<Result<StoredCatalogProduct | null, ProductReadError>>;
}>;
export type CatalogProductDependencies = Readonly<{ repository: CatalogProductRepository; images: ListImageDependencies }>;

// Photos are decorative: an unavailable one shows the placeholder instead of hiding the product.
async function resolveImages(rows: readonly Readonly<{ imageId: ImageId | null }>[], images: ListImageDependencies): Promise<ReadonlyMap<ImageId, string>> {
  const ids = [...new Set(rows.flatMap((row) => row.imageId ?? []))];
  const resolved = ids.length ? await images.resolve(ids) : ok({ images: [], failures: [] });
  const failures = resolved.success ? resolved.data.failures : ids.map((imageId) => ({ imageId, code: resolved.error.code, message: resolved.error.message }));
  if (failures.length) images.report(failures);
  return new Map<ImageId, string>(resolved.success ? resolved.data.images.map((image) => [image.id, image.url]) : []);
}

export async function listCatalogProducts(criteria: CatalogCriteria, deps: CatalogProductDependencies): Promise<Result<CatalogPage, ProductReadError>> {
  const listed = await deps.repository.list(criteria);
  if (!listed.success) return listed;
  const urls = await resolveImages(listed.data.rows, deps.images);
  return ok({ items: listed.data.rows.map((row) => toCatalogCard(row, row.imageId ? urls.get(row.imageId) ?? null : null)), hasMore: listed.data.hasMore });
}

export async function findCatalogProduct(id: ProductId, currency: Currency, deps: CatalogProductDependencies): Promise<Result<CatalogProduct | null, ProductReadError>> {
  const found = await deps.repository.find(id, currency);
  if (!found.success) return found;
  if (!found.data) return ok(null);
  const urls = await resolveImages([found.data], deps.images);
  return ok(toCatalogProduct(found.data, found.data.imageId ? urls.get(found.data.imageId) ?? null : null));
}
