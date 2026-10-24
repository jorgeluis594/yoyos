import { createInstance } from "i18next";
import { expect, test } from "vitest";
import resources from "@core/app/locales";
import { paymentActionName, paymentCardSummary, paymentRowActions, paymentRowBlocked } from "@core/src/features/orders/presentation/order-payments-card";

const money = (amount: number) => ({ amount, currency: "PEN" as const });
const order = (overrides: Partial<Parameters<typeof paymentCardSummary>[0]> = {}) =>
  ({ cancelled: false, balanceDue: money(70), deliveryCharge: money(10), payments: [{ status: "reported" as const }], ...overrides });

test("offers reject and approve only on a pending report of an order that is not cancelled", () => {
  expect(paymentRowActions({ status: "reported" }, { cancelled: false })).toEqual({ reject: true, approve: true, void: false });
  for (const status of ["confirmed", "rejected", "voided"] as const) {
    expect(paymentRowActions({ status }, { cancelled: false })).toMatchObject({ reject: false, approve: false });
  }
  expect(paymentRowActions({ status: "reported" }, { cancelled: true })).toEqual({ reject: false, approve: false, void: false });
  expect(paymentRowActions({ status: "confirmed" }, { cancelled: false }).void).toBe(true);
  expect(paymentRowActions({ status: "confirmed" }, { cancelled: true }).void).toBe(true);
  expect(paymentRowActions({ status: "rejected" }, { cancelled: false }).void).toBe(false);
});

test("shows a cancelled order read-only without Pago por revisar", () => {
  expect(paymentCardSummary(order()).reviewPending).toBe(true);
  expect(paymentCardSummary(order({ payments: [{ status: "confirmed" }, { status: "rejected" }] })).reviewPending).toBe(false);
  const cancelled = paymentCardSummary(order({ cancelled: true }));
  expect(cancelled).toMatchObject({ reviewPending: false, canRegisterPayment: false });
});

test("offers Registrar pago only while Pendiente is above zero", () => {
  expect(paymentCardSummary(order()).canRegisterPayment).toBe(true);
  expect(paymentCardSummary(order({ balanceDue: money(0) })).canRegisterPayment).toBe(false);
  expect(paymentCardSummary(order({ deliveryCharge: money(0) })).includesDelivery).toBe(false);
  expect(paymentCardSummary(order()).includesDelivery).toBe(true);
});

test("names each row action with the row date and time", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "es", resources, interpolation: { escapeValue: false } });
  const morning = "23/10/2026 10:12 p. m.", evening = "24/10/2026 8:00 a. m.";
  const actions = ["thumbnail", "viewReceipt", "approve", "reject", "void"] as const;
  const names = actions.flatMap(action => [morning, evening].map(when => paymentActionName(i18n.t, action, when)));
  expect(new Set(names).size).toBe(names.length);
  expect(paymentActionName(i18n.t, "thumbnail", morning)).toBe("Ver comprobante del 23/10/2026 10:12 p. m.");
  expect(paymentActionName(i18n.t, "approve", morning)).toBe("Aprobar pago reportado el 23/10/2026 10:12 p. m.");
  for (const name of names) expect(name).toMatch(/\d{2}\/10\/2026/);
});

test("blocks the row after a lost response until the card reloads, and every row while it reloads", () => {
  const order = {}, reloaded = {};
  const uncertain = { paymentId: "a", order };
  expect(paymentRowBlocked("a", uncertain, order, true)).toBe(true);
  expect(paymentRowBlocked("b", uncertain, order, true)).toBe(false);
  expect(paymentRowBlocked("a", uncertain, reloaded, true)).toBe(false);
  expect(paymentRowBlocked("b", null, order, false)).toBe(true);
});

test("names the pt receipt link as its visible label and keeps the reported wording consistent", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "pt", resources, interpolation: { escapeValue: false } });
  const when = "23/10/2026 10:12";
  expect(i18n.t("orders.viewReceipt")).toBe("Ver comprovante");
  expect(paymentActionName(i18n.t, "viewReceipt", when)).toContain(i18n.t("orders.viewReceipt"));
  expect(paymentActionName(i18n.t, "viewReceipt", when)).not.toBe(paymentActionName(i18n.t, "thumbnail", when));
  expect(i18n.t("orders.paymentReported")).toBe("Pagamento reportado, pendente de revisão");
  expect(paymentActionName(i18n.t, "reject", when)).toBe("Rejeitar pagamento reportado em 23/10/2026 10:12");
});
