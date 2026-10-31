import { expect, test } from "vitest";
import { lowStockThreshold, matchesStockFilter, stockLevelOf } from "@core/src/features/products/domain/stock-level";

test("classifies 0 as sold out, 1 to 3 as low and 4 as available", () => {
  expect(lowStockThreshold).toBe(3);
  expect([0, 1, 3, 4].map(stockLevelOf)).toEqual(["sold_out", "low", "low", "available"]);
});

test("counts low variants as in stock for the in-stock filter", () => {
  expect([0, 2, 9].map((quantity) => matchesStockFilter(quantity, "in_stock"))).toEqual([false, true, true]);
  expect([0, 2, 9].map((quantity) => matchesStockFilter(quantity, "low"))).toEqual([false, true, false]);
  expect([0, 2, 9].map((quantity) => matchesStockFilter(quantity, "sold_out"))).toEqual([true, false, false]);
});
