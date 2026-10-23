import { afterEach, expect, test, vi } from "vitest";
import { RouterContextProvider, isRouteErrorResponse } from "react-router";
import { err, ok } from "@shared/functional";
import type { CatalogSubdomain } from "@shared/catalog-subdomain";
import type { CompanyId } from "@shared/identity";
import { catalogBrowse } from "@core/src/features/catalog/browse-composition";
import { catalogStorefront } from "@core/src/features/catalog/composition";
import type { Storefront } from "@core/src/features/catalog/application/resolve-storefront";
import { requestHostContext } from "@core/app/request-host-context";
import { storefrontContext } from "@core/app/storefront-context";
import { documentPath, isStorefrontPath, storefrontMiddleware } from "@core/app/middleware/storefront";

const base = "http://localhost:3000";
const companyId = "00000000-0000-4000-8000-000000000001" as CompanyId;
const published: Storefront = { kind: "published", companyId, subdomain: "fantasio" as CatalogSubdomain, store: { name: "Fantasio", currency: "PEN" } };
const appearance = { logoUrl: null, theme: "noche" as const };
const reply = new Response("next");

/** Runs the middleware for `path` on `hostname`; `thrown` is what it refused with, if anything. */
async function run(path: string, hostname: string | null = "fantasio.localhost") {
  const context = new RouterContextProvider();
  if (hostname) context.set(requestHostContext, hostname);
  const next = vi.fn(async () => reply);
  const request = new Request(`http://${hostname ?? "fantasio.localhost"}:3000${path}`);
  try {
    const response = await storefrontMiddleware({ request, params: {}, context, url: new URL(request.url), pattern: path } as never, next);
    return { response, thrown: null, next, context };
  } catch (thrown) {
    return { response: null, thrown, next, context };
  }
}
const body = (thrown: unknown) => (isRouteErrorResponse(thrown) || (thrown as { data?: unknown }).data !== undefined) ? (thrown as { data: unknown; init?: { status?: number } }) : null;

afterEach(() => vi.restoreAllMocks());
vi.stubEnv("CATALOG_BASE_URL", base);

function resolves(storefront: Storefront) {
  vi.spyOn(catalogBrowse, "storeAppearance").mockResolvedValue({ kind: "custom", appearance });
  return vi.spyOn(catalogStorefront, "resolve").mockResolvedValue(ok(storefront));
}

test("serves only /, /productos/:productId and /carrito on a published store host", async () => {
  resolves(published);
  for (const path of ["/", "/productos/abc", "/carrito", "/productos/abc/"]) expect((await run(path)).next).toHaveBeenCalledOnce();
  for (const path of ["/login", "/settings", "/productos", "/productos/a/b", "/dashboard", "/catalogo/x", "/es-PE/"]) {
    const { thrown, next } = await run(path);
    expect(next).not.toHaveBeenCalled();
    expect(body(thrown)).toMatchObject({ data: { kind: "store_not_found" }, init: { status: 404 } });
  }
});

test("normalizes /_root.data and /productos/:id.data", async () => {
  expect(documentPath("/_root.data")).toBe("/");
  expect(documentPath("/productos/abc.data")).toBe("/productos/abc");
  expect(isStorefrontPath("/_root.data")).toBe(true);
  expect(isStorefrontPath("/productos/abc.data")).toBe(true);
  expect(isStorefrontPath("/login.data")).toBe(false);
  resolves(published);
  expect((await run("/_root.data")).next).toHaveBeenCalledOnce();
  expect((await run("/productos/abc.data")).next).toHaveBeenCalledOnce();
  expect(body((await run("/login.data")).thrown)).toMatchObject({ data: { kind: "store_not_found" } });
});

test("lets /__manifest through on a store host without a lookup", async () => {
  const resolve = resolves(published);
  expect((await run("/__manifest")).next).toHaveBeenCalledOnce();
  expect(resolve).not.toHaveBeenCalled();
});

test("throws store_not_found with the store header for /login on a published store host", async () => {
  resolves(published);
  const { thrown } = await run("/login");
  expect(body(thrown)).toMatchObject({ data: { kind: "store_not_found", header: { storeName: "Fantasio", appearance } },
    init: { status: 404, headers: { "Referrer-Policy": "no-referrer" } } });
});

test("throws catalog_unavailable for documents and other paths on an unknown or hidden store host", async () => {
  resolves({ kind: "unavailable" });
  for (const path of ["/", "/productos/abc", "/login", "/settings/catalog"]) {
    const { thrown, next } = await run(path, "no-existe.localhost");
    expect(next).not.toHaveBeenCalled();
    expect(body(thrown)).toMatchObject({ data: { kind: "catalog_unavailable" }, init: { status: 404 } });
  }
});

test("throws catalog_unavailable for an invalid store host such as a.b.localhost", async () => {
  resolves({ kind: "unavailable" });
  expect(body((await run("/", "a.b.localhost")).thrown)).toMatchObject({ data: { kind: "catalog_unavailable" } });
});

test("throws catalog_load_error with 503 for documents and passes /carrito on when the lookup fails", async () => {
  vi.spyOn(catalogStorefront, "resolve").mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
  expect(body((await run("/")).thrown)).toMatchObject({ data: { kind: "catalog_load_error" }, init: { status: 503 } });
  const cart = await run("/carrito");
  expect(cart.next).toHaveBeenCalledOnce();
  expect(cart.context.get(storefrontContext)).toEqual({ kind: "error" });
});

test("lets /carrito through with an unavailable storefront instead of throwing", async () => {
  resolves({ kind: "unavailable" });
  const { response, thrown, context } = await run("/carrito", "no-existe.localhost");
  expect(thrown).toBeNull();
  expect(response).toBe(reply);
  expect(context.get(storefrontContext)).toEqual({ kind: "unavailable" });
});

test("puts the resolved store in the context so the loaders do not read it again", async () => {
  const resolve = resolves(published);
  const { context } = await run("/");
  expect(context.get(storefrontContext)).toEqual(published);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(resolve).toHaveBeenCalledWith({ kind: "store", subdomain: "fantasio" });
});

test("uses the request URL hostname when Express gave none", async () => {
  const resolve = resolves(published);
  await run("/", null);
  expect(resolve).toHaveBeenCalledWith({ kind: "store", subdomain: "fantasio" });
});

test("leaves app host requests untouched", async () => {
  const resolve = resolves(published);
  for (const hostname of ["localhost", "127.0.0.1"]) {
    const { next, context } = await run("/login", hostname);
    expect(next).toHaveBeenCalledOnce();
    expect(context.get(storefrontContext)).toBeNull();
  }
  expect(resolve).not.toHaveBeenCalled();
});
