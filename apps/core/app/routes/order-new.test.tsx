// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import OrderNew from "@core/app/routes/order-new";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });

const variantId = "00000000-0000-4000-8000-000000000003";
const products = [{ id: "00000000-0000-4000-8000-000000000002", name: "Polo básico", currency: "PEN", variants: [
  { id: variantId, sku: null, attributes: { Talla: "L", Color: "Azul" }, price: 39.9, stock: 4 },
] }];
let root: Root | undefined;
let container: HTMLDivElement;

afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); vi.unstubAllGlobals(); });

test("a sale with a variant that was deactivated meanwhile marks the item with its combination as «L / Azul»", async () => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const Stub = createRoutesStub([{
    path: "/orders/new", Component: OrderNew,
    loader: () => ({ products, base: "/es-PE/orders", settings: null }),
    action: () => ({ code: "VARIANT_NOT_FOUND", error: "Uno de los productos ya no está disponible.", variantId }),
  }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub initialEntries={["/orders/new"]} /></I18nextProvider>));
  const named = (name: string) => [...container.querySelectorAll("button")].find((element) => element.getAttribute("aria-label") === name || element.textContent?.startsWith(name))!;

  await vi.waitFor(() => expect(container.textContent).toContain("L · Azul · Stock: 4"));
  await act(async () => { named("Agregar Polo básico").click(); });
  expect(container.textContent).toContain("L · Azul · 39.90 PEN");
  await act(async () => { named("Guardar pedido").click(); });

  await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe("L / Azul ya no está disponible. Quítalo para continuar."));
});
