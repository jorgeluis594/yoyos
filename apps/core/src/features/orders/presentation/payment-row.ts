import type { OrderAggregateResponse } from "@shared/contracts/orders";

type Order = OrderAggregateResponse;

export type PaymentFormat = Readonly<{ amount: (money: Order["total"]) => string; date: (iso: string) => string }>;

export function paymentDate(payment: Order["payments"][number]): string {
  return payment.status === "reported" ? payment.data.reportedAt : payment.status === "rejected" ? payment.data.rejectedAt : payment.data.confirmedAt;
}

export const paymentRowId = (paymentId: string) => `payment-row-${paymentId}`;
