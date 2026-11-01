// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import ProductDetail from "@core/app/routes/product-detail";
import type { ProductDetailResponse } from "@shared/contracts/products";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const product = (hidden: boolean): ProductDetailResponse["product"] => ({
  id: id(50), name: "Casaca jean", description: null, hidden, photos: [], currency: "PEN", qrCode: id(51), createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z", structureVersion: 1,
  options: [], variants: [{ id: id(60), combination: [], sku: null, salePrice: { amount: 10, currency: "PEN" }, purchasePrice: null, qrCode: id(70), status: "active", stock: 0, hasOrders: false }],
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  container = document.body.appendChild(document.createElement("div")); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function open(loaded: { hidden: boolean; saved: boolean; catalogEmptied: boolean }) {
  const data = { product: product(loaded.hidden), catalog: "/es-PE/products", saved: loaded.saved, catalogEmptied: loaded.catalogEmptied, variantDeleted: false };
  const router = createMemoryRouter([{ path: "/es-PE/products/:productId", element: <ProductDetail />, loader: () => data }], { initialEntries: [`/es-PE/products/${id(50)}`] });
  await act(async () => { root.render(<I18nextProvider i18n={i18n}><RouterProvider router={router} /></I18nextProvider>); });
}
const status = () => container.querySelector('[role="status"]')?.textContent ?? "";
const hideSwitch = () => container.querySelector<HTMLButtonElement>('button[role="switch"]')!;

test("the saved message adds the last-visible notice after Producto guardado correctamente when the catalog was emptied", async () => {
  await open({ hidden: true, saved: true, catalogEmptied: true });
  expect(status()).toBe("Producto guardado correctamente. Tu catálogo publicado se quedó sin productos visibles. Tus clientes verán la tienda vacía.");
  expect(hideSwitch().getAttribute("aria-checked")).toBe("true");
});

test("creating a hidden product opens its page with the switch on and no last-visible notice", async () => {
  await open({ hidden: true, saved: false, catalogEmptied: false });
  expect(hideSwitch().getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).not.toContain("sin productos visibles");
  await open({ hidden: true, saved: true, catalogEmptied: false });
  expect(status()).toBe("Producto guardado correctamente.");
});
