import { expect, test } from "vitest";
import { checkPaymentAmount, offersPartialStockDeduction, paymentProgress } from "@shared/orders-payment";

const pen = (amount) => ({ amount, currency: "PEN" });
const order = (balanceDue, stockDeducted = false) => ({ stockDeducted, balanceDue: pen(balanceDue) });

test("offers the partial stock choice only when the amount is below the balance and stock is not deducted", () => {
  expect(offersPartialStockDeduction(order(70), pen(30))).toBe(true);
  expect(offersPartialStockDeduction(order(70), pen(70))).toBe(false);
  expect(offersPartialStockDeduction(order(70), pen(80))).toBe(false);
  expect(offersPartialStockDeduction(order(70, true), pen(30))).toBe(false);
  expect(offersPartialStockDeduction(order(70), { amount: 30, currency: "USD" })).toBe(false);
});

test("does not offer the partial stock choice for an empty or invalid amount", () => {
  expect(offersPartialStockDeduction(order(70), null)).toBe(false);
  expect(offersPartialStockDeduction(order(70), pen(0))).toBe(false);
  expect(offersPartialStockDeduction(order(70), pen(-5))).toBe(false);
  expect(offersPartialStockDeduction(order(70), pen(Number.NaN))).toBe(false);
  expect(offersPartialStockDeduction(order(70), pen(0.004))).toBe(false);
});

const problemOf = (typed, balance) => {
  const result = checkPaymentAmount(typed, pen(balance));
  return result.success ? null : result.error.problem;
};

test("checkPaymentAmount reports empty, not numeric, zero and over balance", () => {
  expect(problemOf("", 60)).toBe("empty");
  expect(problemOf("   ", 60)).toBe("empty");
  expect(problemOf("abc", 60)).toBe("not_numeric");
  expect(problemOf("0", 60)).toBe("zero");
  expect(problemOf("0.00", 60)).toBe("zero");
  expect(problemOf("999", 60)).toBe("exceeds_balance");
  expect(problemOf("60.01", 60)).toBe("exceeds_balance");
  expect(checkPaymentAmount("999", pen(60))).toMatchObject({ success: false, error: { problem: "exceeds_balance", balanceDue: pen(60) } });
  expect(checkPaymentAmount("60", pen(60))).toEqual({ success: true, data: pen(60) });
  expect(checkPaymentAmount("12.5", pen(60))).toEqual({ success: true, data: pen(12.5) });
  expect(problemOf("5", 0)).toBe("exceeds_balance");
});

test("checkPaymentAmount compares by cents so an amount equal to the balance is accepted", () => {
  expect(problemOf("0.3", 0.1 + 0.2)).toBeNull();
  expect(problemOf("0.31", 0.1 + 0.2)).toBe("exceeds_balance");
});

test("checkPaymentAmount treats a negative amount or more than two decimals as not numeric", () => {
  expect(problemOf("-5", 60)).toBe("not_numeric");
  expect(problemOf("1.234", 60)).toBe("not_numeric");
  expect(problemOf("1,5", 60)).toBe("not_numeric");
  expect(problemOf("1e3", 60)).toBe("not_numeric");
});

test("paymentProgress tells unpaid, partial and paid", () => {
  expect(paymentProgress({ paymentStatus: "pending", total: pen(55), balanceDue: pen(55) })).toEqual({ kind: "unpaid" });
  expect(paymentProgress({ paymentStatus: "pending", total: pen(55), balanceDue: pen(35) })).toEqual({ kind: "partial", balanceDue: pen(35) });
  expect(paymentProgress({ paymentStatus: "paid", total: pen(55), balanceDue: pen(0) })).toEqual({ kind: "paid" });
});
