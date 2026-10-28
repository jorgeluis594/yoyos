// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import { draftFromProduct } from "@shared/product-variants";
import type { ProductDetailResponse } from "@shared/contracts/products";
import { ProductForm, type ProductFormProps } from "@core/src/features/products/presentation/product-form";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const color = id(1), negro = id(2), azul = id(3);
const rojo = id(4);
const threeColors = (): ProductDetailResponse["product"] => {
  const base = product(false);
  return { ...base, options: [{ id: color, name: "Color", values: [{ id: negro, name: "Negro" }, { id: azul, name: "Azul" }, { id: rojo, name: "Rojo" }] }],
    variants: [negro, azul, rojo].map((value, index) => ({ ...base.variants[0], id: id(80 + index), qrCode: id(90 + index), combination: [{ optionId: color, valueId: value }] })) };
};
const product = (blocked: boolean): ProductDetailResponse["product"] => ({
  id: id(50), name: "Polo", description: null, imageId: null, currency: "PEN", qrCode: id(51), createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z", structureVersion: 1,
  options: [{ id: color, name: "Color", values: [{ id: negro, name: "Negro" }, { id: azul, name: "Azul" }] }],
  variants: [negro, azul].map((value, index) => ({
    id: id(60 + index), combination: [{ optionId: color, valueId: value }], sku: null, salePrice: money(10), purchasePrice: null, qrCode: id(70 + index), status: "active",
    stock: blocked && value === azul ? 3 : 0, hasOrders: false,
  })),
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  container = document.body.appendChild(document.createElement("div")); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

function mount(props: Partial<ProductFormProps> = {}) {
  const router = createMemoryRouter([
    { path: "/products/new", element: <><ProductForm currency="PEN" cancelTo="/products" pending={false} onSave={() => undefined} {...props} /><Link to="/products">Salir</Link></> },
    { path: "/products", element: <p>Lista</p> },
  ], { initialEntries: ["/products/new"] });
  act(() => root.render(<I18nextProvider i18n={i18n}><RouterProvider router={router} /></I18nextProvider>));
  return router;
}
const byLabel = (label: string) => container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`) ?? [...container.querySelectorAll<HTMLInputElement>("input")].find((input) => container.querySelector(`label[for="${input.id}"]`)?.textContent?.startsWith(label))!;
const button = (name: string | RegExp, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find((candidate) => name instanceof RegExp ? name.test(candidate.textContent ?? "") || name.test(candidate.getAttribute("aria-label") ?? "") : candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name)!;
const click = (element: Element) => act(() => (element as HTMLElement).click());
function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const press = (element: Element, key: string) => act(() => { element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });

test("the arrows on a value handle move it one place and announce the new position", () => {
  mount();
  click(button("Agregar opciones como talla o color"));
  type(byLabel("Nombre de la opción"), "Talla");
  type(byLabel("Agregar otro valor"), "S");
  type(byLabel("Agregar otro valor"), "M");
  press(button("Mover «S», posición 1 de 2"), "ArrowDown");
  expect([...container.querySelectorAll<HTMLInputElement>("fieldset input")].map((input) => input.value)).toEqual(["M", "S", ""]);
  expect(container.querySelector("[aria-live=polite]")?.textContent).toBe("«S» está en la posición 2 de 2.");
  press(button("Mover «S», posición 2 de 2"), "ArrowDown");
  expect([...container.querySelectorAll<HTMLInputElement>("fieldset input")].map((input) => input.value)).toEqual(["M", "S", ""]);
});

test("removing a value of a saved product marks it with its variants and Deshacer brings it back", () => {
  mount({ draft: draftFromProduct(product(false)) });
  click(button("Editar Color"));
  click(button("Quitar «Azul»"));
  expect(container.textContent).toContain("Azul se eliminará al guardar con 1 variante y su QR");
  expect(container.textContent).toContain("Se eliminará");
  expect(container.textContent).toContain("1 de 100 variantes");
  click(button("Deshacer", container));
  expect(container.textContent).not.toContain("se eliminará al guardar");
  expect(container.textContent).toContain("2 de 100 variantes");
});

test("a value whose variants have stock is not marked and says why", () => {
  mount({ draft: draftFromProduct(product(true)) });
  click(button("Editar Color"));
  click(button("Quitar «Azul»"));
  expect(container.textContent).toContain("No se puede eliminar «Azul»: 1 variante tiene pedidos o stock. Desactívala desde su detalle.");
  expect(container.textContent).not.toContain("se eliminará al guardar");
});

test("leaving a form with changes asks first and Seguir editando keeps what was typed", async () => {
  const router = mount();
  expect(container.textContent).not.toContain("¿Descartar cambios?");
  type(byLabel("Nombre"), "Cuaderno");
  await act(async () => { await router.navigate("/products"); });
  expect(document.body.textContent).toContain("¿Descartar cambios?");
  expect(document.body.textContent).toContain("Se perderán los cambios que no guardaste.");
  click(button("Seguir editando"));
  expect(router.state.location.pathname).toBe("/products/new");
  expect(byLabel("Nombre").value).toBe("Cuaderno");
  await act(async () => { await router.navigate("/products"); });
  click(button("Descartar"));
  expect(router.state.location.pathname).toBe("/products");
});

test("a stale save shows the reload notice and Recargar producto asks before discarding edits", () => {
  let reloaded = 0;
  mount({ draft: draftFromProduct(product(false)), feedback: { errors: { changed: "Este producto cambió desde que lo abriste. Recarga el producto para ver los cambios." }, issues: [] }, onReload: () => { reloaded++; } });
  expect(container.textContent).toContain("Este producto cambió desde que lo abriste.");
  click(button("Recargar producto"));
  expect(reloaded).toBe(1);
  type(byLabel("Nombre"), "Otro");
  click(button("Recargar producto"));
  expect(document.body.textContent).toContain("¿Descartar cambios?");
  expect(reloaded).toBe(1);
  click(button("Descartar"));
  expect(reloaded).toBe(2);
});

const valueInputs = () => [...container.querySelectorAll<HTMLInputElement>("fieldset input")].map((input) => input.value);

test("focus returns to a handle once per keyboard move, so typing elsewhere keeps its focus", () => {
  mount();
  click(button("Agregar opciones como talla o color"));
  const name = byLabel("Nombre de la opción");
  type(name, "Talla");
  type(byLabel("Agregar otro valor"), "S");
  type(byLabel("Agregar otro valor"), "M");
  press(button("Mover «S», posición 1 de 2"), "ArrowDown");
  act(() => name.focus());
  type(name, "Tallas");
  expect(document.activeElement).toBe(name);
});

test("a keyboard move counts only the values that are not marked for removal", () => {
  mount({ draft: draftFromProduct(threeColors()) });
  click(button("Editar Color"));
  click(button("Quitar «Negro»"));
  press(button("Mover «Azul», posición 1 de 2"), "ArrowDown");
  expect(valueInputs()).toEqual(["Rojo", "Azul", ""]);
});

test("the selection bar removes the selected combinations that are not saved yet and hides Quitar for saved ones", () => {
  mount();
  click(button("Agregar opciones como talla o color"));
  type(byLabel("Nombre de la opción"), "Talla");
  type(byLabel("Agregar otro valor"), "S");
  type(byLabel("Agregar otro valor"), "M");
  click(button("Listo"));
  click(button("S", container.querySelector("[role=group]")!));
  click(button("Quitar", container.querySelector("[role=toolbar]")!));
  expect(container.textContent).toContain("Se quitará");
  expect(container.textContent).toContain("1 de 100 variantes");
  expect(container.querySelector("[role=toolbar]")).toBeNull();
});

test("Deshacer on a combination marked «Se quitará» brings the row back, selectable and counted again", () => {
  mount();
  click(button("Agregar opciones como talla o color"));
  type(byLabel("Nombre de la opción"), "Talla");
  type(byLabel("Agregar otro valor"), "S");
  type(byLabel("Agregar otro valor"), "M");
  click(button("Listo"));
  click(button("S", container.querySelector("[role=group]")!));
  click(button("Quitar", container.querySelector("[role=toolbar]")!));
  const marked = container.querySelector("tr[data-removal]")!;
  expect(marked.textContent).toContain("Se quitará");
  expect(marked.querySelector<HTMLInputElement>("input[type=checkbox]")!.disabled).toBe(true);
  expect(container.textContent).toContain("1 de 100 variantes");

  click(button("Deshacer", marked));
  expect(container.querySelector("tr[data-removal]")).toBeNull();
  expect(container.textContent).not.toContain("Se quitará");
  expect(container.textContent).toContain("2 de 100 variantes");
  expect(container.querySelectorAll<HTMLInputElement>("tbody input[type=checkbox]:not(:disabled)")).toHaveLength(2);
});

test("a selection of saved variants has no Quitar and cannot edit stock", () => {
  mount({ draft: draftFromProduct(product(false)) });
  click(button("Negro", container.querySelector("[role=group]")!));
  const toolbar = container.querySelector("[role=toolbar]")!;
  expect(button("Quitar", toolbar)).toBeUndefined();
  expect(button("Editar stock", toolbar).disabled).toBe(true);
});
