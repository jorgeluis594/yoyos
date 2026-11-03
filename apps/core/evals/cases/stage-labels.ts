import { after } from "@core/evals/cases/builders";
import type { DecisionKind, EvalCaseInput, FinalLine, OutcomeKind, StageExpectation } from "@core/evals/cases/schema";

/**
 * Stage labels of the cases that exercise the four families of the seed bank (cases/seed-bank.ts): the intent, the extracted fields (`quantity` and
 * `price` are reserved names; the rest are the variant attributes as the buyer names them) and the chosen product, plus the decision where the
 * notice and outcomes do not say it. The other cases are relabelled by derivation (lib/stage-facts.ts `decisionOf`). Paraphrases take their base's label.
 */
type Label = Readonly<{ stages: StageExpectation; decision?: DecisionKind }>;

/**
 * Relabel table (product «Every current outcome under the new decisions»): the cases whose legacy expectation is a notice that never changed the order
 * (`variant_only`, `unnamed_add`) or a silent change of the order's only item now expect a «Con duda» change: the order changes, the outcome is the change
 * and there is no notice. Cases whose answer stays urgent (several items, the photo guard, a pending) are not here and keep their legacy notice.
 * Paraphrases take their base's expectation.
 */
type Relabel = Readonly<{ outcomes: readonly OutcomeKind[]; order: readonly FinalLine[] }>;
const variantChanged = (order: FinalLine): Relabel => ({ outcomes: ["variant_changed"], order: [order] });
const quantityChanged = (order: FinalLine): Relabel => ({ outcomes: ["quantity_changed"], order: [order] });
const negro = { Color: "Negro" } as const;
export const doubtfulRelabels: Readonly<Record<string, Relabel>> = {
  // Variant-only text with one item it fits and no photo: the variant changes, marked (product l.214).
  "int-variant-only": variantChanged(after("polo-basico", { Talla: "L", Color: "Negro" })),
  "int-variant-only-color": variantChanged(after("gorra-trucker", negro)),
  "int-variant-only-la-quiero": variantChanged(after("polera-capucha", { Talla: "M", Color: "Gris" })),
  // «dame 2 de ese» / «pásame 2 de esos» with one of that product in the order and no photo just sent is set wording: the line is set to 2, marked
  // (founder 2026-11-01). Add wording («2 más», «otro igual», «lo mismo x2») adds, marked.
  "int-unnamed-add": quantityChanged(after("polo-basico", { Talla: "M", Color: "Negro" }, 2)),
  "int-unnamed-add-otro-igual": quantityChanged(after("gorra-trucker", negro, 2)),
  "int-unnamed-uno-mas": quantityChanged(after("correa-cuero", negro, 2)),
  "int-unnamed-set-esos-no-photo-2": quantityChanged(after("polera-capucha", { Talla: "M", Color: "Gris" }, 2)),
  // Set wording on the only item with no photo just sent: the only item is a context target, at best «Con duda» (product l.245).
  "int-unnamed-set-only-item-2": quantityChanged(after("correa-cuero", negro, 4)),
  "int-set-quantity-unnamed": quantityChanged(after("polo-basico", { Talla: "M", Color: "Negro" }, 3)),
  // Holdout v1, same patterns.
  "hold-variant-only-necesito": variantChanged(after("polera-capucha", { Talla: "L", Color: "Gris" })),
  "hold-unnamed-otra": quantityChanged(after("correa-cuero", negro, 2)),
  "hold-unnamed-dos-mas": quantityChanged(after("polera-capucha", { Talla: "M", Color: "Gris" }, 3)),
  "hold-unnamed-lo-mismo": quantityChanged(after("gorra-trucker", negro, 3)),
  "hold-qty-only-item": quantityChanged(after("medias-pack", {}, 4)),
};

export const stageLabels: Readonly<Record<string, Label>> = {
  // Confirmations and payment questions must not read as no intent.
  "int-ready-confirmo": { stages: { intent: "requests" }, decision: "notice" },
  "int-pay-account-number": { stages: { intent: "requests" }, decision: "urgent" },
  "int-pay-which-account": { stages: { intent: "requests" }, decision: "urgent" },
  // Quantities, named or after a photo.
  "int-qty-set-named": { stages: { intent: "requests", fields: { quantity: "3" }, product: "polo-basico" }, decision: "applied" },
  "int-qty-one-more-named": { stages: { intent: "requests", fields: { quantity: "1" }, product: "gorra-trucker" }, decision: "doubtful" },
  "int-unnamed-uno-mas": { stages: { intent: "requests", fields: { quantity: "1" } }, decision: "doubtful" },
  // Mentioned prices.
  "int-price-one-sol-new": { stages: { intent: "requests", fields: { price: "1", Color: "Negro" }, product: "correa-cuero" }, decision: "applied" },
  "int-price-one-sol-existing": { stages: { intent: "requests", fields: { price: "1" }, product: "polo-basico" }, decision: "applied" },
  "int-price-identified-product-2": { stages: { intent: "requests", fields: { price: "55", Talla: "L", Color: "Blanco" }, product: "polo-premium" }, decision: "applied" },
  // «la quiero en M» with a single item.
  "int-variant-only-la-quiero": { stages: { intent: "requests", fields: { Talla: "M" } }, decision: "doubtful" },
};

const baseIdOf = (id: string): string => id.split("~")[0]!;

/** Adds the stage labels and the «Con duda» relabels to the first expectation of the message cases. Run before the paraphrases are made, so they keep it. */
export function withStageLabels(cases: readonly EvalCaseInput[]): readonly EvalCaseInput[] {
  return cases.map((testCase) => {
    if (testCase.pass !== "interpretation" && testCase.pass !== "end_to_end") return testCase;
    const label = stageLabels[baseIdOf(testCase.id)];
    const relabel = doubtfulRelabels[baseIdOf(testCase.id)];
    if (!label && !relabel) return testCase;
    const [first, ...rest] = testCase.expected;
    const labelled = {
      ...first!,
      ...(label ? { stages: label.stages } : {}),
      ...(relabel ? { decision: "doubtful" as const, notice: null, outcomes: [...relabel.outcomes], order: [...relabel.order] } : {}),
      ...(label?.decision && !relabel ? { decision: label.decision } : {}),
    };
    return { ...testCase, expected: [labelled, ...rest] };
  });
}
