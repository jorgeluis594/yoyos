import { orderedRows, removalOf, rowLabel, type EditorDraft, type EditorRow, type RowRemoval } from "@shared/product-variants";
import type { FeedbackIssue } from "@core/src/features/products/presentation/messages";

export type RowTag = "new" | "inactive" | "removed" | "deleted";
export type RowView = Readonly<{ row: EditorRow; label: string; removal: RowRemoval | null; tag: RowTag | null }>;

/** The table rows in saved order, each with its label and the mark that explains why it is struck or new. */
export function rowViews(draft: EditorDraft): readonly RowView[] {
  return orderedRows(draft).map((row) => {
    const removal = removalOf(draft, row);
    const tag: RowTag | null = removal ? (row.id === null ? "removed" : "deleted") : row.id === null ? "new" : row.status === "inactive" ? "inactive" : null;
    return { row, label: rowLabel(draft, row), removal, tag };
  });
}

/** A stock is a whole number of at least zero, as core accepts it. */
export const isValidStock = (stock: number): boolean => Number.isSafeInteger(stock) && stock >= 0;

/** The product's stock: what its active variants add up to. A product without options reads it from its single variant.
 *  Null while one of them holds an invalid stock, so the total never shows a figure that looks true. */
export function stockTotal(draft: EditorDraft): number | null {
  const stocks = rowViews(draft).filter((view) => view.removal === null && view.row.status === "active").map((view) => view.row.stock);
  return stocks.every(isValidStock) ? stocks.reduce((sum, stock) => sum + stock, 0) : null;
}

export const hasOptions = (draft: EditorDraft): boolean => draft.options.length > 0;

/** The rows a request sends as `newVariants`, in the order the request lists them. */
export const newRowsInRequestOrder = (draft: EditorDraft): readonly EditorRow[] =>
  orderedRows(draft).filter((row) => row.id === null && removalOf(draft, row) === null);

/** The message of a rejected price or stock, to show in the cell of that field. */
export type RowCells = Readonly<{ salePrice?: string; stock?: string }>;

export type FeedbackTargets = Readonly<{
  rows: Readonly<Record<string, string>>;
  /** The rows whose rejected field is the price or the stock, so each message lands on its own field. */
  cells: Readonly<Record<string, RowCells>>;
  options: Readonly<Record<string, string>>;
  values: Readonly<Record<string, string>>;
  /** Marked values that core refused to delete because a variant now has orders or stock. */
  blockedValues: ReadonlySet<string>;
}>;

/** Places each rejected part of a save on the option, value or row the seller sees. */
export function feedbackTargets(draft: EditorDraft, issues: readonly FeedbackIssue[]): FeedbackTargets {
  const rows: Record<string, string> = {};
  const cells: Record<string, RowCells> = {};
  const options: Record<string, string> = {};
  const values: Record<string, string> = {};
  const blockedValues = new Set<string>();
  const added = newRowsInRequestOrder(draft);
  const keep = (target: Record<string, string>, key: string, text: string) => { target[key] ??= text; };
  // Without options there is no table: a rejected price or SKU belongs to the form's own fields.
  const withTable = draft.options.length > 0;
  const cell = (ref: string, issue: FeedbackIssue) => {
    const key = issue.field === "salePrice" ? "salePrice" : issue.field === "stock" || issue.field === "initialStock" ? "stock" : null;
    if (key) cells[ref] = { ...cells[ref], [key]: cells[ref]?.[key] ?? issue.message };
  };
  for (const issue of issues) {
    if (!withTable && (issue.scope === "newVariant" || issue.scope === "variant")) continue;
    if (issue.scope === "newVariant" && issue.index !== undefined && added[issue.index]) { keep(rows, added[issue.index].ref, issue.message); cell(added[issue.index].ref, issue); }
    else if (issue.scope === "variant" && issue.variantId) {
      const row = draft.rows.find((candidate) => candidate.id === issue.variantId);
      if (!row) continue;
      const marked = draft.options.flatMap((option) => option.values.filter((value) => value.marked && value.id === row.combination[option.id]));
      if (marked.length > 0 && (issue.reason === "VARIANT_HAS_ORDERS" || issue.reason === "VARIANT_HAS_STOCK")) marked.forEach((value) => blockedValues.add(value.id));
      else { keep(rows, row.ref, issue.message); cell(row.ref, issue); }
    } else if (issue.scope === "option" && issue.optionId) keep(options, issue.optionId, issue.message);
    else if (issue.scope === "value" && issue.valueId) keep(values, issue.valueId, issue.message);
  }
  return { rows, cells, options, values, blockedValues };
}

/** Whatever the seller can lose by leaving: compared with the snapshot taken when the form opened. */
export const draftSnapshot = (parts: readonly unknown[]): string => JSON.stringify(parts);
