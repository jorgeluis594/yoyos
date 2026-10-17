import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { indexProductImage, type IndexProductImageDependencies } from "@core/src/features/products/application/index-product-image";
import type { EmbeddingModel, EmbeddingVector, ProductImageEmbedding } from "@core/src/features/products/domain/image-identification";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";

const productId = "00000000-0000-4000-8000-000000000001" as ProductId;
const imageId = "00000000-0000-4000-8000-000000000002" as ImageId;
const oldImageId = "00000000-0000-4000-8000-000000000003" as ImageId;
const model = "openai/test" as EmbeddingModel;
const vector = [0.1, 0.2] as unknown as EmbeddingVector;
const image = { bytes: new Uint8Array([1]), contentType: "image/png" };

function setup(overrides: Partial<IndexProductImageDependencies> = {}) {
  const saved: ProductImageEmbedding[] = [];
  const embedded: unknown[] = [];
  const deps: IndexProductImageDependencies = {
    findImageIndexState: async () => ok({ imageId, indexedImageId: oldImageId }),
    readImage: async () => ok(image),
    embedImage: async (input) => { embedded.push(input); return ok(vector); },
    saveEmbedding: async (embedding) => { saved.push(embedding); return ok("saved"); },
    model,
    ...overrides,
  };
  return { deps, saved, embedded };
}

test("embeds the current product image and saves it with the model", async () => {
  const context = setup();
  expect(await indexProductImage({ productId }, context.deps)).toEqual(ok({ kind: "indexed", imageId }));
  expect(context.embedded).toEqual([image]);
  expect(context.saved).toEqual([{ productId, imageId, model, vector }]);
});

test("skips a product without image, a missing product and an already indexed image", async () => {
  for (const [state, reason] of [[null, "product_not_found"], [{ imageId: null, indexedImageId: null }, "no_image"], [{ imageId, indexedImageId: imageId }, "already_indexed"]] as const) {
    const context = setup({ findImageIndexState: async () => ok(state) });
    expect(await indexProductImage({ productId }, context.deps)).toEqual(ok({ kind: "skipped", reason }));
    expect(context.embedded).toEqual([]);
  }
});

test("reports image_replaced when the product changed its image before saving", async () => {
  const context = setup({ saveEmbedding: async () => ok("image_replaced") });
  expect(await indexProductImage({ productId }, context.deps)).toEqual(ok({ kind: "skipped", reason: "image_replaced" }));
});

test("propagates image storage and embedder failures without saving", async () => {
  const failures = [
    { readImage: async () => err({ code: "IMAGE_STORAGE_UNAVAILABLE" as const, message: "down" }) },
    { embedImage: async () => err({ code: "EMBEDDER_UNAVAILABLE" as const, message: "503" }) },
    { embedImage: async () => err({ code: "INVALID_EMBEDDING" as const, message: "length" }) },
  ];
  for (const failure of failures) {
    const context = setup(failure);
    expect(await indexProductImage({ productId }, context.deps)).toMatchObject({ success: false });
    expect(context.saved).toEqual([]);
  }
  expect(await indexProductImage({ productId }, setup({ findImageIndexState: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "db" }) }).deps))
    .toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
});
