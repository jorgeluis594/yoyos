import { describe, expect, test } from "vitest";
import type { FinalLine } from "@core/evals/cases/schema";
import { changedLinesOf, lineDiffers, scoredLinesOf, type ChangedLine, type ChangeRow } from "@core/evals/lib/changed-lines";

const snapshot = (variantId: string, quantity: number, mentioned: { amount: number; units: number } | null = null) => ({
  itemId: "i", variantId, productName: "p", variantAttributes: { Talla: "M" }, sku: null, quantity, unitPrice: { amount: 10, currency: "PEN" }, position: 0,
  mentionedPrice: mentioned ? { amount: { amount: mentioned.amount, currency: "PEN" }, units: mentioned.units } : null,
});
const productOf = (variantId: string) => variantId === "v-polera" ? "polera-algodon" as const : variantId === "v-gorra" ? "gorra-trucker" as const : null;

describe("changedLinesOf (the message's change rows)", () => {
  test("reads an added line unmarked, a doubtful one marked, and a removal as a line with no state after", () => {
    const rows: readonly ChangeRow[] = [
      { decision: "applied", before: null, after: snapshot("v-polera", 2) },
      { decision: "doubtful", before: null, after: snapshot("v-polera", 3, { amount: 8, units: 1 }) },
      { decision: "applied", before: snapshot("v-gorra", 2), after: null },
    ];
    expect(changedLinesOf(rows, productOf)).toEqual([
      { product: "polera-algodon", variant: { Talla: "M" }, marked: false, after: { quantity: 2, mentionedPrice: null }, touched: { quantity: true, mentionedPrice: true } },
      { product: "polera-algodon", variant: { Talla: "M" }, marked: true, after: { quantity: 3, mentionedPrice: { amount: 8, units: 1 } }, touched: { quantity: true, mentionedPrice: true } },
      { product: "gorra-trucker", variant: { Talla: "M" }, marked: false, after: null, touched: { quantity: true, mentionedPrice: true } },
    ]);
  });

  test("reads no line from a message with no rows", () => {
    expect(changedLinesOf([], productOf)).toEqual([]);
  });
});

const line = (over: Partial<ChangedLine> = {}): ChangedLine => ({ product: "polera-algodon", variant: { Talla: "M" }, marked: false, after: { quantity: 2, mentionedPrice: null },
  touched: { quantity: true, mentionedPrice: true }, ...over });
const wanted = (over: Partial<FinalLine> = {}): FinalLine => ({ product: "polera-algodon", variant: { Talla: "M" }, quantity: 2, mentionedPrice: null, ...over });
const wantedL = (quantity: number): FinalLine => wanted({ variant: { Talla: "L" }, quantity });

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

describe("the fields a message touched on a line", () => {
  const tallaL = (quantity: number, mentioned: { amount: number; units: number } | null = null) => ({ ...snapshot("v-polera", quantity, mentioned), variantAttributes: { Talla: "L" } });
  const tallaM = (quantity: number, mentioned: { amount: number; units: number } | null = null) => ({ ...snapshot("v-polera-m", quantity, mentioned), variantAttributes: { Talla: "M" } });
  const productOfVariant = (variantId: string) => variantId.startsWith("v-polera") ? "polera-algodon" as const : null;

  test("a variant change carries the quantity of the line it replaces: the new line's quantity is not the message's", () => {
    const rows: readonly ChangeRow[] = [{ decision: "applied", before: null, after: tallaL(1) }, { decision: "applied", before: tallaM(1), after: null }];
    expect(changedLinesOf(rows, productOfVariant).map(({ touched }) => touched)).toEqual([{ quantity: false, mentionedPrice: false }, { quantity: true, mentionedPrice: true }]);
  });

  test("a variant change that also sets another quantity or states a price touches them", () => {
    const rows: readonly ChangeRow[] = [{ decision: "applied", before: null, after: tallaL(3, { amount: 8, units: 1 }) }, { decision: "applied", before: tallaM(1), after: null }];
    expect(changedLinesOf(rows, productOfVariant)[0]!.touched).toEqual({ quantity: true, mentionedPrice: true });
  });

  test("a new line with nothing to inherit from, and a row that changed the quantity or only the price, touch what they changed", () => {
    expect(changedLinesOf([{ decision: "applied", before: null, after: tallaL(2) }], productOfVariant)[0]!.touched).toEqual({ quantity: true, mentionedPrice: true });
    expect(changedLinesOf([{ decision: "applied", before: tallaL(2), after: tallaL(3) }], productOfVariant)[0]!.touched).toEqual({ quantity: true, mentionedPrice: false });
    expect(changedLinesOf([{ decision: "applied", before: tallaL(2), after: tallaL(2, { amount: 8, units: 1 }) }], productOfVariant)[0]!.touched).toEqual({ quantity: false, mentionedPrice: true });
  });

  test("a quantity the message did not change is not its error, a quantity it did change is", () => {
    const inherited = changedLinesOf([{ decision: "applied", before: null, after: tallaL(1) }, { decision: "applied", before: tallaM(1), after: null }], productOfVariant);
    const wanted = [wantedL(2)];
    expect(scoredLinesOf(inherited, wanted)).toEqual([{ marked: false, wrong: false }, { marked: false, wrong: false }]);
    const changed = changedLinesOf([{ decision: "applied", before: tallaL(2), after: tallaL(3) }], productOfVariant);
    expect(scoredLinesOf(changed, wanted)).toEqual([{ marked: false, wrong: true }]);
    expect(scoredLinesOf(changedLinesOf([{ decision: "applied", before: tallaL(2), after: tallaL(2) }], productOfVariant), [wantedL(5)])).toEqual([{ marked: false, wrong: false }]);
  });

  test("a line the message put on the wrong variant is still wrong, whatever it inherited", () => {
    const rows: readonly ChangeRow[] = [{ decision: "applied", before: null, after: tallaL(1) }, { decision: "applied", before: tallaM(1), after: null }];
    expect(scoredLinesOf(changedLinesOf(rows, productOfVariant), [wanted({ variant: { Talla: "M" }, quantity: 1 })])).toEqual([{ marked: false, wrong: true }, { marked: false, wrong: true }]);
  });
});
