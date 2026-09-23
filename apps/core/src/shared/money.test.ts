import assert from "node:assert/strict";
import test from "node:test";
import { andThen, ok } from "@shared/functional";
import { addMoney, compareMoney, subtractMoney } from "./money";

const pen = (amount: number) => ({ amount, currency: "PEN" });

test("monetary arithmetic and comparison compose through Result", () => {
  assert.deepEqual(addMoney(pen(0.1), pen(0.2)), ok(pen(0.3)));
  assert.deepEqual(subtractMoney(pen(0.1), pen(0.2)), ok(pen(-0.1)));
  assert.deepEqual(compareMoney(pen(2), pen(3)), ok(-1));
  assert.deepEqual(compareMoney(pen(3), pen(3)), ok(0));
  assert.deepEqual(compareMoney(pen(4), pen(3)), ok(1));
  assert.deepEqual(andThen(addMoney(pen(0.1), pen(0.2)), (sum) => addMoney(sum, pen(0.3))), ok(pen(0.6)));
});

test("rejects different currencies, invalid amounts and lost precision", () => {
  const usd = { amount: 1, currency: "USD" };
  for (const operation of [addMoney, subtractMoney, compareMoney]) {
    const mismatch = operation(pen(1), usd);
    assert.equal(mismatch.success, false);
    if (!mismatch.success) assert.equal(mismatch.error.code, "CURRENCY_MISMATCH");
  }
  const invalid = addMoney(pen(Number.NaN), pen(1));
  assert.equal(invalid.success, false);
  if (!invalid.success) assert.equal(invalid.error.code, "INVALID_AMOUNT");
  const fraction = addMoney(pen(1.001), pen(1));
  assert.equal(fraction.success, false);
  if (!fraction.success) assert.equal(fraction.error.code, "INVALID_AMOUNT");
  const currency = addMoney({ amount: 1, currency: "ZZZ" }, pen(1));
  assert.equal(currency.success, false);
  if (!currency.success) assert.equal(currency.error.code, "INVALID_CURRENCY");
  const precision = addMoney(pen(1e15), pen(0.01));
  assert.equal(precision.success, false);
  if (!precision.success) assert.equal(precision.error.code, "PRECISION_LOSS");
});
