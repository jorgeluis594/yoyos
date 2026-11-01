// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, test } from "vitest";
import resources from "@core/app/locales";
import ProductList from "@core/app/routes/product-list";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });

const item = (n: number, name: string, hidden: boolean) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, name, hidden, variantCount: 1, activeVariantCount: 1, sku: `SKU${n}`,
  minSalePrice: { amount: 10, currency: "PEN" as const }, hasDifferentPrices: false, totalStock: 4,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.body.appendChild(document.createElement("div")); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

test("the list shows the Oculto badge with an eye-off icon for a hidden product", async () => {
  const list = { items: [item(1, "Casaca jean", true), item(2, "Polo básico", false)], page: 1, pageSize: 20, total: 2 };
  const router = createMemoryRouter([{ path: "/es-PE/products", element: <ProductList />, loader: () => ({ list, search: "", base: "/es-PE/products" }) }], { initialEntries: ["/es-PE/products"] });
  await act(async () => { root.render(<I18nextProvider i18n={i18n}><RouterProvider router={router} /></I18nextProvider>); });
  const rows = [...container.querySelectorAll("tbody tr")];
  const jacket = rows.find((row) => row.textContent?.includes("Casaca jean"))!;
  const polo = rows.find((row) => row.textContent?.includes("Polo básico"))!;
  expect(jacket.textContent).toContain("Oculto");
  expect(jacket.querySelector("svg.lucide-eye-off")).not.toBeNull();
  const link = jacket.querySelector("a")!;
  expect(container.querySelector(`#${link.getAttribute("aria-describedby")}`)?.textContent).toBe("Oculto");
  expect(polo.querySelector("a")!.hasAttribute("aria-describedby")).toBe(false);
  expect(polo.textContent).not.toContain("Oculto");
});
