import { fitLabelLines } from "@mobile/features/products/infrastructure/label-text";

const measure = (value: string) => Array.from(value).length;

test("keeps a full SKU within three lines or rejects it", () => {
  expect(fitLabelLines("ABCDEFGHI", 3, measure, 3, false)).toEqual(["ABC", "DEF", "GHI"]);
  expect(fitLabelLines("ABCDEFGHIJ", 3, measure, 3, false)).toBeNull();
});

test("truncates an overflowing name on its second line", () => {
  expect(fitLabelLines("ABCDEFGHI", 4, measure, 2, true)).toEqual(["ABCD", "EFG…"]);
});

test("rejects a SKU character that cannot fit and keeps Unicode intact when truncating a name", () => {
  const wide = (value: string) => Array.from(value).reduce((size, character) => size + (character === "界" ? 4 : 1), 0);
  expect(fitLabelLines("AB界", 3, wide, 3, false)).toBeNull();
  expect(fitLabelLines("😀😀😀😀😀😀😀", 3, measure, 2, true)).toEqual(["😀😀😀", "😀😀…"]);
  expect(fitLabelLines("ABC", 1, (value) => Array.from(value).reduce((size, character) => size + (character === "…" ? 2 : 1), 0), 2, true)).toBeNull();
});
