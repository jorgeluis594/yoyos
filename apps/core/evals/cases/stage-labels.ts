import type { DecisionKind, EvalCaseInput, StageExpectation } from "@core/evals/cases/schema";

/**
 * Stage labels of the cases that exercise the four families of the seed bank (cases/seed-bank.ts): the intent, the extracted fields (`quantity` and
 * `price` are reserved names; the rest are the variant attributes as the buyer names them) and the chosen product, plus the decision where the
 * notice and outcomes do not say it. The other cases are relabelled by derivation (lib/stage-facts.ts `decisionOf`). Paraphrases take their base's label.
 */
type Label = Readonly<{ stages: StageExpectation; decision?: DecisionKind }>;

export const stageLabels: Readonly<Record<string, Label>> = {
  // Confirmations and payment questions read as no intent.
  "int-ready-confirmo": { stages: { intent: "requests" }, decision: "notice" },
  "int-pay-account-number": { stages: { intent: "requests" }, decision: "urgent" },
  "int-pay-which-account": { stages: { intent: "requests" }, decision: "urgent" },
  // Quantities, named or after a photo.
  "int-qty-set-named": { stages: { intent: "requests", fields: { quantity: "3" }, product: "polo-basico" }, decision: "applied" },
  "int-qty-one-more-named": { stages: { intent: "requests", fields: { quantity: "1" }, product: "gorra-trucker" }, decision: "applied" },
  "int-unnamed-uno-mas": { stages: { intent: "requests", fields: { quantity: "1" } }, decision: "urgent" },
  // Mentioned prices.
  "int-price-one-sol-new": { stages: { intent: "requests", fields: { price: "1", Color: "Negro" }, product: "correa-cuero" }, decision: "applied" },
  "int-price-one-sol-existing": { stages: { intent: "requests", fields: { price: "1" }, product: "polo-basico" }, decision: "applied" },
  "int-price-identified-product-2": { stages: { intent: "requests", fields: { price: "55", Talla: "L", Color: "Blanco" }, product: "polo-premium" }, decision: "applied" },
  // «la quiero en M» with a single item.
  "int-variant-only-la-quiero": { stages: { intent: "requests", fields: { Talla: "M" } }, decision: "urgent" },
};

const baseIdOf = (id: string): string => id.split("~")[0]!;

/** Adds the stage labels to the first expectation of the labelled message cases. Run before the paraphrases are made, so they keep it. */
export function withStageLabels(cases: readonly EvalCaseInput[]): readonly EvalCaseInput[] {
  return cases.map((testCase) => {
    const label = stageLabels[baseIdOf(testCase.id)];
    if (!label || (testCase.pass !== "interpretation" && testCase.pass !== "end_to_end")) return testCase;
    const [first, ...rest] = testCase.expected;
    return { ...testCase, expected: [{ ...first!, stages: label.stages, ...(label.decision ? { decision: label.decision } : {}) }, ...rest] };
  });
}
