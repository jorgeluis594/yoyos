import { describe, expect, test } from "vitest";
import { centsText, moneyOfCents } from "@core/src/features/orders/infrastructure/sales-cents";

describe("integer-cent text", () => {
  test("parses integer-cent text exactly, including 10, 7, 123456789 and negative differences, and builds Money as cents / 100", () => {
    expect(["10", "7", "123456789", "-14050", "0", "-0"].map((text) => centsText.parse(text))).toEqual([10, 7, 123_456_789, -14_050, 0, -0]);
    expect(moneyOfCents(10, "PEN")).toEqual({ amount: 0.1, currency: "PEN" });
    expect(moneyOfCents(7, "USD")).toEqual({ amount: 0.07, currency: "USD" });
    expect(moneyOfCents(123_456_789, "PEN")).toEqual({ amount: 1_234_567.89, currency: "PEN" });
    expect(Math.round(moneyOfCents(-14_050, "PEN").amount * 100)).toBe(-14_050);
  });

  test("refuses text that is not an integer or is not a safe integer", () => {
    for (const text of ["", "1.5", "1e3", " 7", "7 ", "--1", "abc", "9007199254740993", "-9007199254740993"]) expect(centsText.safeParse(text).success, text).toBe(false);
    expect(centsText.safeParse(1).success).toBe(false);
    expect(centsText.safeParse("9007199254740991").success).toBe(true);
  });
});
