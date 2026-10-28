import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { manifestEntry, pickPhoto, readPhotoManifest, type ImageManifest } from "@core/evals/fixtures/image-manifest";

function photoFolder(entries: readonly Readonly<Record<string, unknown>>[]): string {
  const dir = mkdtempSync(join(tmpdir(), "eval-photos-"));
  for (const entry of entries) {
    mkdirSync(join(dir, String(entry.folder)), { recursive: true });
    writeFileSync(join(dir, String(entry.folder), String(entry.file).split("/").at(-1)!), "jpeg");
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(entries));
  return dir;
}

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

  test("a bare file name is read inside its folder", () => {
    expect(manifestEntry.parse({ ...valid, file: "polo-basico-worn.jpg" }).file).toBe("customer/polo-basico-worn.jpg");
  });

  test("the local folder is merged at run time, with absolute paths, and never indexes the catalog", () => {
    const committed = photoFolder([valid]);
    const local = photoFolder([{ ...valid, folder: "non-product", file: "yape-real.jpg", productKey: null, color: null, scenario: "yape-payment", expected: "not_product" },
      { ...valid, folder: "catalog", file: "polo-basico.jpg", scenario: "catalog" }]);

    const merged = readPhotoManifest({ EVAL_IMAGES_DIR: committed, EVAL_LOCAL_IMAGES_DIR: local })!;

    expect(merged.entries.map(({ file, local: isLocal }) => [file, isLocal ?? false])).toEqual([["customer/polo-basico-worn.jpg", false], [join(local, "non-product/yape-real.jpg"), true]]);
    expect(readPhotoManifest({ EVAL_IMAGES_DIR: committed, EVAL_LOCAL_IMAGES_DIR: join(local, "missing") })!.entries).toHaveLength(1);
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
