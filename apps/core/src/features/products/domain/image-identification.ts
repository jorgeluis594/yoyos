import type { ImageId, ProductId } from "@core/src/features/products/domain/product";

export type ImageBytes = Readonly<{ bytes: Uint8Array; contentType: string }>;
export type EmbeddingModel = string & { readonly __brand: "EmbeddingModel" };
export type EmbeddingVector = readonly number[] & { readonly __brand: "EmbeddingVector" };
export type ProductImageEmbedding = Readonly<{ productId: ProductId; imageId: ImageId; model: EmbeddingModel; vector: EmbeddingVector }>;

export function parseEmbeddingModel(value: string): EmbeddingModel | null {
  return value.length > 0 && value.length <= 100 ? value as EmbeddingModel : null;
}

export function parseEmbeddingVector(values: readonly number[], dimensions: number): EmbeddingVector | null {
  return values.length === dimensions && values.every(Number.isFinite) ? values as EmbeddingVector : null;
}
