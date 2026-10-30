import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { expect, test } from "vitest";
import resources from "@core/app/locales";
import { BuyerPaymentContent } from "@core/src/features/orders/presentation/buyer-payment-content";
import { checkoutScreen } from "@core/src/features/orders/presentation/buyer-checkout-screen";
import type { BuyerPaymentView } from "@shared/contracts/orders";

const money = (amount: number) => ({ amount, currency: "PEN" as const });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const view = (overrides: Partial<BuyerPaymentView>): BuyerPaymentView => ({ orderId: id(1), total: money(70), deliveryCharge: money(10), availability: "available",
  paidAmount: money(0), balanceDue: money(70), paymentStatus: "pending", rejectedReport: null,
  settings: [{ method: "digital_wallet", provider: "Plin", holder: "Tienda", imageUrl: "https://cdn.example/qr.png" }],
  payments: [], ...overrides });

async function render(value: BuyerPaymentView, lng = "es") {
  const i18n = createInstance();
  await i18n.init({ lng, resources });
  const screen = checkoutScreen({ state: "confirmed", view: value });
  if (screen.kind !== "payment" && screen.kind !== "paid" && screen.kind !== "payment_unavailable") throw new Error(`No payment content for ${screen.kind}`);
  const router = createMemoryRouter([{ path: "/", element: createElement(BuyerPaymentContent, { screen }) }]);
  try { return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(RouterProvider, { router }))); }
  finally { router.dispose(); }
}

test("shows the rejection notice with its reason at the start of the upload block and lists the rejected receipt", async () => {
  const html = await render(view({ rejectedReport: { reason: "El monto no coincide" },
    payments: [{ id: id(2), status: "rejected", amount: null, method: null, receiptImageUrl: "https://cdn.example/r.png", rejectionReason: "El monto no coincide", reportedAt: "2026-10-30T23:42:00.000Z" }] }));
  expect(html).toContain("Tu comprobante fue rechazado");
  expect(html).toContain("Motivo: El monto no coincide");
  expect(html).toContain("Envía otro comprobante para que la tienda lo revise.");
  expect(html.indexOf("Tu comprobante fue rechazado")).toBeLessThan(html.indexOf("Adjunta tu comprobante"));
  expect(html).toContain("Ver captura · Rechazado");
  // The reason shows twice: in the notice and under the rejected receipt.
  expect(html.split("Motivo: El monto no coincide").length - 1).toBe(2);
  expect(html.indexOf("Ver captura · Rechazado")).toBeLessThan(html.lastIndexOf("Motivo: El monto no coincide"));
  expect(html).not.toContain("Pago pendiente de revisión");
  expect(html).toContain('id="checkout-rejected-title"');
  expect(html).not.toContain("role=\"status\"");
});

test("shows the reason once with its own period and no doubled one", async () => {
  const html = await render(view({ rejectedReport: { reason: "El monto no coincide." },
    payments: [{ id: id(2), status: "rejected", amount: null, method: null, receiptImageUrl: "https://cdn.example/r.png", rejectionReason: "El monto no coincide.", reportedAt: "2026-10-30T23:42:00.000Z" }] }));
  expect(html).toContain("Motivo: El monto no coincide.");
  expect(html).not.toContain("coincide..");
});

test("renders the rejected checkout state in Portuguese without a doubled period", async () => {
  const html = await render(view({ rejectedReport: { reason: "Valor diferente." },
    payments: [{ id: id(2), status: "rejected", amount: null, method: null, receiptImageUrl: "https://cdn.example/r.png", rejectionReason: "Valor diferente.", reportedAt: "2026-10-30T23:42:00.000Z" }] }), "pt");
  expect(html).toContain("Seu comprovante foi rejeitado");
  expect(html).toContain("Motivo: Valor diferente.");
  expect(html).not.toContain("diferente..");
  expect(html).toContain("Envie outro comprovante para que a loja o revise.");
});
