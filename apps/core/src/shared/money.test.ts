import assert from "node:assert/strict";
import test from "node:test";
import { andThen, ok } from "@shared/functional";
import { add, compare, subtract } from "./money";

const pen = (amount: number) => ({ amount, currency: "PEN" });

test("monetary arithmetic and comparison compose through Result", () => {
  assert.deepEqual(add(pen(0.1), pen(0.2)), ok(pen(0.3)));
  assert.deepEqual(subtract(pen(0.1), pen(0.2)), ok(pen(-0.1)));
  assert.deepEqual(compare(pen(2), pen(3)), ok(-1));
  assert.deepEqual(compare(pen(3), pen(3)), ok(0));
  assert.deepEqual(compare(pen(4), pen(3)), ok(1));
  assert.deepEqual(andThen(add(pen(0.1), pen(0.2)), (sum) => add(sum, pen(0.3))), ok(pen(0.6)));
});

test("truncates each input to two decimals before arithmetic and comparison", () => {
  assert.deepEqual(add(pen(1.239), pen(0)), ok(pen(1.23)));
  assert.deepEqual(subtract(pen(-1.239), pen(0)), ok(pen(-1.23)));
  assert.deepEqual(add(pen(0.004), pen(0.004)), ok(pen(0)));
  assert.deepEqual(compare(pen(1.009), pen(1)), ok(0));
});

test("rejects different currencies, invalid amounts and lost precision", () => {
  const usd = { amount: 1, currency: "USD" };
  for (const operation of [add, subtract, compare]) {
    const mismatch = operation(pen(1), usd);
    assert.equal(mismatch.success, false);
    if (!mismatch.success) assert.equal(mismatch.error.code, "CURRENCY_MISMATCH");
  }
  const invalid = add(pen(Number.NaN), pen(1));
  assert.equal(invalid.success, false);
  if (!invalid.success) assert.equal(invalid.error.code, "INVALID_AMOUNT");
  const currency = add({ amount: 1, currency: "ZZZ" }, pen(1));
  assert.equal(currency.success, false);
  if (!currency.success) assert.equal(currency.error.code, "INVALID_CURRENCY");
  const precision = add(pen(1e15), pen(0.01));
  assert.equal(precision.success, false);
  if (!precision.success) assert.equal(precision.error.code, "PRECISION_LOSS");
});
