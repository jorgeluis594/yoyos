// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import { OrderView, type OrderViewProps, type SavedViewProps } from "@core/src/features/orders/presentation/order-view";
import { initialDraft, type OrderViewState } from "@core/src/features/orders/presentation/order-view-state";
import { deadpoolM, order1042, savedState } from "@core/src/features/orders/presentation/order-1042.fixture";
import type { LeaveGuard } from "@core/src/features/orders/presentation/use-unsaved-changes-guard";
import { catalogPaymentOptions } from "@core/src/features/orders/presentation/payment-options";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
void i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });

const variantId = "00000000-0000-4000-8000-0000000000a1";
const empty = () => initialDraft({ kind: "new", orderId: "00000000-0000-4000-8000-000000001042", currency: "PEN" });
const withLine = (state: OrderViewState): OrderViewState => ({ ...state, draft: { ...state.draft, items: [{ variantId, productName: "Corona de Príncipe", attributes: {}, sku: null,
  unitPrice: { amount: 45, currency: "PEN" }, quantityText: "2", stock: 12, sellable: true }] } });
const guard = (patch: Partial<LeaveGuard> = {}): LeaveGuard => ({ blocked: false, mode: "changes", stay: vi.fn(), leave: vi.fn(), ...patch });

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = undefined; container?.remove(); vi.unstubAllGlobals(); });

const baseProps = (over: Partial<OrderViewProps> = {}): Omit<OrderViewProps, "state" | "onStateChange"> => ({
  settings: null, paymentOptions: catalogPaymentOptions, links: { sales: "/es-PE/orders", deliverySettings: "/es-PE/settings/delivery", paymentSettings: "/es-PE/settings/payments", createProduct: "/es-PE/products/new" }, catalogEpoch: 0, guard: guard(),
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

// ---------------------------------------------------------------------------------------------------------------------

const savedExtras = (over: Partial<SavedViewProps> = {}): SavedViewProps => ({
  link: { kind: "ready", url: "https://fantasio.yoyos.lat/checkout/1042" }, receiptUrls: {}, manualPaymentId: "00000000-0000-4000-8000-0000000000f2", voidResult: undefined,
  actionBusy: false, underHeader: null, statusCard: <section aria-label="Estado del pedido"><button type="button">Marcar enviado</button></section>,
  onPrint: vi.fn(), onDiscardChanges: vi.fn(), onReload: vi.fn(), onSaveCustomerOnly: vi.fn(), ...over });
const mountSaved = (start: OrderViewState = savedState(), over: Partial<OrderViewProps> = {}, extras: Partial<SavedViewProps> = {}) => mount(start, { saved: savedExtras(extras), ...over });
const typeQuantity = (state: OrderViewState, variantId: string, quantityText: string): OrderViewState =>
  ({ ...state, draft: { ...state.draft, items: state.draft.items.map((line) => line.variantId === variantId ? { ...line, quantityText } : line) } });
const edited = () => typeQuantity(savedState(), deadpoolM, "2");
const labelOf = (name: string) => container.querySelector(`[role="group"][aria-label="${name}"]`);

describe("OrderView (saved order)", () => {
  test("shows the saved order sections in mockup order without Detalles internos", async () => {
    await mountSaved();
    const titles = [...container.querySelectorAll('[data-slot="card-title"]')].map((title) => title.textContent?.replace(/\s+/g, " ").trim());
    expect(titles).toEqual(["Productos", "Pagos", "Cliente (opcional)", "Enlace del pedido", "Entrega"]);
    expect(container.textContent).not.toContain("Detalles internos");
    expect(container.querySelector("h1")?.textContent).toBe("Pedido #1042");
    expect(container.querySelector('nav [aria-current="page"]')?.textContent).toBe("Pedido #1042");
    expect(container.textContent).toContain("Creado el 2026-10-30T09:10:00.000Z · Registrado por el vendedor");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Enlace del pedido"]')?.value ?? container.querySelector<HTMLInputElement>("input[readonly]")?.value).toBe("https://fantasio.yoyos.lat/checkout/1042");
    expect(button("Marcar enviado")).toBeDefined();
  });

  test("shows only Venta completada, only Pedido cancelado, or Pago pendiente and Enviada in the saved order header with their accessible names", async () => {
    await mountSaved(savedState({ order: order1042({ deliveryStatus: "shipped" }) }));
    expect([...container.querySelectorAll('[role="group"][aria-label^="Estado"]')].map((label) => label.getAttribute("aria-label")))
      .toEqual(["Estado del pago: Pago pendiente", "Estado de la entrega: Enviada"]);
    expect(labelOf("Estado del pago: Pago pendiente")?.textContent).toBe("Pago pendiente");
    act(() => root!.unmount());
    await mountSaved(savedState({ order: order1042({ status: "completed", paymentStatus: "paid", deliveryStatus: "delivered", completedAt: "2026-10-31T16:40:00.000Z" }) }));
    expect([...container.querySelectorAll('[role="group"][aria-label^="Estado"]')].map((label) => label.getAttribute("aria-label"))).toEqual(["Estado de la venta: Venta completada"]);
    expect(container.textContent).toContain("Venta completada el 2026-10-31T16:40:00.000Z");
    act(() => root!.unmount());
    await mountSaved(savedState({ order: order1042({ status: "cancelled", cancelled: true }) }));
    expect([...container.querySelectorAll('[role="group"][aria-label^="Estado"]')].map((label) => label.getAttribute("aria-label"))).toEqual(["Estado del pedido: Pedido cancelado"]);
  });

  test("names the origin of a catalog order in the subtitle and drops its badge", async () => {
    await mountSaved(savedState({ order: order1042({ source: "catalog" }) }));
    expect(container.textContent).toContain("Pedido desde el catálogo");
    expect(container.textContent).not.toContain("Desde el catálogo");
  });

  test("keeps Guardar cambios and Descartar cambios disabled until something differs and blocks the payment actions while editing", async () => {
    const onSave = vi.fn();
    await mountSaved(savedState(), { onSave });
    expect(button("Guardar cambios")!.disabled).toBe(true);
    expect(button("Descartar cambios")!.disabled).toBe(true);
    expect(container.textContent).not.toContain("Tienes cambios sin guardar.");
    expect(button("Agregar Yape")!.getAttribute("aria-disabled")).toBeNull();
    act(() => root!.unmount());
    await mountSaved(edited(), { onSave });
    expect(container.textContent).toContain("Tienes cambios sin guardar.");
    expect(button("Descartar cambios")!.disabled).toBe(false);
    expect(button("Agregar Yape")!.getAttribute("aria-disabled")).toBe("true");
    expect(container.textContent).toContain("Guarda o descarta los cambios primero.");
    await click(button("Guardar cambios"));
    expect(onSave).toHaveBeenCalledOnce();
  });

  test("blocks Imprimir rótulo with its note while there are unsaved changes", async () => {
    const onPrint = vi.fn();
    await mountSaved(savedState(), {}, { onPrint });
    await click(button("Imprimir rótulo"));
    expect(onPrint).toHaveBeenCalledOnce();
    act(() => root!.unmount());
    const blocked = vi.fn();
    await mountSaved(edited(), {}, { onPrint: blocked });
    expect(button("Imprimir rótulo")!.getAttribute("aria-disabled")).toBe("true");
    await click(button("Imprimir rótulo"));
    expect(blocked).not.toHaveBeenCalled();
  });

  test("asks before discarding the changes of a saved order and then hands the discard to the route", async () => {
    const onDiscardChanges = vi.fn();
    await mountSaved(edited(), {}, { onDiscardChanges });
    await click(button("Descartar cambios"));
    expect(document.body.textContent).toContain("¿Descartar los cambios?");
    await click(button("Seguir editando"));
    expect(onDiscardChanges).not.toHaveBeenCalled();
    await click(button("Descartar cambios"));
    await click([...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((element) => element.textContent === "Descartar cambios"));
    expect(onDiscardChanges).toHaveBeenCalledOnce();
  });

  test("asks to discard changes when leaving a saved order with unsaved edits and keeps them on Seguir editando", async () => {
    const held = guard({ blocked: true });
    await mountSaved(edited(), { guard: held });
    expect(document.body.textContent).toContain("¿Descartar los cambios?");
    await click(button("Seguir editando"));
    expect(held.stay).toHaveBeenCalled();
    await click([...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((element) => element.textContent === "Descartar cambios"));
    expect(held.leave).toHaveBeenCalled();
  });

  test("shows only the total in the sticky bar of a saved order without changes and the two actions after an edit", async () => {
    let notify: (entries: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal("IntersectionObserver", class { constructor(callback: typeof notify) { notify = callback; } observe() {} disconnect() {} });
    await mountSaved();
    await act(async () => notify([{ isIntersecting: false }]));
    const bar = () => container.querySelector(".fixed")!;
    expect(bar().textContent).toMatch(/S\/\s298\.00/);
    expect(bar().querySelector("button")).toBeNull();
    act(() => root!.unmount());
    await mountSaved(edited());
    await act(async () => notify([{ isIntersecting: false }]));
    expect(bar().textContent).toContain("Cambios sin guardar");
    expect([...bar().querySelectorAll("button")].map((element) => element.textContent)).toEqual(["Descartar cambios", "Guardar cambios"]);
    expect(bar().textContent).toMatch(/S\/\s418\.00/);
  });

  describe("Guardar cambios shown once per breakpoint", () => {
    let notify: (entries: { isIntersecting: boolean }[]) => void = () => {};
    const viewport = (narrow: boolean) => {
      vi.stubGlobal("IntersectionObserver", class { constructor(callback: typeof notify) { notify = callback; } observe() {} disconnect() {} });
      vi.stubGlobal("matchMedia", (query: string) => ({ matches: narrow && query.startsWith("(max-width"), addEventListener() {}, removeEventListener() {} }));
    };
    const saveButtons = () => [...container.querySelectorAll("button")].filter((element) => element.textContent === "Guardar cambios");

    test("below 1280 px the header gives it up to the sticky bar once the header leaves the view, and takes it back when it returns", async () => {
      viewport(true);
      await mountSaved(edited());
      expect(saveButtons()).toHaveLength(1);
      expect(container.querySelector(".fixed")).toBeNull();
      await act(async () => notify([{ isIntersecting: false }]));
      expect(saveButtons()).toHaveLength(1);
      expect(container.querySelector(".fixed")!.contains(saveButtons()[0]!)).toBe(true);
      await act(async () => notify([{ isIntersecting: true }]));
      expect(saveButtons()).toHaveLength(1);
      expect(container.querySelector(".fixed")).toBeNull();
    });

    test("from 1280 px the header keeps it, whether or not the header is in view", async () => {
      viewport(false);
      await mountSaved(edited());
      await act(async () => notify([{ isIntersecting: false }]));
      expect(saveButtons().filter((element) => !element.closest(".fixed"))).toHaveLength(1);
    });

    test("keeps the disabled header button while the sticky bar has no save to offer", async () => {
      viewport(true);
      await mountSaved();
      await act(async () => notify([{ isIntersecting: false }]));
      expect(saveButtons()).toHaveLength(1);
      expect(saveButtons()[0]!.disabled).toBe(true);
    });

    test("does the same for Guardar venta of a new sale", async () => {
      viewport(true);
      await mount(withLine(empty()));
      await act(async () => notify([{ isIntersecting: false }]));
      const buttons = [...container.querySelectorAll("button")].filter((element) => element.textContent === "Guardar venta");
      expect(buttons).toHaveLength(1);
      expect(container.querySelector(".fixed")!.contains(buttons[0]!)).toBe(true);
    });
  });

  test("lets the sticky bar wrap so Guardar cambios never leaves the screen", async () => {
    let notify: (entries: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal("IntersectionObserver", class { constructor(callback: typeof notify) { notify = callback; } observe() {} disconnect() {} });
    await mountSaved(edited());
    await act(async () => notify([{ isIntersecting: false }]));
    const bar = container.querySelector<HTMLElement>(".fixed")!;
    expect(bar.className).toContain("flex-wrap");
    expect(bar.firstElementChild!.className).toContain("min-w-0");
    expect(bar.lastElementChild!.className).toContain("basis-full");
  });

  test("says once, next to the actions, that there are unsaved changes and keeps the per-control reasons for assistive technology only", async () => {
    await mountSaved(edited());
    const visible = [...container.querySelectorAll("p, span")].filter((element) => element.textContent === "Guarda o descarta los cambios primero." && !element.classList.contains("sr-only"));
    expect(visible).toEqual([]);
    const notice = [...container.querySelectorAll("p")].filter((element) => element.textContent?.startsWith("Tienes cambios sin guardar."));
    expect(notice).toHaveLength(1);
    expect(notice[0]!.closest('[data-slot="page-header"]')).not.toBeNull();
    expect(button("Agregar Yape")!.getAttribute("aria-describedby")).toBeTruthy();
  });

  test("shows a cancelled order as read-only: only Pedido cancelado, no balance and no save actions", async () => {
    await mountSaved(savedState({ order: order1042({ status: "cancelled", cancelled: true }) }), { notice: { kind: "success", text: "Venta guardada." } });
    expect(button("Guardar cambios")).toBeUndefined();
    expect(button("Descartar cambios")).toBeUndefined();
    expect(container.textContent).not.toContain("Saldo pendiente");
    expect(container.textContent).not.toContain("Pago parcial");
    expect(container.textContent).not.toContain("Pago pendiente");
    expect(container.textContent).not.toContain("Venta guardada.");
    expect(container.textContent).not.toContain("Una entrega guardada se puede cambiar");
  });

  test("keeps a cancelled order read-only in the header and the sticky bar when it was cancelled while the edits were kept", async () => {
    await mountSaved(typeQuantity(savedState({ order: order1042({ status: "cancelled", cancelled: true }) }), deadpoolM, "2"), { notice: { kind: "locked", code: "ORDER_CANCELLED" } });
    expect(button("Guardar cambios")).toBeUndefined();
    expect(button("Descartar cambios")).toBeUndefined();
    expect(container.textContent).not.toContain("Tienes cambios sin guardar.");
    expect(container.textContent).not.toContain("Cambios sin guardar");
    expect(document.body.textContent).toContain("El pedido está cancelado; no se guardaron los cambios.");
  });

  test("asks for touch targets of at least 44 px on every control of the view, also with a mouse", async () => {
    await mountSaved();
    expect(container.querySelector("section")!.className).toContain("[&_[data-slot=button]]:min-h-touch");
    expect(container.querySelector("section")!.className).toContain("[&_[data-slot=tabs-trigger]]:min-h-touch");
    expect(container.querySelector<HTMLElement>('nav a[href="/es-PE/orders"]')!.className).toContain("min-h-touch");
  });

  test("shows the conflict alert with Recargar pedido, which asks before discarding the edits", async () => {
    const onReload = vi.fn();
    await mountSaved(edited(), { notice: { kind: "conflict" } }, { onReload });
    expect(document.body.textContent).toContain("Este pedido cambió mientras lo editabas. Tus cambios siguen aquí; recarga para ver la versión actual.");
    expect(document.activeElement?.getAttribute("role")).toBe("alert");
    await click(button("Recargar pedido"));
    expect(document.body.textContent).toContain("¿Descartar tus cambios y ver la versión actual?");
    await click(button("Seguir viendo mis cambios"));
    expect(onReload).not.toHaveBeenCalled();
    await click(button("Recargar pedido"));
    await click(button("Descartar y recargar"));
    expect(onReload).toHaveBeenCalledOnce();
  });

  test("tells a shipped order from a delivered or cancelled one and offers Guardar solo el cliente only with a customer edit", async () => {
    const onSaveCustomerOnly = vi.fn();
    const shipped = savedState({ order: order1042({ deliveryStatus: "shipped" }) });
    await mountSaved(shipped, { notice: { kind: "locked", code: "DELIVERY_LOCKED" } }, { onSaveCustomerOnly });
    expect(document.body.textContent).toContain("El pedido ya se envió; no se guardaron los cambios.");
    expect(button("Guardar solo el cliente")).toBeUndefined();
    act(() => root!.unmount());
    const withName = { ...shipped, draft: { ...shipped.draft, customer: { name: "Ana", phone: "+51977909427" } } };
    await mountSaved(withName, { notice: { kind: "locked", code: "DELIVERY_LOCKED" } }, { onSaveCustomerOnly });
    await click(button("Guardar solo el cliente"));
    expect(onSaveCustomerOnly).toHaveBeenCalledOnce();
    act(() => root!.unmount());
    await mountSaved(savedState({ order: order1042({ deliveryStatus: "delivered" }) }), { notice: { kind: "locked", code: "DELIVERY_LOCKED" } });
    expect(document.body.textContent).toContain("El pedido ya se entregó; no se guardaron los cambios.");
    act(() => root!.unmount());
    await mountSaved(savedState({ order: order1042({ status: "cancelled", cancelled: true }) }), { notice: { kind: "locked", code: "ORDER_CANCELLED" } });
    expect(document.body.textContent).toContain("El pedido está cancelado; no se guardaron los cambios.");
    expect(button("Guardar solo el cliente")).toBeUndefined();
  });

  test("announces the result of a save politely and moves focus to the heading", async () => {
    await mountSaved(savedState(), { notice: { kind: "success", text: "Cambios guardados." }, headingFocus: 0 });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Cambios guardados.");
    act(() => root!.unmount());
    await mountSaved(savedState(), { notice: { kind: "success", text: "Venta guardada." }, headingFocus: 1 });
    expect(document.activeElement?.id).toBe("order-view-title");
  });

  test("shows the in-doubt check of a save with its own text and offers Comprobar de nuevo only after it failed", async () => {
    const onCheckAgain = vi.fn();
    await mountSaved(edited(), { notice: { kind: "doubt", checking: true }, onCheckAgain });
    expect(document.body.textContent).toContain("No sabemos si los cambios se guardaron. Verificando…");
    expect(button("Guardar cambios")!.disabled).toBe(true);
    act(() => root!.unmount());
    await mountSaved(edited(), { notice: { kind: "doubt", checking: false }, onCheckAgain });
    await click(button("Comprobar de nuevo"));
    expect(onCheckAgain).toHaveBeenCalledOnce();
  });

  test("does not let the seller save while a payment or fulfillment action is in flight", async () => {
    await mountSaved(edited(), {}, { actionBusy: true });
    expect(button("Guardar cambios")!.disabled).toBe(true);
  });
});
