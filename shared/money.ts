import Decimal from "decimal.js";
import { andThen, err, map, ok, traverse } from "@shared/functional";
import type { Result } from "@shared/result";

/** Monetary amount in major currency units. */
export const currencies = ["PEN", "USD", "COP", "ARS", "CLP", "BRL"] as const;
export type Currency = (typeof currencies)[number];
export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && currencies.some((currency) => currency === value);
}

export type Money = {
  readonly amount: number;
  readonly currency: string;
};

// A finite number can reach 1e308; retain its cents during intermediate arithmetic.
const DecimalMoney = Decimal.clone({ precision: 400 });

export type MoneyError = {
  message: string;
  code: "INVALID_AMOUNT" | "INVALID_CURRENCY" | "INVALID_SCALAR" | "DIVISION_BY_ZERO" | "CURRENCY_MISMATCH" | "PRECISION_LOSS";
};

function validate(money: Money): Result<Decimal, MoneyError> {
  if (!isCurrency(money.currency)) {
    return err({ message: "Unsupported currency", code: "INVALID_CURRENCY" });
  }
  if (typeof money.amount !== "number" || !Number.isFinite(money.amount)) {
    return err({ message: "Amount must be finite", code: "INVALID_AMOUNT" });
  }
  const amount = new DecimalMoney(money.amount.toString());
  return ok(amount.toDecimalPlaces(2, DecimalMoney.ROUND_DOWN));
}

function validateScalar(value: number): Result<Decimal, MoneyError> {
  return typeof value === "number" && Number.isFinite(value)
    ? ok(new DecimalMoney(value.toString()))
    : err({ message: "Scalar must be finite", code: "INVALID_SCALAR" });
}

function pair(a: Money, b: Money): Result<[Decimal, Decimal], MoneyError> {
  return andThen(traverse([a, b], validate), ([left, right]) =>
    a.currency === b.currency
      ? ok([left, right])
      : err({ message: "Currencies must match", code: "CURRENCY_MISMATCH" }),
  );
}

function finish(amount: Decimal, currency: string): Result<Money, MoneyError> {
  const truncated = amount.toDecimalPlaces(2, DecimalMoney.ROUND_DOWN);
  const value = truncated.toNumber();
  if (!Number.isFinite(value) || !new DecimalMoney(value.toString()).equals(truncated)) {
    return err({ message: "Result cannot be represented as a number without losing precision", code: "PRECISION_LOSS" });
  }
  return ok({ amount: value, currency });
}

export function add(other: Money): (current: Money) => Result<Money, MoneyError> {
  return (current: Money): Result<Money, MoneyError> =>
    andThen(pair(current, other), ([left, right]) => finish(left.plus(right), current.currency));
}

export function subtract(other: Money): (current: Money) => Result<Money, MoneyError> {
  return (current: Money): Result<Money, MoneyError> =>
    andThen(pair(current, other), ([left, right]) => finish(left.minus(right), current.currency));
}

export function multiply(money: Money): (factor: number) => Result<Money, MoneyError> {
  return (factor: number): Result<Money, MoneyError> =>
    andThen(validate(money), (amount) =>
      andThen(validateScalar(factor), (scalar) => finish(amount.times(scalar), money.currency)),
    );
}

export function divide(money: Money): (divisor: number) => Result<Money, MoneyError> {
  return (divisor: number): Result<Money, MoneyError> =>
    andThen(validate(money), (amount) =>
      andThen(validateScalar(divisor), (scalar) =>
        scalar.isZero()
          ? err({ message: "Cannot divide by zero", code: "DIVISION_BY_ZERO" })
          : finish(amount.div(scalar), money.currency),
      ),
    );
}

export function compare(other: Money): (current: Money) => Result<-1 | 0 | 1, MoneyError> {
  return (current: Money): Result<-1 | 0 | 1, MoneyError> =>
    map(pair(current, other), ([left, right]) =>
      left.lessThan(right) ? -1 : left.greaterThan(right) ? 1 : 0,
    );
}
