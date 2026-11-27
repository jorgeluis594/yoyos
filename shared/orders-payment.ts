import { err, ok } from "@shared/functional";
import { compare, type Money } from "@shared/money";
import type { Result } from "@shared/result";

/** Whether the payment form offers to deduct stock for a payment that leaves a balance. */
export function offersPartialStockDeduction(order: Readonly<{ stockDeducted: boolean; balanceDue: Money }>, amount: Money | null): boolean {
  if (order.stockDeducted || amount === null || !Number.isFinite(amount.amount) || amount.amount < 0.01) return false;
  const comparison = compare(order.balanceDue)(amount);
  return comparison.success && comparison.data === -1;
}

export type PaymentAmountProblem = "empty" | "not_numeric" | "zero" | "exceeds_balance";

const decimalAmount = /^\d+(\.\d{1,2})?$/;

/**
 * Guidance for the payment forms; core decides under the order lock. `typed` is already normalized to a dot decimal.
 * Empty → empty; not matching ^\d+(\.\d{1,2})?$ (letters, negative, more than two decimals) → not_numeric; 0 → zero;
 * above the balance (compared in cents) → exceeds_balance.
 */
export function checkPaymentAmount(typed: string, balanceDue: Money): Result<Money, Readonly<{ problem: PaymentAmountProblem; balanceDue: Money; message: string }>> {
  const fail = (problem: PaymentAmountProblem) => err({ problem, balanceDue, message: `Payment amount problem: ${problem}` });
  const text = typed.trim();
  if (text === "") return fail("empty");
  if (!decimalAmount.test(text)) return fail("not_numeric");
  const amount: Money = { amount: Number(text), currency: balanceDue.currency };
  if (amount.amount === 0) return fail("zero");
  const comparison = compare(balanceDue)(amount);
  if (!comparison.success || comparison.data > 0) return fail("exceeds_balance");
  return ok(amount);
}

export type PaymentProgress =
  | Readonly<{ kind: "unpaid" }>
  | Readonly<{ kind: "partial"; balanceDue: Money }>
  | Readonly<{ kind: "paid" }>;

/** Partial: payment pending and a balance smaller than the total. */
export function paymentProgress(order: Readonly<{ paymentStatus: "pending" | "paid"; total: Money; balanceDue: Money }>): PaymentProgress {
  if (order.paymentStatus === "paid") return { kind: "paid" };
  const comparison = compare(order.total)(order.balanceDue);
  return comparison.success && comparison.data < 0 ? { kind: "partial", balanceDue: order.balanceDue } : { kind: "unpaid" };
}
