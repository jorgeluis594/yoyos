// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, data, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import OrderDetail, { shouldRevalidate } from "@core/app/routes/order-detail";
import { homeDelivery, order1042, orderId, pen, revisions, yape } from "@core/src/features/orders/presentation/order-1042.fixture";
import { deadpoolM, lineCatalog } from "@core/src/features/orders/presentation/order-1042.fixture";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("@core/src/features/dispatch-labels/presentation/dispatch-label-print-dialog", () => ({ DispatchLabelPrintDialog: () => null }));

const i18n = createInstance();
void i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });

type Order = ReturnType<typeof order1042>;
type LoaderData = { order: Order; revisions: typeof revisions; lineCatalog: typeof lineCatalog | null };
const loaderData = (patch: Partial<LoaderData> = {}) => ({ order: order1042(), revisions, lineCatalog, base: "/es-PE/orders", manualPaymentId: "00000000-0000-4000-8000-0000000000f2",
  receiptUrls: {}, settings: null, settingsPath: "/es-PE/settings/delivery", link: { kind: "unavailable" as const }, ...patch });
const raisedDeadpool = (order: Order, quantity = 2): Order => ({ ...order, total: pen(298 + 120 * (quantity - 1)), itemsTotal: pen(298 + 120 * (quantity - 1)), balanceDue: pen(148 + 120 * (quantity - 1)),
  items: order.items.map((item) => item.variantId === deadpoolM ? { ...item, quantity, subtotal: pen(120 * quantity) } : item) });

let root: Root | undefined;
let container: HTMLDivElement;
let current: ReturnType<typeof loaderData>;
let loads: number;
let bodies: Record<string, unknown>[];
let answer: (body: Record<string, unknown>) => unknown;
let router: ReturnType<typeof createMemoryRouter>;

beforeEach(() => { sessionStorage.clear(); current = loaderData(); loads = 0; bodies = []; answer = () => ({ operation: "save_changes", code: "INVALID_INPUT" }); });
afterEach(() => { act(() => root?.unmount()); root = undefined; container?.remove(); vi.unstubAllGlobals(); });

async function mount() {
  router = createMemoryRouter([
    { path: "/es-PE/orders", element: <p>Ventas</p> },
    { id: "detail", path: "/es-PE/orders/:orderId", Component: OrderDetail, shouldRevalidate: shouldRevalidate as never,
      loader: () => { loads += 1; return structuredClone(current); },
      action: async ({ request }) => { const body = await request.json(); bodies.push(body); return answer(body); } },
  ], { initialEntries: [`/es-PE/orders/${orderId}`] });
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><RouterProvider router={router} /></I18nextProvider>));
  await vi.waitFor(() => expect(container.querySelector("h1")?.textContent).toBe("Pedido #1042"));
}

const button = (name: string) => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((element) => (element.getAttribute("aria-label") ?? element.textContent)?.trim().startsWith(name));
const click = async (element: Element | undefined) => act(async () => { (element as HTMLElement).click(); });
async function type(element: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
const quantityInputs = () => [...container.querySelectorAll<HTMLInputElement>("input[data-quantity]")];
const raiseDeadpool = () => type(quantityInputs()[2]!, "2");
const refuse = (code: string, extra: object = {}) => { answer = () => ({ operation: "save_changes", code, ...extra }); };
const settle = () => vi.waitFor(() => expect(bodies.length).toBeGreaterThan(0));

describe("saved order route", () => {
  test("sends only the changed part with its pinned revision and shows the saved result without reloading", async () => {
    await mount();
    answer = () => ({ operation: "save_changes", order: raisedDeadpool(current.order), revisions: { ...revisions, items: "Z".repeat(43) }, lineCatalog, applied: ["items"] });
    await raiseDeadpool();
    await click(button("Guardar cambios"));
    await settle();
    expect(bodies[0]).toEqual({ operation: "save_changes", items: { base: revisions.items, lines: [expect.objectContaining({ quantity: 1 }), expect.objectContaining({ quantity: 1 }), { variantId: deadpoolM, quantity: 2 }] } });
    await vi.waitFor(() => expect(container.textContent).toContain("Cambios guardados."));
    expect(container.textContent).toMatch(/S\/\s418\.00/);
    expect(button("Guardar cambios")!.disabled).toBe(true);
    expect(loads).toBe(1);
    expect(document.activeElement?.id).toBe("order-view-title");
  });

  test("maps ORDER_CHANGED to the conflict alert and keeps the edits until Descartar y recargar", async () => {
    await mount();
    refuse("ORDER_CHANGED", { parts: ["items"] });
    await raiseDeadpool();
    await click(button("Guardar cambios"));
    await vi.waitFor(() => expect(container.textContent).toContain("Este pedido cambió mientras lo editabas."));
    expect(quantityInputs()[2]!.value).toBe("2");
    expect(loads).toBe(1);
    current = loaderData({ order: raisedDeadpool(order1042()), revisions: { ...revisions, items: "Y".repeat(43) } });
    await click(button("Recargar pedido"));
    await click(button("Descartar y recargar"));
    await vi.waitFor(() => expect(loads).toBe(2));
    await vi.waitFor(() => expect(container.textContent).not.toContain("Este pedido cambió mientras lo editabas."));
    expect(quantityInputs()[2]!.value).toBe("2");
    expect(button("Guardar cambios")!.disabled).toBe(true);
  });

  test("answers the conflict on save after a void refreshed an order whose items a chat message changed", async () => {
    await mount();
    answer = (body) => (body.items as { base: string }).base === "Y".repeat(43) ? { operation: "save_changes", code: "SAVED" } : { operation: "save_changes", code: "ORDER_CHANGED", parts: ["items"] };
    await raiseDeadpool();
    // The seller voids the payment: the refresh brings a chat change of the items and the new balance, and keeps the pinned base of the edited items.
    const chat = raisedDeadpool(order1042(), 5);
    current = loaderData({ order: { ...chat, paidAmount: pen(0), balanceDue: pen(418), payments: [{ ...yape, status: "voided" as const, data: { ...yape.data, voidedAt: "2026-10-30T10:00:00.000Z", voidedBy: { kind: "seller" as const, userId: "user-1" } } } as never] },
      revisions: { ...revisions, items: "Y".repeat(43) } });
    await act(async () => { await router.revalidate(); });
    await vi.waitFor(() => expect(loads).toBe(2));
    expect(quantityInputs()[2]!.value).toBe("2");
    await click(button("Guardar cambios"));
    await settle();
    expect(bodies[0]).toMatchObject({ items: { base: revisions.items } });
    await vi.waitFor(() => expect(container.textContent).toContain("Este pedido cambió mientras lo editabas."));
  });

  test("blocks saving and leaving while an in-doubt check is running, then revalidates when the changes were applied so the next save sends fresh revisions", async () => {
    await mount();
    let resolveCheck: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveCheck = resolve; })));
    answer = () => data({ operation: "save_changes", lost: "in-doubt" }, { status: 503 });
    await raiseDeadpool();
    await click(button("Guardar cambios"));
    await vi.waitFor(() => expect(container.textContent).toContain("No sabemos si los cambios se guardaron. Verificando…"));
    expect(button("Guardar cambios")!.disabled).toBe(true);
    await act(async () => { void router.navigate("/es-PE/orders"); });
    expect(document.body.textContent).toContain("Puede que no se haya guardado. ¿Salir igualmente?");
    await click(button("Quedarme"));
    current = loaderData({ order: raisedDeadpool(order1042()), revisions: { ...revisions, items: "Z".repeat(43) } });
    await act(async () => resolveCheck(new Response(JSON.stringify(raisedDeadpool(order1042())), { status: 200 })));
    await vi.waitFor(() => expect(loads).toBe(2));
    await vi.waitFor(() => expect(container.textContent).toContain("Cambios guardados."));
    expect(button("Guardar cambios")!.disabled).toBe(true);
    await type(quantityInputs()[2]!, "3");
    answer = () => ({ operation: "save_changes", code: "INVALID_INPUT" });
    await click(button("Guardar cambios"));
    await vi.waitFor(() => expect(bodies.length).toBe(2));
    expect(bodies[1]).toMatchObject({ items: { base: "Z".repeat(43) } });
  });

  test("shows the conflict alert when the in-doubt check finds the order changed otherwise", async () => {
    await mount();
    const elsewhere = order1042({ items: order1042().items.slice(0, 2) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(elsewhere), { status: 200 })));
    answer = () => data({ operation: "save_changes", lost: "in-doubt" }, { status: 503 });
    await raiseDeadpool();
    await click(button("Guardar cambios"));
    await vi.waitFor(() => expect(container.textContent).toContain("Este pedido cambió mientras lo editabas."));
    expect(quantityInputs()[2]!.value).toBe("2");
  });

  test("keeps the edits and enables saving again when the check finds the changes were not applied", async () => {
    await mount();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(order1042()), { status: 200 })));
    answer = () => data({ operation: "save_changes", lost: "in-doubt" }, { status: 503 });
    await raiseDeadpool();
    await click(button("Guardar cambios"));
    await vi.waitFor(() => expect(container.textContent).not.toContain("Verificando…"));
    expect(quantityInputs()[2]!.value).toBe("2");
    expect(button("Guardar cambios")!.disabled).toBe(false);
  });

  test("offers Comprobar de nuevo when the check itself fails and keeps saving blocked", async () => {
    await mount();
    const fetcher = vi.fn(async () => { throw new TypeError("offline"); });
    vi.stubGlobal("fetch", fetcher);
    answer = () => data({ operation: "save_changes", lost: "in-doubt" }, { status: 503 });
    await raiseDeadpool();
    await click(button("Guardar cambios"));
    await vi.waitFor(() => expect(container.textContent).toContain("No pudimos comprobar si se guardó."));
    expect(button("Guardar cambios")!.disabled).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(order1042()), { status: 200 })));
    await click(button("Comprobar de nuevo"));
    await vi.waitFor(() => expect(container.textContent).not.toContain("No pudimos comprobar"));
  });

  test("maps DELIVERY_LOCKED with a customer edit to the Guardar solo el cliente offer, which sends only the customer", async () => {
    await mount();
    refuse("DELIVERY_LOCKED");
    await raiseDeadpool();
    await type(container.querySelector<HTMLInputElement>("#customer-name")!, "Ana Pérez");
    current = loaderData({ order: order1042({ deliveryStatus: "shipped", shippedAt: "2026-10-30T12:00:00.000Z" }), lineCatalog: null });
    await click(button("Guardar cambios"));
    await vi.waitFor(() => expect(container.textContent).toContain("El pedido ya se envió; no se guardaron los cambios."));
    await vi.waitFor(() => expect(loads).toBe(2));
    refuse("INVALID_INPUT");
    await click(button("Guardar solo el cliente"));
    await vi.waitFor(() => expect(bodies.length).toBe(2));
    expect(Object.keys(bodies[1]!).sort()).toEqual(["customer", "operation"]);
    expect(bodies[1]).toMatchObject({ customer: { value: { name: "Ana Pérez" } } });
  });

  test("tells a shipped or delivered order that the step already happened instead of the transition rule", async () => {
    current = loaderData({ order: order1042({ deliveryStatus: "shipped", shippedAt: "2026-10-30T12:00:00.000Z" }), lineCatalog: null });
    await mount();
    expect(container.textContent).toContain("Marcar entregado");
    expect(container.textContent).not.toContain("Solo se puede enviar desde pendiente");
    act(() => root!.unmount());
    current = loaderData({ order: order1042({ deliveryStatus: "delivered", status: "completed", paymentStatus: "paid" }), lineCatalog: null });
    await mount();
    expect(container.textContent).toContain("Entregado");
    expect(container.textContent).not.toContain("Marcar entregado");
    expect(container.textContent).not.toContain("Solo se puede enviar desde pendiente");
  });

  test("saves a customer name change without touching the recipient of another person", async () => {
    current = loaderData({ order: order1042({ buyer: { contactId: null, name: "Jorge Gonzalez", phone: "+51977909427" } }) });
    const other = homeDelivery;
    current = loaderData({ order: { ...current.order, delivery: { ...other, recipient: { ...other.recipient, name: "María Quispe", phone: "+51988111222" } } } });
    await mount();
    refuse("INVALID_INPUT");
    await type(container.querySelector<HTMLInputElement>("#customer-name")!, "Jorge G. Gonzalez");
    await click(button("Guardar cambios"));
    await settle();
    expect(Object.keys(bodies[0]!).sort()).toEqual(["customer", "operation"]);
  });

  test("answers ORDER_CANCELLED by naming it, keeping the edits and offering no customer-only save", async () => {
    await mount();
    refuse("ORDER_CANCELLED");
    await raiseDeadpool();
    current = loaderData({ order: order1042({ status: "cancelled", cancelled: true }), lineCatalog: null });
    await click(button("Guardar cambios"));
    await vi.waitFor(() => expect(container.textContent).toContain("El pedido está cancelado; no se guardaron los cambios."));
    expect(button("Guardar solo el cliente")).toBeUndefined();
  });

  test("announces «Venta guardada.» and focuses the heading when a new sale lands on the saved view", async () => {
    sessionStorage.setItem("order-view-saved", orderId);
    await mount();
    expect(container.textContent).toContain("Venta guardada.");
    expect(document.activeElement?.id).toBe("order-view-title");
    expect(sessionStorage.getItem("order-view-saved")).toBeNull();
  });

  test("lets the seller leave without asking when there are no unsaved changes", async () => {
    await mount();
    await act(async () => { await router.navigate("/es-PE/orders"); });
    expect(router.state.location.pathname).toBe("/es-PE/orders");
  });
});
