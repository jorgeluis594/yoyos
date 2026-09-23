import Decimal from "decimal.js";
import { andThen, err, map, ok, traverse } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";

// A finite number can reach 1e308; retain its cents during intermediate arithmetic.
const DecimalMoney = Decimal.clone({ precision: 400 });
const currencies = new Set(Intl.supportedValuesOf("currency"));

export type MoneyError = {
  message: string;
  code: "INVALID_AMOUNT" | "INVALID_CURRENCY" | "CURRENCY_MISMATCH" | "PRECISION_LOSS";
};

function validate(money: Money): Result<Decimal, MoneyError> {
  if (typeof money.currency !== "string" || !currencies.has(money.currency)) {
    return err({ message: "Unsupported currency", code: "INVALID_CURRENCY" });
  }
  if (typeof money.amount !== "number" || !Number.isFinite(money.amount)) {
    return err({ message: "Amount must be finite", code: "INVALID_AMOUNT" });
  }
  const amount = new DecimalMoney(money.amount.toString());
  if (amount.decimalPlaces() > 2) {
    return err({ message: "Amount must have at most two decimal places", code: "INVALID_AMOUNT" });
  }
  return ok(amount);
}

function pair(a: Money, b: Money): Result<[Decimal, Decimal], MoneyError> {
  return andThen(traverse([a, b], validate), ([left, right]) =>
    a.currency === b.currency
      ? ok([left, right])
      : err({ message: "Currencies must match", code: "CURRENCY_MISMATCH" }),
  );
}

function toMoney(amount: Decimal, currency: string): Result<Money, MoneyError> {
  if (amount.decimalPlaces() > 2) {
    return err({ message: "Result exceeds two decimal places", code: "PRECISION_LOSS" });
  }
  const value = amount.toNumber();
  if (!Number.isFinite(value) || !new DecimalMoney(value.toString()).equals(amount)) {
    return err({ message: "Result cannot be represented as a number without losing precision", code: "PRECISION_LOSS" });
  }
  return ok({ amount: value, currency });
}

export function addMoney(a: Money, b: Money): Result<Money, MoneyError> {
  return andThen(pair(a, b), ([left, right]) => toMoney(left.plus(right), a.currency));
}

export function subtractMoney(a: Money, b: Money): Result<Money, MoneyError> {
  return andThen(pair(a, b), ([left, right]) => toMoney(left.minus(right), a.currency));
}

export function compareMoney(a: Money, b: Money): Result<-1 | 0 | 1, MoneyError> {
  return map(pair(a, b), ([left, right]) =>
    left.lessThan(right) ? -1 : left.greaterThan(right) ? 1 : 0,
  );
}
