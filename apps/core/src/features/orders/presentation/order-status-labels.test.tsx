// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { expect, test } from "vitest";
import resources from "@core/app/locales";
import { OrderStatusText, orderOriginKey, orderStatusLabels, type LabelledOrder } from "@core/src/features/orders/presentation/order-status-labels";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const instance = async (lng: "es" | "pt" = "es") => { const i18n = createInstance(); await i18n.use(initReactI18next).init({ lng, resources, interpolation: { escapeValue: false } }); return i18n; };
const order = (values: Partial<LabelledOrder> = {}): LabelledOrder =>
  ({ status: "active", paymentStatus: "pending", deliveryStatus: "pending", total: { amount: 298, currency: "PEN" }, balanceDue: { amount: 148, currency: "PEN" }, ...values });
const render = async (value: LabelledOrder, lng: "es" | "pt" = "es") => {
  const i18n = await instance(lng);
  const host = document.createElement("div");
  await act(async () => { createRoot(host).render(<I18nextProvider i18n={i18n}><OrderStatusText order={value} /></I18nextProvider>); });
  return host;
};

test("shows only Venta completada for a completed sale", async () => {
  const { t } = await instance();
  expect(orderStatusLabels(order({ status: "completed", paymentStatus: "paid", deliveryStatus: "delivered", balanceDue: { amount: 0, currency: "PEN" } }), t, "es"))
    .toEqual([{ kind: "order", state: "completed", text: "Venta completada", name: "Estado de la venta: Venta completada" }]);
  const host = await render(order({ status: "completed", paymentStatus: "paid", deliveryStatus: "delivered" }));
  expect(host.querySelectorAll("li")).toHaveLength(1);
  expect(host.textContent).toBe("Venta completada");
});

test("shows only Pedido cancelado without balance for a cancelled order", async () => {
  const { t } = await instance();
  expect(orderStatusLabels(order({ status: "cancelled" }), t, "es"))
    .toEqual([{ kind: "order", state: "cancelled", text: "Pedido cancelado", name: "Estado del pedido: Pedido cancelado" }]);
  const host = await render(order({ status: "cancelled", deliveryStatus: "shipped" }));
  expect(host.textContent).toBe("Pedido cancelado");
  expect(host.textContent).not.toMatch(/S\/|Entrega|Pago/);
});

test("a partially paid order reads «Pago parcial · falta S/ 35.00»", async () => {
  const { t } = await instance();
  const partial = order({ total: { amount: 55, currency: "PEN" }, balanceDue: { amount: 35, currency: "PEN" } });
  const [payment, delivery] = orderStatusLabels(partial, t, "es");
  expect(payment).toMatchObject({ kind: "payment", state: "pending", text: expect.stringMatching(/^Pago parcial · falta S\/\s35\.00$/) });
  expect(delivery).toEqual({ kind: "delivery", state: "pending", text: "Entrega pendiente", name: "Estado de la entrega: Entrega pendiente" });
  const host = await render(partial);
  expect([...host.querySelectorAll("li")].map((item) => item.textContent?.replace(/\u00a0/g, " "))).toEqual(["Pago parcial · falta S/ 35.00", "Entrega pendiente"]);
});

test("an order with no payment reads «Pago pendiente»", async () => {
  const { t } = await instance();
  const unpaid = order({ total: { amount: 148, currency: "PEN" }, balanceDue: { amount: 148, currency: "PEN" }, deliveryStatus: "shipped" });
  expect(orderStatusLabels(unpaid, t, "es")[0]).toMatchObject({ text: "Pago pendiente", name: "Estado del pago: Pago pendiente" });
  const host = await render(unpaid);
  expect([...host.querySelectorAll("li")].map((item) => item.textContent)).toEqual(["Pago pendiente", "Enviada"]);
});

test("a paid order reads «Pagado» in the list and the badge", async () => {
  const { t } = await instance();
  const paid = order({ paymentStatus: "paid", deliveryStatus: "delivered", balanceDue: { amount: 0, currency: "PEN" } });
  expect(orderStatusLabels(paid, t, "es").map((label) => label.name)).toEqual(["Estado del pago: Pagado", "Estado de la entrega: Entregada"]);
  const host = await render(paid);
  expect([...host.querySelectorAll("li")].map((item) => item.textContent)).toEqual(["Pagado", "Entregada"]);
});

test("uses one icon per dimension and never repeats the old Coins, Send or PackageCheck icons", async () => {
  const host = await render(order({ deliveryStatus: "shipped" }));
  const icons = [...host.querySelectorAll("li svg")].map((svg) => svg.getAttribute("class") ?? "");
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
