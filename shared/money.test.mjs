import assert from "node:assert/strict";
import test from "node:test";
import { ok, pipe } from "./functional.ts";
import { add, compare, divide, multiply, subtract } from "./money.ts";

const pen = (amount) => ({ amount, currency: "PEN" });

test("monetary arithmetic and comparison compose through Result", () => {
  assert.deepEqual(add(pen(0.1))(pen(0.2)), ok(pen(0.3)));
  assert.deepEqual(subtract(pen(0.2))(pen(0.1)), ok(pen(-0.1)));
  assert.deepEqual(compare(pen(3))(pen(2)), ok(-1));
  assert.deepEqual(compare(pen(3))(pen(3)), ok(0));
  assert.deepEqual(compare(pen(3))(pen(4)), ok(1));
  assert.deepEqual(pipe(ok(pen(0.1)), add(pen(0.2)), subtract(pen(0.1))), ok(pen(0.2)));
});

test("truncates each input to two decimals before arithmetic and comparison", () => {
  assert.deepEqual(add(pen(0))(pen(1.239)), ok(pen(1.23)));
  assert.deepEqual(subtract(pen(0))(pen(-1.239)), ok(pen(-1.23)));
  assert.deepEqual(add(pen(0.004))(pen(0.004)), ok(pen(0)));
  assert.deepEqual(compare(pen(1))(pen(1.009)), ok(0));
});

test("accepts the supported currencies", () => {
  for (const currency of ["PEN", "USD", "COP", "ARS", "CLP", "BRL"]) {
    assert.deepEqual(add({ amount: 1, currency })({ amount: 1, currency }), ok({ amount: 2, currency }));
  }
});

test("rejects different currencies, invalid amounts and lost precision", () => {
  const usd = { amount: 1, currency: "USD" };
  for (const operation of [add, subtract, compare]) {
    const mismatch = operation(usd)(pen(1));
    assert.equal(mismatch.success, false);
    if (!mismatch.success) assert.equal(mismatch.error.code, "CURRENCY_MISMATCH");
  }
  const invalid = add(pen(1))(pen(Number.NaN));
  assert.equal(invalid.success, false);
  if (!invalid.success) assert.equal(invalid.error.code, "INVALID_AMOUNT");
  const currency = add({ amount: 1, currency: "ZZZ" })(pen(1));
  assert.equal(currency.success, false);
  if (!currency.success) assert.equal(currency.error.code, "INVALID_CURRENCY");
  const precision = add(pen(0.01))(pen(1e15));
  assert.equal(precision.success, false);
  if (!precision.success) assert.equal(precision.error.code, "PRECISION_LOSS");
});

test("multiplies and divides with decimal scalars and truncates toward zero", () => {
  assert.deepEqual(multiply(pen(1.239))(2.5), ok(pen(3.07)));
  assert.deepEqual(multiply(pen(-1.23))(0.333), ok(pen(-0.4)));
  assert.deepEqual(multiply({ amount: 2, currency: "USD" })(-1.25), ok({ amount: -2.5, currency: "USD" }));
  assert.deepEqual(divide(pen(1))(3), ok(pen(0.33)));
  assert.deepEqual(divide(pen(-1.23))(2), ok(pen(-0.61)));
  assert.deepEqual(divide(pen(1.23))(-2), ok(pen(-0.61)));
  assert.deepEqual(divide(pen(1))(0.125), ok(pen(8)));
  assert.deepEqual(
    pipe(ok(pen(1.23)), (money) => multiply(money)(2.5), (money) => divide(money)(2)),
    ok(pen(1.53)),
  );
});

test("rejects invalid scalars, zero divisors and results that lose precision", () => {
  for (const operation of [multiply, divide]) {
    const invalid = operation(pen(1))(Number.POSITIVE_INFINITY);
    assert.equal(invalid.success, false);
    if (!invalid.success) assert.equal(invalid.error.code, "INVALID_SCALAR");
  }
  const zero = divide(pen(1))(0);
  assert.equal(zero.success, false);
  if (!zero.success) assert.equal(zero.error.code, "DIVISION_BY_ZERO");
  for (const result of [multiply(pen(1e15))(0.33333333333333337), divide(pen(1e15))(0.3)]) {
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "PRECISION_LOSS");
  }
});
