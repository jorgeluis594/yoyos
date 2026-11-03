import type { FinalLine } from "@core/evals/cases/schema";
import type { ProductKey } from "@core/evals/fixtures/catalog";

/** The lines a message changed, read from its `OrderItemChange` rows, and the per-line reading of the founder's silent-change gate. Pure: unit-tested in changed-lines.test.ts. */

type Mentioned = Readonly<{ amount: number; units: number }>;
/** A line as the order holds it after the change. */
export type ChangedLineState = Readonly<{ quantity: number; mentionedPrice: Mentioned | null }>;
/** Which fields of a line the message changed: the others keep what the line had (or the line it replaced had), so a difference there is not this message's. */
export type TouchedFields = Readonly<{ quantity: boolean; mentionedPrice: boolean }>;
/**
 * One change row: the line (product and variant), its state after the change (null when the message removed it), the «Con duda» mark it carries, own or
 * inherited by a completed pending, and the fields the message touched.
 */
export type ChangedLine = Readonly<{ product: ProductKey | null; variant: Readonly<Record<string, string>>; after: ChangedLineState | null; marked: boolean; touched: TouchedFields }>;
/** The same row scored against the expected order: `wrong` when that line differs from the expected one. */
export type ScoredChangedLine = Readonly<{ marked: boolean; wrong: boolean }>;

/** The stored snapshot of a change row (`lineSnapshotSchema`), as far as the eval reads it. */
export type ChangeRow = Readonly<{
  decision: "applied" | "doubtful";
  before: unknown;
  after: unknown;
}>;
type Snapshot = Readonly<{ variantId: string; variantAttributes: Record<string, string>; quantity: number; mentionedPrice: Readonly<{ amount: Readonly<{ amount: number }>; units: number }> | null }>;

const stateOf = (snapshot: Snapshot): ChangedLineState =>
  ({ quantity: snapshot.quantity, mentionedPrice: snapshot.mentionedPrice ? { amount: snapshot.mentionedPrice.amount.amount, units: snapshot.mentionedPrice.units } : null });
const touchedAll: TouchedFields = { quantity: true, mentionedPrice: true };

/**
 * The lines the rows changed. A row with a line before and after touched only what differs between them. A variant change leaves two rows (the old
 * variant removed, the new one added): the added line carries the quantity and price of the removed line of its product, so it touched them only when they differ.
 */
export function changedLinesOf(rows: readonly ChangeRow[], productOf: (variantId: string) => ProductKey | null): readonly ChangedLine[] {
  const removed = rows.flatMap(({ before, after }) => before !== null && after === null ? [{ state: stateOf(before as Snapshot), product: productOf((before as Snapshot).variantId), used: false }] : []);
  return rows.map(({ decision, before, after }) => {
    const line = (after ?? before) as Snapshot;
    const state = after ? stateOf(after as Snapshot) : null;
    const product = productOf(line.variantId);
    const previous = before ? stateOf(before as Snapshot) : null;
    const replaced = state && !previous ? removed.find((candidate) => !candidate.used && candidate.product !== null && candidate.product === product) : undefined;
    if (replaced) replaced.used = true;
    const origin = previous ?? replaced?.state ?? null;
    const touched = state && origin ? { quantity: state.quantity !== origin.quantity, mentionedPrice: !samePrice(state.mentionedPrice, origin.mentionedPrice) } : touchedAll;
    return { product, variant: line.variantAttributes, marked: decision === "doubtful", after: state, touched };
  });
}

const sameVariant = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([name, value]) => b[name] === value);
const samePrice = (a: Mentioned | null, b: Mentioned | null) => a === null || b === null ? a === b : a.amount === b.amount && a.units === b.units;

/**
 * The line differs from the expected order's line for its product and variant: missing, extra, or another quantity or price. Lines the message did not
 * touch are not looked at, and neither are the fields of a line it did not change (an inherited quantity): that is an earlier message's error.
 */
export function lineDiffers(line: ChangedLine, expected: readonly FinalLine[]): boolean {
  const wanted = expected.find((candidate) => candidate.product === line.product && sameVariant(candidate.variant, line.variant));
  if (line.after === null) return wanted !== undefined;
  if (wanted === undefined) return true;
  return (line.touched.quantity && wanted.quantity !== line.after.quantity) || (line.touched.mentionedPrice && !samePrice(wanted.mentionedPrice, line.after.mentionedPrice));
}

export const scoredLinesOf = (lines: readonly ChangedLine[], expected: readonly FinalLine[]): readonly ScoredChangedLine[] =>
  lines.map((line) => ({ marked: line.marked, wrong: lineDiffers(line, expected) }));
