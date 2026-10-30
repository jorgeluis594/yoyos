import type { BuyerPaymentView } from "@shared/contracts/orders";
import type { Money } from "@shared/money";
import { salesTimeZone } from "@shared/orders-date";

/** Why: a single discriminated result replaces three independent branches that could disagree. */
export type CheckoutScreen =
  | Readonly<{ kind: "review" }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "payment_unavailable"; view: BuyerPaymentView }>
  | Readonly<{ kind: "paid"; view: BuyerPaymentView }>
  | Readonly<{ kind: "closing"; receipts: ReadonlyArray<PendingReceipt> }>
  | Readonly<{ kind: "payment"; view: BuyerPaymentView; rejection: Readonly<{ reason: string | null }> | null }>;

/** Why: the closing card needs only the link and the date, newest first; it never shows amounts. */
export type PendingReceipt = Readonly<{ id: string; url: string | null; reportedAt: string }>;

/** Why: a confirmed checkout always has its view; the union makes the missing view unrepresentable instead of a runtime branch. */
export type CheckoutScreenInput =
  | Readonly<{ state: "pending" }>
  | Readonly<{ state: "cancelled" }>
  | Readonly<{ state: "confirmed"; view: BuyerPaymentView }>;

const pendingReceipts = (view: BuyerPaymentView): ReadonlyArray<PendingReceipt> =>
  view.payments.flatMap((payment) => payment.status === "reported" && payment.reportedAt !== null ? [{ id: payment.id, url: payment.receiptImageUrl, reportedAt: payment.reportedAt }] : [])
    .sort((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt));

/** Which screen the buyer checkout shows; core already decided every status it reads. */
export function checkoutScreen(input: CheckoutScreenInput): CheckoutScreen {
  if (input.state === "pending") return { kind: "review" };
  if (input.state === "cancelled" || input.view.availability === "cancelled") return { kind: "cancelled" };
  const { view } = input;
  if (view.availability !== "available") return { kind: "payment_unavailable", view };
  if (view.paymentStatus === "paid") return { kind: "paid", view };
  const receipts = pendingReceipts(view);
  if (receipts.length > 0) return { kind: "closing", receipts };
  return { kind: "payment", view, rejection: view.rejectedReport };
}

/** Why: the row rule depends on whether anything was confirmed, not on the delivery charge. */
export type AmountRows =
  | Readonly<{ kind: "single"; label: "amountToPay" | "orderTotal"; amount: Money }>
  | Readonly<{ kind: "breakdown"; total: Money; paid: Money; balance: Money }>;

export function amountRows(view: BuyerPaymentView, place: "payment_box" | "amounts_card"): AmountRows {
  if (view.paidAmount.amount > 0) return { kind: "breakdown", total: view.total, paid: view.paidAmount, balance: view.balanceDue };
  return place === "payment_box" ? { kind: "single", label: "amountToPay", amount: view.balanceDue } : { kind: "single", label: "orderTotal", amount: view.total };
}

export type CheckoutHeadingId = "checkout-closing-title" | "checkout-rejected-title" | "checkout-paid-title" | "checkout-cancelled-title";

/** The heading the refreshed screen announces through focus; screens without one return null. */
export function focusTargetFor(screen: CheckoutScreen): CheckoutHeadingId | null {
  if (screen.kind === "closing") return "checkout-closing-title";
  if (screen.kind === "paid") return "checkout-paid-title";
  if (screen.kind === "cancelled") return "checkout-cancelled-title";
  return screen.kind === "payment" && screen.rejection ? "checkout-rejected-title" : null;
}

const receiptDateFormats = new Map<string, Intl.DateTimeFormat>();

/** Medium date and short time in the store's zone, the seller's order list patterns; one formatter per language. */
export function formatReceiptDate(iso: string, language: string): string {
  const locale = language.startsWith("pt") ? "pt-BR" : "es-PE";
  let format = receiptDateFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: salesTimeZone });
    receiptDateFormats.set(locale, format);
  }
  return format.format(new Date(iso));
}
