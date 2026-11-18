import type { TFunction } from "i18next";
import { formatCurrency } from "@core/app/format-currency";
import type { Money } from "@shared/money";
import { checkPaymentAmount, type PaymentAmountProblem } from "@shared/orders-payment";

/** The reason a typed payment amount cannot be sent; `sale` words the excess for a new sale, where the limit is what the other rows leave to collect. */
export function paymentAmountMessage(t: TFunction, language: string, problem: PaymentAmountProblem, balanceDue: Money, scope: "order" | "sale" = "order"): string {
  const amount = formatCurrency(balanceDue.amount, balanceDue.currency, language);
  switch (problem) {
    case "empty": return t("orders.paymentAmountEmpty");
    case "not_numeric": return t("orders.paymentInvalidAmount");
    case "zero": return t("orders.paymentAmountZero");
    case "exceeds_balance": return t(scope === "sale" ? "orders.saleRowExceeds" : "orders.paymentExceedsBalance", { amount });
  }
}

/** The problem of a typed amount against the balance it may fill, or null when it can be sent. */
export function paymentAmountProblem(typed: string, balanceDue: Money): PaymentAmountProblem | null {
  const checked = checkPaymentAmount(typed, balanceDue);
  return checked.success ? null : checked.error.problem;
}

/** A typed amount that is a positive money value with at most two decimals, whatever the balance: the draft rows use it to size what the other rows leave. */
export function typedPaymentAmount(typed: string, currency: Money["currency"]): Money | null {
  const checked = checkPaymentAmount(typed, { amount: 1e9, currency });
  return checked.success ? checked.data : null;
}
