import { ok } from "@shared/functional";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import type { ListImageDependencies } from "@core/src/features/products/application/list";
import type { ProductReadError } from "@core/src/features/products/application/repository";
import { toCatalogCard, toCatalogProduct, type CatalogCard, type CatalogProduct, type StoredCatalogProduct } from "@core/src/features/products/domain/catalog-product";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";

/** `search` is already normalized by the catalog; `currency` is the business's, other products are hidden. */
export type CatalogCriteria = Readonly<{ currency: Currency; search: string | null; offset: number; limit: number }>;
export type CatalogPage = Readonly<{ items: readonly CatalogCard[]; hasMore: boolean }>;
export type CatalogProductRepository = Readonly<{
  list(criteria: CatalogCriteria): Promise<Result<Readonly<{ rows: readonly StoredCatalogProduct[]; hasMore: boolean }>, ProductReadError>>;
  find(id: ProductId, currency: Currency): Promise<Result<StoredCatalogProduct | null, ProductReadError>>;
}>;
export type CatalogProductDependencies = Readonly<{ repository: CatalogProductRepository; images: ListImageDependencies }>;

// Photos are decorative: an unavailable one shows the placeholder instead of hiding the product.
async function withImages(rows: readonly StoredCatalogProduct[], images: ListImageDependencies): Promise<readonly CatalogProduct[]> {
  const ids = [...new Set(rows.flatMap((row) => row.imageId ?? []))];
  const resolved = ids.length ? await images.resolve(ids) : ok({ images: [], failures: [] });
  const failures = resolved.success ? resolved.data.failures : ids.map((imageId) => ({ imageId, code: resolved.error.code, message: resolved.error.message }));
  if (failures.length) images.report(failures);
  const urls = new Map<ImageId, string>(resolved.success ? resolved.data.images.map((image) => [image.id, image.url]) : []);
  return rows.map((row) => toCatalogProduct(row, row.imageId ? urls.get(row.imageId) ?? null : null));
}

export async function listCatalogProducts(criteria: CatalogCriteria, deps: CatalogProductDependencies): Promise<Result<CatalogPage, ProductReadError>> {
  const listed = await deps.repository.list(criteria);
  if (!listed.success) return listed;
  return ok({ items: (await withImages(listed.data.rows, deps.images)).map(toCatalogCard), hasMore: listed.data.hasMore });
}

export async function findCatalogProduct(id: ProductId, currency: Currency, deps: CatalogProductDependencies): Promise<Result<CatalogProduct | null, ProductReadError>> {
  const found = await deps.repository.find(id, currency);
  if (!found.success) return found;
  if (!found.data) return ok(null);
  const [product] = await withImages([found.data], deps.images);
  return ok(product);
}
