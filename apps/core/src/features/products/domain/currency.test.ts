import { expect, test } from "vitest";
import { countryCurrencies, countries } from "@shared/country";
import { add, isCurrency } from "@shared/money";

test("country currencies remain supported by shared Money", () => {
  for (const country of countries) {
    const currency = countryCurrencies[country];
    expect(isCurrency(currency)).toBe(true);
    expect(add({ amount: 1, currency })({ amount: 2, currency })).toEqual({ success: true, data: { amount: 3, currency } });
  }
  expect(isCurrency("EUR")).toBe(false);
});
