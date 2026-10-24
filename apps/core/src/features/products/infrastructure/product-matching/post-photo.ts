import sharp from "sharp";
import type { ImageBytes } from "@core/src/features/products/domain/image-identification";

// A screenshot of a social post or chat is a photo band between flat app screens (white or dark): the band is cut out so the product
// is compared without the app around it. Measured on a small RGB copy, so it costs a few milliseconds.
const SAMPLE_WIDTH = 96;
const COLOR_TOLERANCE = 40;        // sum of absolute RGB differences to the screen background
const PHOTO_ROW = 0.9;             // share of a row's pixels off the background for the row to be photo
const FLAT_ROW = 0.15;             // at most this share off the background for a row to be app screen
const MIN_BAND = 0.25, MAX_BAND = 0.85; // band height as a share of the image
const MIN_FLAT_OUTSIDE = 0.6;      // share of the rows outside the band that must be flat app screen
const MIN_SCREEN_EDGE = 0.05;      // app screen above and below the band, as a share of the image

type Rgb = readonly [number, number, number];

export type PostPhotoBand = Readonly<{ top: number; height: number }>; // in source pixels

function backgroundOf(pixels: Uint8Array, width: number, height: number): Rgb {
  // The most common coarse colour of the first and last rows: the app screen behind the post.
  const counts = new Map<number, number>();
  for (const y of [0, 1, height - 2, height - 1]) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    const key = (pixels[i]! >> 4) << 8 | (pixels[i + 1]! >> 4) << 4 | pixels[i + 2]! >> 4;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [key] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return [((key >> 8) & 15) * 16 + 8, ((key >> 4) & 15) * 16 + 8, (key & 15) * 16 + 8];
}

// Size after applying the EXIF orientation, as `rotate()` does: orientations 5 to 8 swap width and height.
async function orientedSize(image: ImageBytes): Promise<Readonly<{ width: number; height: number }>> {
  const { width = 0, height = 0, orientation = 1 } = await sharp(image.bytes, { limitInputPixels: 24_000_000 }).metadata();
  return orientation >= 5 ? { width: height, height: width } : { width, height };
}

/** The photo band of a post or chat screenshot, or null when the image is not one (a plain photo has no flat app screen around it). */
export async function findPostPhotoBand(image: ImageBytes): Promise<PostPhotoBand | null> {
  const { data, info } = await sharp(image.bytes, { limitInputPixels: 24_000_000 }).rotate().resize({ width: SAMPLE_WIDTH }).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8Array(data);
  const { width, height } = info;
  if (height < 8) return null;
  const background = backgroundOf(pixels, width, height);
  const offShare = Array.from({ length: height }, (_, y) => {
    let off = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      if (Math.abs(pixels[i]! - background[0]) + Math.abs(pixels[i + 1]! - background[1]) + Math.abs(pixels[i + 2]! - background[2]) > COLOR_TOLERANCE) off++;
    }
    return off / width;
  });
  let best = { top: 0, rows: 0 };
  for (let y = 0, start = -1; y <= height; y++) {
    if (y < height && offShare[y]! >= PHOTO_ROW) { if (start < 0) start = y; continue; }
    if (start >= 0 && y - start > best.rows) best = { top: start, rows: y - start };
    start = -1;
  }
  // A light product background leaves rows that are not fully off the screen colour: the band grows over every row that is not flat.
  let top = best.top, end = best.top + best.rows;
  while (top > 0 && offShare[top - 1]! > FLAT_ROW) top--;
  while (end < height && offShare[end]! > FLAT_ROW) end++;
  if (end - top < MIN_BAND * height || end - top > MAX_BAND * height) return null;
  // App screen above and below (the post's header and caption), so a dark photo with a black corner is not a screenshot.
  if (top < MIN_SCREEN_EDGE * height || height - end < MIN_SCREEN_EDGE * height) return null;
  const outside = offShare.filter((_, y) => y < top || y >= end);
  if (outside.filter((share) => share <= FLAT_ROW).length < MIN_FLAT_OUTSIDE * outside.length) return null;
  const scale = (await orientedSize(image)).height / height;
  return { top: Math.round(top * scale), height: Math.round((end - top) * scale) };
}

/** The photo of a post or chat screenshot, cut out of the app screen; null when the image is not one or cannot be read. */
export async function cropPostPhoto(image: ImageBytes): Promise<ImageBytes | null> {
  try {
    const band = await findPostPhotoBand(image);
    if (!band) return null;
    const { width, height } = await orientedSize(image);
    const bytes = await sharp(image.bytes, { limitInputPixels: 24_000_000 }).rotate()
      .extract({ left: 0, top: band.top, width, height: Math.min(band.height, height - band.top) }).jpeg({ quality: 90 }).toBuffer();
    return { bytes: new Uint8Array(bytes), contentType: "image/jpeg" };
  } catch {
    return null; // An image the crop cannot read is searched whole; the embedder reports it if it is really unreadable.
  }
}
