import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ImageId, Product, ProductId } from "@core/src/features/products/domain/product";
import type { ProductReadError, ProductRepository } from "@core/src/features/products/application/repository";

export type Detail = Readonly<{ product: Product; image?: Readonly<{ id: ImageId; url: string }> }>;
export type DetailError = Readonly<{ code: "IMAGE_NOT_FOUND"; message: string }> | ProductReadError;
export type GetDependencies = Readonly<{
  repository: Pick<ProductRepository, "get">;
  resolveImage: (imageId: ImageId) => Promise<{ id: ImageId; url: string } | null>;
}>;

export async function getProduct(id: ProductId, deps: GetDependencies): Promise<Result<Detail | null, DetailError>> {
  const result = await deps.repository.get(id);
  if (!result.success) return result;
  const product = result.data;
  if (!product) return ok(null);
  if (!product.imageId) return ok({ product });
  const image = await deps.resolveImage(product.imageId);
  if (!image) return err({ code: "IMAGE_NOT_FOUND", message: "Image is unavailable" });
  return ok({ product, image });
}
