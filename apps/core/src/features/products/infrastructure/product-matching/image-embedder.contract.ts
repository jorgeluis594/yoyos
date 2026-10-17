import sharp from "sharp";
import { expect, test } from "vitest";
import type { EmbedImage } from "@core/src/features/products/application/index-product-image";

/** Stands in for the provider's HTTP endpoint; every adapter test controls this boundary, never the network. */
export type Transport = typeof fetch;

export type ImageEmbedderHarness = Readonly<{
  dimensions: number;
  /** Builds the adapter over the transport; its client timeout must be short so the timeout case ends quickly. */
  build: (transport: Transport) => EmbedImage;
  /** Transport whose provider answers with these vector values. */
  answering: (values: readonly (number | null)[]) => Transport;
}>;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const timingOut: Transport = (_input, init) => new Promise((_resolve, reject) => {
  init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
});

export function imageEmbedderContract(harness: ImageEmbedderHarness) {
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

  test("returns EMBEDDER_UNAVAILABLE on timeout, 429, 5xx and network errors", async () => {
    const network: Transport = async () => { throw new TypeError("fetch failed"); };
    for (const transport of [timingOut, async () => json(429, { error: { message: "slow down" } }), async () => json(503, { error: { message: "down" } }), network])
      expect(await harness.build(transport)(await image())).toMatchObject({ success: false, error: { code: "EMBEDDER_UNAVAILABLE" } });
  });
}
