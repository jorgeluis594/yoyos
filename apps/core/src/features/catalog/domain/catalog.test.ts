import { expect, test } from "vitest";
import { parseCartQuantity, parseCatalogSearch } from "@core/src/features/catalog/domain/catalog";

test("parses search terms of 2 to 80 characters and quantities of 1 to 99", () => {
  expect(parseCatalogSearch("  polo ")).toEqual({ success: true, data: "polo" });
  expect(parseCatalogSearch("po").success).toBe(true);
  expect(parseCatalogSearch("p ").success).toBe(false);
  expect(parseCatalogSearch("a".repeat(80)).success).toBe(true);
  expect(parseCatalogSearch("a".repeat(81))).toMatchObject({ success: false, error: { code: "INVALID_SEARCH" } });
  expect(parseCartQuantity(1)).toEqual({ success: true, data: 1 });
  expect(parseCartQuantity(99).success).toBe(true);
  for (const invalid of [0, 100, 1.5, Number.NaN]) expect(parseCartQuantity(invalid)).toMatchObject({ success: false, error: { code: "INVALID_QUANTITY" } });
});
