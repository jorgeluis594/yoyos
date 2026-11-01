import type { FinalLine } from "@core/evals/cases/schema";
import type { ProductKey } from "@core/evals/fixtures/catalog";

/** The lines a message changed, read from its `OrderItemChange` rows, and the per-line reading of the founder's silent-change gate. Pure: unit-tested in changed-lines.test.ts. */

type Mentioned = Readonly<{ amount: number; units: number }>;
/** A line as the order holds it after the change. */
export type ChangedLineState = Readonly<{ quantity: number; mentionedPrice: Mentioned | null }>;
/** One change row: the line (product and variant), its state after the change (null when the message removed it) and the «Con duda» mark it carries, own or inherited by a completed pending. */
export type ChangedLine = Readonly<{ product: ProductKey | null; variant: Readonly<Record<string, string>>; after: ChangedLineState | null; marked: boolean }>;
/** The same row scored against the expected order: `wrong` when that line differs from the expected one. */
export type ScoredChangedLine = Readonly<{ marked: boolean; wrong: boolean }>;

/** The stored snapshot of a change row (`lineSnapshotSchema`), as far as the eval reads it. */
export type ChangeRow = Readonly<{
  decision: "applied" | "doubtful";
  before: unknown;
  after: unknown;
}>;
type Snapshot = Readonly<{ variantId: string; variantAttributes: Record<string, string>; quantity: number; mentionedPrice: Readonly<{ amount: Readonly<{ amount: number }>; units: number }> | null }>;

export function changedLinesOf(rows: readonly ChangeRow[], productOf: (variantId: string) => ProductKey | null): readonly ChangedLine[] {
  return rows.map(({ decision, before, after }) => {
    const line = (after ?? before) as Snapshot;
    const state = after as Snapshot | null;
    return { product: productOf(line.variantId), variant: line.variantAttributes, marked: decision === "doubtful",
      after: state ? { quantity: state.quantity, mentionedPrice: state.mentionedPrice ? { amount: state.mentionedPrice.amount.amount, units: state.mentionedPrice.units } : null } : null };
  });
}

const sameVariant = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([name, value]) => b[name] === value);
const samePrice = (a: Mentioned | null, b: Mentioned | null) => a === null || b === null ? a === b : a.amount === b.amount && a.units === b.units;

/** The line differs from the expected order's line for its product and variant: missing, extra, or another quantity or price. Lines the message did not touch are not looked at. */
export function lineDiffers(line: ChangedLine, expected: readonly FinalLine[]): boolean {
  const wanted = expected.find((candidate) => candidate.product === line.product && sameVariant(candidate.variant, line.variant));
  if (line.after === null) return wanted !== undefined;
  return wanted === undefined || wanted.quantity !== line.after.quantity || !samePrice(wanted.mentionedPrice, line.after.mentionedPrice);
}

export const scoredLinesOf = (lines: readonly ChangedLine[], expected: readonly FinalLine[]): readonly ScoredChangedLine[] =>
  lines.map((line) => ({ marked: line.marked, wrong: lineDiffers(line, expected) }));
