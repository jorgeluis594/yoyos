// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import type { ProductDetailResponse } from "@shared/contracts/products";
import type { VariantOutcome } from "@core/src/features/products/presentation/variant-detail-model";
import { VariantDetail, type VariantDetailProps } from "@core/src/features/products/presentation/variant-detail";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const [talla, color, l, m, azul] = [1, 2, 3, 4, 5].map(id);
const variants = (override: Partial<ProductDetailResponse["product"]["variants"][number]> = {}) => [
  { id: id(60), combination: [{ optionId: talla, valueId: l }, { optionId: color, valueId: azul }], sku: "POLO-L", salePrice: money(42.9), purchasePrice: money(21), qrCode: id(70), status: "active", stock: 6, hasOrders: false, ...override },
  { id: id(61), combination: [{ optionId: talla, valueId: m }, { optionId: color, valueId: azul }], sku: null, salePrice: money(39.9), purchasePrice: null, qrCode: id(71), status: "active", stock: 0, hasOrders: false },
];
const product = (override = {}): ProductDetailResponse["product"] => ({
  id: id(50), name: "Polo básico", description: null, photos: [], currency: "PEN", qrCode: id(51), createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z", structureVersion: 1,
  options: [{ id: talla, name: "Talla", values: [{ id: l, name: "L" }, { id: m, name: "M" }] }, { id: color, name: "Color", values: [{ id: azul, name: "Azul" }] }],
  variants: variants(override),
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.body.appendChild(document.createElement("div")); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

function mount(override = {}, props: Partial<VariantDetailProps> = {}) {
  const detail = product(override);
  const router = createMemoryRouter([{ path: "/products/:productId/variants/:variantId", element:
    <VariantDetail product={detail} variant={detail.variants[0]} productHref={`/products/${detail.id}`} outcome={undefined} pending={null} onSubmit={() => undefined} onReload={() => undefined} {...props} /> }],
  { initialEntries: [`/products/${detail.id}/variants/${detail.variants[0].id}`] });
  act(() => root.render(<I18nextProvider i18n={i18n}><RouterProvider router={router} /></I18nextProvider>));
}
const button = (name: string) => [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name)!;
const click = (element: Element) => act(() => (element as HTMLElement).click());
const field = (label: string) => [...document.querySelectorAll<HTMLInputElement>("input")].find((input) => document.querySelector(`label[for="${input.id}"]`)?.textContent?.startsWith(label))!;

test("shows the combination, prices with two decimals, read-only stock, QR and the sibling list with the current one marked", () => {
  mount();
  expect(container.querySelector("h1")?.textContent).toBe("L / Azul");
  expect(container.textContent).toContain("Variante de Polo básico");
  expect(field("Precio de venta").value).toBe("42.90");
  expect(field("Precio de compra").value).toBe("21.00");
  expect(field("Stock").readOnly).toBe(true);
  expect(container.querySelector("svg[role=img] path")?.getAttribute("d")).toMatch(/^M4 4h1v1h-1z/);
  expect(container.querySelector("[aria-current=page]")?.textContent).toContain("L / Azul");
  expect(container.querySelector<HTMLAnchorElement>("a[href$='/variants/" + id(61) + "']")?.textContent).toContain("M / Azul");
});

test("offers deleting only when nothing blocks it and otherwise says why, in the order core checks", () => {
  mount({ hasOrders: true });
  expect(container.textContent).toContain("Tiene pedidos, por eso no se puede eliminar.");
  expect(button("Eliminar variante")).toBeUndefined();
  act(() => root.unmount()); root = createRoot(container);
  mount({ stock: 6 });
  expect(container.textContent).toContain("Tiene 6 unidades en stock, por eso no se puede eliminar.");
  act(() => root.unmount()); root = createRoot(container);
  mount({ stock: 0 });
  expect(button("Eliminar variante")).toBeDefined();
});

test("asks before deactivating, warns about the stock and sends the status change", () => {
  const onSubmit = vi.fn();
  mount({}, { onSubmit });
  click(button("Desactivar variante"));
  expect(document.body.textContent).toContain("¿Desactivar L / Azul?");
  expect(document.body.textContent).toContain("Todavía tiene 6 unidades en stock.");
  click(button("Desactivar"));
  expect(onSubmit).toHaveBeenCalledWith({ intent: "status", status: "inactive" });
});

test("shows the in-progress text and disables every action while one waits", () => {
  mount({}, { pending: "status", pendingStatus: "inactive" });
  expect(button("Desactivando…").disabled).toBe(true);
  expect(button("Guardar cambios").disabled).toBe(true);
  expect(button("Cambiar combinación").disabled).toBe(true);
});

test("a deactivated variant shows its notice and offers Activar variante", () => {
  const onSubmit = vi.fn();
  mount({ status: "inactive" }, { onSubmit });
  expect(container.textContent).toContain("Variante desactivada. No aparece en tu tienda ni al crear pedidos.");
  click(button("Activar variante"));
  expect(onSubmit).toHaveBeenCalledWith({ intent: "status", status: "active" });
});

test("sends the edited prices and SKU and places the rejection next to its field", () => {
  const onSubmit = vi.fn();
  mount({}, { onSubmit, outcome: { intent: "update", failed: true, errors: { sku: "Este SKU ya lo usa otra variante." } } });
  expect(container.textContent).toContain("Este SKU ya lo usa otra variante.");
  expect(field("SKU").getAttribute("aria-invalid")).toBe("true");
  const input = field("Precio de venta");
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "45"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(container.textContent).not.toContain("Este SKU ya lo usa otra variante.");
  click(button("Guardar cambios"));
  expect(onSubmit).toHaveBeenCalledWith({ intent: "update", sku: "POLO-L", salePrice: 45, purchasePrice: 21 });
});

test("Imprimir opens the browser print dialog with the label and does not print a label that does not fit", () => {
  const print = vi.fn();
  vi.stubGlobal("print", print);
  mount();
  const label = container.querySelector("#variant-label")!;
  expect(label.textContent).toContain("Polo básico");
  expect(label.textContent).toContain("L / Azul");
  expect(label.textContent).toContain("POLO-L");
  click(button("Imprimir"));
  expect(print).toHaveBeenCalledOnce();
  for (const element of label.querySelectorAll("div")) Object.defineProperty(element, "scrollHeight", { value: 99, configurable: true });
  click(button("Imprimir"));
  expect(print).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("El contenido no cabe completo en esta etiqueta.");
});

const openCombination = () => click(button("Cambiar combinación"));
const dialogText = () => document.querySelector("[role=dialog]")?.textContent ?? "";

test("the combination dialog names the value that is left without variants and drops the line when it is kept", () => {
  mount();
  openCombination();
  expect(dialogText()).not.toContain("se quitará");
  const select = document.querySelector<HTMLSelectElement>(`#combination-${talla}`)!;
  act(() => { select.value = m; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(dialogText()).toContain("«L» se quitará de Talla porque no le quedan variantes.");
  act(() => { select.value = l; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(dialogText()).not.toContain("se quitará");
});

let answer: (outcome: VariantOutcome | undefined) => void = () => undefined;
function Harness({ onReload }: Readonly<{ onReload: () => void }>) {
  const [outcome, setOutcome] = useState<VariantOutcome>();
  useEffect(() => { answer = setOutcome; }, []);
  const detail = product();
  return <VariantDetail product={detail} variant={detail.variants[0]} productHref="/p" outcome={outcome} pending={null} onSubmit={() => undefined} onReload={onReload} />;
}
function mountHarness(onReload = () => undefined) {
  const router = createMemoryRouter([{ path: "/p", element: <Harness onReload={onReload} /> }], { initialEntries: ["/p"] });
  act(() => root.render(<I18nextProvider i18n={i18n}><RouterProvider router={router} /></I18nextProvider>));
}
const fail = (errors: object): VariantOutcome => ({ intent: "combination", failed: true, errors });

test("offline, in-doubt and form failures of the combination show inside the dialog, with a way to reload when in doubt", () => {
  const onReload = vi.fn();
  mountHarness(onReload);
  openCombination();
  act(() => answer(fail({ form: "No se pudo cambiar la combinación. Revisa tu conexión e inténtalo otra vez." })));
  expect(dialogText()).toContain("No se pudo cambiar la combinación. Revisa tu conexión e inténtalo otra vez.");
  act(() => answer(fail({ inDoubt: "No se pudo confirmar el cambio. Recarga la variante para ver su combinación." })));
  expect(dialogText()).toContain("No se pudo confirmar el cambio.");
  click([...document.querySelectorAll("[role=dialog] button")].find((candidate) => candidate.textContent === "Recargar variante")!);
  expect(onReload).toHaveBeenCalledOnce();
});

test("a rejection of the combination disappears when the seller changes a selector or reopens the dialog", () => {
  mountHarness();
  openCombination();
  act(() => answer(fail({ combination: "Ya existe la variante M / Azul. Elige otra combinación." })));
  expect(dialogText()).toContain("Ya existe la variante M / Azul.");
  const select = document.querySelector<HTMLSelectElement>(`#combination-${talla}`)!;
  act(() => { select.value = m; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(dialogText()).not.toContain("Ya existe la variante");
  act(() => answer(fail({ combination: "Otra vez." })));
  expect(dialogText()).toContain("Otra vez.");
  click([...document.querySelectorAll("[role=dialog] button")].find((candidate) => candidate.textContent === "Cancelar")!);
  openCombination();
  expect(dialogText()).not.toContain("Otra vez.");
});

test("a combination failure does not come back as a page notice after Cancelar", () => {
  mountHarness();
  openCombination();
  act(() => answer(fail({ form: "No se pudo cambiar la combinación. Revisa tu conexión e inténtalo otra vez." })));
  expect(dialogText()).toContain("No se pudo cambiar la combinación.");
  click([...document.querySelectorAll("[role=dialog] button")].find((candidate) => candidate.textContent === "Cancelar")!);
  expect(document.querySelector("[role=dialog]")).toBeNull();
  expect(document.body.textContent).not.toContain("No se pudo cambiar la combinación.");
  act(() => answer(fail({ inDoubt: "No se pudo confirmar el cambio. Recarga la variante para ver su combinación." })));
  openCombination();
  click([...document.querySelectorAll("[role=dialog] button")].find((candidate) => candidate.textContent === "Cancelar")!);
  expect(document.body.textContent).not.toContain("No se pudo confirmar el cambio.");
});
