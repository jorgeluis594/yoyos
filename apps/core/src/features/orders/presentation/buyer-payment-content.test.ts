import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { expect, test } from "vitest";
import resources from "@core/app/locales";
import { BuyerPaymentContent } from "@core/src/features/orders/presentation/buyer-payment-content";
import type { BuyerPaymentView } from "@shared/contracts/orders";

const money = (amount: number) => ({ amount, currency: "PEN" as const });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const view = (overrides: Partial<BuyerPaymentView>): BuyerPaymentView => ({ orderId: id(1), total: money(70), deliveryCharge: money(10), availability: "available",
  paidAmount: money(0), balanceDue: money(70), paymentStatus: "pending", rejectedReport: null,
  settings: [{ method: "digital_wallet", provider: "Plin", holder: "Tienda", imageUrl: "https://cdn.example/qr.png" }],
  payments: [], ...overrides });

async function render(value: BuyerPaymentView) {
  const i18n = createInstance();
  await i18n.init({ lng: "es", resources });
  const router = createMemoryRouter([{ path: "/", element: createElement(BuyerPaymentContent, { view: value }) }]);
  try { return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(RouterProvider, { router }))); }
  finally { router.dispose(); }
}

test("shows the rejection notice with its reason at the start of the upload block and lists the rejected receipt", async () => {
  const html = await render(view({ rejectedReport: { reason: "El monto no coincide" },
    payments: [{ id: id(2), status: "rejected", amount: null, method: null, receiptImageUrl: "https://cdn.example/r.png", rejectionReason: "El monto no coincide" }] }));
  expect(html).toContain("Tu comprobante fue rechazado");
  expect(html).toContain("Motivo: El monto no coincide.");
  expect(html).toContain("Envía otro comprobante para que la tienda lo revise.");
  expect(html.indexOf("Tu comprobante fue rechazado")).toBeLessThan(html.indexOf("Adjunta tu comprobante"));
  expect(html).toContain("Ver captura · Rechazado");
  // The reason shows twice: in the notice and under the rejected receipt.
  expect(html.split("Motivo: El monto no coincide.").length - 1).toBe(2);
  expect(html.indexOf("Ver captura · Rechazado")).toBeLessThan(html.lastIndexOf("Motivo: El monto no coincide."));
  expect(html).not.toContain("Pago pendiente de revisión");
});

test("shows the pending notice instead of the upload block while a report is pending", async () => {
  const html = await render(view({ payments: [{ id: id(3), status: "reported", amount: null, method: null, receiptImageUrl: "https://cdn.example/n.png", rejectionReason: null }] }));
  expect(html).toContain("Pago pendiente de revisión");
  expect(html).not.toContain("Tu comprobante fue rechazado");
  expect(html).not.toContain("Adjunta tu comprobante");
});
