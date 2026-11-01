import { describe, expect, test } from "vitest";
import type { FinalLine } from "@core/evals/cases/schema";
import { changedLinesOf, lineDiffers, scoredLinesOf, type ChangedLine, type ChangeRow } from "@core/evals/lib/changed-lines";

const snapshot = (variantId: string, quantity: number, mentioned: { amount: number; units: number } | null = null) => ({
  itemId: "i", variantId, productName: "p", variantAttributes: { Talla: "M" }, sku: null, quantity, unitPrice: { amount: 10, currency: "PEN" }, position: 0,
  mentionedPrice: mentioned ? { amount: { amount: mentioned.amount, currency: "PEN" }, units: mentioned.units } : null,
});
const productOf = (variantId: string) => variantId === "v-polera" ? "polera-algodon" as const : null;

describe("changedLinesOf (the message's change rows)", () => {
  test("reads an added line unmarked, a doubtful one marked, and a removal as a line with no state after", () => {
    const rows: readonly ChangeRow[] = [
      { decision: "applied", before: null, after: snapshot("v-polera", 2) },
      { decision: "doubtful", before: null, after: snapshot("v-polera", 3, { amount: 8, units: 1 }) },
      { decision: "applied", before: snapshot("v-polera", 2), after: null },
    ];
    expect(changedLinesOf(rows, productOf)).toEqual([
      { product: "polera-algodon", variant: { Talla: "M" }, marked: false, after: { quantity: 2, mentionedPrice: null } },
      { product: "polera-algodon", variant: { Talla: "M" }, marked: true, after: { quantity: 3, mentionedPrice: { amount: 8, units: 1 } } },
      { product: "polera-algodon", variant: { Talla: "M" }, marked: false, after: null },
    ]);
  });

  test("reads no line from a message with no rows", () => {
    expect(changedLinesOf([], productOf)).toEqual([]);
  });
});

const line = (over: Partial<ChangedLine> = {}): ChangedLine => ({ product: "polera-algodon", variant: { Talla: "M" }, marked: false, after: { quantity: 2, mentionedPrice: null }, ...over });
const wanted = (over: Partial<FinalLine> = {}): FinalLine => ({ product: "polera-algodon", variant: { Talla: "M" }, quantity: 2, mentionedPrice: null, ...over });

describe("lineDiffers (the changed line against the expected order)", () => {
  test("a line equal to the expected one does not differ", () => {
    expect(lineDiffers(line(), [wanted()])).toBe(false);
  });

  test("differs when the expected order lacks the line, or has another quantity, variant or price", () => {
    expect(lineDiffers(line(), [])).toBe(true);
    expect(lineDiffers(line(), [wanted({ quantity: 3 })])).toBe(true);
    expect(lineDiffers(line(), [wanted({ variant: { Talla: "L" } })])).toBe(true);
    expect(lineDiffers(line(), [wanted({ mentionedPrice: { amount: 8, units: 1 } })])).toBe(true);
  });

  test("a removed line differs only when the expected order still holds it", () => {
    expect(lineDiffers(line({ after: null }), [wanted()])).toBe(true);
    expect(lineDiffers(line({ after: null }), [])).toBe(false);
  });
});

describe("the per-line silent change", () => {
  const other = wanted({ product: "gorra-trucker", variant: {}, quantity: 1 });

  test("a cascade: the message changed a right line while another line of the order (not touched) is wrong", () => {
    expect(scoredLinesOf([line()], [wanted(), other])).toEqual([{ marked: false, wrong: false }]);
  });

  test("a marked wrong line is marked, and a line that inherited its mark from the completed pending too", () => {
    expect(scoredLinesOf([line({ marked: true })], [wanted({ quantity: 5 })])).toEqual([{ marked: true, wrong: true }]);
    const completion = changedLinesOf([{ decision: "doubtful", before: null, after: snapshot("v-polera", 2) }], productOf);
    expect(scoredLinesOf(completion, [])).toEqual([{ marked: true, wrong: true }]);
  });

  test("a real silent change: an unmarked changed line that the expected order does not have", () => {
    expect(scoredLinesOf([line(), line({ marked: true })], [wanted({ quantity: 5 })])).toEqual([{ marked: false, wrong: true }, { marked: true, wrong: true }]);
  });
});
