import { describe, expect, test } from "vitest";
import { mentionedPriceOf, parseMentionedPrice, type StatedPrice } from "@core/src/features/orders/domain/mentioned-price";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";

describe("parseMentionedPrice", () => {
  test("keeps 50 for 3 units without splitting it per unit", () => {
    expect(parseMentionedPrice({ amount: "50", units: 3, currency: "order_currency" }, "PEN"))
      .toEqual({ amount: { amount: 50, currency: "PEN" }, units: 3 });
    expect(parseMentionedPrice({ amount: "20.5", units: 1, currency: "order_currency" }, "USD"))
      .toEqual({ amount: { amount: 20.5, currency: "USD" }, units: 1 });
  });

  test("drops a price stated in another currency", () => {
    expect(parseMentionedPrice({ amount: "20", units: 1, currency: "other" }, "PEN")).toBeNull();
  });

  test("drops a non-positive amount or more than 99 units", () => {
    const price = (amount: string, units: number) => parseMentionedPrice({ amount, units, currency: "order_currency" }, "PEN");
    expect(price("0", 1)).toBeNull();
    expect(price("0.00", 1)).toBeNull();
    expect(price("-5", 1)).toBeNull();
    expect(price("20.123", 1)).toBeNull();
    expect(price("1000000000", 1)).toBeNull();
    expect(price("20", 0)).toBeNull();
    expect(price("20", 100)).toBeNull();
    expect(price("20", 1.5)).toBeNull();
    expect(price("20", 99)).not.toBeNull();
  });
});

const stated = (amount: string, per: StatedPrice["per"], currency: StatedPrice["currency"] = "not_named"): StatedPrice => ({ amount, currency, per });
const priceOf = (price: StatedPrice, quantity: number, unit: number) => mentionedPriceOf(price, quantity as PositiveInteger, { amount: unit, currency: "PEN" });

describe("mentionedPriceOf", () => {
  test("reads «2 en 70» at a catalog price of 40 as 70 for 2", () => {
    expect(priceOf(stated("70", "not_explicit"), 2, 40)).toEqual({ amount: { amount: 70, currency: "PEN" }, units: 2 });
  });

  test("reads «2 en 70» at a catalog price of 75 as 70 per unit", () => {
    expect(priceOf(stated("70", "not_explicit"), 2, 75)).toEqual({ amount: { amount: 70, currency: "PEN" }, units: 1 });
  });

  test("reads a tie as a price for the lot", () => {
    expect(priceOf(stated("40", "not_explicit"), 2, 30)?.units).toBe(2);
    expect(priceOf(stated("60", "not_explicit"), 2, 45)?.units).toBe(2);
  });

  test("keeps an explicit per-unit price whatever the distance", () => {
    expect(priceOf(stated("40", "unit"), 2, 35)?.units).toBe(1);
    expect(priceOf(stated("70", "unit"), 2, 40)?.units).toBe(1);
    expect(priceOf(stated("35", "lot"), 3, 35)?.units).toBe(3);
  });

  test("reads any price for one unit as per unit", () => {
    expect(priceOf(stated("20", "not_explicit"), 1, 100)?.units).toBe(1);
  });

  test("drops a price in another currency", () => {
    expect(priceOf(stated("20", "unit", "other"), 1, 20)).toBeNull();
    expect(priceOf(stated("20", "unit", "USD"), 1, 20)).toBeNull();
    expect(priceOf(stated("20", "unit", "PEN"), 1, 20)).not.toBeNull();
  });

  test("drops an amount the order cannot keep", () => {
    expect(priceOf(stated("0", "unit"), 1, 20)).toBeNull();
    expect(priceOf(stated("abc", "not_explicit"), 2, 20)).toBeNull();
  });
});
