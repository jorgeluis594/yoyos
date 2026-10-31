import type { ImageExpectation, MessageExpectation, OutcomeKind } from "@core/evals/cases/schema";
import type { CaseRecord } from "@core/evals/lib/case-record";

/**
 * Grades the visual-search model's own pick against what the case expects, whatever the gate then did with it. Only the visual
 * sources are graded: the reading of text has no certainty gate (evals/README.md). True or false when the case says what the right
 * pick is, null when it cannot tell.
 */

type Certainty = CaseRecord["certainties"][number];

/** The pick of a certainty: its `pick`, or for older records the part of `detail` after «→» («none» is null). */
export function pickOf(certainty: Certainty): string | null | undefined {
  if (certainty.pick !== undefined) return certainty.pick;
  if (certainty.detail === undefined) return undefined;
  const [, chosen] = certainty.detail.split(" → ");
  if (chosen === undefined) return undefined;
  return chosen === "none" ? null : chosen;
}

const noProductOutcomes: ReadonlySet<OutcomeKind> = new Set<OutcomeKind>(["no_intent", "not_identified", "image_with_request"]);

const orderedProducts = (expectations: readonly MessageExpectation[]) => new Set(expectations.flatMap(({ order }) => order?.map(({ product }) => product) ?? []));

/** A product pick in a message case is right when an acceptable final order has that product. */
function gradeMessageProduct(pick: string | null, expectations: readonly MessageExpectation[]): boolean | null {
  const products = orderedProducts(expectations);
  const expectsNoProduct = expectations.every(({ order, outcomes, notice }) => !order?.length
    && (outcomes ?? []).every((kind) => noProductOutcomes.has(kind)) && (outcomes !== undefined || notice == null || notice === "not_identified"));
  if (pick === null) {
    if (expectsNoProduct || expectations.some(({ outcomes, notice }) => outcomes?.includes("not_identified") || notice === "not_identified")) return true;
    return products.size ? false : null;
  }
  if (products.has(pick)) return true;
  // With no product in any acceptable order: wrong when nothing should be identified (a selfie, a product not sold), else unknown
  // (a photo whose product ends in «Falta la variante» names no order line).
  return products.size || expectsNoProduct ? false : null;
}

/** A visual pick names the expected product; «none» is right when the photo may end unidentified or as no product. */
function gradeImage(pick: string | null, expectations: readonly ImageExpectation[]): boolean {
  return expectations.some((expectation) => expectation.kind === "found" ? expectation.product === pick : pick === null);
}

/** `shows_product` picks «product» or «not_product»: right when the photo is expected to be a product or not. */
function gradeShowsProduct(pick: string, expectations: readonly ImageExpectation[]): boolean {
  return expectations.some(({ kind }) => (kind === "not_product") === (pick === "not_product"));
}

export function gradePick(certainty: Certainty, record: CaseRecord): boolean | null {
  const pick = pickOf(certainty);
  if (pick === undefined) return null;
  if (record.pass === "image") {
    const expectations = record.expected as readonly ImageExpectation[];
    if (certainty.source === "shows_product") return pick === null ? null : gradeShowsProduct(pick, expectations);
    return certainty.source.startsWith("visual") ? gradeImage(pick, expectations) : null;
  }
  // Whether a message photo is a product is not stated by message expectations (a declined product photo also ends as no intent).
  if (certainty.source === "shows_product" || record.pass === "conversation") return null;
  return certainty.source.startsWith("visual") ? gradeMessageProduct(pick, record.expected as readonly MessageExpectation[]) : null;
}
