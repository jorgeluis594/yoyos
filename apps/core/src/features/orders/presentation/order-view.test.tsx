// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import { OrderView, type OrderViewProps } from "@core/src/features/orders/presentation/order-view";
import { initialDraft, type OrderViewState } from "@core/src/features/orders/presentation/order-view-state";
import type { LeaveGuard } from "@core/src/features/orders/presentation/use-unsaved-changes-guard";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
void i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });

const variantId = "00000000-0000-4000-8000-0000000000a1";
const empty = () => initialDraft({ kind: "new", orderId: "00000000-0000-4000-8000-000000001042", currency: "PEN" });
const withLine = (state: OrderViewState): OrderViewState => ({ ...state, draft: { ...state.draft, items: [{ variantId, productName: "Corona de Príncipe", attributes: {}, sku: null,
  unitPrice: { amount: 45, currency: "PEN" }, quantityText: "2", stock: 12, sellable: true }] } });
const guard = (patch: Partial<LeaveGuard> = {}): LeaveGuard => ({ blocked: false, mode: "changes", stay: vi.fn(), leave: vi.fn(), allowLeaving: vi.fn(), holdLeaving: vi.fn(), ...patch });

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = undefined; container?.remove(); vi.unstubAllGlobals(); });

const baseProps = (over: Partial<OrderViewProps> = {}): Omit<OrderViewProps, "state" | "onStateChange"> => ({
  settings: null, links: { sales: "/es-PE/orders", deliverySettings: "/es-PE/settings/delivery", createProduct: "/es-PE/products/new" }, catalogEpoch: 0, guard: guard(),
  saving: false, notice: null, attempts: 0, unavailableVariantId: null, coverRequired: false, format: { amount: (money) => `S/ ${money.amount.toFixed(2)}`, date: (iso) => iso },
  newPaymentId: () => "00000000-0000-4000-8000-0000000000f1", onSave: vi.fn(), onCheckAgain: vi.fn(), onDiscard: vi.fn(), ...over });

let latest: OrderViewState;
async function mount(start: OrderViewState, over: Partial<OrderViewProps> = {}) {
  function Harness() {
    const [state, setState] = useState(start);
    latest = state;
    return <OrderView state={state} onStateChange={setState} {...baseProps(over)} />;
  }
  const router = createMemoryRouter([{ path: "/", element: <Harness /> }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><RouterProvider router={router} /></I18nextProvider>));
}
const button = (name: string) => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((element) => (element.getAttribute("aria-label") ?? element.textContent)?.trim().startsWith(name));
const press = async (key: string, target: Element = document.body) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
const click = async (element: Element | undefined) => act(async () => { (element as HTMLElement).click(); });

describe("OrderView (new sale)", () => {
  test("shows the sections in mockup order with the link grey until the sale is saved", async () => {
    await mount(empty());
    const titles = [...container.querySelectorAll('[data-slot="card-title"]')].map((title) => title.textContent?.replace(/\s+/g, " ").trim());
    expect(titles).toEqual(["Productos", "Pagos", "Cliente (opcional)", "Enlace del pedido", "Entrega"]);
    expect(container.textContent).toContain("Disponible al guardar");
    expect(container.textContent).toContain("Sin guardar");
    expect(container.querySelector("h1")?.textContent).toContain("Nueva venta");
    expect(container.querySelector('nav a[href="/es-PE/orders"]')?.textContent).toBe("Ventas");
  });

  test("keeps Descartar disabled while the sale is empty and asks before emptying a started one", async () => {
    const onDiscard = vi.fn();
    await mount(empty(), { onDiscard });
    expect(button("Descartar")!.disabled).toBe(true);
    act(() => root!.unmount());
    await mount(withLine(empty()), { onDiscard });
    expect(button("Descartar")!.disabled).toBe(false);
    await click(button("Descartar"));
    expect(document.body.textContent).toContain("¿Descartar esta venta?");
    await click(button("Seguir editando"));
    expect(onDiscard).not.toHaveBeenCalled();
    await click(button("Descartar"));
    await click(button("Descartar venta"));
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  test("disables Guardar venta until there is a product and shows Guardando… while sending", async () => {
    await mount(empty());
    expect(button("Guardar venta")!.disabled).toBe(true);
    act(() => root!.unmount());
    const onSave = vi.fn();
    await mount(withLine(empty()), { onSave });
    await click(button("Guardar venta"));
    expect(onSave).toHaveBeenCalledOnce();
    act(() => root!.unmount());
    await mount(withLine(empty()), { saving: true });
    expect(button("Guardando…")!.disabled).toBe(true);
  });

  test("opens the picker with the slash key only outside text fields and when no dialog is open", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]")));
    await mount(empty());
    const name = container.querySelector<HTMLInputElement>("#customer-name")!;
    await press("/", name);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await press("/");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="combobox"]')).not.toBeNull();
    await click(button("Listo"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("does not open the picker with the slash key while a dialog is open", async () => {
    await mount(withLine(empty()));
    await click(button("Descartar"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await press("/");
    expect(document.querySelector('[role="combobox"]')).toBeNull();
  });

  test("marks the invalid fields after a refused save and moves focus to the first one", async () => {
    const half = withLine(empty());
    const typed = { ...half, draft: { ...half.draft, customer: { name: "Ana", phone: "" } } };
    await mount(typed, { attempts: 1 });
    expect(document.body.textContent).toContain("No se guardó: revisa 1 campo marcado.");
    expect(document.body.textContent).toContain("Completa nombre y celular, o deja ambos vacíos.");
    expect(document.activeElement?.id).toBe("customer-phone");
  });

  test("shows no marks before the first refused save", async () => {
    const half = withLine(empty());
    await mount({ ...half, draft: { ...half.draft, customer: { name: "Ana", phone: "" } } });
    expect(document.body.textContent).not.toContain("No se guardó");
    expect(document.body.textContent).not.toContain("Completa nombre y celular");
  });

  test("offers Quitar cliente on a new sale once a customer is typed and empties both fields", async () => {
    await mount(empty());
    expect(button("Quitar cliente")).toBeUndefined();
    const name = container.querySelector<HTMLInputElement>("#customer-name")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Ana"); name.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(latest.draft.customer.name).toBe("Ana");
    await click(button("Quitar cliente"));
    expect(latest.draft.customer).toEqual({ name: "", phone: "" });
  });

  test("shows the in-doubt check and offers Comprobar de nuevo only after the check failed", async () => {
    const onCheckAgain = vi.fn();
    await mount(withLine(empty()), { notice: { kind: "doubt", checking: true }, onCheckAgain });
    expect(document.body.textContent).toContain("No sabemos si la venta se guardó. Verificando…");
    expect(button("Comprobar de nuevo")).toBeUndefined();
    expect(button("Guardar venta")!.disabled).toBe(true);
    act(() => root!.unmount());
    await mount(withLine(empty()), { notice: { kind: "doubt", checking: false }, onCheckAgain });
    await click(button("Comprobar de nuevo"));
    expect(onCheckAgain).toHaveBeenCalledOnce();
  });

  test("asks to discard the changes when leaving and keeps them on Seguir editando", async () => {
    const held = guard({ blocked: true });
    await mount(withLine(empty()), { guard: held });
    expect(document.body.textContent).toContain("¿Descartar los cambios?");
    await click(button("Seguir editando"));
    expect(held.stay).toHaveBeenCalled();
    await click(button("Descartar cambios"));
    expect(held.leave).toHaveBeenCalled();
  });

  test("asks the in-doubt question instead while a save may have gone through", async () => {
    await mount(withLine(empty()), { guard: guard({ blocked: true, mode: "doubt" }) });
    expect(document.body.textContent).toContain("Puede que no se haya guardado. ¿Salir igualmente?");
    expect(button("Salir")).toBeDefined();
    expect(button("Quedarme")).toBeDefined();
  });

  test("shows the total and Guardar venta in a sticky bar once the header leaves the view", async () => {
    let notify: (entries: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal("IntersectionObserver", class { constructor(callback: typeof notify) { notify = callback; } observe() {} disconnect() {} });
    await mount(withLine(empty()));
    expect(container.querySelector(".fixed")).toBeNull();
    await act(async () => notify([{ isIntersecting: false }]));
    const bar = container.querySelector(".fixed")!;
    expect(bar.textContent).toContain("Total");
    expect(bar.textContent).toMatch(/S\/\s90\.00/);
    expect(bar.textContent).toContain("Guardar venta");
  });
});
