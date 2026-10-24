import { describe, expect, test } from "vitest";
import { manifestEntry, pickPhoto, type ImageManifest } from "@core/evals/fixtures/image-manifest";

const valid = { file: "customer/polo-basico-worn.jpg", folder: "customer", productKey: "polo-basico", color: "Negro", scenario: "worn", expected: "match",
  generator: "gpt-image", prompt: "a worn black tee", derivedFrom: null };

describe("photo manifest", () => {
  test("accepts a photo of a catalog product in a color it sells", () => {
    expect(manifestEntry.safeParse(valid).success).toBe(true);
  });

  test.each([
    ["a match without its product", { productKey: null }],
    ["a color the product does not sell", { color: "Rojo" }],
    ["a file outside its folder", { file: "negative/polo-basico-worn.jpg" }],
    ["an unknown product key", { productKey: "polo-cuello-v" }],
  ])("rejects %s", (_name, change) => {
    expect(manifestEntry.safeParse({ ...valid, ...change }).success).toBe(false);
  });

  test("a hard negative may name the product it resembles, in a color it does not sell", () => {
    expect(manifestEntry.safeParse({ ...valid, folder: "negative", file: "negative/polo-rojo.jpg", expected: "no_match", color: "Rojo" }).success).toBe(true);
  });

  test("picks the first photo matching every field and the hint", () => {
    const manifest: ImageManifest = { dir: "/photos", entries: [
      manifestEntry.parse({ ...valid, file: "customer/polo-basico-angle.jpg", scenario: "angle" }),
      manifestEntry.parse(valid),
    ] };

    expect(pickPhoto(manifest, { productKey: "polo-basico", hint: "worn" })?.file).toBe("customer/polo-basico-worn.jpg");
    expect(pickPhoto(manifest, { productKey: "polo-basico" })?.file).toBe("customer/polo-basico-angle.jpg");
    expect(pickPhoto(manifest, { productKey: "gorra-trucker" })).toBeNull();
  });
});
