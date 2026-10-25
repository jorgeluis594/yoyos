import { expect, test } from "vitest";
import { offersPartialStockDeduction } from "@shared/orders-payment";

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
