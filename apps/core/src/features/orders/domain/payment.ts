import { z } from "zod";
import { currencies, type Currency, type Money } from "@shared/money";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { OrderId, PaymentId, UserId } from "@core/src/features/orders/domain/order";

export type ImageId = string & { readonly __brand: "ImageId" };
export type PaymentMethod = "digital_wallet" | "bank_transfer";
export type ReportData = Readonly<{ receiptImageId: ImageId; reportedAt: Date }>;
export type PaymentEvidence = Readonly<{ kind: "manual" }> | Readonly<{ kind: "buyer_report"; report: ReportData }>;
export type ConfirmationActor = Readonly<{ kind: "seller"; userId: UserId }> | Readonly<{ kind: "legacy" }>;
export type ConfirmationData = Readonly<{ confirmedAt: Date; confirmedBy: ConfirmationActor; evidence: PaymentEvidence }>;
type PaymentIdentity = Readonly<{ id: PaymentId; orderId: OrderId }>;
export type ReportedPayment = PaymentIdentity & Readonly<{ status: "reported"; currency: Currency; amount: null; method: null; data: ReportData }>;
export type ConfirmedPayment = PaymentIdentity & Readonly<{ status: "confirmed"; amount: Money; method: PaymentMethod; data: ConfirmationData }>;
export type VoidedPayment = PaymentIdentity & Readonly<{ status: "voided"; amount: Money; method: PaymentMethod; data: ConfirmationData & Readonly<{ voidedAt: Date; voidedBy: UserId }> }>;
export type Payment = ReportedPayment | ConfirmedPayment | VoidedPayment;
export type PaymentError = Readonly<{ code: "INVALID_PAYMENT" | "CURRENCY_MISMATCH" | "PAYMENT_CONFLICT" | "INVALID_TRANSITION" | "PAYMENT_NOT_FOUND"; message: string }>;

const uuid = z.uuid();
const date = z.date().refine((value) => Number.isFinite(value.getTime()));
const money = z.strictObject({ amount: z.number().finite().positive().refine((value) => /^\d+(?:\.\d{1,2})?$/.test(value.toString()) &&
  BigInt(value.toFixed(2).replace(".", "")) <= 999999999999999n), currency: z.enum(currencies) });
const report = z.strictObject({ receiptImageId: uuid, reportedAt: date });
const actor = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("seller"), userId: z.string().min(1) }), z.strictObject({ kind: z.literal("legacy") })]);
const evidence = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("manual") }), z.strictObject({ kind: z.literal("buyer_report"), report })]);
const confirmation = z.strictObject({ confirmedAt: date, confirmedBy: actor, evidence });
const identity = { id: uuid, orderId: uuid };
const payment = z.discriminatedUnion("status", [
  z.strictObject({ ...identity, status: z.literal("reported"), currency: z.enum(currencies), amount: z.null(), method: z.null(), data: report }),
  z.strictObject({ ...identity, status: z.literal("confirmed"), amount: money, method: z.enum(["digital_wallet", "bank_transfer"]), data: confirmation }),
  z.strictObject({ ...identity, status: z.literal("voided"), amount: money, method: z.enum(["digital_wallet", "bank_transfer"]),
    data: confirmation.extend({ voidedAt: date, voidedBy: z.string().min(1) }) }),
]);

export function parsePayment(value: unknown): Result<Payment, PaymentError> {
  const parsed = payment.safeParse(value);
  return parsed.success ? ok(parsed.data as Payment) : err({ code: "INVALID_PAYMENT", message: "Invalid payment" });
}

export function reportPayment(input: { id: PaymentId; orderId: OrderId; currency: Currency; receiptImageId: ImageId; reportedAt: Date },
  existing: Payment | null): Result<Payment, PaymentError> {
  if (existing) {
    const receipt = existing.status === "reported" ? existing.data.receiptImageId :
      existing.data.evidence.kind === "buyer_report" ? existing.data.evidence.report.receiptImageId : null;
    const currency = existing.status === "reported" ? existing.currency : existing.amount.currency;
    if (existing.id === input.id && existing.orderId === input.orderId && currency === input.currency && receipt === input.receiptImageId)
      return ok(existing);
    return err({ code: "PAYMENT_CONFLICT", message: "Payment ID has different evidence" });
  }
  return parsePayment({ id: input.id, orderId: input.orderId, status: "reported", currency: input.currency,
    amount: null, method: null, data: { receiptImageId: input.receiptImageId, reportedAt: input.reportedAt } });
}

export function confirmPayment(input: { id: PaymentId; orderId: OrderId; source: "manual" | "buyer_report";
  amount: Money; method: PaymentMethod; confirmedBy: UserId; confirmedAt: Date }, existing: Payment | null): Result<ConfirmedPayment, PaymentError> {
  if (existing && (existing.id !== input.id || existing.orderId !== input.orderId)) return err({ code: "PAYMENT_CONFLICT", message: "Payment belongs to another order" });
  if (existing?.status === "voided") return err({ code: "INVALID_TRANSITION", message: "Voided payment cannot be confirmed" });
  if (existing?.status === "reported" && input.source !== "buyer_report") return err({ code: "PAYMENT_CONFLICT", message: "Reported payment requires report confirmation" });
  if (existing?.status === "reported" && existing.currency !== input.amount.currency)
    return err({ code: "CURRENCY_MISMATCH", message: "Payment currency differs from report" });
  if (!existing && input.source === "buyer_report") return err({ code: "PAYMENT_NOT_FOUND", message: "Reported payment is unavailable" });
  if (existing?.status === "confirmed") {
    if (existing.amount.amount === input.amount.amount && existing.amount.currency === input.amount.currency &&
      existing.method === input.method && existing.data.evidence.kind === input.source) return ok(existing);
    return err({ code: "PAYMENT_CONFLICT", message: "Payment ID has different confirmation" });
  }
  const candidate = { id: input.id, orderId: input.orderId, status: "confirmed", amount: input.amount, method: input.method,
    data: { confirmedAt: input.confirmedAt, confirmedBy: { kind: "seller", userId: input.confirmedBy },
      evidence: existing ? { kind: "buyer_report", report: existing.data } : { kind: "manual" } } };
  const parsed = parsePayment(candidate);
  return parsed.success && parsed.data.status === "confirmed" ? ok(parsed.data) : parsed.success
    ? err({ code: "INVALID_PAYMENT", message: "Invalid confirmation" }) : parsed;
}

export function voidPayment(existing: Payment, voidedBy: UserId, voidedAt: Date): Result<VoidedPayment, PaymentError> {
  if (existing.status === "voided") return ok(existing);
  if (existing.status === "reported") return err({ code: "INVALID_TRANSITION", message: "Reported payment cannot be voided" });
  const parsed = parsePayment({ ...existing, status: "voided", data: { ...existing.data, voidedAt, voidedBy } });
  return parsed.success && parsed.data.status === "voided" ? ok(parsed.data) : parsed.success
    ? err({ code: "INVALID_PAYMENT", message: "Invalid voided payment" }) : parsed;
}
