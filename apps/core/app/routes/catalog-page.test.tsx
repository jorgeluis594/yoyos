// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub, data, RouterContextProvider, type LoaderFunctionArgs } from "react-router";
import { storefrontContext } from "@core/app/storefront-context";
import { ok } from "@shared/functional";
import { catalogBrowse } from "@core/src/features/catalog/browse-composition";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { afterEach, expect, test, vi } from "vitest";
import Catalog, { ErrorBoundary } from "@core/app/routes/catalog";
import CatalogProductPage, { ErrorBoundary as ProductErrorBoundary, loader as productLoader } from "@core/app/routes/catalog-product";

vi.mock("@core/src/shared/infrastructure/logger", async (importOriginal) => ({
  ...await importOriginal<typeof import("@core/src/shared/infrastructure/logger")>(), bindRequestOperation: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const companyId = "00000000-0000-4000-8000-000000000001";
const pen = (amount: number) => ({ amount, currency: "PEN" });
const card = (name: string, extra: object = {}) => ({ id: crypto.randomUUID(), name, imageUrl: null, price: { kind: "single", amount: pen(45) }, soldOut: false, ...extra });
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { vi.restoreAllMocks(); act(() => root?.unmount()); root = undefined; container.remove(); localStorage.clear(); });

async function mount(path: string, routes: Parameters<typeof createRoutesStub>[0]) {
  const Stub = createRoutesStub(routes);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<Stub initialEntries={[path]} />));
}
const button = (name: string) => [...container.querySelectorAll("button")].find((element) => element.textContent === name || element.getAttribute("aria-label") === name)!;
const shows = (text: string) => vi.waitFor(() => expect(container.textContent).toContain(text));

test("catalog page shows cards with initial, «Desde» and «Agotado», and an empty search offers «Borrar búsqueda» back to the empty store", async () => {
  const page = (q: string, items: object[] = [], hasMore = false) => ({ storeName: "Moda Lucía", companyId, appearance: { logoUrl: null, theme: "classic" }, items, hasMore, q, pages: 1 });
  const loader = vi.fn(({ request }: { request: Request }) => page(new URL(request.url).searchParams.get("q") ?? ""));
  loader.mockReturnValueOnce(page("", [
    card("polo básico", { price: { kind: "from", amount: pen(45) } }), card("Casaca negra", { soldOut: true })], true));
  await mount("/", [{ path: "/", Component: Catalog, loader, ErrorBoundary }]);
  await shows("Moda Lucía");
  const cards = [...container.querySelectorAll("li")];
  expect(cards[0].textContent?.replace(/\s/g, " ")).toBe("Ppolo básicoDesde S/ 45.00");
  expect(cards[1].textContent).toContain("Agotado");
  expect(container.querySelector("img")).toBeNull();
  expect([...container.querySelectorAll("a")].some((link) => link.textContent === "Ver más")).toBe(true);

  act(() => root!.unmount());
  container.remove();
  await mount("/?q=polo+rojo", [{ path: "/", Component: Catalog, loader, ErrorBoundary }]);
  await shows('No encontramos productos con "polo rojo"');
  await act(async () => button("Borrar búsqueda").click());
  await shows("Esta tienda todavía no tiene productos publicados");
  expect((container.querySelector("input[type=search]") as HTMLInputElement).value).toBe("");
});

test("an unavailable catalog and a failed load show their own messages, never an empty catalog", async () => {
  const fail = (status: number) => () => { throw data(null, { status }); };
  await mount("/", [{ path: "/", Component: Catalog, loader: fail(404), ErrorBoundary }]);
  await shows("Catálogo no disponible");
  act(() => root!.unmount());
  container.remove();
  await mount("/", [{ path: "/", Component: Catalog, loader: fail(503), ErrorBoundary }]);
  await shows("No pudimos cargar el catálogo. Revisa tu conexión");
  expect(container.querySelector("a")?.textContent).toBe("Reintentar");
  expect(container.textContent).not.toContain("todavía no tiene productos");
});

test("a sold-out variant is not selectable and the quantity stops at the available stock", async () => {
  const variant = (talla: string, amount: number, maxQuantity: number) => ({ id: crypto.randomUUID(), attributes: { Talla: talla, Color: "Negro" }, price: pen(amount), maxQuantity });
  const product = { id: crypto.randomUUID(), name: "Polo básico", description: null, imageUrl: null, price: { kind: "from", amount: pen(45) }, soldOut: false,
    attributes: [{ name: "Color", values: ["Negro"] }, { name: "Talla", values: ["M", "L"] }], variants: [variant("M", 45, 3), variant("L", 49, 0)] };
  await mount(`/productos/${product.id}`, [{ path: "/productos/:productId", Component: CatalogProductPage,
    loader: () => ({ kind: "found", storeName: "Moda Lucía", companyId, appearance: { logoUrl: null, theme: "classic" }, product }) }]);
  await shows("Polo básico");
  expect(button("L · Agotado").disabled).toBe(true);
  await act(async () => button("Negro").click());
  await act(async () => button("M").click());
  for (let index = 0; index < 4; index++) await act(async () => { if (!button("Agregar uno").disabled) button("Agregar uno").click(); });
  expect(container.querySelector("output")!.textContent).toBe("3");
  expect(button("Agregar uno").disabled).toBe(true);
});

test("the product page shows Este producto ya no está disponible inside the store theme with the store name, status 404 and the request outcome unavailable", async () => {
  vi.spyOn(catalogBrowse, "storeAppearance").mockResolvedValue({ kind: "custom", appearance: { logoUrl: null, theme: "noche" } });
  vi.spyOn(catalogBrowse, "getProduct").mockResolvedValue(ok({ kind: "unavailable", storeName: "Moda Lucía" }));
  const productId = crypto.randomUUID();
  const context = new RouterContextProvider();
  context.set(storefrontContext, { kind: "published", companyId: companyId as never, subdomain: "fantasio" as never, store: { name: "Moda Lucía", currency: "PEN" } });
  const loaded = await productLoader({ params: { productId }, context, request: new Request(`http://fantasio.localhost:3000/productos/${productId}`) } as unknown as LoaderFunctionArgs);
  expect(loaded).toMatchObject({ init: { status: 404 } });
  expect(bindRequestOperation).toHaveBeenCalledWith({ outcome: "unavailable" });
  await mount(`/productos/${productId}`, [{ path: "/productos/:productId", Component: CatalogProductPage, ErrorBoundary: ProductErrorBoundary, loader: () => loaded }]);
  await shows("Este producto ya no está disponible");
  expect(container.querySelector('[data-store-theme-id="noche"]')).not.toBeNull();
  expect(container.querySelector('[data-store-part="header"]')?.textContent).toContain("Moda Lucía");
  expect(container.querySelector("a")?.textContent).toBe("Volver al catálogo");
});

test("Catálogo no disponible and the catalog load error render without a theme scope", async () => {
  const fail = (status: number) => () => { throw data(null, { status }); };
  for (const [status, text] of [[404, "Catálogo no disponible"], [503, "No pudimos cargar el catálogo. Revisa tu conexión"]] as const) {
    await mount(`/productos/${crypto.randomUUID()}`, [{ path: "/productos/:productId", Component: CatalogProductPage, ErrorBoundary: ProductErrorBoundary, loader: fail(status) }]);
    await shows(text);
    expect(container.querySelector("[data-store-theme]")).toBeNull();
    expect(container.querySelector("style")).toBeNull();
    act(() => root!.unmount());
    container.remove();
  }
});
