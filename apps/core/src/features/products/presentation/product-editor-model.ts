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

/** The product's stock: what its active variants add up to. A product without options reads it from its single variant. */
export const stockTotal = (draft: EditorDraft): number =>
  rowViews(draft).filter((view) => view.removal === null && view.row.status === "active").reduce((sum, view) => sum + view.row.stock, 0);

export const hasOptions = (draft: EditorDraft): boolean => draft.options.length > 0;

/** The rows a request sends as `newVariants`, in the order the request lists them. */
export const newRowsInRequestOrder = (draft: EditorDraft): readonly EditorRow[] =>
  orderedRows(draft).filter((row) => row.id === null && removalOf(draft, row) === null);

export type FeedbackTargets = Readonly<{
  rows: Readonly<Record<string, string>>;
  options: Readonly<Record<string, string>>;
  values: Readonly<Record<string, string>>;
  /** Marked values that core refused to delete because a variant now has orders or stock. */
  blockedValues: ReadonlySet<string>;
}>;

/** Places each rejected part of a save on the option, value or row the seller sees. */
export function feedbackTargets(draft: EditorDraft, issues: readonly FeedbackIssue[]): FeedbackTargets {
  const rows: Record<string, string> = {};
  const options: Record<string, string> = {};
  const values: Record<string, string> = {};
  const blockedValues = new Set<string>();
  const added = newRowsInRequestOrder(draft);
  const keep = (target: Record<string, string>, key: string, text: string) => { target[key] ??= text; };
  // Without options there is no table: a rejected price or SKU belongs to the form's own fields.
  const withTable = draft.options.length > 0;
  for (const issue of issues) {
    if (!withTable && (issue.scope === "newVariant" || issue.scope === "variant")) continue;
    if (issue.scope === "newVariant" && issue.index !== undefined && added[issue.index]) keep(rows, added[issue.index].ref, issue.message);
    else if (issue.scope === "variant" && issue.variantId) {
      const row = draft.rows.find((candidate) => candidate.id === issue.variantId);
      if (!row) continue;
      const marked = draft.options.flatMap((option) => option.values.filter((value) => value.marked && value.id === row.combination[option.id]));
      if (marked.length > 0 && (issue.reason === "VARIANT_HAS_ORDERS" || issue.reason === "VARIANT_HAS_STOCK")) marked.forEach((value) => blockedValues.add(value.id));
      else keep(rows, row.ref, issue.message);
    } else if (issue.scope === "option" && issue.optionId) keep(options, issue.optionId, issue.message);
    else if (issue.scope === "value" && issue.valueId) keep(values, issue.valueId, issue.message);
  }
  return { rows, options, values, blockedValues };
}

/** Whatever the seller can lose by leaving: compared with the snapshot taken when the form opened. */
export const draftSnapshot = (parts: readonly unknown[]): string => JSON.stringify(parts);
