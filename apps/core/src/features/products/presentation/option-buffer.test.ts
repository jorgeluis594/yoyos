import { expect, test } from "vitest";
import { createDraft, orderedRows, rowLabel, type EditorDraft } from "@shared/product-variants";
import { applyOptionBuffer, bufferChanged, bufferFromOption, newOptionBuffer, optionIssues, type OptionBuffer } from "@core/src/features/products/presentation/option-buffer";

const base = { sku: null, salePrice: 39.9, purchasePrice: null, stock: 4 };
let counter = 0;
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const buffer = (name: string, texts: readonly string[], overrides: Partial<OptionBuffer> = {}): OptionBuffer =>
  ({ ...newOptionBuffer(id()), name, values: texts.map((text) => ({ id: id(), text })), ...overrides });
const withOption = (draft: EditorDraft, name: string, texts: readonly string[]): EditorDraft => {
  const result = applyOptionBuffer(draft, buffer(name, texts));
  if (!result.success) throw new Error(result.error.code);
  return result.data;
};

test("applies a new option with trimmed names and no blank values", () => {
  const result = applyOptionBuffer(createDraft(base), buffer("  Talla ", [" S", "", "M "]));
  expect(result.success && result.data.options[0]).toMatchObject({ name: "Talla", values: [{ name: "S" }, { name: "M" }] });
});

test("reports a name that repeats another option and values that repeat ignoring case and spaces", () => {
  const draft = withOption(createDraft(base), "Talla", ["S", "M"]);
  expect(optionIssues(draft, buffer("talla ", ["Azul"]))).toEqual([{ kind: "NAME_DUPLICATE", name: "talla" }]);
  const repeated = buffer("Color", ["m", "M "]);
  expect(optionIssues(draft, repeated)).toEqual([{ kind: "VALUE_DUPLICATE", valueId: repeated.values[1].id, text: "M" }]);
});

test("reports an empty name, no values and names over thirty characters", () => {
  const draft = createDraft(base);
  expect(optionIssues(draft, buffer("", ["S"]))).toEqual([{ kind: "NAME_REQUIRED" }]);
  expect(optionIssues(draft, buffer("Talla", []))).toEqual([{ kind: "NO_VALUES" }]);
  const long = buffer("x".repeat(31), ["S"]);
  expect(optionIssues(draft, long)).toEqual([{ kind: "NAME_TOO_LONG" }]);
});

test("reports more than thirty values", () => {
  const issues = optionIssues(createDraft(base), buffer("Talla", Array.from({ length: 31 }, (_, index) => `T${index}`)));
  expect(issues).toContainEqual({ kind: "TOO_MANY_VALUES", maximum: 30 });
});

test("reports 120 combinations with the value counts of every option when a new product passes the limit", () => {
  const draft = withOption(withOption(createDraft(base), "Talla", ["S", "M", "L", "XL", "XXL"]), "Color", ["Negro", "Azul", "Rojo", "Blanco", "Verde", "Gris"]);
  expect(optionIssues(draft, buffer("Manga", ["Corta", "Larga", "Tres cuartos", "Sin manga"]))).toEqual([
    { kind: "TOO_MANY_VARIANTS", maximum: 100, projected: 120, saved: false, current: 30, counts: [{ name: "Talla", count: 5 }, { name: "Color", count: 6 }, { name: "Manga", count: 4 }] },
  ]);
});

test("reports current and new variants when a saved product passes the limit", () => {
  const saved: EditorDraft = { ...withOption(withOption(createDraft(base), "Talla", ["S", "M", "L", "XL", "XXL", "XXXL", "A", "B", "C", "D", "E", "F", "G", "H"]), "Color", ["Negro", "Azul", "Rojo", "Blanco", "Verde", "Gris", "Rosa"]), saved: true };
  const option = saved.options[0];
  const more = { ...bufferFromOption(option), values: [...bufferFromOption(option).values, { id: id(), text: "XXXXL" }] };
  const [issue] = optionIssues(saved, more);
  expect(issue).toMatchObject({ kind: "TOO_MANY_VARIANTS", saved: true, current: 98, projected: 105 });
});

test("renames, adds and moves the values of a saved option in one step", () => {
  const draft = withOption(createDraft(base), "Talla", ["S", "M"]);
  const option = draft.options[0];
  const edited: OptionBuffer = {
    ...bufferFromOption(option), name: "Tallas",
    values: [{ id: id(), text: "XS" }, { id: option.values[1].id, text: "Mediana" }, { id: option.values[0].id, text: "S" }],
  };
  expect(optionIssues(draft, edited)).toEqual([]);
  const applied = applyOptionBuffer(draft, edited);
  expect(applied.success && applied.data.options[0]).toMatchObject({ name: "Tallas", values: [{ name: "XS" }, { name: "Mediana" }, { name: "S" }] });
  expect(applied.success && orderedRows(applied.data).map((row) => rowLabel(applied.data, row))).toEqual(["XS", "Mediana", "S"]);
});

test("a buffer is changed only when it differs from the draft", () => {
  const draft = withOption(createDraft(base), "Talla", ["S", "M"]);
  const same = bufferFromOption(draft.options[0]);
  expect(bufferChanged(draft, same)).toBe(false);
  expect(bufferChanged(draft, { ...same, name: "Tallas" })).toBe(true);
  expect(bufferChanged(draft, newOptionBuffer(id()))).toBe(false);
  expect(bufferChanged(draft, { ...newOptionBuffer(id()), name: "Color" })).toBe(true);
});
