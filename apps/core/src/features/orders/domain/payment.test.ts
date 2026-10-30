import { expect, test } from "vitest";
import { confirmPayment, parsePayment, parseRejectionReason, rejectPayment, reportPayment, voidPayment, type ImageId, type RejectionReason } from "@core/src/features/orders/domain/payment";
import type { OrderId, PaymentId, UserId } from "@core/src/features/orders/domain/order";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const paymentId = id(1) as PaymentId;
const orderId = id(2) as OrderId;
const imageId = id(3) as ImageId;
const seller = "seller" as UserId;
const reportedAt = new Date("2026-10-05T10:00:00Z");
const confirmedAt = new Date("2026-10-05T11:00:00Z");
const input = { id: paymentId, orderId, source: "buyer_report" as const, amount: { amount: 10.25, currency: "PEN" as const },
  method: "bank_transfer" as const, deductStockIfPartial: false, confirmedBy: seller, confirmedAt };

test("report preserves evidence across retries and confirmation", () => {
  const reported = reportPayment({ id: paymentId, orderId, currency: "PEN", receiptImageId: imageId, reportedAt }, null);
  expect(reported).toMatchObject({ success: true, data: { status: "reported", amount: null, method: null,
    data: { receiptImageId: imageId, reportedAt } } });
  if (!reported.success) return;
  expect(reportPayment({ id: paymentId, orderId, currency: "PEN", receiptImageId: imageId, reportedAt: new Date() }, reported.data))
    .toEqual(reported);
  expect(reportPayment({ id: paymentId, orderId, currency: "PEN", receiptImageId: id(4) as ImageId, reportedAt }, reported.data))
    .toMatchObject({ success: false, error: { code: "PAYMENT_CONFLICT" } });
  expect(confirmPayment({ ...input, amount: { amount: 10.25, currency: "USD" } }, reported.data))
    .toMatchObject({ success: false, error: { code: "CURRENCY_MISMATCH" } });
  const confirmed = confirmPayment(input, reported.data);
  expect(confirmed).toMatchObject({ success: true, data: { status: "confirmed", amount: input.amount, method: "bank_transfer",
    data: { confirmedAt, confirmedBy: { kind: "seller", userId: seller }, evidence: { kind: "buyer_report", report: { receiptImageId: imageId, reportedAt } } } } });
  if (!confirmed.success) return;
  expect(reportPayment({ id: paymentId, orderId, currency: "PEN", receiptImageId: imageId, reportedAt }, confirmed.data))
    .toEqual(confirmed);
  expect(confirmPayment({ ...input, confirmedAt: new Date() }, confirmed.data)).toEqual(confirmed);
  expect(confirmPayment({ ...input, amount: { amount: 10, currency: "PEN" } }, confirmed.data))
    .toMatchObject({ success: false, error: { code: "PAYMENT_CONFLICT" } });
});

test("manual payment can be voided once while reports cannot", () => {
  const manual = confirmPayment({ ...input, source: "manual" }, null);
  expect(manual).toMatchObject({ success: true, data: { status: "confirmed", data: { evidence: { kind: "manual" } } } });
  if (!manual.success) return;
  const voidedAt = new Date("2026-10-06T10:00:00Z");
  const voided = voidPayment(manual.data, seller, voidedAt);
  expect(voided).toMatchObject({ success: true, data: { status: "voided", amount: input.amount,
    data: { confirmedAt, voidedAt, voidedBy: seller } } });
  if (!voided.success) return;
  expect(voidPayment(voided.data, "other" as UserId, new Date())).toEqual(voided);
  expect(confirmPayment({ ...input, source: "manual" }, voided.data)).toMatchObject({ success: false, error: { code: "INVALID_TRANSITION" } });
  const reported = reportPayment({ id: paymentId, orderId, currency: "PEN", receiptImageId: imageId, reportedAt }, null);
  if (reported.success) expect(voidPayment(reported.data, seller, voidedAt)).toMatchObject({ success: false, error: { code: "INVALID_TRANSITION" } });
  expect(confirmPayment(input, null)).toMatchObject({ success: false, error: { code: "PAYMENT_NOT_FOUND" } });
});

test("rejects malformed state combinations, dates and monetary precision", () => {
  const manual = confirmPayment({ ...input, source: "manual" }, null);
  if (!manual.success) return;
  for (const invalid of [
    { ...manual.data, status: "reported" },
    { ...manual.data, method: "cash" },
    { ...manual.data, amount: null },
    { ...manual.data, data: { ...manual.data.data, confirmedAt: new Date("invalid") } },
    { ...manual.data, data: { ...manual.data.data, evidence: { kind: "buyer_report" } } },
  ]) expect(parsePayment(invalid)).toMatchObject({ success: false, error: { code: "INVALID_PAYMENT" } });
  expect(confirmPayment({ ...input, source: "manual", amount: { amount: 0.001, currency: "PEN" } }, null))
    .toMatchObject({ success: false, error: { code: "INVALID_PAYMENT" } });
  expect(confirmPayment({ ...input, source: "manual", amount: { amount: 0, currency: "PEN" } }, null))
    .toMatchObject({ success: false, error: { code: "INVALID_PAYMENT" } });
});

const rejection = { rejectedBy: seller, rejectedAt: new Date("2026-10-05T12:00:00Z"), reason: null };
const reported = () => {
  const result = reportPayment({ id: paymentId, orderId, currency: "PEN", receiptImageId: imageId, reportedAt }, null);
  if (!result.success) throw new Error("Expected report");
  return result.data;
};
const rejected = () => {
  const result = rejectPayment(reported(), rejection);
  if (!result.success) throw new Error("Expected rejection");
  return result.data;
};

test("rejects a reported payment keeping its receipt and an optional trimmed reason", () => {
  const reason = parseRejectionReason("  El monto no coincide  ");
  expect(reason).toEqual({ success: true, data: "El monto no coincide" });
  if (!reason.success) return;
  expect(rejectPayment(reported(), { ...rejection, reason: reason.data })).toEqual({ success: true, data: {
    id: paymentId, orderId, status: "rejected", currency: "PEN", amount: null, method: null,
    data: { report: { receiptImageId: imageId, reportedAt }, rejectedAt: rejection.rejectedAt, rejectedBy: seller, reason: "El monto no coincide" } } });
});

test("treats an empty rejection reason as no reason", () => {
  expect(parseRejectionReason("   ")).toEqual({ success: true, data: null });
  expect(parseRejectionReason(null)).toEqual({ success: true, data: null });
});

test("refuses a rejection reason longer than 200 characters", () => {
  expect(parseRejectionReason("a".repeat(200))).toMatchObject({ success: true });
  expect(parseRejectionReason(` ${"a".repeat(201)} `)).toMatchObject({ success: false, error: { code: "INVALID_PAYMENT" } });
});

test("returns an already rejected payment unchanged with its original reason", () => {
  const first = rejectPayment(reported(), { ...rejection, reason: "Primero" as RejectionReason });
  if (!first.success) throw new Error("Expected rejection");
  expect(rejectPayment(first.data, { ...rejection, rejectedAt: new Date(), reason: "Otro" as RejectionReason })).toEqual(first);
});

test("refuses to reject a confirmed or voided payment", () => {
  const confirmed = confirmPayment(input, reported());
  if (!confirmed.success) throw new Error("Expected confirmation");
  expect(rejectPayment(confirmed.data, rejection)).toMatchObject({ success: false, error: { code: "PAYMENT_CONFLICT" } });
  const voided = voidPayment(confirmed.data, seller, new Date());
  if (!voided.success) throw new Error("Expected void");
  expect(rejectPayment(voided.data, rejection)).toMatchObject({ success: false, error: { code: "PAYMENT_CONFLICT" } });
});

test("refuses to confirm a rejected payment", () => {
  expect(confirmPayment(input, rejected())).toMatchObject({ success: false, error: { code: "PAYMENT_CONFLICT" } });
});

test("replaying a buyer report whose payment was rejected returns it without writing", () => {
  expect(reportPayment({ id: paymentId, orderId, currency: "PEN", receiptImageId: imageId, reportedAt: new Date() }, rejected()))
    .toEqual({ success: true, data: rejected() });
});

test("refuses a buyer report with the id of a rejected payment and another receipt", () => {
  expect(reportPayment({ id: paymentId, orderId, currency: "PEN", receiptImageId: id(4) as ImageId, reportedAt }, rejected()))
    .toMatchObject({ success: false, error: { code: "PAYMENT_CONFLICT" } });
});

test("refuses to void a rejected payment with INVALID_TRANSITION", () => {
  expect(voidPayment(rejected(), seller, new Date())).toMatchObject({ success: false, error: { code: "INVALID_TRANSITION" } });
});
