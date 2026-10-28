import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import { findCatalogProduct } from "@core/src/features/products/application/catalog-products";
import type { ListImageDependencies } from "@core/src/features/products/application/list";
import type { StoredCatalogProduct } from "@core/src/features/products/domain/catalog-product";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";

const image = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` as ImageId;
const stored = (photoIds: readonly ImageId[]): StoredCatalogProduct => ({
  id: "p1" as ProductId, name: "Polo", description: null, photoIds, currency: "PEN", options: [],
  variants: [{ id: "v1" as VariantId, attributes: {}, salePrice: 30, stock: 2 }],
});
const dependencies = (urls: Record<string, string>, photoIds: readonly ImageId[]) => {
  const report = vi.fn();
  const images: ListImageDependencies = {
    resolve: async (ids) => ok({ images: ids.flatMap((id) => urls[id] ? [{ id, url: urls[id] }] : []), failures: ids.filter((id) => !urls[id]).map((imageId) => ({ imageId, code: "IMAGE_STORAGE_UNAVAILABLE", message: "down" })) }),
    report,
  };
  return { deps: { repository: { list: async () => ok({ rows: [], hasMore: false }), find: async () => ok(stored(photoIds)) }, images }, report };
};

test("the catalog product keeps photo order and drops a photo whose URL cannot be resolved", async () => {
  const [a, b, c] = [image(1), image(2), image(3)];
  const { deps, report } = dependencies({ [a]: "https://img.test/a.jpg", [c]: "https://img.test/c.jpg" }, [c, b, a]);
  const found = await findCatalogProduct("p1" as ProductId, "PEN", deps);
  expect(found).toMatchObject({ success: true, data: { photoUrls: ["https://img.test/c.jpg", "https://img.test/a.jpg"] } });
  expect(report).toHaveBeenCalledWith([{ imageId: b, code: "IMAGE_STORAGE_UNAVAILABLE", message: "down" }]);
});

test("a catalog product without photos has no photo URLs and resolves nothing", async () => {
  const { deps, report } = dependencies({}, []);
  expect(await findCatalogProduct("p1" as ProductId, "PEN", deps)).toMatchObject({ success: true, data: { photoUrls: [] } });
  expect(report).not.toHaveBeenCalled();
});
