import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { indexProductPhotos, type IndexProductPhotosDependencies } from "@core/src/features/products/application/index-product-photos";
import type { EmbeddingModel, EmbeddingVector, ImageEmbedding } from "@core/src/features/products/domain/image-identification";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";

const productId = "00000000-0000-4000-8000-000000000001" as ProductId;
const [front, stand, back] = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2", "00000000-0000-4000-8000-0000000000a3"] as ImageId[];
const model = "openai/test" as EmbeddingModel;
const vector = [0.1, 0.2] as unknown as EmbeddingVector;
const image = { bytes: new Uint8Array([1]), contentType: "image/png" };
const unindexed = (...ids: ImageId[]) => ids.map((imageId) => ({ imageId, indexed: false }));

function setup(overrides: Partial<IndexProductPhotosDependencies> = {}) {
  const saved: ImageEmbedding[] = [];
  const read: ImageId[] = [];
  const deps: IndexProductPhotosDependencies = {
    findPhotoIndexState: async () => ok(unindexed(front, stand, back)),
    readImage: async (imageId) => { read.push(imageId); return ok(image); },
    embedImage: async () => ok(vector),
    saveEmbedding: async (embedding) => { saved.push(embedding); return ok(undefined); },
    model,
    ...overrides,
  };
  return { deps, saved, read };
}

test("indexes every unindexed photo of the product in position order", async () => {
  const context = setup();
  expect(await indexProductPhotos({ productId }, context.deps)).toEqual(ok({ kind: "processed", indexed: [front, stand, back], failed: [] }));
  expect(context.read).toEqual([front, stand, back]);
  expect(context.saved).toEqual([front, stand, back].map((imageId) => ({ imageId, model, vector })));
});

test("skips photos already indexed with the model", async () => {
  const context = setup({ findPhotoIndexState: async () => ok([{ imageId: front, indexed: true }, { imageId: stand, indexed: false }, { imageId: back, indexed: true }]) });
  expect(await indexProductPhotos({ productId }, context.deps)).toEqual(ok({ kind: "processed", indexed: [stand], failed: [] }));
  expect(context.read).toEqual([stand]);
});

test("a permanent failure on the second photo still indexes the later photos and the job succeeds", async () => {
  const context = setup({ embedImage: async () => context.read.at(-1) === stand ? err({ code: "INVALID_EMBEDDING" as const, message: "length" }) : ok(vector) });
  const outcome = await indexProductPhotos({ productId }, context.deps);
  expect(outcome).toEqual(ok({ kind: "processed", indexed: [front, back], failed: [{ imageId: stand, code: "INVALID_EMBEDDING", message: "length" }] }));
  expect(context.saved.map(({ imageId }) => imageId)).toEqual([front, back]);
});

test("a retryable failure on one photo still tries the later photos and reports it", async () => {
  const context = setup({ readImage: async (imageId) => imageId === front ? err({ code: "IMAGE_STORAGE_UNAVAILABLE" as const, storageCode: "IMAGE_STORAGE_UNAVAILABLE" as const, message: "down" }) : ok(image) });
  expect(await indexProductPhotos({ productId }, context.deps)).toEqual(ok({ kind: "processed", indexed: [stand, back],
    failed: [{ imageId: front, code: "IMAGE_STORAGE_UNAVAILABLE", message: "down" }] }));
});

test("a retried job tries only the photos still without embedding", async () => {
  const context = setup({ findPhotoIndexState: async () => ok([{ imageId: front, indexed: true }, { imageId: stand, indexed: false }, { imageId: back, indexed: true }]) });
  await indexProductPhotos({ productId }, context.deps);
  expect(context.saved.map(({ imageId }) => imageId)).toEqual([stand]);
});

test("records a save failure of one photo and continues", async () => {
  const context = setup({ saveEmbedding: async (embedding) => embedding.imageId === front ? err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "db" }) : ok(undefined) });
  expect(await indexProductPhotos({ productId }, context.deps)).toEqual(ok({ kind: "processed", indexed: [stand, back],
    failed: [{ imageId: front, code: "PERSISTENCE_UNAVAILABLE", message: "db" }] }));
});

test("skips a product without photos, a missing product and a fully indexed product", async () => {
  for (const [state, reason] of [[null, "product_not_found"], [[], "no_photos"], [[{ imageId: front, indexed: true }], "already_indexed"]] as const) {
    const context = setup({ findPhotoIndexState: async () => ok(state) });
    expect(await indexProductPhotos({ productId }, context.deps)).toEqual(ok({ kind: "skipped", reason }));
    expect(context.read).toEqual([]);
  }
});

test("fails only when the state cannot be read", async () => {
  expect(await indexProductPhotos({ productId }, setup({ findPhotoIndexState: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "db" }) }).deps))
    .toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
});
