import { expect, test, vi } from "vitest";
import { listProducts, type ListPage, type ProductSummary } from "@core/src/features/products/application/list";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import { err, ok } from "@shared/functional";

const output: ListPage = { items: [], page: 1, pageSize: 20, total: 0 };
const noImage = async () => ok(null);
const summary = (id: string, imageId?: string): ProductSummary => ({
  id: id as ProductId, name: id, variantCount: 1, minSalePrice: { amount: 10, currency: "PEN" }, hasDifferentPrices: false, totalStock: 2,
  ...(imageId === undefined ? {} : { imageId: imageId as ImageId }),
});

test("normalizes search and pagination without changing the input", async () => {
  const list = vi.fn(async () => ok(output));
  const input = Object.freeze({ search: "  blue  shirt  " });
  expect(await listProducts(input, { repository: { list }, resolveImage: noImage })).toEqual({ success: true, data: output });
  expect(list).toHaveBeenCalledWith({ search: "blue  shirt", page: 1, pageSize: 20 });
  await listProducts({ search: "  " }, { repository: { list }, resolveImage: noImage });
  expect(list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
});

test("rejects invalid explicit criteria before querying", async () => {
  const list = vi.fn(async () => ok(output));
  for (const input of [
    { page: 0, pageSize: 101 }, { page: 1.5 }, { pageSize: NaN },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 }, { search: 12 as unknown as string },
  ]) {
    expect(await listProducts(input, { repository: { list }, resolveImage: noImage })).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
  }
  expect(list).not.toHaveBeenCalled();
});

test("attaches resolved thumbnails and omits unavailable ones without failing the listing", async () => {
  const page: ListPage = { ...output, total: 4, items: [summary("plain"), summary("shown", "img-ok"), summary("missing", "img-missing"), summary("broken", "img-broken")] };
  const resolveImage = vi.fn(async (id: ImageId) => id === "img-ok" ? ok({ id, url: "https://cdn.example/ok.webp" })
    : id === "img-missing" ? ok(null) : err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" }));
  const result = await listProducts({}, { repository: { list: async () => ok(page) }, resolveImage });
  expect(result).toMatchObject({ success: true, data: { total: 4 } });
  if (!result.success) return;
  expect(result.data.items.map((item) => item.image ?? null)).toEqual([null, { id: "img-ok", url: "https://cdn.example/ok.webp" }, null, null]);
  expect(result.data.items.every((item) => !("imageId" in item))).toBe(true);
});

test("propagates repository failures", async () => {
  const failure = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" };
  expect(await listProducts({}, { repository: { list: async () => err(failure) }, resolveImage: noImage })).toEqual({ success: false, error: failure });
});
