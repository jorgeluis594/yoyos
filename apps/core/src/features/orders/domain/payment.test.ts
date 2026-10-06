import { expect, test } from "vitest";
import { confirmPayment, parsePayment, reportPayment, voidPayment, type ImageId } from "@core/src/features/orders/domain/payment";
import type { OrderId, PaymentId, UserId } from "@core/src/features/orders/domain/order";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const paymentId = id(1) as PaymentId;
const orderId = id(2) as OrderId;
const imageId = id(3) as ImageId;
const seller = "seller" as UserId;
const reportedAt = new Date("2026-10-05T10:00:00Z");
const confirmedAt = new Date("2026-10-05T11:00:00Z");
const input = { id: paymentId, orderId, source: "buyer_report" as const, amount: { amount: 10.25, currency: "PEN" as const },
  method: "bank_transfer" as const, confirmedBy: seller, confirmedAt };

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
