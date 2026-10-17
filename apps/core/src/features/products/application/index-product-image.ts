import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ImageReadError } from "@core/src/shared/images/application/images";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { EmbeddingModel, EmbeddingVector, ImageBytes, ImageEmbedding } from "@core/src/features/products/domain/image-identification";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

/** Port every embedding provider implements. */
export type EmbedImage = (image: ImageBytes) =>
  Promise<Result<EmbeddingVector, Readonly<{ code: "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING"; message: string }>>>;

/** Retry policy of index-product-image; this module stays free of runtime imports so event-handlers can read it while loading. */
export const indexProductImagePolicy = { concurrency: 2, retries: 8 } as const;

export type IndexProductImageInput = Readonly<{ productId: ProductId }>;
export type IndexProductImageOutcome =
  | Readonly<{ kind: "indexed"; imageId: ImageId }>
  | Readonly<{ kind: "skipped"; reason: "product_not_found" | "no_image" | "already_indexed" }>;
export type IndexProductImageError = Readonly<{
  code: "PERSISTENCE_UNAVAILABLE" | "IMAGE_STORAGE_UNAVAILABLE" | "IMAGE_NOT_FOUND" | "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING";
  message: string;
}>;
export type IndexProductImageDependencies = Readonly<{
  findImageIndexState: (productId: ProductId, model: EmbeddingModel) =>
    Promise<Result<Readonly<{ imageId: ImageId | null; indexed: boolean }> | null, PersistenceError>>;
  readImage: (imageId: ImageId) => Promise<Result<ImageBytes, ImageReadError>>;
  embedImage: EmbedImage;
  saveEmbedding: (embedding: ImageEmbedding) => Promise<Result<void, PersistenceError>>;
  model: EmbeddingModel;
}>;

export async function indexProductImage(input: IndexProductImageInput, deps: IndexProductImageDependencies):
  Promise<Result<IndexProductImageOutcome, IndexProductImageError>> {
  const state = await deps.findImageIndexState(input.productId, deps.model);
  if (!state.success) return state;
  if (!state.data) return ok({ kind: "skipped", reason: "product_not_found" });
  const { imageId, indexed } = state.data;
  if (!imageId) return ok({ kind: "skipped", reason: "no_image" });
  if (indexed) return ok({ kind: "skipped", reason: "already_indexed" });
  const image = await deps.readImage(imageId);
  if (!image.success) return image;
  const vector = await deps.embedImage(image.data);
  if (!vector.success) return vector;
  // If the product changed its image meanwhile, this row still caches the old image; search only joins current images.
  const saved = await deps.saveEmbedding({ imageId, model: deps.model, vector: vector.data });
  return saved.success ? ok({ kind: "indexed", imageId }) : saved;
}
