import sharp from "sharp";
import { expect, test } from "vitest";
import type { EmbedImage } from "@core/src/features/products/application/index-product-image";

/** Stands in for the provider's HTTP endpoint; every adapter test controls this boundary, never the network. */
export type Transport = typeof fetch;

/** Backend is the boundary the adapter test controls instead of the real provider: an HTTP transport or a local model loader. */
export type ImageEmbedderHarness<Backend> = Readonly<{
  dimensions: number;
  build: (backend: Backend) => EmbedImage;
  /** Backend whose provider answers with these vector values; null stands for a non-finite value. */
  answering: (values: readonly (number | null)[]) => Backend;
  /** Backends whose provider is unavailable, for example timeout, 429, 5xx and network errors, or a model that fails to load or run. */
  unavailable: readonly Backend[];
}>;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const timingOut: Transport = (_input, init) => new Promise((_resolve, reject) => {
  init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
});

/** Timeout, 429, 5xx and network errors; the adapter's client timeout must be short so the timeout case ends quickly. */
export const unavailableTransports: readonly Transport[] = [timingOut, async () => json(429, { error: { message: "slow down" } }),
  async () => json(503, { error: { message: "down" } }), async () => { throw new TypeError("fetch failed"); }];

export function imageEmbedderContract<Backend>(harness: ImageEmbedderHarness<Backend>) {
  const image = async () => ({ bytes: new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c33" } }).png().toBuffer()), contentType: "image/png" });
  const ones = (length: number) => Array.from({ length }, () => 0.5);

  test("returns a vector of the configured model dimension", async () => {
    const result = await harness.build(harness.answering(ones(harness.dimensions)))(await image());
    expect(result.success && result.data).toHaveLength(harness.dimensions);
  });

  test("returns INVALID_EMBEDDING for a vector of another length or with non-finite values", async () => {
    for (const values of [ones(harness.dimensions - 1), [...ones(harness.dimensions - 1), null]])
      expect(await harness.build(harness.answering(values))(await image())).toMatchObject({ success: false, error: { code: "INVALID_EMBEDDING" } });
  });

  test("returns EMBEDDER_UNAVAILABLE when the provider is unavailable", async () => {
    for (const backend of harness.unavailable)
      expect(await harness.build(backend)(await image())).toMatchObject({ success: false, error: { code: "EMBEDDER_UNAVAILABLE" } });
  });
}
