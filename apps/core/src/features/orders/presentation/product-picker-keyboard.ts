/** The combobox keyboard model of the product picker: focus stays in the search field and these keys move a highlight. */
export type PickerRow = Readonly<{ variantCount: number; hasOptions: boolean }>;
export type PickerHighlight = Readonly<{ product: number; chip: number | null }> | null;
export type PickerKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Enter";
export type PickerKeyOutcome = Readonly<{ highlight: PickerHighlight; add: Readonly<{ product: number; variant: number }> | null; preventDefault: boolean }>;

export const isPickerKey = (key: string): key is PickerKey => ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(key);

export function pickerKey(key: PickerKey, highlight: PickerHighlight, rows: readonly PickerRow[]): PickerKeyOutcome {
  const keep = (preventDefault: boolean): PickerKeyOutcome => ({ highlight, add: null, preventDefault });
  if (key === "Enter" && (!highlight || rows.length === 0)) return keep(true);
  if (rows.length === 0) return keep(false);
  if (!highlight) {
    if (key === "ArrowDown") return { highlight: { product: 0, chip: null }, add: null, preventDefault: true };
    if (key === "ArrowUp") return { highlight: { product: rows.length - 1, chip: null }, add: null, preventDefault: true };
    return keep(false);
  }
  const row = rows[highlight.product];
  switch (key) {
    case "ArrowDown": return { highlight: { product: Math.min(highlight.product + 1, rows.length - 1), chip: null }, add: null, preventDefault: true };
    case "ArrowUp": return { highlight: { product: Math.max(highlight.product - 1, 0), chip: null }, add: null, preventDefault: true };
    case "ArrowRight":
      if (!row.hasOptions) return keep(true);
      return { highlight: { product: highlight.product, chip: highlight.chip === null ? 0 : Math.min(highlight.chip + 1, row.variantCount - 1) }, add: null, preventDefault: true };
    case "ArrowLeft":
      if (highlight.chip === null) return keep(true);
      return { highlight: { product: highlight.product, chip: highlight.chip === 0 ? null : highlight.chip - 1 }, add: null, preventDefault: true };
    case "Enter":
      if (!row.hasOptions) return { highlight, add: { product: highlight.product, variant: 0 }, preventDefault: true };
      if (highlight.chip === null) return { highlight: { product: highlight.product, chip: 0 }, add: null, preventDefault: true };
      return { highlight, add: { product: highlight.product, variant: highlight.chip }, preventDefault: true };
  }
}
