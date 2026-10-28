import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ImageReadError } from "@core/src/shared/images/application/images";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { EmbeddingModel, EmbeddingVector, ImageBytes, ImageEmbedding } from "@core/src/features/products/domain/image-identification";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

/** Port every embedding provider implements. */
export type EmbedImage = (image: ImageBytes) =>
  Promise<Result<EmbeddingVector, Readonly<{ code: "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING"; message: string }>>>;

/** Retry policy of index-product-photos; this module stays free of runtime imports so event-handlers can read it while loading. */
// One job at a time: the local model saturates the CPU, so parallel indexing only slows customer image searches and raises RAM.
export const indexProductPhotosPolicy = { concurrency: 1, retries: 8 } as const;

export type IndexProductPhotosInput = Readonly<{ productId: ProductId }>;
export type PhotoIndexFailure = Readonly<{
  imageId: ImageId;
  code: "PERSISTENCE_UNAVAILABLE" | "IMAGE_STORAGE_UNAVAILABLE" | "IMAGE_NOT_FOUND" | "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING";
  message: string;
}>;
/** Every unindexed photo was tried; `failed` holds the photos that could not be indexed, retryable or not. */
export type IndexProductPhotosOutcome =
  | Readonly<{ kind: "processed"; indexed: readonly ImageId[]; failed: readonly PhotoIndexFailure[] }>
  | Readonly<{ kind: "skipped"; reason: "product_not_found" | "no_photos" | "already_indexed" }>;
export type IndexProductPhotosError = PersistenceError; // only the state read; photo failures are outcomes
export type IndexProductPhotosDependencies = Readonly<{
  /** Photos of the product in position order with whether each image has an embedding of the model; null when the product does not exist. */
  findPhotoIndexState: (productId: ProductId, model: EmbeddingModel) =>
    Promise<Result<readonly Readonly<{ imageId: ImageId; indexed: boolean }>[] | null, PersistenceError>>;
  readImage: (imageId: ImageId) => Promise<Result<ImageBytes, ImageReadError>>;
  embedImage: EmbedImage;
  saveEmbedding: (embedding: ImageEmbedding) => Promise<Result<void, PersistenceError>>;
  model: EmbeddingModel;
}>;

type PhotoFailure = Pick<PhotoIndexFailure, "code" | "message">;

async function indexPhoto(imageId: ImageId, deps: IndexProductPhotosDependencies): Promise<Result<void, PhotoFailure>> {
  const image = await deps.readImage(imageId);
  if (!image.success) return image;
  const vector = await deps.embedImage(image.data);
  if (!vector.success) return vector;
  // If the photo left the product meanwhile, this row is harmless: search only joins current photos.
  return deps.saveEmbedding({ imageId, model: deps.model, vector: vector.data });
}

/** Tries every unindexed photo in position order; a failed photo never stops the later ones. Retry decisions belong to the handler. */
export async function indexProductPhotos(input: IndexProductPhotosInput, deps: IndexProductPhotosDependencies):
  Promise<Result<IndexProductPhotosOutcome, IndexProductPhotosError>> {
  const state = await deps.findPhotoIndexState(input.productId, deps.model);
  if (!state.success) return state;
  if (!state.data) return ok({ kind: "skipped", reason: "product_not_found" });
  if (!state.data.length) return ok({ kind: "skipped", reason: "no_photos" });
  const pending = state.data.filter(({ indexed }) => !indexed);
  if (!pending.length) return ok({ kind: "skipped", reason: "already_indexed" });
  const indexed: ImageId[] = [];
  const failed: PhotoIndexFailure[] = [];
  for (const { imageId } of pending) {
    const result = await indexPhoto(imageId, deps);
    if (result.success) indexed.push(imageId);
    else failed.push({ imageId, code: result.error.code, message: result.error.message });
  }
  return ok({ kind: "processed", indexed, failed });
}
