import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import { err, ok } from "@shared/functional";
import { loader } from "@core/app/routes/catalog";
import { loader as productLoader } from "@core/app/routes/catalog-product";
import { catalogBrowse } from "@core/src/features/catalog/browse-composition";

vi.mock("@core/src/shared/infrastructure/logger", async (importOriginal) => ({
  ...await importOriginal<typeof import("@core/src/shared/infrastructure/logger")>(), bindRequestOperation: vi.fn(),
}));

const companyId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const args = (params: Record<string, string>, search = "") => ({ params, request: new Request(`http://localhost/catalogo/${params.companyId}${search}`) }) as unknown as LoaderFunctionArgs;
afterEach(() => vi.restoreAllMocks());
beforeEach(() => { vi.spyOn(catalogBrowse, "appearance").mockResolvedValue(null); });

test("a malformed link and a hidden catalog are unavailable, and a failed read is a load error, never an empty catalog", async () => {
  const browse = vi.spyOn(catalogBrowse, "browse").mockResolvedValue(err({ code: "CATALOG_UNAVAILABLE", message: "hidden" }));
  await expect(loader(args({ companyId: "not-a-uuid" }))).rejects.toMatchObject({ init: { status: 404 } });
  await expect(loader(args({ companyId }))).rejects.toMatchObject({ init: { status: 404 } });
  browse.mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
  await expect(loader(args({ companyId }))).rejects.toMatchObject({ init: { status: 503 } });

  browse.mockResolvedValue(ok({ storeName: "Moda Lucía", items: [], hasMore: false }));
  expect(await loader(args({ companyId }, "?q=%20polo%20&page=2"))).toMatchObject({ data: { storeName: "Moda Lucía", q: "polo", pages: 2 } });
  expect(browse).toHaveBeenLastCalledWith({ search: "polo", pages: 2 }, { companyId });
  await loader(args({ companyId }, "?q=p&page=-1"));
  expect(browse).toHaveBeenLastCalledWith({ search: null, pages: 1 }, { companyId });
  await loader(args({ companyId }, "?page=21"));
  expect(browse).toHaveBeenLastCalledWith({ search: null, pages: 20 }, { companyId });
});

test("a missing product shows the product message while a hidden catalog shows the catalog one", async () => {
  const getProduct = vi.spyOn(catalogBrowse, "getProduct").mockResolvedValue(err({ code: "PRODUCT_UNAVAILABLE", message: "gone" }));
  await expect(productLoader(args({ companyId, productId }))).rejects.toMatchObject({ data: "product", init: { status: 404 } });
  await expect(productLoader(args({ companyId, productId: "bad" }))).rejects.toMatchObject({ data: "product", init: { status: 404 } });
  expect(getProduct).toHaveBeenLastCalledWith(null, { companyId });
  getProduct.mockResolvedValue(err({ code: "CATALOG_UNAVAILABLE", message: "hidden" }));
  await expect(productLoader(args({ companyId, productId }))).rejects.toMatchObject({ data: null, init: { status: 404 } });
  await expect(productLoader(args({ companyId, productId: "bad" }))).rejects.toMatchObject({ data: null, init: { status: 404 } });
});
