import * as ImageManipulator from "expo-image-manipulator";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type JpegBounds = Readonly<{ maxSide: number; maxPixels?: number; maxBytes: number }>;
export type JpegFittingError = Readonly<{ code: "TOO_LARGE"; message: string }>;

const qualities = [0.82, 0.72, 0.62, 0.52] as const;

function fits(bounds: JpegBounds, size: number, width: number, height: number) {
  return size <= bounds.maxBytes && Math.max(width, height) <= bounds.maxSide && (bounds.maxPixels === undefined || width * height <= bounds.maxPixels);
}

/** Re-encodes an image as JPEG inside the bounds. Four size attempts cap device work; the upload API remains the final check. */
export async function fitJpeg(uri: string, width: number, height: number, bounds: JpegBounds): Promise<Result<string, JpegFittingError>> {
  const pixelScale = bounds.maxPixels === undefined ? 1 : Math.sqrt(bounds.maxPixels / (width * height));
  const scale = Math.min(1, bounds.maxSide / Math.max(width, height), pixelScale);
  for (const [attempt, compress] of qualities.entries()) {
    const factor = scale * 0.75 ** attempt;
    const result = await ImageManipulator.manipulateAsync(
      uri,
      factor < 1 ? [{ resize: { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) } }] : [],
      { compress, format: ImageManipulator.SaveFormat.JPEG },
    );
    const file = await fetch(result.uri).then(response => response.blob());
    if (fits(bounds, file.size, result.width, result.height)) return ok(result.uri);
  }
  return err({ code: "TOO_LARGE", message: "The image does not fit the bounds" });
}
