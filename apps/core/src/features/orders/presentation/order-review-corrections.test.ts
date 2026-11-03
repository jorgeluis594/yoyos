import { expect, test } from "vitest";
import { hasCorrections, invalidItems, itemsLeft, keepItem, parseQuantity, quantityTextOf, reconcile, removeItem, toRequest, typeQuantity } from "@core/src/features/orders/presentation/order-review-corrections";

const a = { id: "a", quantity: 1 };
const b = { id: "b", quantity: 2 };

test("a quantity is a whole number from 1 to 9999", () => {
  expect(["1", " 9999 ", "0", "10000", "", "1.5", "-1", "abc"].map(parseQuantity)).toEqual([1, 9999, null, null, null, null, null, null]);
});

test("typing the loaded quantity again is no correction", () => {
  const typed = typeQuantity({}, a, "3");
  expect(hasCorrections(typed)).toBe(true);
  expect(quantityTextOf(typed, a)).toBe("3");
  expect(hasCorrections(typeQuantity(typed, a, "1"))).toBe(false);
});

test("the request sends quantities, 0 for Quitar, and nothing while a quantity is invalid", () => {
  const corrections = removeItem(typeQuantity({}, b, "4"), "a");
  expect(toRequest(corrections)).toEqual([{ itemId: "b", quantity: 4 }, { itemId: "a", quantity: 0 }]);
  expect(toRequest(typeQuantity({}, b, "0"))).toBeNull();
  expect(invalidItems(typeQuantity({}, b, ""))).toEqual(["b"]);
  expect(toRequest(keepItem(removeItem({}, "a"), "a"))).toEqual([]);
});

test("Quitar cannot take the last item", () => {
  expect(itemsLeft([a, b], removeItem({}, "a"))).toBe(1);
  expect(itemsLeft([a, b], removeItem(removeItem({}, "a"), "b"))).toBe(0);
});

test("after a reload the corrections stay on the items nothing touched", () => {
  const corrections = removeItem(typeQuantity({}, b, "4"), "a");
  expect(Object.keys(reconcile(corrections, [a, b], [a, b], []))).toEqual(["b", "a"]);
  expect(Object.keys(reconcile(corrections, [a, b], [a, b], ["a"]))).toEqual(["b"]);
  expect(Object.keys(reconcile(corrections, [a, b], [a, { id: "b", quantity: 3 }], []))).toEqual(["a"]);
  expect(Object.keys(reconcile(corrections, [a, b], [b], []))).toEqual(["b"]);
});
