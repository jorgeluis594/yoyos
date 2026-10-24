import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { cropPostPhoto, findPostPhotoBand } from "@core/src/features/products/infrastructure/product-matching/post-photo";

type Band = Readonly<{ top: number; height: number; color: string }>;

// A 360×720 image: a flat screen of `screen` with the given bands (a photo is a striped block, a text line a thin dark strip).
async function image(screen: string, bands: readonly Band[]) {
  const block = async ({ height, color }: Band) => sharp({ create: { width: 360, height, channels: 3, background: color } })
    .composite([{ input: { create: { width: 360, height: Math.max(1, Math.floor(height / 3)), channels: 3, background: "#203060" } }, top: 0, left: 0 }]).png().toBuffer();
  const bytes = await sharp({ create: { width: 360, height: 720, channels: 3, background: screen } })
    .composite(await Promise.all(bands.map(async (band) => ({ input: await block(band), top: band.top, left: 0 })))).jpeg({ quality: 95 }).toBuffer();
  return { bytes: new Uint8Array(bytes), contentType: "image/jpeg" };
}

const text = (top: number): Band => ({ top, height: 6, color: "#999999" });
const photo: Band = { top: 160, height: 360, color: "#c8b496" };
// Measured on a 96-pixel-wide copy, so edges are found within a few source pixels.
const near = (value: number) => expect.toSatisfy((actual: number) => Math.abs(actual - value) <= 6);
const band = { top: near(160), height: near(360) };

describe("post photo", () => {
  test("finds the photo band between the post's header and caption on a light or dark screen", async () => {
    expect(await findPostPhotoBand(await image("#ffffff", [text(40), text(80), photo, text(560), text(600)]))).toEqual(band);
    expect(await findPostPhotoBand(await image("#101010", [text(40), photo, text(600)]))).toEqual(band);
  });

  test("ignores a plain photo, a product on a white background and a dark photo with a black top", async () => {
    expect(await findPostPhotoBand(await image("#c8b496", [{ top: 300, height: 100, color: "#203060" }]))).toBeNull();
    expect(await findPostPhotoBand(await image("#ffffff", [{ top: 200, height: 300, color: "#ffffff" }]))).toBeNull();
    expect(await findPostPhotoBand(await image("#050505", [{ top: 200, height: 520, color: "#c8b496" }]))).toBeNull();
  });

  test("crops the photo band out of the screenshot, and nothing out of other or unreadable images", async () => {
    const cropped = await cropPostPhoto(await image("#ffffff", [text(40), photo, text(600)]));
    expect(cropped && await sharp(cropped.bytes).metadata()).toMatchObject({ width: 360, height: near(360), format: "jpeg" });
    expect(await cropPostPhoto(await image("#c8b496", []))).toBeNull();
    expect(await cropPostPhoto({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" })).toBeNull();
  });
});
