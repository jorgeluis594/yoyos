import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { parseDeliveryPrice } from "@core/src/features/delivery-settings/domain/delivery-price";

test("delivery accepts explicit free delivery and preserves valid prices including the order limit", () => {
  for (const amount of [0, 0.01, 8, 12.35, 9999999999999.99]) {
    const price = { amount, currency: "PEN" };
    expect(parseDeliveryPrice(price, "PEN")).toEqual(ok(price));
  }
});

test("missing, negative, nonfinite, overprecise and out-of-range prices never become free or truncated", () => {
  for (const amount of [undefined, null, "", "8", -0.01, NaN, Infinity, -Infinity, 8.001, 0.001, 10000000000000]) {
    expect(parseDeliveryPrice({ amount, currency: "PEN" }, "PEN"))
      .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_RATE" } });
  }
});

test("delivery rejects incompatible currencies and unknown fields without mutating the input", () => {
  const price = Object.freeze({ amount: 8, currency: "USD" });
  expect(parseDeliveryPrice(price, "PEN").success).toBe(false);
  expect(parseDeliveryPrice(price, "USD")).toEqual(ok(price));
  for (const value of [null, {}, { amount: 8 }, { amount: 8, currency: "UNKNOWN" }, { amount: 8, currency: "PEN", cents: 800 }]) {
    expect(parseDeliveryPrice(value, "PEN").success).toBe(false);
  }
});
