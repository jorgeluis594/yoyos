// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import ProductDetail, { loader as detailLoader } from "@core/app/routes/product-detail";
import ProductNew, { action as createAction } from "@core/app/routes/product-new";
import * as presenter from "@core/src/features/products/presentation/product-presenter";
import { productEditing } from "@core/src/features/products/product-editing";
import type { ProductId } from "@core/src/features/products/domain/product";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });

const createdId = "00000000-0000-4000-8000-000000000002" as ProductId;
const context = { get: () => ({ company: { id: "00000000-0000-4000-8000-000000000001", country: "PE" } }) } as unknown as ActionFunctionArgs["context"];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  container = document.body.appendChild(document.createElement("div")); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const click = (element: Element) => act(() => (element as HTMLElement).click());

test("creating a hidden product opens its page with the switch on and no last-visible notice", async () => {
  const create = vi.spyOn(productEditing, "create").mockResolvedValue({ success: true, data: createdId });
  vi.spyOn(productEditing, "get").mockResolvedValue({ success: true, data: {} } as never);
  vi.spyOn(presenter, "toProductDetailResponse").mockReturnValue({ product: {
    id: createdId, name: "Muestra polo", description: null, hidden: true, photos: [], currency: "PEN", structureVersion: 1, updatedAt: "2026-10-31T00:00:00.000Z",
    options: [], variants: [{ id: "00000000-0000-4000-8000-000000000003", combination: [], sku: null, salePrice: { amount: 10, currency: "PEN" }, purchasePrice: null, qrCode: "q", status: "active", stock: 0, hasOrders: false }],
  } } as never);
  const router = createMemoryRouter([
    { path: "/es-PE/products/new", element: <ProductNew />, loader: () => ({ currency: "PEN", catalog: "/es-PE/products" }), action: (args: ActionFunctionArgs) => createAction({ ...args, context }) },
    { path: "/es-PE/products/:productId", element: <ProductDetail />, loader: (args: LoaderFunctionArgs) => detailLoader({ ...args, context }) },
  ], { initialEntries: ["/es-PE/products/new"] });
  await act(async () => { root.render(<I18nextProvider i18n={i18n}><RouterProvider router={router} /></I18nextProvider>); });

  type(container.querySelector<HTMLInputElement>("#name")!, "Muestra polo");
  type(container.querySelector<HTMLInputElement>("#salePrice")!, "10");
  click(container.querySelector('button[role="switch"]')!);
  await act(async () => { container.querySelector("form")!.requestSubmit(); });
  await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/es-PE/products/${createdId}`));

  expect(create).toHaveBeenCalledWith(expect.objectContaining({ hidden: true }));
  expect(router.state.location.search).toBe("?saved=1");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Producto guardado correctamente.");
  expect(container.textContent).not.toContain("sin productos visibles");
  expect(container.querySelector('button[role="switch"]')!.getAttribute("aria-checked")).toBe("true");
});
