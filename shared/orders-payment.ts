import { compare, type Money } from "@shared/money";

/** Whether the payment form offers to deduct stock for a payment that leaves a balance. */
export function offersPartialStockDeduction(order: Readonly<{ stockDeducted: boolean; balanceDue: Money }>, amount: Money | null): boolean {
  if (order.stockDeducted || amount === null || !Number.isFinite(amount.amount) || amount.amount < 0.01) return false;
  const comparison = compare(order.balanceDue)(amount);
  return comparison.success && comparison.data === -1;
}
