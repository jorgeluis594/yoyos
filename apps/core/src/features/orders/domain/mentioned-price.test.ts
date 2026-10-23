import { describe, expect, test } from "vitest";
import { parseMentionedPrice } from "@core/src/features/orders/domain/mentioned-price";

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
