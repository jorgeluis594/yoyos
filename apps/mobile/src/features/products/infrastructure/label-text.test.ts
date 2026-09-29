import { fitLabelLines } from "@mobile/features/products/infrastructure/label-text";

const measure = (value: string) => Array.from(value).length;

test("keeps a full SKU within three lines or rejects it", () => {
  expect(fitLabelLines("ABCDEFGHI", 3, measure, 3, false)).toEqual(["ABC", "DEF", "GHI"]);
  expect(fitLabelLines("ABCDEFGHIJ", 3, measure, 3, false)).toBeNull();
});

test("truncates an overflowing name on its second line", () => {
  expect(fitLabelLines("ABCDEFGHI", 4, measure, 2, true)).toEqual(["ABCD", "EFG…"]);
});
