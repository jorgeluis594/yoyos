// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { expect, test } from "vitest";
import resources from "@core/app/locales";
import { OrderStatusIndicators, orderOriginKey, orderStatusLabels, type LabelledOrder } from "@core/src/features/orders/presentation/order-status-labels";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const instance = async (lng: "es" | "pt" = "es") => { const i18n = createInstance(); await i18n.use(initReactI18next).init({ lng, resources, interpolation: { escapeValue: false } }); return i18n; };
const order = (values: Partial<LabelledOrder> = {}): LabelledOrder =>
  ({ status: "active", paymentStatus: "pending", deliveryStatus: "pending", balanceDue: { amount: 148, currency: "PEN" }, ...values });
const render = async (value: LabelledOrder, lng: "es" | "pt" = "es") => {
  const i18n = await instance(lng);
  const host = document.createElement("div");
  await act(async () => { createRoot(host).render(<I18nextProvider i18n={i18n}><OrderStatusIndicators order={value} /></I18nextProvider>); });
  return host;
};

test("shows only Venta completada for a completed sale", async () => {
  const { t } = await instance();
  expect(orderStatusLabels(order({ status: "completed", paymentStatus: "paid", deliveryStatus: "delivered", balanceDue: { amount: 0, currency: "PEN" } }), t, "es"))
    .toEqual([{ kind: "order", state: "completed", text: "Venta completada", name: "Estado de la venta: Venta completada" }]);
  const host = await render(order({ status: "completed", paymentStatus: "paid", deliveryStatus: "delivered" }));
  expect(host.querySelectorAll("summary")).toHaveLength(1);
  expect(host.querySelector("summary")?.getAttribute("aria-label")).toBe("Estado de la venta: Venta completada");
});

test("shows only Pedido cancelado without balance for a cancelled order", async () => {
  const { t } = await instance();
  expect(orderStatusLabels(order({ status: "cancelled" }), t, "es"))
    .toEqual([{ kind: "order", state: "cancelled", text: "Pedido cancelado", name: "Estado del pedido: Pedido cancelado" }]);
  const host = await render(order({ status: "cancelled", deliveryStatus: "shipped" }));
  expect(host.textContent).toBe("Pedido cancelado");
  expect(host.textContent).not.toMatch(/S\/|Entrega|Pago/);
});

test("shows Pago pendiente with the balance and Enviada for an active partially paid shipped order", async () => {
  const { t } = await instance();
  const [payment, delivery] = orderStatusLabels(order({ deliveryStatus: "shipped" }), t, "es");
  expect(payment).toMatchObject({ kind: "payment", state: "pending", text: expect.stringMatching(/^Pago pendiente: S\/\s148\.00$/) });
  expect(delivery).toEqual({ kind: "delivery", state: "shipped", text: "Enviada", name: "Estado de la entrega: Enviada" });
  const host = await render(order({ deliveryStatus: "shipped" }));
  expect(host.querySelector("details span")?.textContent).toMatch(/^Pago pendiente: S\/\s148\.00 · Enviada$/);
});

test("names labels with Estado del pago and Estado de la entrega", async () => {
  const { t } = await instance();
  const names = (value: LabelledOrder) => orderStatusLabels(value, t, "es").map((label) => label.name);
  expect(names(order())).toEqual([expect.stringMatching(/^Estado del pago: Pago pendiente: S\/\s148\.00$/), "Estado de la entrega: Entrega pendiente"]);
  expect(names(order({ paymentStatus: "paid", deliveryStatus: "delivered", balanceDue: { amount: 0, currency: "PEN" } })))
    .toEqual(["Estado del pago: Pagada", "Estado de la entrega: Entregada"]);
  const host = await render(order({ deliveryStatus: "shipped" }));
  expect(host.querySelector("summary")?.getAttribute("aria-label")).toMatch(/^Estado del pago: .*· Estado de la entrega: Enviada$/);
});

test("uses one icon per dimension and never repeats the old Coins, Send or PackageCheck icons", async () => {
  const host = await render(order({ deliveryStatus: "shipped" }));
  const icons = [...host.querySelectorAll("summary svg")].map((svg) => svg.getAttribute("class") ?? "");
  expect(icons).toHaveLength(2);
  expect(icons[0]).toContain("lucide-credit-card");
  expect(icons[1]).toContain("lucide-truck");
  expect(icons[1]).toContain("text-[var(--info)]");
});

test("keeps Enviada in Portuguese and maps the origin of an order to its subtitle key", async () => {
  const { t } = await instance("pt");
  expect(orderStatusLabels(order({ deliveryStatus: "shipped" }), t, "pt")[1].text).toBe("Enviada");
  expect(orderOriginKey("manual")).toBe("orderView.header.origin.manual");
  expect(orderOriginKey("catalog")).toBe("orderView.header.origin.catalog");
  expect(orderOriginKey("whatsapp")).toBe("orderView.header.origin.whatsapp");
});
