import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { createLocalImageEmbedder, type LoadImageFeatureModel, type RgbImage } from "@core/src/features/products/infrastructure/product-matching/local-image-embedder";
import { imageEmbedderContract } from "@core/src/features/products/infrastructure/product-matching/image-embedder.contract";

const dimensions = 512;
const build = (load: LoadImageFeatureModel) => createLocalImageEmbedder({ modelId: "Xenova/clip-vit-base-patch32", currentCompanyId: () => "company", load });
const answering = (values: readonly (number | null)[]): LoadImageFeatureModel => async () =>
  ({ dimensions, embed: async () => values.map((value) => value ?? Number.NaN) });
const png = async (width: number, height: number) =>
  ({ bytes: new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "#3a6" } }).png().toBuffer()), contentType: "image/png" });

describe("local image embedder contract", () => {
  imageEmbedderContract({ dimensions, build: (load) => build(load).embedImage, answering, unavailable: [
    async () => { throw new Error("model download failed"); },
    async () => ({ dimensions, embed: async () => { throw new Error("onnxruntime failed"); } }),
  ] });
});

test("loads the model once for concurrent first calls and returns a unit vector of the resized image", async () => {
  const seen: RgbImage[] = [];
  let loads = 0;
  const embedder = build(async () => {
    loads++;
    return { dimensions: 2, embed: async (image) => { seen.push(image); return [3, 4]; } };
  });
  const image = await png(3000, 1500);
  const results = await Promise.all([embedder.embedImage(image), embedder.embedImage(image)]);
  expect(embedder.model).toBe("local/Xenova/clip-vit-base-patch32");
  expect(loads).toBe(1);
  expect(results.map((result) => result.success && result.data)).toEqual([[0.6, 0.8], [0.6, 0.8]]);
  expect(seen.map(({ width, height, data }) => [width, height, data.length])).toEqual([[1024, 512, 1024 * 512 * 3], [1024, 512, 1024 * 512 * 3]]);
});

test("loads the model again on the next call after a failed load", async () => {
  let loads = 0;
  const embedder = build(async () => {
    if (++loads === 1) throw new Error("network down");
    return { dimensions: 2, embed: async () => [1, 0] };
  });
  const image = await png(4, 4);
  expect(await embedder.embedImage(image)).toMatchObject({ success: false, error: { code: "EMBEDDER_UNAVAILABLE" } });
  expect(await embedder.embedImage(image)).toEqual({ success: true, data: [1, 0] });
});

test("returns INVALID_EMBEDDING for an undecodable image or a zero vector", async () => {
  expect(await build(answering([1, 0])).embedImage({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" }))
    .toMatchObject({ success: false, error: { code: "INVALID_EMBEDDING" } });
  expect(await build(answering(Array.from({ length: dimensions }, () => 0))).embedImage(await png(4, 4)))
    .toMatchObject({ success: false, error: { code: "INVALID_EMBEDDING" } });
});
