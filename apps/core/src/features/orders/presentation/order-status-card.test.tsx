// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, describe, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { OrderStatusCard, primaryOperation, statusSteps } from "@core/src/features/orders/presentation/order-status-card";
import { homeDelivery, order1042, pen } from "@core/src/features/orders/presentation/order-1042.fixture";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// 2026-10-30 10:00 in Lima
const now = new Date("2026-10-30T15:00:00.000Z");
const i18n = createInstance();
void i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });
const agencyDelivery = { ...homeDelivery, method: "agency" as const } as unknown as OrderAggregateResponse["delivery"];
const storeDelivery = { method: "store", recipient: homeDelivery.recipient, pickupPoint: { name: "Tienda", address: "Jr. Unión 1", instructions: null }, settingsVersion: 1, recordedBy: homeDelivery.recordedBy } as unknown as OrderAggregateResponse["delivery"];
const noPayment = { paidAmount: pen(0), balanceDue: pen(298), payments: [] };

describe("OrderStatusCard", () => {
  let root: Root | undefined;
  const calls = { fulfill: vi.fn(), cancel: vi.fn(), addPayment: vi.fn() };
  afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.clearAllMocks(); });

  function mount(patch: Partial<OrderAggregateResponse> = {}, props: { unsaved?: boolean; busy?: boolean } = {}) {
    root = createRoot(document.body.appendChild(document.createElement("div")));
    act(() => root!.render(<I18nextProvider i18n={i18n}><OrderStatusCard order={order1042(patch)} unsaved={props.unsaved ?? false} busy={props.busy ?? false}
      onFulfill={calls.fulfill} onCancel={calls.cancel} onAddPayment={calls.addPayment} now={now} /></I18nextProvider>));
  }
  const text = () => document.body.textContent ?? "";
  const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.includes(name));
  const click = (name: string) => act(() => button(name)!.click());
  const steps = () => [...document.querySelectorAll("ol > li")];
  const disabled = (name: string) => button(name)?.getAttribute("aria-disabled") === "true";

  test("pending home delivery with a partial payment: stepper, primary action and links", () => {
    mount();
    expect(text()).toContain("Estado del pedido"); expect(text()).toContain("Entrega a domicilio");
    expect(document.querySelector("[data-testid=order-status-badge]")?.textContent).toBe("Pendiente");
    expect(steps().map(step => step.textContent)).toEqual(["1PendienteHoy 04:10", "2Enviado", "3Entregado"]);
    expect(steps().filter(step => step.getAttribute("aria-current") === "step").map(step => step.textContent)).toEqual(["1PendienteHoy 04:10"]);
    expect(disabled("Marcar enviado")).toBe(false);
    for (const name of ["Entregar directamente", "Cancelar pedido"]) expect(button(name)).toBeDefined();
    expect(button("Marcar entregado")).toBeUndefined();
    click("Marcar enviado"); expect(calls.fulfill).toHaveBeenCalledWith("ship");
    click("Entregar directamente"); expect(calls.fulfill).toHaveBeenLastCalledWith("deliver");
    click("Cancelar pedido"); expect(calls.cancel).toHaveBeenCalledOnce();
  });

  test("agency has the same three steps and its own subtitle", () => {
    mount({ delivery: agencyDelivery });
    expect(text()).toContain("Entrega por agencia"); expect(steps()).toHaveLength(3);
  });

  test("a pending order without delivery is told as to be defined and keeps three steps", () => {
    mount({ delivery: null });
    expect(text()).toContain("Entrega por definir"); expect(steps()).toHaveLength(3);
  });

  test("store pickup: two steps, one tap to deliver, no shipping", () => {
    mount({ delivery: storeDelivery });
    expect(text()).toContain("Recojo en tienda"); expect(steps().map(step => step.textContent)).toEqual(["1PendienteHoy 04:10", "2Entregado"]);
    expect(button("Marcar enviado")).toBeUndefined(); expect(button("Entregar directamente")).toBeUndefined();
    expect(text()).toContain("Recojo en tienda · sin envío");
    click("Marcar entregado"); expect(calls.fulfill).toHaveBeenCalledWith("deliver");
    expect(button("Cancelar pedido")).toBeDefined();
  });

  test("shipped: only «Marcar entregado», no back-to-pending nor cancel", () => {
    mount({ deliveryStatus: "shipped", shippedAt: "2026-10-30T14:25:00.000Z", stockDeducted: true });
    expect(document.querySelector("[data-testid=order-status-badge]")?.textContent).toBe("Enviado");
    expect(steps().map(step => step.textContent)).toEqual(["PendienteHoy 04:10", "2EnviadoHoy 09:25", "3Entregado"]);
    expect(button("Marcar entregado")).toBeDefined();
    for (const absent of ["Marcar enviado", "Entregar directamente", "Cancelar pedido", "Volver a pendiente"]) expect(text()).not.toContain(absent);
  });

  test("delivered with a recipient: no buttons, no undo, and a balance may remain", () => {
    mount({ deliveryStatus: "delivered", shippedAt: "2026-10-29T14:25:00.000Z", deliveredAt: "2026-10-30T21:40:00.000Z", stockDeducted: true });
    expect(document.querySelector("[data-testid=order-status-badge]")?.textContent).toBe("Entregado");
    expect(document.querySelectorAll("button")).toHaveLength(0);
    expect(text()).toContain("Entregado a Jorge Gonzalez el 30 oct, 16:40.");
    expect(text()).not.toContain("Deshacer entrega");
    expect(steps()[2]!.textContent).toContain("Hoy 16:40");
  });

  test("delivered straight from pending shows «Enviado» done without a date and names no one without a recipient", () => {
    mount({ deliveryStatus: "delivered", deliveredAt: "2026-10-30T21:40:00.000Z", delivery: null, stockDeducted: true });
    expect(steps()[1]!.textContent).toBe("EnviadoSe entregó directamente, sin envío.");
    expect(statusSteps(order1042({ deliveryStatus: "delivered", deliveredAt: "2026-10-30T21:40:00.000Z" }))[1]).toMatchObject({ key: "shipped", tone: "done", at: null });
    expect(text()).toContain("Entregado el 30 oct, 16:40.");
  });

  test("cancelled: red end step, stock sentence only when stock had been deducted", () => {
    const cancelled = { cancelled: true, status: "cancelled" as const, cancelledAt: "2026-10-29T23:40:00.000Z" };
    mount({ ...cancelled, stockDeducted: true });
    expect(document.querySelector("[data-testid=order-status-badge]")?.textContent).toBe("Cancelado");
    expect(steps().map(step => step.textContent)).toEqual(["PendienteHoy 04:10", "Cancelado29 oct"]);
    expect(document.querySelectorAll("button")).toHaveLength(0);
    expect(text()).toContain("Pedido cancelado el 29 oct, 18:40. El stock de los productos se devolvió al inventario.");
    expect(text()).not.toContain("Reabrir");
    act(() => root!.unmount()); document.body.innerHTML = "";
    mount({ ...cancelled, stockDeducted: false });
    expect(text()).toContain("Pedido cancelado el 29 oct, 18:40."); expect(text()).not.toContain("devolvió");
  });

  test("without a confirmed payment the actions are disabled with an amber note and a link to Pagos, but cancelling stays enabled", () => {
    mount(noPayment);
    expect(disabled("Marcar enviado")).toBe(true); expect(disabled("Entregar directamente")).toBe(true); expect(disabled("Cancelar pedido")).toBe(false);
    expect(document.getElementById("order-status-note")?.textContent).toContain("Registra al menos un pago para enviar. Puede ser un pago parcial. Agregar pago");
    expect(button("Marcar enviado")?.getAttribute("aria-describedby")).toBe("order-status-note");
    click("Marcar enviado"); click("Entregar directamente"); expect(calls.fulfill).not.toHaveBeenCalled();
    click("Agregar pago"); expect(calls.addPayment).toHaveBeenCalledOnce();
    click("Cancelar pedido"); expect(calls.cancel).toHaveBeenCalledOnce();
  });

  test("store pickup without payment says «para entregar»", () => {
    mount({ ...noPayment, delivery: storeDelivery });
    expect(document.getElementById("order-status-note")?.textContent).toContain("Registra al menos un pago para entregar.");
    expect(disabled("Marcar entregado")).toBe(true);
  });

  test("waiting stock keeps its reason under the button, in the same way", () => {
    mount({ stockDue: { kind: "waiting", shortItems: [{ variantId: order1042().items[0]!.variantId, available: 0 }] } });
    expect(disabled("Marcar enviado")).toBe(true);
    expect(document.getElementById("order-status-note")?.textContent).toContain("Para enviar falta stock de Traje de Príncipe Azul (M).");
    expect(button("Agregar pago")).toBeUndefined();
  });

  test("unsaved edits or a running action disable the transitions and the cancellation", () => {
    mount({}, { unsaved: true });
    for (const name of ["Marcar enviado", "Entregar directamente", "Cancelar pedido"]) expect(disabled(name)).toBe(true);
    click("Marcar enviado"); click("Cancelar pedido"); expect(calls.fulfill).not.toHaveBeenCalled(); expect(calls.cancel).not.toHaveBeenCalled();
    act(() => root!.unmount()); document.body.innerHTML = "";
    mount({}, { busy: true }); expect(disabled("Marcar enviado")).toBe(true);
  });

  test("primaryOperation follows the state", () => {
    expect(primaryOperation(order1042())).toBe("ship");
    expect(primaryOperation(order1042({ delivery: storeDelivery }))).toBe("deliver");
    expect(primaryOperation(order1042({ deliveryStatus: "shipped" }))).toBe("deliver");
    expect(primaryOperation(order1042({ deliveryStatus: "delivered" }))).toBeNull();
    expect(primaryOperation(order1042({ cancelled: true }))).toBeNull();
  });
});
