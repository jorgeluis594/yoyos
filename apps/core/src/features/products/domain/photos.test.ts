import { describe, expect, test } from "vitest";
import { productPhotoLimits as sharedLimits } from "@shared/contracts/products";
import type { ImageId } from "@core/src/features/products/domain/product";
import { parseProductPhotos, primaryPhoto, productPhotoLimits, samePhotos } from "@core/src/features/products/domain/photos";

const image = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` as ImageId;
const images = (count: number) => Array.from({ length: count }, (_, index) => image(index + 1));

describe("product photos", () => {
  test("the domain limit equals the shared contract limit", () => {
    expect(productPhotoLimits).toEqual(sharedLimits);
  });

  test("parseProductPhotos accepts up to 8 distinct photos in order", () => {
    const list = images(productPhotoLimits.maxPhotos);
    const parsed = parseProductPhotos(list);
    expect(parsed).toEqual({ success: true, data: list });
    expect(parseProductPhotos([])).toEqual({ success: true, data: [] });
  });

  test("parseProductPhotos rejects a ninth photo with TOO_MANY_PHOTOS and the maximum", () => {
    const parsed = parseProductPhotos([...images(8), image(9)]);
    expect(parsed).toMatchObject({ success: false, error: { issues: [{ scope: "product", field: "photoIds", reason: "TOO_MANY_PHOTOS", maximum: 8 }] } });
    // The limit is checked before scanning for repeats.
    expect(parseProductPhotos(Array.from({ length: 500 }, () => image(1)))).toMatchObject({ success: false, error: { issues: [{ reason: "TOO_MANY_PHOTOS" }] } });
  });

  test("parseProductPhotos reports each repeated photo with its index", () => {
    const parsed = parseProductPhotos([image(1), image(2), image(1), image(2), image(1)]);
    expect(parsed).toMatchObject({ success: false, error: { issues: [
      { scope: "photo", field: "photoIds", index: 2, reason: "DUPLICATE_PHOTO" },
      { scope: "photo", field: "photoIds", index: 3, reason: "DUPLICATE_PHOTO" },
      { scope: "photo", field: "photoIds", index: 4, reason: "DUPLICATE_PHOTO" },
    ] } });
  });

  test("the primary is the first photo and two lists are the same only in the same order", () => {
    const [a, b] = images(2);
    const first = parseProductPhotos([a, b]);
    const second = parseProductPhotos([b, a]);
    if (!first.success || !second.success) throw new Error("unexpected");
    expect(primaryPhoto(first.data)).toBe(a);
    expect(primaryPhoto(second.data)).toBe(b);
    expect(primaryPhoto([] as unknown as typeof first.data)).toBeNull();
    expect(samePhotos(first.data, first.data)).toBe(true);
    expect(samePhotos(first.data, second.data)).toBe(false);
  });
});
