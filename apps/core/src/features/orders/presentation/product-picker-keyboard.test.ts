import { describe, expect, test } from "vitest";
import { pickerKey, type PickerHighlight, type PickerRow } from "@core/src/features/orders/presentation/product-picker-keyboard";

const single: PickerRow = { variantCount: 1, hasOptions: false };
const sizes: PickerRow = { variantCount: 3, hasOptions: true };
const rows = [sizes, single, sizes];

describe("pickerKey", () => {
  test("moves the caret with left and right until down arrow highlights the first product", () => {
    for (const key of ["ArrowLeft", "ArrowRight"] as const) {
      expect(pickerKey(key, null, rows)).toEqual({ highlight: null, add: null, preventDefault: false });
    }
    expect(pickerKey("ArrowDown", null, rows)).toEqual({ highlight: { product: 0, chip: null }, add: null, preventDefault: true });
    expect(pickerKey("ArrowUp", null, rows)).toEqual({ highlight: { product: 2, chip: null }, add: null, preventDefault: true });
  });

  test("moves between products with up and down and between chips with left and right", () => {
    let highlight: PickerHighlight = { product: 0, chip: null };
    const press = (key: Parameters<typeof pickerKey>[0]) => { highlight = pickerKey(key, highlight, rows).highlight; return highlight; };
    expect(press("ArrowRight")).toEqual({ product: 0, chip: 0 });
    expect(press("ArrowRight")).toEqual({ product: 0, chip: 1 });
    expect(press("ArrowRight")).toEqual({ product: 0, chip: 2 });
    expect(press("ArrowRight")).toEqual({ product: 0, chip: 2 });
    expect(press("ArrowLeft")).toEqual({ product: 0, chip: 1 });
    expect(press("ArrowDown")).toEqual({ product: 1, chip: null });
    expect(press("ArrowRight")).toEqual({ product: 1, chip: null });
    expect(press("ArrowDown")).toEqual({ product: 2, chip: null });
    expect(press("ArrowDown")).toEqual({ product: 2, chip: null });
    expect(press("ArrowUp")).toEqual({ product: 1, chip: null });
  });

  test("adds the product itself on Enter when it has no options", () => {
    expect(pickerKey("Enter", { product: 1, chip: null }, rows)).toEqual({ highlight: { product: 1, chip: null }, add: { product: 1, variant: 0 }, preventDefault: true });
  });

  test("highlights the first chip on Enter over a product with options without adding", () => {
    expect(pickerKey("Enter", { product: 0, chip: null }, rows)).toEqual({ highlight: { product: 0, chip: 0 }, add: null, preventDefault: true });
  });

  test("adds the highlighted chip on Enter and keeps the highlight", () => {
    expect(pickerKey("Enter", { product: 2, chip: 1 }, rows)).toEqual({ highlight: { product: 2, chip: 1 }, add: { product: 2, variant: 1 }, preventDefault: true });
  });

  test("does nothing on Enter while nothing is highlighted", () => {
    expect(pickerKey("Enter", null, rows)).toEqual({ highlight: null, add: null, preventDefault: true });
  });

  test("ignores every key when there are no results", () => {
    expect(pickerKey("ArrowDown", null, [])).toEqual({ highlight: null, add: null, preventDefault: false });
    expect(pickerKey("Enter", null, [])).toEqual({ highlight: null, add: null, preventDefault: true });
  });
});
