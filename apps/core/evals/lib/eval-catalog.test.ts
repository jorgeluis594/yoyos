import { describe, expect, test } from "vitest";
import type { ImageId } from "@core/src/features/products/domain/product";
import { readRegisteredImages, registerImageFile } from "@core/evals/lib/eval-catalog";

const known = "00000000-0000-4000-8000-000000000001" as ImageId;
const unknown = "00000000-0000-4000-8000-000000000002" as ImageId;

describe("readRegisteredImages", () => {
  test("reads registered photos in the order asked and reports an unregistered id as not found", async () => {
    registerImageFile(known, "src/features/products/infrastructure/product-matching/dim-photo.ts");
    const read = await readRegisteredImages([unknown, known]);
    expect(read.success && read.data.map((image) => image.success)).toEqual([false, true]);
    expect(read.success && !read.data[0]!.success && read.data[0]!.error.code).toBe("IMAGE_NOT_FOUND");
  });
});
