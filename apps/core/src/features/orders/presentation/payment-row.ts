import type { OrderAggregateResponse } from "@shared/contracts/orders";

type Order = OrderAggregateResponse;

export type PaymentFormat = Readonly<{ amount: (money: Order["total"]) => string; date: (iso: string) => string }>;

export function paymentDate(payment: Order["payments"][number]): string {
  return payment.status === "reported" ? payment.data.reportedAt : payment.status === "rejected" ? payment.data.rejectedAt : payment.data.confirmedAt;
}

/** When the buyer reported the payment, or null for a payment recorded by the seller. */
export function reportedAt(payment: Order["payments"][number]): string | null {
  if (payment.status === "reported") return payment.data.reportedAt;
  if (payment.status === "rejected") return payment.data.report.reportedAt;
  return payment.data.evidence.kind === "buyer_report" ? payment.data.evidence.report.reportedAt : null;
}

export const paymentRowId = (paymentId: string) => `payment-row-${paymentId}`;
