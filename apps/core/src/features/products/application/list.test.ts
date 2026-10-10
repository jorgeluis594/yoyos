import { expect, test, vi } from "vitest";
import { listProducts, type ListImageDependencies, type ListPage, type ProductSummary } from "@core/src/features/products/application/list";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import { err, ok } from "@shared/functional";

const output: ListPage = { items: [], page: 1, pageSize: 20, total: 0 };
const summary = (id: string, imageId?: string): ProductSummary => ({
  id: id as ProductId, name: id, variantCount: 1, minSalePrice: { amount: 10, currency: "PEN" }, hasDifferentPrices: false, totalStock: 2,
  ...(imageId === undefined ? {} : { imageId: imageId as ImageId }),
});

test("normalizes search and pagination without changing the input", async () => {
  const list = vi.fn(async () => ok(output));
  const input = Object.freeze({ search: "  blue  shirt  " });
  expect(await listProducts(input, { repository: { list } })).toEqual({ success: true, data: output });
  expect(list).toHaveBeenCalledWith({ search: "blue  shirt", sort: "recent", page: 1, pageSize: 20 });
  await listProducts({ search: "  " }, { repository: { list } });
  expect(list).toHaveBeenLastCalledWith({ sort: "recent", page: 1, pageSize: 20 });
});

test("passes explicit stock filter and sort", async () => {
  const list = vi.fn(async () => ok(output));
  await listProducts({ stock: "sold_out", sort: "name", page: 2 }, { repository: { list } });
  expect(list).toHaveBeenCalledWith({ stock: "sold_out", sort: "name", page: 2, pageSize: 20 });
});

test("rejects invalid explicit criteria before querying", async () => {
  const list = vi.fn(async () => ok(output));
  for (const input of [
    { page: 0, pageSize: 101 }, { page: 1.5 }, { pageSize: NaN },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 }, { search: 12 as unknown as string },
    { stock: "low" as unknown as "in_stock" }, { sort: "price" as unknown as "name" },
  ]) {
    expect(await listProducts(input, { repository: { list } })).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
  }
  expect(list).not.toHaveBeenCalled();
});

const imagePage: ListPage = { ...output, total: 5, items: [summary("plain"), summary("shown", "img-ok"), summary("shared", "img-ok"), summary("missing", "img-missing"), summary("private", "img-private")] };

test("returns items without thumbnails when images are not requested", async () => {
  const result = await listProducts({}, { repository: { list: async () => ok(imagePage) } });
  expect(result).toMatchObject({ success: true, data: { total: 5 } });
  if (!result.success) return;
  expect(result.data.items.every((item) => !("image" in item) && !("imageId" in item))).toBe(true);
});

test("resolves every thumbnail with one batch lookup and reports failures once with their kind", async () => {
  const images: ListImageDependencies = {
    resolve: vi.fn(async () => ok({
      images: [{ id: "img-ok" as ImageId, url: "https://cdn.example/ok.webp" }],
      failures: [{ imageId: "img-private" as ImageId, code: "PRIVATE_IMAGE", message: "private" }],
    })),
    report: vi.fn(),
  };
  const result = await listProducts({}, { repository: { list: async () => ok(imagePage) }, images });
  expect(images.resolve).toHaveBeenCalledOnce();
  expect(images.resolve).toHaveBeenCalledWith(["img-ok", "img-missing", "img-private"]);
  expect(images.report).toHaveBeenCalledOnce();
  expect(images.report).toHaveBeenCalledWith([{ imageId: "img-private", code: "PRIVATE_IMAGE", message: "private" }]);
  expect(result).toMatchObject({ success: true, data: { total: 5 } });
  if (!result.success) return;
  const shown = { id: "img-ok", url: "https://cdn.example/ok.webp" };
  expect(result.data.items.map((item) => item.image ?? null)).toEqual([null, shown, shown, null, null]);
  expect(result.data.items.every((item) => !("imageId" in item))).toBe(true);
});

test("keeps the listing when the batch lookup fails and reports it once", async () => {
  const failure = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" };
  const images: ListImageDependencies = { resolve: vi.fn(async () => err(failure)), report: vi.fn() };
  const result = await listProducts({}, { repository: { list: async () => ok(imagePage) }, images });
  expect(result).toMatchObject({ success: true, data: { total: 5 } });
  if (!result.success) return;
  expect(result.data.items.every((item) => !("image" in item))).toBe(true);
  expect(images.report).toHaveBeenCalledOnce();
  expect(images.report).toHaveBeenCalledWith(["img-ok", "img-missing", "img-private"].map((imageId) => ({ imageId, ...failure })));
});

test("skips the image lookup and report when no listed product has an image", async () => {
  const images: ListImageDependencies = { resolve: vi.fn(), report: vi.fn() };
  await listProducts({}, { repository: { list: async () => ok({ ...output, total: 1, items: [summary("plain")] }) }, images });
  expect(images.resolve).not.toHaveBeenCalled();
  expect(images.report).not.toHaveBeenCalled();
});

test("propagates repository failures", async () => {
  const failure = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" };
  expect(await listProducts({}, { repository: { list: async () => err(failure) } })).toEqual({ success: false, error: failure });
});
