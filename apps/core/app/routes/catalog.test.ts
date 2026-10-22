import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import { err, ok } from "@shared/functional";
import { handle, loader } from "@core/app/routes/catalog";
import { handle as productHandle, loader as productLoader } from "@core/app/routes/catalog-product";
import { colorSchemeOf } from "@core/app/color-scheme";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { catalogBrowse } from "@core/src/features/catalog/browse-composition";

vi.mock("@core/src/shared/infrastructure/logger", async (importOriginal) => ({
  ...await importOriginal<typeof import("@core/src/shared/infrastructure/logger")>(), bindRequestOperation: vi.fn(),
}));

const companyId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const args = (params: Record<string, string>, search = "") => ({ params, request: new Request(`http://localhost/catalogo/${params.companyId}${search}`) }) as unknown as LoaderFunctionArgs;
afterEach(() => vi.restoreAllMocks());
const noche = { logoUrl: null, theme: "noche" } as const;
beforeEach(() => {
  vi.mocked(bindRequestOperation).mockClear();
  vi.spyOn(catalogBrowse, "storeAppearance").mockResolvedValue({ kind: "custom", appearance: noche });
});

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

test("the catalog loader returns the store appearance and binds how it was resolved on the request log", async () => {
  vi.spyOn(catalogBrowse, "browse").mockResolvedValue(ok({ storeName: "Moda Lucía", items: [], hasMore: false }));
  expect(await loader(args({ companyId }))).toMatchObject({ data: { storeName: "Moda Lucía", appearance: noche } });
  expect(bindRequestOperation).toHaveBeenCalledWith({ storeAppearance: "custom", storeTheme: "noche" });
});

test("the catalog page declares the fixed color scheme when the store loaded and the system scheme when unavailable", () => {
  for (const route of [handle, productHandle]) {
    expect(route.colorScheme({ storeName: "Moda Lucía", appearance: noche })).toBe("fixed");
    expect(route.colorScheme(undefined)).toBe("system");
  }
  expect(colorSchemeOf([{ handle, data: { storeName: "Moda Lucía" } }])).toBe("fixed");
  expect(colorSchemeOf([{ handle: productHandle, data: undefined }])).toBe("system");
});

test("a missing product keeps the store inside a 404, while a hidden catalog shows the catalog message", async () => {
  const getProduct = vi.spyOn(catalogBrowse, "getProduct").mockResolvedValue(ok({ kind: "unavailable", storeName: "Moda Lucía" }));
  const unavailable = { data: { kind: "unavailable", storeName: "Moda Lucía", appearance: noche }, init: { status: 404 } };
  expect(await productLoader(args({ companyId, productId }))).toMatchObject(unavailable);
  expect(bindRequestOperation).toHaveBeenCalledWith({ outcome: "unavailable" });
  expect(await productLoader(args({ companyId, productId: "bad" }))).toMatchObject(unavailable);
  expect(getProduct).toHaveBeenLastCalledWith(null, { companyId });
  expect(await productLoader(args({ companyId, productId }))).toMatchObject({ init: { headers: { "Referrer-Policy": "no-referrer" } } });
  getProduct.mockResolvedValue(err({ code: "CATALOG_UNAVAILABLE", message: "hidden" }));
  await expect(productLoader(args({ companyId, productId }))).rejects.toMatchObject({ data: null, init: { status: 404 } });
  await expect(productLoader(args({ companyId, productId: "bad" }))).rejects.toMatchObject({ data: null, init: { status: 404 } });
});
