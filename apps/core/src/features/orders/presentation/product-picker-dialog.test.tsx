// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, describe, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import { ProductPickerDialog, type PickerChoice } from "@core/src/features/orders/presentation/product-picker-dialog";
import type { CatalogProduct, CatalogSearch, CatalogVariant } from "@core/src/features/orders/presentation/use-catalog-search";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const variant = (n: number, label: string | null, stock: number, price = 120): CatalogVariant =>
  ({ id: id(n), attributes: label ? { Talla: label } : {}, sku: null, price, stock });
const suit: CatalogProduct = { id: id(100), name: "Traje de Príncipe Azul", currency: "PEN",
  variants: [variant(1, "S", 3), variant(2, "M", 5), variant(3, "L", 0)] };
const crown: CatalogProduct = { id: id(101), name: "Corona de Príncipe", currency: "PEN", variants: [variant(4, null, 12, 45)] };
const mixed: CatalogProduct = { id: id(102), name: "Capa", currency: "PEN", variants: [variant(5, "Roja", 2, 45), variant(6, "Azul", 2, 60)] };

const i18n = createInstance();
void i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });

describe("ProductPickerDialog", () => {
  let root: Root | undefined;
  afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

  const search = (over: Partial<CatalogSearch> = {}): CatalogSearch => ({ text: "", inStock: false, status: "ready", products: [suit, crown],
    open: vi.fn(), close: vi.fn(), setText: vi.fn(), setInStock: vi.fn(), retry: vi.fn(), ...over });
  type Props = Partial<Parameters<typeof ProductPickerDialog>[0]>;
  const element = (props: Props) => <I18nextProvider i18n={i18n}>
    <ProductPickerDialog search={search()} quantities={new Map()} createProductHref="/pe/products/new" onAdd={vi.fn()} onClose={vi.fn()} {...props} /></I18nextProvider>;
  async function mount(props: Props = {}) {
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root!.render(element(props)));
  }
  const rerender = (props: Props) => act(async () => root!.render(element(props)));
  const input = () => document.querySelector<HTMLInputElement>("input[role=combobox]")!;
  const press = (key: string) => act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
  // Intl formats money with a no-break space.
  const plain = (value: string | null | undefined) => (value ?? "").replace(/\s/g, " ");
  const bodyText = () => plain(document.body.textContent);
  const button = (name: string) => [...document.querySelectorAll("button")].find((candidate) => plain(candidate.getAttribute("aria-label") ?? candidate.textContent?.trim()) === name);
  const active = () => document.getElementById(input().getAttribute("aria-activedescendant") ?? "");

  test("labels the search field and counts the results", async () => {
    await mount();
    expect(document.querySelector("label")?.textContent).toBe("Buscar producto");
    expect(bodyText()).toContain("2 resultados");
    expect(bodyText()).toContain("Variante única · 12 en stock");
    expect(bodyText()).toContain("3 variantes · elige una para agregar");
    expect(bodyText()).toContain("S/ 120.00");
    expect(bodyText()).not.toContain("Desde S/ 120.00");
  });

  test("keeps the list inside the dialog so a narrow screen never clips the price or Agregar", async () => {
    await mount();
    const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
    expect(dialog.className).toContain("grid-cols-[minmax(0,1fr)]");
    expect(document.querySelector("[role=listbox]")!.parentElement!.className).toContain("overflow-x-hidden");
    expect(dialog.className).toContain("[&_[data-slot=button]]:min-h-touch");
  });

  test("opens the search when mounted and closes it when unmounted", async () => {
    const state = search();
    await mount({ search: state });
    expect(state.open).toHaveBeenCalledTimes(1);
    act(() => root!.unmount()); root = undefined;
    expect(state.close).toHaveBeenCalled();
  });

  test("names a chip with its stock and the units already in the order", async () => {
    await mount({ quantities: new Map([[id(2), 2]]) });
    const chip = button("M, 5 en stock, 2 en el pedido")!;
    expect(chip.textContent).toContain("✓ 2");
    expect(button("S, 3 en stock")).toBeDefined();
  });

  test("adds the price to the chip name when the variants differ in price", async () => {
    await mount({ search: search({ products: [mixed] }) });
    expect(button("Roja, 2 en stock, S/ 45.00")).toBeDefined();
    expect(bodyText()).toContain("Desde S/ 45.00");
  });

  test("adds the highlighted chip with Enter and keeps the picker open", async () => {
    const onAdd = vi.fn(); const onClose = vi.fn();
    await mount({ onAdd, onClose });
    await press("ArrowDown"); await press("ArrowRight"); await press("ArrowRight");
    expect(active()?.getAttribute("aria-label")).toBe("M, 5 en stock");
    await press("Enter");
    expect(onAdd).toHaveBeenCalledWith({ product: suit, variant: suit.variants[1] } satisfies PickerChoice);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
  });

  test("highlights the first chip on Enter over a product with options without adding", async () => {
    const onAdd = vi.fn();
    await mount({ onAdd });
    await press("ArrowDown"); await press("Enter");
    expect(onAdd).not.toHaveBeenCalled();
    expect(active()?.getAttribute("aria-label")).toBe("S, 3 en stock");
  });

  test("adds a product without options on Enter", async () => {
    const onAdd = vi.fn();
    await mount({ onAdd });
    await press("ArrowUp"); await press("Enter");
    expect(onAdd).toHaveBeenCalledWith({ product: crown, variant: crown.variants[0] });
  });

  test("clears the highlight when the search text, the filter or the result set changes", async () => {
    const state = search();
    await mount({ search: state });
    await press("ArrowDown");
    expect(active()).not.toBeNull();
    await rerender({ search: { ...state, text: "pr" } });
    expect(active()).toBeNull();
    await press("ArrowDown");
    await rerender({ search: { ...state, text: "pr", inStock: true } });
    expect(active()).toBeNull();
    await press("ArrowDown");
    await rerender({ search: { ...state, text: "pr", inStock: true, products: [crown, suit] } });
    expect(active()).toBeNull();
  });

  test("announces each addition politely", async () => {
    await mount({ quantities: new Map([[id(2), 1]]) });
    const region = document.querySelector("[role=status]")!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    await act(async () => { button("M, 5 en stock, 1 en el pedido")!.click(); });
    expect(region.textContent).toBe("Agregado: Traje de Príncipe Azul, M. 2 en el pedido.");
    await act(async () => { button("Agregar")!.click(); });
    expect(region.textContent).toBe("Agregado: Corona de Príncipe. 1 en el pedido.");
  });

  test("lets a no-stock chip be added", async () => {
    const onAdd = vi.fn();
    await mount({ onAdd });
    const chip = button("L, Sin stock") as HTMLButtonElement;
    expect(chip.disabled).toBe(false);
    expect(chip.getAttribute("aria-disabled")).toBeNull();
    await act(async () => { chip.click(); });
    expect(onAdd).toHaveBeenCalledWith({ product: suit, variant: suit.variants[2] });
  });

  test("walks product criterion 2: Enter twice leaves one M line with 2 units and Listo · 1 agregado", async () => {
    const lines = new Map<string, number>();
    const onAdd = vi.fn();
    const state = search();
    function Harness() {
      const [quantities, setQuantities] = useState<ReadonlyMap<string, number>>(new Map());
      return <ProductPickerDialog search={state} quantities={quantities} createProductHref="/pe/products/new" onClose={vi.fn()}
        onAdd={(choice) => { onAdd(choice); lines.set(choice.variant.id, (lines.get(choice.variant.id) ?? 0) + 1); setQuantities(new Map(lines)); }} />;
    }
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root!.render(<I18nextProvider i18n={i18n}><Harness /></I18nextProvider>));
    await press("ArrowDown"); await press("ArrowRight"); await press("ArrowRight");
    await press("Enter");
    expect(bodyText()).toContain("Agregado: Traje de Príncipe Azul, M. 1 en el pedido.");
    await press("Enter");
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(onAdd).toHaveBeenNthCalledWith(2, { product: suit, variant: suit.variants[1] });
    const chip = button("M, 5 en stock, 2 en el pedido")!;
    expect(chip.textContent).toContain("✓ 2");
    expect(document.querySelector("[role=status]")!.textContent).toBe("Agregado: Traje de Príncipe Azul, M. 2 en el pedido.");
    expect(button("Listo · 1 agregado")).toBeDefined();
    await act(async () => { button("Agregar")!.click(); });
    expect(button("Listo · 2 agregados")).toBeDefined();
  });

  test("counts the additions in Listo and closes with it", async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    expect(button("Listo")).toBeDefined();
    await act(async () => { button("S, 3 en stock")!.click(); });
    await act(async () => { button("Agregar")!.click(); });
    expect(button("Listo · 2 agregados")).toBeDefined();
    await act(async () => { button("Listo · 2 agregados")!.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("closes with Escape", async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(onClose).toHaveBeenCalled();
  });

  test("passes the typed text and the chosen filter to the search", async () => {
    const state = search();
    await mount({ search: state });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), "prín");
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(state.setText).toHaveBeenCalledWith("prín");
    await act(async () => { button("Con stock")!.click(); });
    expect(state.setInStock).toHaveBeenCalledWith(true);
    expect(button("Todos")!.getAttribute("aria-pressed")).toBe("true");
  });

  test("shows the loading, empty, no-result and too-many states", async () => {
    await mount({ search: search({ status: "loading", products: [] }) });
    expect(bodyText()).toContain("Buscando…");
    await rerender({ search: search({ products: [] }) });
    expect(bodyText()).toContain("Todavía no hay productos");
    const link = document.querySelector("a")!;
    expect(link.textContent).toBe("Crear producto en otra pestaña");
    expect(link.getAttribute("href")).toBe("/pe/products/new");
    expect(link.getAttribute("target")).toBe("_blank");
    await rerender({ search: search({ products: [], text: "capa" }) });
    expect(bodyText()).toContain("No encontramos \"capa\"");
    expect(bodyText()).toContain("Prueba con otro nombre o crea el producto en otra pestaña.");
    const many = Array.from({ length: 20 }, (_, n) => ({ ...crown, id: id(200 + n), variants: [variant(300 + n, null, 1)] }));
    await rerender({ search: search({ products: many }) });
    expect(bodyText()).toContain("Mostrando los primeros 20. Escribe más para afinar la búsqueda.");
  });

  test("shows the retry state and keeps the search when the catalog fails", async () => {
    const state = search({ status: "error", products: [], text: "prín" });
    await mount({ search: state });
    expect(bodyText()).toContain("No se pudo cargar el catálogo.");
    expect(input().value).toBe("prín");
    await act(async () => { button("Reintentar")!.click(); });
    expect(state.retry).toHaveBeenCalledTimes(1);
  });

  test("cannot add a hidden stale result from the keyboard while the catalog failed", async () => {
    const onAdd = vi.fn();
    await mount({ onAdd, search: search({ status: "error", text: "pr" }) });
    expect(document.querySelector("[role=listbox]")).toBeNull();
    await press("ArrowDown"); await press("Enter");
    expect(onAdd).not.toHaveBeenCalled();
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(input().getAttribute("aria-controls")).toBeNull();
  });

  test("keeps interactive controls out of options and points the combobox at an option", async () => {
    await mount();
    const list = document.querySelector("[role=listbox]")!;
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(input().getAttribute("aria-controls")).toBe(list.id);
    expect(document.querySelectorAll("[role=group]")).toHaveLength(2);
    for (const option of list.querySelectorAll("[role=option]")) expect(option.querySelector("button, a, input")).toBeNull();
    for (const group of list.querySelectorAll("[role=group]")) expect(document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent).toMatch(/Príncipe/);
    await press("ArrowDown"); await press("ArrowRight");
    expect(active()?.getAttribute("role")).toBe("option");
    expect(active()?.getAttribute("aria-selected")).toBe("true");
    await press("ArrowDown");
    expect(active()?.getAttribute("role")).toBe("option");
    expect(active()?.textContent).toBe("Agregar");
  });

  test("hides the results counter while the first load runs", async () => {
    await mount({ search: search({ status: "loading", products: [] }) });
    expect(bodyText()).not.toContain("resultados");
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  test("shows initials instead of photos", async () => {
    await mount();
    expect(document.querySelector("img")).toBeNull();
    expect(bodyText()).toContain("TP");
    expect(bodyText()).toContain("CP");
  });

  test("shows the Portuguese texts", async () => {
    await i18n.changeLanguage("pt");
    try {
      await mount();
      expect(bodyText()).toContain("Buscar produto");
    } finally { await i18n.changeLanguage("es"); }
  });
});
