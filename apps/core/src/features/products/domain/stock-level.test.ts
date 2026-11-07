import { expect, test } from "vitest";
import { checkProductStockTotal, lowStockThreshold, matchesStockFilter, parseStockCount, stockLevelOf } from "@core/src/features/products/domain/stock-level";
import { lAzul, mNegro, shirts } from "@core/src/features/products/application/variant-action-fixtures";

test("classifies 0 as sold out, 1 to 3 as low and 4 as available", () => {
  expect(lowStockThreshold).toBe(3);
  expect([0, 1, 3, 4].map(stockLevelOf)).toEqual(["sold_out", "low", "low", "available"]);
});

test("counts low variants as in stock for the in-stock filter", () => {
  expect([0, 2, 9].map((quantity) => matchesStockFilter(quantity, "in_stock"))).toEqual([false, true, true]);
  expect([0, 2, 9].map((quantity) => matchesStockFilter(quantity, "low"))).toEqual([false, true, false]);
  expect([0, 2, 9].map((quantity) => matchesStockFilter(quantity, "sold_out"))).toEqual([true, false, false]);
});

test("parses a whole number from 0 up to the safe bound", () => {
  expect([0, 7, Number.MAX_SAFE_INTEGER].map(parseStockCount)).toEqual([0, 7, Number.MAX_SAFE_INTEGER].map((data) => ({ success: true, data })));
});

test("rejects a negative, fractional or too large stock with INVALID_STOCK", () => {
  for (const value of [-1, 2.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, "3", null, undefined]) {
    expect(parseStockCount(value)).toEqual({ success: false, error: expect.objectContaining({ reason: "INVALID_STOCK" }) });
  }
});

test("rejects a count that takes the product total out of range with INVALID_TOTAL_STOCK", () => {
  const product = shirts({ [mNegro]: Number.MAX_SAFE_INTEGER - 6 }); // total with lAzul's 6
  expect(checkProductStockTotal(product, lAzul, 6).success).toBe(true);
  expect(checkProductStockTotal(product, lAzul, 0).success).toBe(true);
  expect(checkProductStockTotal(product, lAzul, 7)).toEqual({ success: false, error: expect.objectContaining({ reason: "INVALID_TOTAL_STOCK" }) });
});
