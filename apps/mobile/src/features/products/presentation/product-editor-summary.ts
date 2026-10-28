import { orderedRows, removalOf, type EditorDraft } from "@shared/product-variants";

export type EditorSummary = Readonly<{
  /** Live variants, including deactivated and new ones. */
  count: number;
  active: number;
  /** Stock and lowest price count active variants only. */
  stock: number;
  from: number | null;
}>;

export function editorSummary(draft: EditorDraft): EditorSummary {
  const live = orderedRows(draft).filter((row) => removalOf(draft, row) === null);
  const active = live.filter((row) => row.status === "active");
  return {
    count: live.length,
    active: active.length,
    stock: active.reduce((total, row) => total + row.stock, 0),
    from: active.length > 0 ? Math.min(...active.map((row) => row.salePrice)) : null,
  };
}
