import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { brightenDimPhoto } from "@core/src/features/products/infrastructure/product-matching/dim-photo";

// A 200×200 photo of two halves: `dark` on top, `light` below; the gap between them is its contrast.
async function photo(dark: string, light: string) {
  const bytes = await sharp({ create: { width: 200, height: 200, channels: 3, background: light } })
    .composite([{ input: { create: { width: 200, height: 100, channels: 3, background: dark } }, top: 0, left: 0 }]).jpeg({ quality: 95 }).toBuffer();
  return { bytes: new Uint8Array(bytes), contentType: "image/jpeg" };
}

const contrast = async (bytes: Uint8Array) => (await sharp(bytes).greyscale().stats()).channels[0]!.stdev;

describe("dim photo", () => {
  test("stretches the contrast of a dark, washed-out photo", async () => {
    const dim = await photo("#141414", "#3c3c3c");
    const brightened = await brightenDimPhoto(dim);
    expect(brightened?.contentType).toBe("image/jpeg");
    expect(await contrast(brightened!.bytes)).toBeGreaterThan(2 * await contrast(dim.bytes));
  });

  test("leaves a photo with normal contrast and an unreadable image as they are", async () => {
    expect(await brightenDimPhoto(await photo("#202020", "#d0d0d0"))).toBeNull();
    expect(await brightenDimPhoto({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" })).toBeNull();
  });
});
