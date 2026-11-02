// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, test } from "vitest";
import resources from "@core/app/locales";
import type { ProductDetailResponse } from "@shared/contracts/products";
import ProductVariant from "@core/app/routes/product-variant";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [talla, l, m] = [1, 2, 3].map(id);
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const product: ProductDetailResponse["product"] = {
  id: id(50), name: "Polo", description: null, hidden: false, photos: [], currency: "PEN", qrCode: id(51), createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z", structureVersion: 1,
  options: [{ id: talla, name: "Talla", values: [{ id: l, name: "L" }, { id: m, name: "M" }] }],
  variants: [l, m].map((value, index) => ({ id: id(60 + index), combination: [{ optionId: talla, valueId: value }], sku: null, salePrice: money(10), purchasePrice: null, qrCode: id(70 + index), status: "active", stock: 0, hasOrders: false })),
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.body.appendChild(document.createElement("div")); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

test("the outcome of an action on one variant is not shown on a sibling opened afterwards", async () => {
  const router = createMemoryRouter([{
    path: "/products/:productId/variants/:variantId", Component: ProductVariant,
    loader: ({ params }) => ({ state: "ready", product, variant: product.variants.find((variant) => variant.id === params.variantId), productHref: `/products/${product.id}` }),
    action: () => ({ intent: "update", saved: "Variante guardada" }),
  }], { initialEntries: [`/products/${product.id}/variants/${product.variants[0].id}`] });
  await act(async () => { root.render(<I18nextProvider i18n={i18n}><RouterProvider router={router} /></I18nextProvider>); });
  await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Guardar cambios")!.click(); });
  expect(container.textContent).toContain("Variante guardada");
  await act(async () => { container.querySelector<HTMLAnchorElement>(`a[href$="/variants/${product.variants[1].id}"]`)!.click(); });
  expect(container.querySelector("h1")?.textContent).toBe("M");
  expect(container.textContent).not.toContain("Variante guardada");
});
