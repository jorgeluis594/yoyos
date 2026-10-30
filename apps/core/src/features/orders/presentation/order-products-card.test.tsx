// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, describe, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { OrderProductsCard } from "@core/src/features/orders/presentation/order-products-card";
import { initialDraft, type LoadedOrder, type OrderViewState } from "@core/src/features/orders/presentation/order-view-state";
import type { CatalogSearch } from "@core/src/features/orders/presentation/use-catalog-search";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const orderId = "00000000-0000-4000-8000-000000001042";
const trajeM = "00000000-0000-4000-8000-0000000000a1";
const trajeL = "00000000-0000-4000-8000-0000000000a2";
const crownId = "00000000-0000-4000-8000-0000000000c2";
const revision = (letter: string) => letter.repeat(43);
const revisions = { items: revision("A"), customer: revision("B"), delivery: revision("C") };
const pen = (amount: number) => ({ amount, currency: "PEN" as const });

const item = (id: string, variantId: string, name: string, size: string | null, price: number, quantity = 1, mentionedPrice: OrderAggregateResponse["items"][number]["mentionedPrice"] = null) => ({
  id, variantId, productName: name, variantAttributes: (size ? { Talla: size } : {}) as Record<string, string>, sku: null, quantity, unitPrice: pen(price), subtotal: pen(price * quantity), mentionedPrice,
});
function order(patch: Partial<OrderAggregateResponse> = {}): OrderAggregateResponse {
  return {
    checkoutEnabledAt: null, checkoutConfirmedAt: null, number: 1042, id: orderId, companyId: "00000000-0000-4000-8000-0000000000c1", sellerId: "user-1",
    buyer: null, source: "manual", createdAt: "2026-10-30T09:10:00.000Z", scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, status: "active",
    paymentStatus: "pending", paidAmount: pen(0), balanceDue: pen(178), overpaidAmount: pen(0), cancelled: false, delivery: null, deliveryStatus: "pending",
    stockDeducted: false, stockDue: null,
    items: [item("00000000-0000-4000-8000-000000000001", trajeM, "Traje de Príncipe Azul", "M", 89, 1), item("00000000-0000-4000-8000-000000000002", trajeL, "Traje de Príncipe Azul", "L", 89, 1)],
    payments: [], itemsTotal: pen(178), deliveryCost: pen(0), deliveryCharge: pen(0), total: pen(178), ...patch,
  };
}
const loaded = (patch: Partial<LoadedOrder> = {}): LoadedOrder => ({ order: order(), revisions, lineCatalog: { [trajeM]: { stock: 5 }, [trajeL]: { stock: 2 } }, ...patch });
const saved = (patch: Partial<LoadedOrder> = {}) => initialDraft({ kind: "saved", ...loaded(patch) });
const fresh = () => initialDraft({ kind: "new", orderId, currency: "PEN" });

const i18n = createInstance();
void i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });

const catalogSearch = (over: Partial<CatalogSearch> = {}): CatalogSearch => ({ text: "", inStock: false, status: "ready", products: [], open: vi.fn(), close: vi.fn(),
  setText: vi.fn(), setInStock: vi.fn(), retry: vi.fn(), ...over });
const crown = { id: "00000000-0000-4000-8000-000000000101", name: "Corona de Príncipe", currency: "PEN" as const,
  variants: [{ id: crownId, attributes: {}, sku: null, price: 45, stock: 12 }] };
const suit = { id: "00000000-0000-4000-8000-000000000100", name: "Traje de Príncipe Azul", currency: "PEN" as const,
  variants: [{ id: trajeM, attributes: { Talla: "M" }, sku: null, price: 99, stock: 5 }] };

describe("OrderProductsCard", () => {
  let root: Root | undefined;
  let latest: OrderViewState;
  afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

  function Harness({ start, search, initiallyOpen }: Readonly<{ start: OrderViewState; search: CatalogSearch; initiallyOpen: boolean }>) {
    const [state, setState] = useState(start);
    const [open, setOpen] = useState(initiallyOpen);
    latest = state;
    return <I18nextProvider i18n={i18n}>
      <OrderProductsCard state={state} onChange={setState} search={search} pickerOpen={open} onPickerOpenChange={setOpen} createProductHref="/pe/products/new" />
    </I18nextProvider>;
  }
  async function mount(start: OrderViewState, { search = catalogSearch(), open = false } = {}) {
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root!.render(<Harness start={start} search={search} initiallyOpen={open} />));
  }
  const text = () => (document.body.textContent ?? "").replaceAll("\u00a0", " ");
  const fields = () => [...document.querySelectorAll<HTMLInputElement>("input[data-quantity]")];
  const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name)!;
  const chip = (prefix: string) => [...document.querySelectorAll<HTMLElement>("button[role=option]")].find((candidate) => candidate.getAttribute("aria-label")?.startsWith(prefix))!;
  const click = (element: HTMLElement) => act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  async function type(input: HTMLInputElement, value: string) {
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const blur = (input: HTMLInputElement) => act(async () => { input.blur(); input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  const quantities = () => latest.draft.items.map((line) => line.quantityText);

  test("shows each line with its combination, price, subtotal, the count and the estimate note", async () => {
    await mount(saved({ order: order({ items: [item("00000000-0000-4000-8000-000000000001", trajeM, "Traje de Príncipe Azul", "M", 89, 2), item("00000000-0000-4000-8000-000000000003", crownId, "Corona de Príncipe", null, 35)], itemsTotal: pen(213), total: pen(213) }), lineCatalog: { [trajeM]: { stock: 5 }, [crownId]: { stock: 9 } } }));
    expect(text()).toContain("2 productos · 3 unidades");
    expect(text()).toContain("M · S/ 89.00 c/u");
    expect(text()).toContain("Variante única · S/ 35.00 c/u");
    expect(text()).toContain("Stock pendiente");
    expect(text()).not.toContain(i18n.t("orderView.products.estimate"));
    await type(fields()[0]!, "3");
    expect(text()).toContain(i18n.t("orderView.products.estimate"));
    expect(text()).toContain("Subtotal");
    expect(text()).toContain("S/ 302.00");
  });

  test("shows the mentioned-price note on a line that has one", async () => {
    await mount(saved({ order: order({ items: [item("00000000-0000-4000-8000-000000000001", trajeM, "Traje de Príncipe Azul", "M", 89, 1, { amount: pen(80), units: 1 })] }) }));
    expect(text()).toContain("El cliente mencionó S/ 80.00 por unidad");
  });

  test("shows the empty state and opens the picker from the dashed row and from Agregar producto", async () => {
    const open = vi.fn();
    await mount(fresh(), { search: catalogSearch({ open }) });
    expect(text()).toContain("Aún no hay productos");
    expect(text()).toContain("Pulsa / o Agregar producto para buscar.");
    await click(button("Agregar producto"));
    expect(document.querySelector("input[role=combobox]")).not.toBeNull();
    expect(open).toHaveBeenCalled();
  });

  test("adds a catalog variant as a new line with quantity 1 and the catalog price", async () => {
    await mount(fresh(), { search: catalogSearch({ products: [crown] }), open: true });
    await click(button("Agregar"));
    expect(latest.draft.items).toMatchObject([{ variantId: crownId, quantityText: "1", unitPrice: pen(45), stock: 12, sellable: true }]);
  });

  test("raises the quantity instead of duplicating a variant already in the order and keeps its saved price", async () => {
    await mount(saved(), { search: catalogSearch({ products: [suit] }), open: true });
    await click(chip("M, "));
    expect(latest.draft.items.filter((line) => line.variantId === trajeM)).toMatchObject([{ quantityText: "2", unitPrice: pen(89) }]);
  });

  test("keeps the saved price when a removed saved variant is added again", async () => {
    await mount(saved(), { search: catalogSearch({ products: [suit] }), open: true });
    await click(button("Quitar Traje de Príncipe Azul, M"));
    expect(latest.draft.items.map((line) => line.variantId)).toEqual([trajeL]);
    await click(chip("M, "));
    expect(latest.draft.items.find((line) => line.variantId === trajeM)).toMatchObject({ quantityText: "1", unitPrice: pen(89) });
  });

  test("changes the quantity with the stepper and does not go below 1", async () => {
    await mount(saved());
    await click(button("Aumentar cantidad"));
    expect(quantities()).toEqual(["2", "1"]);
    await click(button("Disminuir cantidad"));
    expect(quantities()).toEqual(["1", "1"]);
    expect(button("Disminuir cantidad").disabled).toBe(true);
  });

  test("removes a line by its accessible name", async () => {
    await mount(saved());
    await click(button("Quitar Traje de Príncipe Azul, L"));
    expect(latest.draft.items.map((line) => line.variantId)).toEqual([trajeM]);
  });

  test("disables removing the only line with its note", async () => {
    await mount(saved({ order: order({ items: [item("00000000-0000-4000-8000-000000000001", trajeM, "Traje de Príncipe Azul", "M", 89)] }) }));
    expect(button("Quitar Traje de Príncipe Azul, M").disabled).toBe(true);
    expect(text()).toContain("Un pedido necesita al menos un producto. Para anularlo, cancela el pedido.");
  });

  test("keeps only digits while typing and marks 0 without removing the line", async () => {
    await mount(saved());
    await type(fields()[0]!, "a2b");
    expect(quantities()[0]).toBe("2");
    await type(fields()[0]!, "0");
    expect(latest.draft.items).toHaveLength(2);
    expect(text()).toContain("Escribe una cantidad de 1 o más.");
    expect(fields()[0]!.getAttribute("aria-invalid")).toBe("true");
    await type(fields()[0]!, "10000");
    expect(text()).toContain("Máximo 9999 unidades.");
  });

  test("restores the previous quantity when the field is left empty", async () => {
    await mount(saved());
    await type(fields()[0]!, "3");
    fields()[0]!.focus();
    await type(fields()[0]!, "");
    expect(quantities()[0]).toBe("");
    await blur(fields()[0]!);
    expect(quantities()[0]).toBe("3");
  });

  test("shows the stock warning on a saved line above its current stock", async () => {
    await mount(saved());
    expect(text()).not.toContain("Disponible:");
    await type(fields()[1]!, "3");
    expect(text()).toContain("Disponible: 2. Si lo cobras, el pedido quedará esperando stock.");
  });

  test("shows the no-longer-sold note when raising a line absent from the line catalog", async () => {
    await mount(saved({ lineCatalog: { [trajeM]: { stock: 5 } } }));
    expect(text()).not.toContain("Este producto ya no se vende");
    await click(document.querySelectorAll<HTMLButtonElement>("button[aria-label='Aumentar cantidad']")[1]!);
    expect(text()).toContain("Este producto ya no se vende; puedes bajar la cantidad o quitarlo.");
  });

  test("shows no stock warning or note when the line catalog is unknown", async () => {
    await mount(saved({ lineCatalog: null }));
    await type(fields()[1]!, "50");
    expect(text()).not.toContain("Disponible:");
    expect(text()).not.toContain("ya no se vende");
  });

  test("shows the locked note with its remedy when stock is deducted and disables every control", async () => {
    await mount(saved({ order: order({ stockDeducted: true }) }));
    expect(text()).toContain("El stock de este pedido ya se descontó; los productos ya no se pueden cambiar. Para cambiarlos, cancela el pedido y crea una venta nueva.");
    expect(text()).toContain("Stock descontado");
    expect(button("Agregar producto").disabled).toBe(true);
    expect(button("Aumentar cantidad").disabled).toBe(true);
    expect(button("Quitar Traje de Príncipe Azul, M").disabled).toBe(true);
    expect(fields()[0]!.disabled).toBe(true);
  });
});
