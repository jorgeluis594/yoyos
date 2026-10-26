import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ImageId, Product, ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductReadError, ProductRepository } from "@core/src/features/products/application/repository";

/** `orderedVariantIds` holds the variants that any order references, confirmed or not. */
export type Detail = Readonly<{ product: Product; orderedVariantIds: ReadonlySet<VariantId>; image?: Readonly<{ id: ImageId; url: string }> }>;
export type DetailError = Readonly<{ code: "IMAGE_NOT_FOUND"; message: string }> | ProductReadError;
export type GetDependencies = Readonly<{
  repository: Pick<ProductRepository, "get">;
  findOrderedVariantIds: (ids: readonly VariantId[]) => Promise<Result<ReadonlySet<VariantId>, ProductReadError>>;
  /** Runs both reads against one database snapshot, so a concurrent save cannot show up between them. */
  snapshot: <T>(read: () => Promise<T>) => Promise<T>;
  resolveImage: (imageId: ImageId) => Promise<Result<{ id: ImageId; url: string } | null, ProductReadError>>;
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
  if (!product.imageId) return ok({ product, orderedVariantIds });
  const image = await deps.resolveImage(product.imageId);
  if (!image.success) return image;
  if (!image.data) return err({ code: "IMAGE_NOT_FOUND", message: "Image is unavailable" });
  return ok({ product, orderedVariantIds, image: image.data });
}
