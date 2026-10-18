import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { createLocalImageEmbedder, DEFAULT_LOCAL_IMAGE_MODEL, localModelPath } from "@core/src/features/products/infrastructure/product-matching/local-image-embedder";

// Real model on real photos: two views of one silver teapot and a different silver teapot (CC0, The Met Open Access, see embedding-fixtures/README.md).
// The model loads offline from apps/core/models; fetch throws so any network access fails the test.
const fixture = async (name: string) =>
  ({ bytes: new Uint8Array(await readFile(new URL(`./embedding-fixtures/${name}`, import.meta.url))), contentType: "image/jpeg" });
const dot = (left: readonly number[], right: readonly number[]) => left.reduce((sum, value, index) => sum + value * right[index], 0);

// shortcut: skipped while the default model's weights are not committed (license, design §15); drop the skip when they are.
test.skipIf(!existsSync(join(localModelPath, DEFAULT_LOCAL_IMAGE_MODEL)))("two photos of the same product are closer than photos of different products", async () => {
  vi.stubGlobal("fetch", () => { throw new Error("Network disabled in the real-model test"); });
  const embedder = createLocalImageEmbedder({ modelId: DEFAULT_LOCAL_IMAGE_MODEL, currentCompanyId: () => "test" });
  const first = await embedder.embedImage(await fixture("product-a-front.jpg"));
  const [second, other] = await Promise.all(["product-a-side.jpg", "product-b.jpg"].map(async (name) => embedder.embedImage(await fixture(name))));
  if (!first.success || !second.success || !other.success) throw new Error("Embedding failed");
  expect(Math.hypot(...first.data)).toBeCloseTo(1, 5);
  expect(dot(first.data, second.data)).toBeGreaterThan(dot(first.data, other.data));
  expect(dot(first.data, second.data)).toBeGreaterThan(dot(second.data, other.data));
}, 300_000);
