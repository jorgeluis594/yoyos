import sharp from "sharp";
import type { ImageBytes } from "@core/src/features/products/domain/image-identification";

// A dark, blurry or washed-out phone photo has little contrast: its product is compared on a contrast-stretched copy. Measured on
// fixture photos, damaged ones stay under a luminance deviation of 25 and every clear photo, product or not, is above 30.
const SAMPLE_WIDTH = 96;
const MAX_DIM_STDEV = 28;

/** A dim photo with its contrast stretched, or null when the photo is clear enough or cannot be read. */
export async function brightenDimPhoto(image: ImageBytes): Promise<ImageBytes | null> {
  try {
    const { channels: [luminance] } = await sharp(image.bytes, { limitInputPixels: 24_000_000 }).rotate().resize({ width: SAMPLE_WIDTH })
      .greyscale().stats();
    if (!luminance || luminance.stdev >= MAX_DIM_STDEV) return null;
    const bytes = await sharp(image.bytes, { limitInputPixels: 24_000_000 }).rotate().normalise().jpeg({ quality: 90 }).toBuffer();
    return { bytes: new Uint8Array(bytes), contentType: "image/jpeg" };
  } catch {
    return null; // An image this step cannot read is searched as it came; the embedder reports it if it is really unreadable.
  }
}
