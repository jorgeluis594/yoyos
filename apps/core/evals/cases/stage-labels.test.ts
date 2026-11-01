import { expect, test } from "vitest";
import { allCases } from "@core/evals/cases";
import { doubtfulRelabels } from "@core/evals/cases/stage-labels";
import { decisionOf } from "@core/evals/lib/stage-facts";

test("the variant-only and unnamed-reference cases expect a doubtful change with the changed order and no notice", () => {
  for (const id of Object.keys(doubtfulRelabels)) {
    for (const testCase of allCases.filter((candidate) => candidate.id === id || candidate.paraphraseOf === id)) {
      if (testCase.pass !== "interpretation") throw new Error(`${id} is not an interpretation case`);
      const [expectation] = testCase.expected;
      expect(decisionOf(expectation!), testCase.id).toBe("doubtful");
      expect(expectation!.notice, testCase.id).toBeNull();
      expect(expectation!.order?.length, testCase.id).toBeGreaterThan(0);
    }
  }
});

test("the «la quiero en M» case expects Polera gris M ×1 as a doubtful change (product AC1)", () => {
  const testCase = allCases.find((candidate) => candidate.id === "int-variant-only-la-quiero");
  expect(testCase).toMatchObject({ expected: [{ decision: "doubtful", outcomes: ["variant_changed"], notice: null, order: [{ product: "polera-capucha", variant: { Talla: "M", Color: "Gris" }, quantity: 1 }] }] });
});

const singleItemCases = allCases.filter((testCase) => testCase.pass === "interpretation" && !testCase.paraphraseOf
  && testCase.input.photo === undefined && testCase.input.order?.length === 1 && !testCase.input.pendings?.length);
const legacyKinds = ["variant_only", "unnamed_add"];
/** Single-item set wording with no photo: the only item is a context target, at best «Con duda» (product l.245). */
const onlyItemSets = ["int-set-quantity-unnamed", "int-unnamed-set-only-item-2", "hold-qty-only-item"];
/** The variant is not sold for the item, so product l.214 keeps it urgent as `variant_not_available`. */
const variantNotSold = ["hold-variant-only-gris"];

test("no single-item case without photo or pending keeps the old urgent variant-only or unnamed-add label", () => {
  const stale = singleItemCases.flatMap((testCase) => testCase.pass !== "interpretation" ? [] : testCase.expected
    .filter((expectation) => legacyKinds.includes(expectation.notice ?? "") || (expectation.outcomes ?? []).some((kind) => legacyKinds.includes(kind)))
    .filter((expectation) => decisionOf(expectation) !== "doubtful" && !variantNotSold.includes(testCase.id))
    .map(() => testCase.id));
  expect(stale).toEqual([]);
});

/**
 * The burst case keeps its allowed repeat. T16 settled the question: a photo right after another photo leaves nothing (`nextLastIncomingPhoto`), so «the photo just sent»
 * does not cover two photos in a row and the set wording after a burst stays an unnamed add. A real run (E2) confirms whether the notices repeat.
 */
const burstAfterTwoPhotos = ["conv-photo-burst-set"];

test("the only-item set cases are doubtful too", () => {
  for (const id of onlyItemSets) {
    const testCase = allCases.find((candidate) => candidate.id === id);
    if (testCase?.pass !== "interpretation") throw new Error(`${id} is not an interpretation case`);
    expect(decisionOf(testCase.expected[0]!), id).toBe("doubtful");
  }
});

test("no conversation step expects the double notice the product removed", () => {
  const repeats = allCases.flatMap((testCase) => testCase.pass !== "conversation" ? []
    : testCase.steps.filter((step) => "expected" in step && step.expectsRepeatNotice && step.expected.notice === "unnamed_add").map(() => testCase.id));
  expect(repeats.filter((id) => !burstAfterTwoPhotos.includes(id))).toEqual([]);
});
