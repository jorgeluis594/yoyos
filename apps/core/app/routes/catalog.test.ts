import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RouterContextProvider, type LoaderFunctionArgs } from "react-router";
import { err, ok } from "@shared/functional";
import { handle, loader, meta } from "@core/app/routes/catalog";
import { handle as productHandle, loader as productLoader } from "@core/app/routes/catalog-product";
import { colorSchemeOf } from "@core/app/color-scheme";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { catalogBrowse } from "@core/src/features/catalog/browse-composition";
import { catalogLegacy } from "@core/src/features/catalog/composition";
import { middleware as layoutMiddleware } from "@core/app/routes/catalog-layout";
import { loader as legacyLoader } from "@core/app/routes/legacy-catalog-redirect";
import { action as legacyCartAction, loader as legacyCartLoader } from "@core/app/routes/legacy-catalog-cart";
import { storefrontContext, type StorefrontState } from "@core/app/storefront-context";

vi.mock("@core/src/shared/infrastructure/logger", async (importOriginal) => ({
  ...await importOriginal<typeof import("@core/src/shared/infrastructure/logger")>(), bindRequestOperation: vi.fn(),
}));

const companyId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const store = { name: "Moda Lucía", currency: "PEN" as const };
const published: StorefrontState = { kind: "published", companyId: companyId as never, subdomain: "fantasio" as never, store };
const args = (params: Record<string, string>, search = "", state: StorefrontState | null = published) => {
  const context = new RouterContextProvider();
  if (state) context.set(storefrontContext, state);
  return { params, context, request: new Request(`http://fantasio.localhost:3000/${search}`) } as unknown as LoaderFunctionArgs;
};
afterEach(() => vi.restoreAllMocks());
const noche = { logoUrl: null, theme: "noche" } as const;
beforeEach(() => {
  vi.mocked(bindRequestOperation).mockClear();
  vi.spyOn(catalogBrowse, "storeAppearance").mockResolvedValue({ kind: "custom", appearance: noche });
});

test("the grid on fantasio.localhost shows Fantasio products and sends noindex and no-referrer", async () => {
  const browse = vi.spyOn(catalogBrowse, "browse").mockResolvedValue(ok({ storeName: "Moda Lucía", items: [], hasMore: false }));
  const loaded = await loader(args({}, "?q=%20polo%20&page=2"));
  expect(loaded).toMatchObject({ data: { storeName: "Moda Lucía", companyId, q: "polo", pages: 2 }, init: { headers: { "Referrer-Policy": "no-referrer" } } });
  expect(browse).toHaveBeenLastCalledWith({ search: "polo", pages: 2 }, published);
  await loader(args({}, "?q=p&page=-1"));
  expect(browse).toHaveBeenLastCalledWith({ search: null, pages: 1 }, published);
  await loader(args({}, "?page=21"));
  expect(browse).toHaveBeenLastCalledWith({ search: null, pages: 20 }, published);
  expect(meta({ data: { storeName: "Moda Lucía" } } as never)).toContainEqual({ name: "robots", content: "noindex, nofollow" });
});

test("an unavailable storefront and a failed read are never an empty catalog", async () => {
  const browse = vi.spyOn(catalogBrowse, "browse").mockResolvedValue(err({ code: "CATALOG_UNAVAILABLE", message: "hidden" }));
  await expect(loader(args({}, "", { kind: "unavailable" }))).rejects.toMatchObject({ init: { status: 404 } });
  await expect(loader(args({}, "", null))).rejects.toMatchObject({ init: { status: 404 } });
  expect(browse).not.toHaveBeenCalled();
  await expect(loader(args({}))).rejects.toMatchObject({ init: { status: 404 } });
  browse.mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
  await expect(loader(args({}))).rejects.toMatchObject({ init: { status: 503 } });
});

test("a product of another company on Fantasio's host shows the product no longer available with 404", async () => {
  vi.spyOn(catalogBrowse, "getProduct").mockResolvedValue(ok({ kind: "unavailable", storeName: "Moda Lucía" }));
  expect(await productLoader(args({ productId }))).toMatchObject({ data: { kind: "unavailable", storeName: "Moda Lucía", companyId }, init: { status: 404 } });
});

test("/ on the app host keeps redirecting to /es-PE/ and /productos/:id answers the generic 404", async () => {
  const [layout] = layoutMiddleware;
  const run = (path: string) => {
    const context = new RouterContextProvider();
    const next = vi.fn(async () => new Response());
    const request = new Request(`http://localhost:3000${path}`);
    return { next, outcome: Promise.resolve().then(() => layout({ request, params: {}, context, url: new URL(request.url), pattern: path } as never, next)).then(() => null, (thrown: unknown) => thrown as Response) };
  };
  for (const path of ["/?a=1", "/_root.data?a=1"]) {
    const { next, outcome } = run(path);
    const redirect = await outcome;
    expect(redirect).toMatchObject({ status: 308 });
    expect(redirect?.headers.get("Location")).toBe("/es-PE/?a=1");
    expect(next).not.toHaveBeenCalled();
  }
  for (const path of ["/productos/abc", "/productos/abc.data", "/carrito"]) {
    const { next, outcome } = run(path);
    expect(await outcome).toMatchObject({ status: 404 });
    expect(next).not.toHaveBeenCalled();
  }
  const context = new RouterContextProvider();
  context.set(storefrontContext, published);
  const next = vi.fn(async () => new Response("page"));
  await layout({ request: new Request("http://fantasio.localhost:3000/"), params: {}, context } as never, next);
  expect(next).toHaveBeenCalledOnce();
});

test("legacy /catalogo/:id/productos/:pid?x=1 redirects 308 with no-store to the brand product URL with the query", async () => {
  const resolve = vi.spyOn(catalogLegacy, "resolve").mockResolvedValue(ok({ kind: "redirect", subdomain: "fantasio" as never }));
  const response = await legacyLoader({ params: { companyId, productId }, request: new Request(`http://localhost:3000/catalogo/${companyId}/productos/${productId}?x=1`) } as unknown as LoaderFunctionArgs) as Response;
  expect(response.status).toBe(308);
  expect(response.headers.get("Location")).toBe(`http://fantasio.localhost:3000/productos/${productId}?x=1`);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(resolve).toHaveBeenCalledWith(companyId);
  const root = await legacyLoader({ params: { companyId }, request: new Request(`http://localhost:3000/catalogo/${companyId}`) } as unknown as LoaderFunctionArgs) as Response;
  expect(root.headers.get("Location")).toBe("http://fantasio.localhost:3000/");
});

test("legacy product link of another company's product still redirects, and the brand host answers no longer available", async () => {
  const resolve = vi.spyOn(catalogLegacy, "resolve").mockResolvedValue(ok({ kind: "redirect", subdomain: "fantasio" as never }));
  const response = await legacyLoader({ params: { companyId, productId: crypto.randomUUID() }, request: new Request("http://localhost:3000/x") } as unknown as LoaderFunctionArgs) as Response;
  expect(response.status).toBe(308);
  expect(resolve).toHaveBeenCalledTimes(1);
});

test("legacy /catalogo/:id shows Catálogo no disponible when hidden or without subdomain", async () => {
  const resolve = vi.spyOn(catalogLegacy, "resolve").mockResolvedValue(ok({ kind: "unavailable" }));
  const call = (id: string) => legacyLoader({ params: { companyId: id }, request: new Request("http://localhost:3000/catalogo/x") } as unknown as LoaderFunctionArgs);
  await expect(call(companyId)).rejects.toMatchObject({ data: { kind: "catalog_unavailable" }, init: { status: 404 } });
  await expect(call("not-a-uuid")).rejects.toMatchObject({ data: { kind: "catalog_unavailable" }, init: { status: 404 } });
  expect(resolve).toHaveBeenCalledTimes(1);
  resolve.mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
  await expect(call(companyId)).rejects.toMatchObject({ data: { kind: "catalog_load_error" }, init: { status: 503 } });
});

test("legacy cart POST answers CATALOG_UNAVAILABLE", () => {
  expect(legacyCartAction()).toMatchObject({ data: { code: "CATALOG_UNAVAILABLE" }, init: { status: 409, headers: { "Cache-Control": "no-store" } } });
  expect(legacyCartLoader()).toMatchObject({ data: { code: "CATALOG_UNAVAILABLE" }, init: { status: 404 } });
});

test("the catalog loader returns the store appearance and binds how it was resolved on the request log", async () => {
  vi.spyOn(catalogBrowse, "browse").mockResolvedValue(ok({ storeName: "Moda Lucía", items: [], hasMore: false }));
  expect(await loader(args({}))).toMatchObject({ data: { storeName: "Moda Lucía", appearance: noche } });
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
  expect(await productLoader(args({ productId }))).toMatchObject(unavailable);
  expect(bindRequestOperation).toHaveBeenCalledWith({ outcome: "unavailable" });
  expect(await productLoader(args({ productId: "bad" }))).toMatchObject(unavailable);
  expect(getProduct).toHaveBeenLastCalledWith(null, published);
  expect(await productLoader(args({ productId }))).toMatchObject({ init: { headers: { "Referrer-Policy": "no-referrer" } } });
  getProduct.mockResolvedValue(err({ code: "CATALOG_UNAVAILABLE", message: "hidden" }));
  await expect(productLoader(args({ productId }))).rejects.toMatchObject({ data: null, init: { status: 404 } });
  await expect(productLoader(args({ productId: "bad" }, "", { kind: "unavailable" }))).rejects.toMatchObject({ data: null, init: { status: 404 } });
});
