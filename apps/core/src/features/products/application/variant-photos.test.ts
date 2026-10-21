import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { findVariantPhotos, type VariantPhotoDependencies, type VariantPhotoRow } from "@core/src/features/products/application/variant-photos";
import type { ImageId, VariantId } from "@core/src/features/products/domain/product";

const variant = (id: string) => id as VariantId;
const image = (id: string) => id as ImageId;
const row = (id: string, imageId: string | null): VariantPhotoRow => ({ variantId: variant(id), imageId: imageId === null ? null : image(imageId) });

function setup(rows: readonly VariantPhotoRow[], resolved: { images?: { id: string; url: string }[]; failures?: { imageId: string; code: string; message: string }[] } = {}) {
  const deps = {
    findVariantImages: vi.fn<VariantPhotoDependencies["findVariantImages"]>(async () => ok(rows)),
    images: {
      resolve: vi.fn<VariantPhotoDependencies["images"]["resolve"]>(async () => ok({ images: (resolved.images ?? []).map(({ id, url }) => ({ id: image(id), url })),
        failures: (resolved.failures ?? []).map(({ imageId, code, message }) => ({ imageId: image(imageId), code, message })) })),
      report: vi.fn<VariantPhotoDependencies["images"]["report"]>(),
    },
  } satisfies VariantPhotoDependencies;
  return deps;
}

test("returns the photo URL of each variant's product", async () => {
  const deps = setup([row("v1", "i1"), row("v2", "i1"), row("v3", "i2")], { images: [{ id: "i1", url: "https://cdn.example/polo.webp" }, { id: "i2", url: "https://cdn.example/taza.webp" }] });
  const result = await findVariantPhotos([variant("v1"), variant("v2"), variant("v3")], deps);
  expect(result).toEqual(ok(new Map([[variant("v1"), "https://cdn.example/polo.webp"], [variant("v2"), "https://cdn.example/polo.webp"], [variant("v3"), "https://cdn.example/taza.webp"]])));
  expect(deps.images.resolve).toHaveBeenCalledOnce();
  expect(deps.images.resolve).toHaveBeenCalledWith([image("i1"), image("i2")]);
});

test("leaves out variants whose product has no photo or whose image cannot be resolved", async () => {
  const deps = setup([row("v1", "i1"), row("v2", null), row("v3", "i3"), row("v4", "i4")],
    { images: [{ id: "i1", url: "https://cdn.example/polo.webp" }], failures: [{ imageId: "i3", code: "PRIVATE_IMAGE", message: "private" }] });
  const result = await findVariantPhotos([variant("v1"), variant("v2"), variant("v3"), variant("v4")], deps);
  expect(result).toEqual(ok(new Map([[variant("v1"), "https://cdn.example/polo.webp"]])));
});

test("reports image failures once", async () => {
  const failures = [{ imageId: "i2", code: "PRIVATE_IMAGE", message: "private" }, { imageId: "i3", code: "STORAGE_UNAVAILABLE", message: "down" }];
  const deps = setup([row("v1", "i2"), row("v2", "i3")], { failures });
  await findVariantPhotos([variant("v1"), variant("v2")], deps);
  expect(deps.images.report).toHaveBeenCalledOnce();
  expect(deps.images.report).toHaveBeenCalledWith(failures.map(({ imageId, code, message }) => ({ imageId: image(imageId), code, message })));
});

test("reports every image once and returns no photos when the batch cannot be resolved", async () => {
  const deps = setup([row("v1", "i1")]);
  const failure = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" };
  deps.images.resolve.mockResolvedValueOnce(err(failure));
  expect(await findVariantPhotos([variant("v1")], deps)).toEqual(ok(new Map()));
  expect(deps.images.report).toHaveBeenCalledWith([{ imageId: image("i1"), ...failure }]);
});

test("returns the variant query failure", async () => {
  const deps = setup([]);
  const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" });
  deps.findVariantImages.mockResolvedValueOnce(failure);
  expect(await findVariantPhotos([variant("v1")], deps)).toEqual(failure);
  expect(deps.images.resolve).not.toHaveBeenCalled();
});

test("asks for nothing when there are no variants", async () => {
  const deps = setup([]);
  expect(await findVariantPhotos([], deps)).toEqual(ok(new Map()));
  expect(deps.findVariantImages).not.toHaveBeenCalled();
  expect(deps.images.resolve).not.toHaveBeenCalled();
  expect(deps.images.report).not.toHaveBeenCalled();
});
