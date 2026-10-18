import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { createLocalImageEmbedder, DEFAULT_LOCAL_IMAGE_MODEL } from "@core/src/features/products/infrastructure/product-matching/local-image-embedder";

// Real model on real photos: two views of one silver teapot and a different silver teapot (CC0, The Met Open Access, see embedding-fixtures/README.md).
// The model comes from the transformers.js cache or, the first time, from the Hugging Face Hub (CI downloads it on every run).
const fixture = async (name: string) =>
  ({ bytes: new Uint8Array(await readFile(new URL(`./embedding-fixtures/${name}`, import.meta.url))), contentType: "image/jpeg" });
const hubReachable = () => fetch("https://huggingface.co", { method: "HEAD", signal: AbortSignal.timeout(5_000) }).then(() => true, () => false);
const dot = (left: readonly number[], right: readonly number[]) => left.reduce((sum, value, index) => sum + value * right[index], 0);

test("two photos of the same product are closer than photos of different products", async (context) => {
  const embedder = createLocalImageEmbedder({ modelId: DEFAULT_LOCAL_IMAGE_MODEL, currentCompanyId: () => "test" });
  const first = await embedder.embedImage(await fixture("product-a-front.jpg"));
  // Skipped only when the model is not cached and the Hub cannot be reached; any other failure fails the test.
  if (!first.success && first.error.code === "EMBEDDER_UNAVAILABLE" && !await hubReachable()) context.skip("Hugging Face Hub unreachable");
  const [second, other] = await Promise.all(["product-a-side.jpg", "product-b.jpg"].map(async (name) => embedder.embedImage(await fixture(name))));
  if (!first.success || !second.success || !other.success) throw new Error("Embedding failed");
  expect(Math.hypot(...first.data)).toBeCloseTo(1, 5);
  expect(dot(first.data, second.data)).toBeGreaterThan(dot(first.data, other.data));
  expect(dot(first.data, second.data)).toBeGreaterThan(dot(second.data, other.data));
}, 300_000);
