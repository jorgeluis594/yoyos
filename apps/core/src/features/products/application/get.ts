import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ImageId, Product, ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ListImages } from "@core/src/features/products/application/list";
import type { ProductReadError, ProductRepository } from "@core/src/features/products/application/repository";

/** `orderedVariantIds` holds the variants that any order references, confirmed or not. */
export type Detail = Readonly<{ product: Product; orderedVariantIds: ReadonlySet<VariantId>; photos: readonly Readonly<{ id: ImageId; url: string }>[] }>;
export type DetailError = Readonly<{ code: "IMAGE_NOT_FOUND"; message: string }> | ProductReadError;
export type GetDependencies = Readonly<{
  repository: Pick<ProductRepository, "get">;
  findOrderedVariantIds: (ids: readonly VariantId[]) => Promise<Result<ReadonlySet<VariantId>, ProductReadError>>;
  /** Runs both reads against one database snapshot, so a concurrent save cannot show up between them. */
  snapshot: <T>(read: () => Promise<T>) => Promise<T>;
  resolveImages: (ids: readonly ImageId[]) => Promise<Result<ListImages, ProductReadError>>;
}>;

async function readWithOrders(id: ProductId, deps: GetDependencies): Promise<Result<Readonly<{ product: Product; orderedVariantIds: ReadonlySet<VariantId> }> | null, ProductReadError>> {
  const loaded = await deps.repository.get(id);
  if (!loaded.success) return loaded;
  if (!loaded.data) return ok(null);
  const ordered = await deps.findOrderedVariantIds(loaded.data.variants.map((variant) => variant.id));
  if (!ordered.success) return ordered;
  return ok({ product: loaded.data, orderedVariantIds: ordered.data });
}

export async function getProduct(id: ProductId, deps: GetDependencies): Promise<Result<Detail | null, DetailError>> {
  const result = await deps.snapshot(() => readWithOrders(id, deps));
  if (!result.success) return result;
  if (!result.data) return ok(null);
  const { product, orderedVariantIds } = result.data;
  if (!product.photoIds.length) return ok({ product, orderedVariantIds, photos: [] });
  const resolved = await deps.resolveImages(product.photoIds);
  if (!resolved.success) return resolved;
  // The seller never sees a silently hidden photo: a later save would send a list without it.
  const urls = new Map(resolved.data.images.map((image) => [image.id, image.url] as const));
  const photos = product.photoIds.map((id) => ({ id, url: urls.get(id) }));
  if (resolved.data.failures.length || photos.some((photo) => photo.url === undefined)) return err({ code: "IMAGE_NOT_FOUND", message: "Image is unavailable" });
  return ok({ product, orderedVariantIds, photos: photos as readonly Readonly<{ id: ImageId; url: string }>[] });
}
