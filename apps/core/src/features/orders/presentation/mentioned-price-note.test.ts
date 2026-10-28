import { describe, expect, test } from "vitest";
import { mentionedPriceNote } from "@shared/mentioned-price";

const item = (unit: number, mentioned: { amount: number; units: number } | null) => ({
  unitPrice: { amount: unit, currency: "PEN" as const },
  mentionedPrice: mentioned && { amount: { amount: mentioned.amount, currency: "PEN" as const }, units: mentioned.units },
});

describe("mentionedPriceNote", () => {
  test("returns the price the buyer wrote when it differs from the catalog price for the same units", () => {
    expect(mentionedPriceNote(item(25, { amount: 50, units: 3 }))).toEqual({ amount: 50, units: 3 });
  });

  test("returns nothing when the mentioned price equals the catalog price for the same units", () => {
    expect(mentionedPriceNote(item(25, { amount: 75, units: 3 }))).toBeNull();
    expect(mentionedPriceNote(item(0.1, { amount: 0.3, units: 3 }))).toBeNull();
  });

  test("returns nothing when the item has no mentioned price", () => {
    expect(mentionedPriceNote(item(25, null))).toBeNull();
  });
});
