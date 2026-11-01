// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import resources from "@core/app/locales";
import { OrderView, type OrderViewProps } from "@core/src/features/orders/presentation/order-view";
import type { OrderViewState } from "@core/src/features/orders/presentation/order-view-state";
import { deadpoolM, order1042, pen, savedState } from "@core/src/features/orders/presentation/order-1042.fixture";
import {
  confirmed, doubtfulChange, fakeApi, itemDeadpool, itemTrajeL, messageOne, messageTwo, noReview, point, reviewJson, sureChange, whatsappOrder,
  noPendings,
} from "@core/src/features/orders/presentation/order-review.fixture";
import type { OrderReviewResponse } from "@shared/contracts/order-review";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
void i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });
const url = "https://fantasio.yoyos.lat/checkout/1042";

let root: Root | undefined;
let container: HTMLDivElement;
let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => { writeText = vi.fn(async () => undefined); Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true }); });
afterEach(() => { act(() => root?.unmount()); root = undefined; container?.remove(); vi.unstubAllGlobals(); });

type Over = Readonly<{ review: OrderReviewResponse; api: ReturnType<typeof fakeApi>; order: ReturnType<typeof order1042>; state: OrderViewState; onChanged: () => void; afterChange: OrderReviewResponse; retryDelaysMs: readonly number[] }>;
async function mount(over: Partial<Over> = {}) {
  const review = over.review ?? reviewJson();
  const api = over.api ?? fakeApi();
  const onChanged = over.onChanged ?? vi.fn();
  const start = over.state ?? savedState({ order: over.order ?? whatsappOrder() });
  const propsFor = (current: OrderReviewResponse, changed: () => void): Omit<OrderViewProps, "state" | "onStateChange"> => ({
    settings: null, links: { sales: "/es-PE/orders", deliverySettings: "/es-PE/settings/delivery", createProduct: "/es-PE/products/new" }, catalogEpoch: 0,
    guard: { blocked: false, mode: "changes", stay: vi.fn(), leave: vi.fn() }, saving: false, notice: null, attempts: 0, unavailableVariantId: null, coverRequired: false,
    format: { amount: (money) => `S/ ${money.amount.toFixed(2)}`, date: (iso) => iso }, newPaymentId: () => "00000000-0000-4000-8000-0000000000f1", onSave: vi.fn(), onCheckAgain: vi.fn(),
    saved: { link: { kind: "ready", url }, receiptUrls: {}, manualPaymentId: "00000000-0000-4000-8000-0000000000f2", voidResult: undefined, actionBusy: false, underHeader: null, statusCard: null,
      onPrint: vi.fn(), onDiscardChanges: vi.fn(), onReload: vi.fn(), onSaveCustomerOnly: vi.fn(),
      review: { review: current, api, onChanged: changed, retryDelaysMs: over.retryDelaysMs ?? [], now: () => new Date("2026-10-30T22:00:00.000Z") } } });
  function Harness() {
    const [state, setState] = useState(start);
    // The route reads the review again after a confirmation: its answer replaces the one the view was given.
    const [current, setCurrent] = useState(review);
    const changed = () => { onChanged(); if (over.afterChange) setCurrent(over.afterChange); };
    return <OrderView state={state} onStateChange={setState} {...propsFor(current, changed)} />;
  }
  const router = createMemoryRouter([{ path: "/", element: <Harness /> }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><RouterProvider router={router} /></I18nextProvider>));
  return { api, onChanged };
}
const unmount = () => { act(() => root?.unmount()); root = undefined; container.remove(); };
const buttons = () => [...document.body.querySelectorAll<HTMLButtonElement>("button")];
const button = (name: string) => buttons().find((element) => (element.getAttribute("aria-label") ?? element.textContent)?.trim().startsWith(name));
const click = async (element: Element | undefined) => { expect(element).toBeDefined(); await act(async () => { (element as HTMLElement).click(); }); };
const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const gone = () => vi.waitFor(() => expect(dialog()).toBeNull());
const input = (label: string) => document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
async function type(element: HTMLInputElement | null, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element!.dispatchEvent(new Event("input", { bubbles: true })); });
}
const urlInput = () => container.querySelector<HTMLInputElement>('input[aria-label="Enlace del pedido"]');
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
const quantityLabel = "Cantidad de Disfraz de Deadpool M";

describe("web review on the order view", () => {
  test("the link card hides the URL and opens the review first from the copy and open icons", async () => {
    const { api } = await mount();
    expect(urlInput()).toBeNull();
    expect(container.textContent).not.toContain("fantasio.yoyos.lat");
    expect(container.textContent).toContain("Revisa el pedido antes de enviar el enlace.");
    expect(container.textContent).toContain("1 cambio con duda");
    await click(button("Copiar enlace"));
    expect(dialog()?.textContent).toContain("Revisa el pedido #1042");
    expect(writeText).not.toHaveBeenCalled();
    await click(button("Cerrar"));
    await gone();
    await click(button("Abrir enlace en una pestaña nueva"));
    expect(dialog()?.textContent).toContain("Antes de enviar el enlace");
    expect(api.load).toHaveBeenCalledWith("00000000-0000-4000-8000-000000001042");
  });

  test("copy after confirming a review closes the dialog, shows the URL and focuses the copy icon without copying", async () => {
    const { api, onChanged } = await mount({ afterChange: reviewJson({ doubtful: [], status: { ...reviewJson().status, toReview: false, doubtfulCount: 0 } }) });
    await click(button("Copiar enlace"));
    await click(button("Confirmar revisión"));
    await gone();
    expect(api.confirm).toHaveBeenCalledWith("00000000-0000-4000-8000-000000001042", expect.objectContaining({ origin: "link", linkAction: null, corrections: [] }));
    expect(urlInput()?.value).toBe(url);
    await vi.waitFor(() => expect(document.activeElement?.id).toBe("order-link-copy"));
    expect(writeText).not.toHaveBeenCalled();
    expect(api.recordLinkAction).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
    await click(button("Copiar enlace"));
    expect(writeText).toHaveBeenCalledWith(url);
    expect(api.recordLinkAction).toHaveBeenCalledWith("00000000-0000-4000-8000-000000001042", { id: expect.any(String), action: "copy" });
    expect(container.textContent).toContain("Enlace copiado");
  });

  test("open after confirming a review focuses the open icon without opening a tab", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { api } = await mount();
    await click(button("Abrir enlace en una pestaña nueva"));
    await click(button("Confirmar revisión"));
    await gone();
    await vi.waitFor(() => expect(document.activeElement?.id).toBe("order-link-open"));
    expect(document.activeElement?.getAttribute("href")).toBe(url);
    expect(open).not.toHaveBeenCalled();
    expect(api.recordLinkAction).not.toHaveBeenCalled();
    await act(async () => { (document.activeElement as HTMLElement).addEventListener("click", (event) => event.preventDefault()); (document.activeElement as HTMLElement).click(); });
    expect(api.recordLinkAction).toHaveBeenCalledWith("00000000-0000-4000-8000-000000001042", { id: expect.any(String), action: "open" });
  });

  test("Cambios por mensajes rows show Deshacer or the refusal reason", async () => {
    const later = doubtfulChange({ id: "00000000-0000-4000-8000-0000000000c9", messageId: "00000000-0000-4000-8000-0000000000d9", seq: 2 });
    const review = reviewJson({ moreRows: 2, messageRows: [
      { messageId: messageOne, at: "2026-10-30T20:42:00.000Z", changes: [doubtfulChange()], undo: { kind: "available" },
        pendings: { back: [{ kind: "variant_missing", product: "Polo básico" }], end: [{ kind: "not_clear", product: null }] } },
      { messageId: messageTwo, at: "2026-10-29T20:42:00.000Z", changes: [sureChange()], undo: { kind: "refused", reason: "later_change" }, pendings: noPendings },
      { messageId: later.messageId, at: "2026-10-29T19:00:00.000Z", changes: [later], undo: { kind: "undone" }, pendings: noPendings },
    ] });
    const api = fakeApi({ load: vi.fn(async () => ok({ review: { ...review, moreRows: 0 }, order: whatsappOrder() })) });
    const { onChanged } = await mount({ review, api });
    const block = container.querySelector<HTMLElement>('[aria-labelledby="message-changes-title"]')!;
    expect(block.textContent).toContain("Cambios por mensajes");
    expect(block.textContent).toContain("15:42 · Cambió Disfraz de Deadpool a talla M");
    expect(block.textContent).toContain("29/10 15:42 · Agregó Gorra trucker · Rojo · ×1");
    expect(block.textContent).toContain("Un cambio posterior tocó este producto.");
    expect(block.textContent).toContain("Deshecho");
    expect(block.querySelectorAll("button[aria-label^='Deshacer mensaje de las']")).toHaveLength(1);
    await click(button("Deshacer mensaje de las 15:42"));
    expect(dialog()?.textContent).toContain("¿Deshacer lo que hizo este mensaje?");
    expect(dialog()?.textContent).toContain("Volver Disfraz de Deadpool a talla L");
    expect(dialog()?.textContent).toContain("Volverá: Falta la variante · Polo básico");
    expect(dialog()?.textContent).toContain("Terminará: Producto no claro");
    await click(button("Deshacer cambios"));
    await gone();
    expect(api.undo).toHaveBeenCalledWith("00000000-0000-4000-8000-000000001042", messageOne);
    expect(container.textContent).toContain("Cambios deshechos.");
    expect(onChanged).toHaveBeenCalled();
  });

  test("Ver más loads every row of the order", async () => {
    const review = reviewJson({ moreRows: 3 });
    const all = reviewJson({ moreRows: 0, messageRows: [...review.messageRows, { messageId: messageTwo, at: "2026-10-29T20:42:00.000Z", changes: [sureChange()], undo: { kind: "undone" }, pendings: noPendings }] });
    const api = fakeApi({ load: vi.fn(async () => ok({ review: all, order: whatsappOrder() })) });
    await mount({ review, api });
    await click(button("Ver más"));
    await vi.waitFor(() => expect(container.textContent).toContain("Agregó Gorra trucker"));
    expect(button("Ver más")).toBeUndefined();
  });

  test("undo, Revisar pedido and link icons are aria-disabled while product edits are unsaved", async () => {
    const edited = (order = whatsappOrder()): OrderViewState => {
      const state = savedState({ order });
      return { ...state, draft: { ...state.draft, items: state.draft.items.map((line) => line.variantId === deadpoolM ? { ...line, quantityText: "2" } : line) } };
    };
    const { api } = await mount({ state: edited() });
    for (const name of ["Copiar enlace", "Abrir enlace en una pestaña nueva"]) {
      expect(button(name)?.getAttribute("aria-disabled")).toBe("true");
      await click(button(name));
    }
    expect(dialog()).toBeNull();
    expect(container.textContent).toContain("Guarda o descarta los cambios del pedido antes de revisarlo.");
    const undo = button("Deshacer mensaje de las");
    expect(undo?.getAttribute("aria-disabled")).toBe("true");
    await click(undo);
    expect(dialog()).toBeNull();
    expect(api.load).not.toHaveBeenCalled();
    unmount();
    const paid = whatsappOrder({ paymentStatus: "paid" });
    const detail = reviewJson({ status: { ...reviewJson().status, openForMessages: false, entry: "detail" } });
    await mount({ state: edited(paid), order: paid, review: detail });
    const review = button("Revisar pedido");
    expect(review?.getAttribute("aria-disabled")).toBe("true");
    await click(review);
    expect(dialog()).toBeNull();
  });

  test("a paid order with a doubtful item shows Revisar pedido and the URL", async () => {
    const paid = whatsappOrder({ paymentStatus: "paid" });
    const detail = reviewJson({ status: { ...reviewJson().status, openForMessages: false, entry: "detail" } });
    const { api } = await mount({ order: paid, review: detail });
    expect(urlInput()?.value).toBe(url);
    expect(container.textContent).toContain("1 cambio con duda");
    expect(container.textContent).not.toContain("Revisa el pedido antes de enviar el enlace.");
    await click(button("Revisar pedido"));
    expect(dialog()?.textContent).not.toContain("Antes de enviar el enlace");
    await click(button("Confirmar revisión"));
    await gone();
    expect(api.confirm).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ origin: "detail", linkAction: null }));
    await vi.waitFor(() => expect(document.activeElement?.id).toBe("order-review-open"));
    expect(api.recordLinkAction).not.toHaveBeenCalled();
  });

  test("a cancelled WhatsApp order shows no marks, no review and no «Por revisar»", async () => {
    const cancelled = whatsappOrder({ cancelled: true, status: "cancelled", cancelledAt: "2026-10-30T12:00:00.000Z" });
    const stale = reviewJson({ status: { ...reviewJson().status, toReview: false, entry: "none" } });
    await mount({ order: cancelled, review: stale });
    expect(container.textContent).not.toContain("Con duda");
    expect(container.textContent).not.toContain("Revisar pedido");
    expect(container.textContent).not.toContain("Por revisar");
    expect(container.textContent).not.toContain("1 cambio con duda");
    expect(container.textContent).toContain("Pedido cancelado");
  });

  test("an order created on web never shows the review, marks or Cambios por mensajes", async () => {
    await mount({ order: order1042(), review: noReview() });
    expect(urlInput()).not.toBeNull();
    expect(container.textContent).not.toContain("Cambios por mensajes");
    expect(container.textContent).not.toContain("Revisar pedido");
    expect(container.textContent).not.toContain("Con duda");
  });

  test("the doubtful item shows its badge and reason in Productos", async () => {
    await mount();
    const row = container.querySelector<HTMLElement>(`#order-line-${deadpoolM}`) ?? [...container.querySelectorAll("li")].find((li) => li.textContent?.includes("Disfraz de Deadpool"));
    expect(row?.textContent).toContain("Con duda");
    expect(row?.textContent).toContain("Un mensaje cambió talla: de L a M");
  });
});

describe("the review dialog", () => {
  const open = async (over: Partial<Over> = {}) => { const mounted = await mount(over); await click(button("Copiar enlace")); await settle(); return mounted; };

  test("the review dialog shows doubtful changes, points, products and total in reading order", async () => {
    const withPoint = reviewJson({ points: [point()], status: { ...reviewJson().status, pointCount: 1 }, loaded: { ...reviewJson().loaded, points: [{ pendingId: point().pendingId, since: point().since }] } });
    await open({ review: withPoint, api: fakeApi({ load: vi.fn(async () => ok({ review: withPoint, order: whatsappOrder() })) }) });
    const headings = [...dialog()!.querySelectorAll("h3")].map((heading) => heading.textContent);
    expect(headings).toEqual(["Cambios con duda", "Por resolver", "Productos"]);
    const text = dialog()!.textContent!;
    expect(text).toContain("Con duda");
    expect(text).toContain("Un mensaje cambió talla: de L a M");
    expect(text).toContain("El cliente escribió: “la quiero en M”");
    expect(text).toContain("Falta la variante: Polo básico ×2 — falta talla.");
    expect(text).toContain("Pregúntale al cliente o agrégalo en Productos, después de cerrar esta revisión.");
    expect(text).toContain("¿En qué talla quieres el Polo básico: S, M o L?");
    expect(dialog()!.querySelector("[aria-label='Copiar pregunta sobre Polo básico']")).not.toBeNull();
    expect(text).toContain("Traje de Príncipe Azul");
    expect(text).toMatch(/Total: S\/\s298\.00/);
    await click(dialog()!.querySelector("[aria-label='Copiar pregunta sobre Polo básico']")!);
    expect(writeText).toHaveBeenCalledWith("¿En qué talla quieres el Polo básico: S, M o L?");
    expect(dialog()!.textContent).toContain("Pregunta copiada");
  });

  test("the review dialog moves focus to its title and announces the mark with its item", async () => {
    await mount();
    await click(button("Copiar enlace"));
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("Revisa el pedido #1042"));
    const item = dialog()!.querySelector<HTMLElement>(`[data-item="${itemDeadpool}"]`)!;
    expect(item.textContent).toContain("Disfraz de Deadpool");
    expect(item.textContent).toContain("Con duda");
    expect(item.textContent).toContain("Un mensaje cambió talla: de L a M");
    await click(button("Cerrar"));
    await gone();
    await vi.waitFor(() => expect(document.activeElement?.id).toBe("order-link-copy"));
  });

  test("Deshacer mensaje is disabled while the dialog has corrections and enabled after Descartar correcciones", async () => {
    await open();
    const undo = () => [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.getAttribute("aria-label")?.startsWith("Deshacer mensaje de las 15:42"));
    expect(undo()?.getAttribute("aria-disabled")).toBeNull();
    await type(input(quantityLabel), "2");
    expect(undo()?.getAttribute("aria-disabled")).toBe("true");
    expect(dialog()!.textContent).toContain("Confirma o descarta tus correcciones antes de deshacer un mensaje.");
    await click(undo());
    expect(dialog()!.querySelector("[aria-label='Deshacer cambios']")).toBeNull();
    await click(button("Descartar correcciones"));
    expect(input(quantityLabel)?.value).toBe("1");
    expect(undo()?.getAttribute("aria-disabled")).toBeNull();
  });

  test("a shipped order's review is read-only with the lock text", async () => {
    const shipped = whatsappOrder({ deliveryStatus: "shipped", shippedAt: "2026-10-30T15:00:00.000Z", paymentStatus: "paid" });
    const detail = reviewJson({ status: { ...reviewJson().status, openForMessages: false, entry: "detail" } });
    const api = fakeApi({ load: vi.fn(async () => ok({ review: detail, order: shipped })) });
    await mount({ order: shipped, review: detail, api });
    await click(button("Revisar pedido"));
    await settle();
    const text = dialog()!.textContent!;
    expect(text).toContain("El pedido ya se envió; los productos ya no se pueden cambiar.");
    expect(input(quantityLabel)).toBeNull();
    expect([...dialog()!.querySelectorAll("button")].some((element) => element.textContent?.startsWith("Quitar"))).toBe(false);
    expect(text).not.toContain("Deshacer mensaje");
    await click(button("Confirmar revisión"));
    await gone();
    expect(api.confirm).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ corrections: [] }));
  });

  test("a review confirmation without connection keeps corrections and takes no link", async () => {
    const api = fakeApi({ confirm: vi.fn(async () => err({ code: "no_answer" as const, message: "No answer" })) });
    await open({ api, retryDelaysMs: [0] });
    await type(input(quantityLabel), "2");
    await click(button("Confirmar revisión"));
    await vi.waitFor(() => expect(dialog()!.textContent).toContain("No se pudieron guardar los cambios. Revisa tu conexión e inténtalo de nuevo."));
    expect(api.confirm).toHaveBeenCalledTimes(2);
    const ids = api.confirm.mock.calls.map((call) => (call[1] as { id: string }).id);
    expect(ids[0]).toBe(ids[1]);
    expect(input(quantityLabel)?.value).toBe("2");
    expect(dialog()).not.toBeNull();
    expect(urlInput()).toBeNull();
    expect(api.recordLinkAction).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  test("corrections go to core as the quantity or 0 for Quitar, and a quantity out of range blocks the confirmation", async () => {
    const api = fakeApi();
    await open({ api });
    await type(input(quantityLabel), "");
    await type(input(quantityLabel), "0");
    expect(dialog()!.textContent).toContain("Ingresa una cantidad de 1 a 9999.");
    await click(button("Confirmar revisión"));
    expect(api.confirm).not.toHaveBeenCalled();
    await type(input(quantityLabel), "3");
    await click(button("Confirmar revisión"));
    await gone();
    expect(api.confirm).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ corrections: [{ itemId: itemDeadpool, quantity: 3 }] }));
  });

  test("Quitar sends 0 and cannot take the last item", async () => {
    const api = fakeApi();
    await open({ api });
    await click(button("Quitar Disfraz de Deadpool M"));
    expect(dialog()!.textContent).toContain("Se quitará al confirmar.");
    await click(button("Confirmar revisión"));
    await gone();
    expect(api.confirm).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ corrections: [{ itemId: itemDeadpool, quantity: 0 }] }));
    unmount();
    const single = whatsappOrder({ items: [order1042().items[2]!], total: pen(120), itemsTotal: pen(120) });
    const one = fakeApi({ load: vi.fn(async () => ok({ review: reviewJson(), order: single })) });
    await mount({ order: single, api: one });
    await click(button("Copiar enlace"));
    await settle();
    expect(button("Quitar Disfraz de Deadpool M")?.getAttribute("aria-disabled")).toBe("true");
    expect(dialog()!.textContent).toContain("El pedido necesita al menos un producto. Si ya no va, cancélalo.");
  });

  test("a confirmation answered REVIEW_OUTDATED reloads the review, keeps corrections on untouched items and focuses the alert", async () => {
    const outdated = { code: "refused" as const, message: "outdated", error: { code: "REVIEW_OUTDATED" as const, error: "outdated", affectedItemIds: [itemDeadpool], newPoints: 0 } };
    const api = fakeApi({ confirm: vi.fn(async () => err(outdated)) });
    const two = reviewJson({ doubtful: [{ change: doubtfulChange(), quote: null }, { change: doubtfulChange({ id: "00000000-0000-4000-8000-0000000000c3", kind: "quantity_changed", before: sureChange().after, after: { ...sureChange().after!, itemId: itemTrajeL, quantity: 2 },
      decision: { kind: "doubtful", reason: { kind: "quantity_set", quantity: 2 } } }), quote: null }] });
    await open({ api, review: two });
    await type(input(quantityLabel), "2");
    await click(button("Confirmar revisión"));
    await vi.waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("alert"));
    expect(document.activeElement?.textContent).toBe("Llegó un mensaje mientras revisabas. Revisa lo marcado y confirma de nuevo.");
    expect(input(quantityLabel)?.value).toBe("1");
    expect(dialog()!.textContent).toContain("Cambió mientras revisabas");
    expect(api.load).toHaveBeenCalledTimes(2);
  });

  test("a confirmation after a sure message elsewhere says what changed and the confirmed total", async () => {
    const api = fakeApi({ confirm: vi.fn(async () => ok(confirmed({ changedMeanwhile: [sureChange()], total: pen(338) }))) });
    await open({ api });
    await click(button("Confirmar revisión"));
    await gone();
    expect(container.textContent).toMatch(/Mientras revisabas, un mensaje agregó Gorra trucker · Rojo · ×1\. Total: S\/\s338\.00\./);
  });

  test("a confirmation with changes that arrived meanwhile keeps the URL until the link is taken, then asks for the review again", async () => {
    const api = fakeApi({ confirm: vi.fn(async () => ok(confirmed({ changedMeanwhile: [sureChange()], total: pen(338) }))) });
    await mount({ api, afterChange: reviewJson() });
    await click(button("Copiar enlace"));
    await click(button("Confirmar revisión"));
    await gone();
    expect(urlInput()?.value).toBe(url);
    await click(button("Copiar enlace"));
    expect(dialog()).toBeNull();
    expect(writeText).toHaveBeenCalledWith(url);
    expect(api.recordLinkAction).toHaveBeenCalledWith("00000000-0000-4000-8000-000000001042", { id: expect.any(String), action: "copy" });
    expect(urlInput()).toBeNull();
    await click(button("Copiar enlace"));
    expect(dialog()?.textContent).toContain("Revisa el pedido #1042");
  });

  test("Deshacer mensaje in the dialog is disabled while the confirmation is saving", async () => {
    let finish: () => void = () => undefined;
    const api = fakeApi({ confirm: vi.fn(() => new Promise<ReturnType<typeof ok>>((resolve) => { finish = () => resolve(ok(confirmed())); })) as never });
    await open({ api });
    const undo = () => [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.getAttribute("aria-label")?.startsWith("Deshacer mensaje de las"));
    await click(button("Confirmar revisión"));
    expect(undo()?.getAttribute("aria-disabled")).toBe("true");
    await click(undo());
    expect(document.body.textContent).not.toContain("¿Deshacer lo que hizo este mensaje?");
    await act(async () => finish());
  });

  test("a refusal for a product no longer sold names the product when the message touched one line", async () => {
    const review = reviewJson({ messageRows: [{ messageId: messageTwo, at: "2026-10-29T20:42:00.000Z", changes: [sureChange()], undo: { kind: "refused", reason: "not_sold" }, pendings: noPendings }] });
    await mount({ review });
    expect(container.textContent).toContain("Gorra trucker · Rojo ya no se vende.");
  });

  test("a second seller's edit answers ORDER_CHANGED and reloads", async () => {
    const changed = { code: "refused" as const, message: "changed", error: { code: "ORDER_CHANGED" as const, error: "changed" } };
    const api = fakeApi({ confirm: vi.fn(async () => err(changed)) });
    await open({ api });
    await click(button("Confirmar revisión"));
    await vi.waitFor(() => expect(dialog()!.textContent).toContain("Este pedido cambió mientras lo revisabas. Revísalo de nuevo."));
    expect(api.load).toHaveBeenCalledTimes(2);
  });

  test("Cerrar with corrections asks before discarding them", async () => {
    await open();
    await type(input(quantityLabel), "2");
    await click(button("Cerrar"));
    expect(document.body.textContent).toContain("¿Descartar los cambios?");
    await click(button("Seguir revisando"));
    expect(input(quantityLabel)?.value).toBe("2");
    await click(button("Cerrar"));
    await click(buttons().filter((element) => element.textContent === "Descartar cambios").at(-1));
    await gone();
  });

  test("a failed load keeps the link untaken and offers Reintentar", async () => {
    const api = fakeApi({ load: vi.fn(async () => err({ code: "no_answer" as const, message: "No answer" })) });
    await open({ api });
    expect(dialog()!.textContent).toContain("No pudimos cargar el pedido. Revisa tu conexión.");
    expect(button("Reintentar")).toBeDefined();
    expect(urlInput()).toBeNull();
  });
});
