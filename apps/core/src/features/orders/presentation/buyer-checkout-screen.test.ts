import { describe, expect, test } from "vitest";
import type { BuyerPaymentView } from "@shared/contracts/orders";
import { amountRows, checkoutScreen, focusTargetFor, formatReceiptDate } from "@core/src/features/orders/presentation/buyer-checkout-screen";

const pen = (amount: number) => ({ amount, currency: "PEN" as const });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type ViewPayment = BuyerPaymentView["payments"][number];
const payment = (n: number, status: ViewPayment["status"], overrides: Partial<ViewPayment> = {}): ViewPayment => ({ id: id(n), status, amount: null, method: null,
  receiptImageUrl: `https://cdn.example/${n}.png`, rejectionReason: null, reportedAt: status === "reported" || status === "rejected" ? "2026-10-30T23:42:00.000Z" : null, ...overrides });
const confirmed = (n: number, amount: number) => payment(n, "confirmed", { amount: pen(amount), method: "bank_transfer", reportedAt: null });
const view = (overrides: Partial<BuyerPaymentView> = {}): BuyerPaymentView => ({ orderId: id(1), total: pen(30), deliveryCharge: pen(10), availability: "available",
  paidAmount: pen(0), balanceDue: pen(30), paymentStatus: "pending", rejectedReport: null, settings: [], payments: [], ...overrides });
const screenOf = (value: BuyerPaymentView) => checkoutScreen({ state: "confirmed", view: value });

describe("checkoutScreen", () => {
  test("shows the cancelled screen before any payment state, even with a pending receipt", () => {
    expect(checkoutScreen({ state: "cancelled" })).toEqual({ kind: "cancelled" });
    expect(screenOf(view({ availability: "cancelled", payments: [payment(2, "reported")] }))).toEqual({ kind: "cancelled" });
  });

  test("shows the cancelled screen for a confirmed checkout whose view is marked cancelled", () => {
    expect(screenOf(view({ availability: "cancelled" }))).toEqual({ kind: "cancelled" });
    expect(checkoutScreen({ state: "pending" })).toEqual({ kind: "review" });
  });

  test("shows payment not available before paid and closing when the view is not available", () => {
    const unavailable = view({ availability: "delivery_quote_pending", paymentStatus: "paid", payments: [payment(2, "reported")] });
    expect(screenOf(unavailable)).toEqual({ kind: "payment_unavailable", view: unavailable });
  });

  test("shows paid when payments cover the total, even with a receipt still pending", () => {
    const paid = view({ paymentStatus: "paid", paidAmount: pen(30), balanceDue: pen(0), payments: [confirmed(2, 30), payment(3, "reported")] });
    expect(screenOf(paid)).toEqual({ kind: "paid", view: paid });
  });

  test("shows the closing screen while a receipt is pending and the order is not paid", () => {
    expect(screenOf(view({ payments: [payment(2, "reported")] }))).toEqual({ kind: "closing",
      receipts: [{ id: id(2), url: "https://cdn.example/2.png", reportedAt: "2026-10-30T23:42:00.000Z" }] });
  });

  test("keeps the closing screen when a confirmed payment is voided while a receipt is pending", () => {
    const voided = payment(2, "voided", { amount: pen(30), method: "bank_transfer", reportedAt: null });
    expect(screenOf(view({ payments: [voided, payment(3, "reported")] })).kind).toBe("closing");
  });

  test("lists pending receipts newest first and keeps one without an image url", () => {
    const screen = screenOf(view({ payments: [payment(2, "reported", { reportedAt: "2026-10-30T23:42:00.000Z" }),
      payment(3, "reported", { reportedAt: "2026-10-30T23:50:00.000Z", receiptImageUrl: null }), payment(4, "rejected")] }));
    expect(screen).toMatchObject({ kind: "closing" });
    if (screen.kind !== "closing") return;
    expect(screen.receipts).toEqual([{ id: id(3), url: null, reportedAt: "2026-10-30T23:50:00.000Z" },
      { id: id(2), url: "https://cdn.example/2.png", reportedAt: "2026-10-30T23:42:00.000Z" }]);
  });

  test("shows the payment step with the rejection when the latest report was rejected and nothing is pending", () => {
    const rejected = view({ rejectedReport: { reason: "La captura no muestra el monto" }, payments: [payment(2, "rejected")] });
    expect(screenOf(rejected)).toEqual({ kind: "payment", view: rejected, rejection: { reason: "La captura no muestra el monto" } });
    const plain = view();
    expect(screenOf(plain)).toEqual({ kind: "payment", view: plain, rejection: null });
  });
});

describe("amountRows", () => {
  test("gives a single «Monto a pagar» row with the balance when nothing is confirmed", () => {
    expect(amountRows(view(), "payment_box")).toEqual({ kind: "single", label: "amountToPay", amount: pen(30) });
  });

  test("gives total, paid and balance once a payment is confirmed, with an overpayment as paid 35 and balance 0", () => {
    expect(amountRows(view({ paidAmount: pen(20), balanceDue: pen(10) }), "payment_box")).toEqual({ kind: "breakdown", total: pen(30), paid: pen(20), balance: pen(10) });
    expect(amountRows(view({ paidAmount: pen(35), balanceDue: pen(0), paymentStatus: "paid" }), "amounts_card")).toEqual({ kind: "breakdown", total: pen(30), paid: pen(35), balance: pen(0) });
  });

  test("gives «Total del pedido» as the single row of the amounts card when nothing is confirmed", () => {
    expect(amountRows(view({ paymentStatus: "paid", total: pen(0), balanceDue: pen(0) }), "amounts_card")).toEqual({ kind: "single", label: "orderTotal", amount: pen(0) });
    expect(amountRows(view(), "amounts_card")).toEqual({ kind: "single", label: "orderTotal", amount: pen(30) });
  });

  test("gives «Monto a pagar» with the full total again after the only confirmed payment is voided", () => {
    const voided = payment(2, "voided", { amount: pen(30), method: "bank_transfer", reportedAt: null });
    expect(amountRows(view({ payments: [voided] }), "payment_box")).toEqual({ kind: "single", label: "amountToPay", amount: pen(30) });
  });
});

test("names the heading to focus for closing, rejected, paid and cancelled, and none otherwise", () => {
  const closing = screenOf(view({ payments: [payment(2, "reported")] }));
  expect(focusTargetFor(closing)).toBe("checkout-closing-title");
  expect(focusTargetFor(screenOf(view({ rejectedReport: { reason: null } })))).toBe("checkout-rejected-title");
  expect(focusTargetFor(screenOf(view({ paymentStatus: "paid", paidAmount: pen(30), balanceDue: pen(0) })))).toBe("checkout-paid-title");
  expect(focusTargetFor({ kind: "cancelled" })).toBe("checkout-cancelled-title");
  expect(focusTargetFor(screenOf(view()))).toBeNull();
  expect(focusTargetFor(screenOf(view({ availability: "checkout_pending" })))).toBeNull();
  expect(focusTargetFor({ kind: "review" })).toBeNull();
});

test("formats the receipt date in Lima time as «30 oct. 2026, 6:42 p. m.» and «30 de out. de 2026, 18:42» whatever the process time zone", () => {
  const instant = "2026-10-30T23:42:00.000Z";
  expect(formatReceiptDate(instant, "es")).toBe("30 oct. 2026, 6:42 p. m.");
  expect(formatReceiptDate(instant, "pt")).toBe("30 de out. de 2026, 18:42");
  expect(formatReceiptDate("2026-10-31T04:30:00.000Z", "es")).toMatch(/^30 oct\. 2026/);
});
