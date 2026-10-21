import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ImageId, VariantId } from "@core/src/features/products/domain/product";
import type { ListImageDependencies, ListImageFailure } from "@core/src/features/products/application/list";
import type { ProductReadError } from "@core/src/features/products/application/repository";

export type VariantPhotoRow = Readonly<{ variantId: VariantId; imageId: ImageId | null }>;
export type VariantPhotoDependencies = Readonly<{
  /** Product image of each variant, whatever the status of the variant or its product. */
  findVariantImages: (variantIds: readonly VariantId[]) => Promise<Result<readonly VariantPhotoRow[], ProductReadError>>;
  images: ListImageDependencies;
}>;

/** Public URL of the current photo of each variant's product; variants without a resolvable photo are absent. */
export async function findVariantPhotos(variantIds: readonly VariantId[], deps: VariantPhotoDependencies): Promise<Result<ReadonlyMap<VariantId, string>, ProductReadError>> {
  const photos = new Map<VariantId, string>();
  if (!variantIds.length) return ok(photos);
  const rows = await deps.findVariantImages(variantIds);
  if (!rows.success) return rows;
  const imageIds = [...new Set(rows.data.flatMap(({ imageId }) => imageId === null ? [] : [imageId]))];
  if (!imageIds.length) return ok(photos);
  const resolved = await deps.images.resolve(imageIds);
  // A photo is decorative: unresolved images degrade to absence and are reported together.
  const failures: readonly ListImageFailure[] = resolved.success
    ? resolved.data.failures
    : imageIds.map((imageId) => ({ imageId, code: resolved.error.code, message: resolved.error.message }));
  if (failures.length) deps.images.report(failures);
  if (!resolved.success) return ok(photos);
  const urls = new Map(resolved.data.images.map(({ id, url }) => [id, url] as const));
  for (const { variantId, imageId } of rows.data) {
    const url = imageId === null ? undefined : urls.get(imageId);
    if (url !== undefined) photos.set(variantId, url);
  }
  return ok(photos);
}
