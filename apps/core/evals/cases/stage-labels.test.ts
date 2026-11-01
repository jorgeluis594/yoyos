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
