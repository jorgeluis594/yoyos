import sharp from "sharp";
import { expect, test } from "vitest";
import type { ChooseProduct } from "@core/src/features/products/application/identify-products-in-image";
import type { ImageBytes } from "@core/src/features/products/domain/image-identification";
import type { ProductId } from "@core/src/features/products/domain/product";

/** What the provider's HTTP boundary answers; each adapter test translates it to its provider's wire format. */
export type ProviderReply =
  | Readonly<{ kind: "choice"; choice: string; confidence: number; showsProduct: number }>
  | Readonly<{ kind: "malformed" }>
  | Readonly<{ kind: "status"; status: number }>
  | Readonly<{ kind: "timeout" }>
  | Readonly<{ kind: "network" }>;

export type ChooserHarness = (reply: ProviderReply) => Readonly<{ choose: ChooseProduct; sentImages: () => readonly number[] }>;

const png = async (color: string): Promise<ImageBytes> =>
  ({ bytes: new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: color } }).png().toBuffer()), contentType: "image/png" });

async function input() {
  const [query, first, second] = await Promise.all(["#f00", "#0f0", "#00f"].map(png));
  return { query: query!, candidates: [{ productId: "product-a" as ProductId, image: first! }, { productId: "product-b" as ProductId, image: second! }] };
}

/** Every ChooseProduct adapter runs this suite against its controlled HTTP boundary. */
export function productChooserContract(harness: ChooserHarness) {
  test("sends the query image and every candidate image once", async () => {
    const adapter = harness({ kind: "choice", choice: "A", confidence: 0.9, showsProduct: 0.9 });
    await adapter.choose(await input());
    expect(adapter.sentImages()).toEqual([3]);
  });

  test("returns the candidate chosen in the provider's structured output", async () => {
    expect(await harness({ kind: "choice", choice: "B", confidence: 0.91, showsProduct: 0.8 }).choose(await input()))
      .toEqual({ success: true, data: expect.objectContaining({ kind: "product", productId: "product-b", confidence: 0.91, showsProduct: 0.8 }) });
  });

  test("returns none when the provider answers none", async () => {
    expect(await harness({ kind: "choice", choice: "none", confidence: 0.7, showsProduct: 0.1 }).choose(await input())).toEqual({ success: true, data: expect.objectContaining({ kind: "none", confidence: 0.7, showsProduct: 0.1 }) });
  });

  test("returns INVALID_MATCHER_RESPONSE when the provider output is not the expected JSON", async () => {
    for (const reply of [{ kind: "malformed" }, { kind: "choice", choice: "Z", confidence: 0.9, showsProduct: 0.9 }, { kind: "status", status: 400 }] as const) {
      expect(await harness(reply).choose(await input())).toMatchObject({ success: false, error: { code: "INVALID_MATCHER_RESPONSE" } });
    }
  });

  test("returns PRODUCT_MATCHER_UNAVAILABLE on timeout, 429, 5xx and network errors", async () => {
    for (const reply of [{ kind: "timeout" }, { kind: "status", status: 429 }, { kind: "status", status: 500 }, { kind: "status", status: 503 }, { kind: "network" }] as const) {
      expect(await harness(reply).choose(await input())).toMatchObject({ success: false, error: { code: "PRODUCT_MATCHER_UNAVAILABLE" } });
    }
  });
}
