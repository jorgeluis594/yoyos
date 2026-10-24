import type { ImageExpectation, MessageExpectation, OutcomeKind, TextExpectation } from "@core/evals/cases/schema";
import type { CaseRecord } from "@core/evals/lib/case-record";

/**
 * Grades a model's own pick against what the case expects, whatever the gate then did with it. The calibration needs this: below a
 * gate every outcome field is decided by the gate (an action under 0.6 always ends as `ambiguous_intent`), so grading by outcome only
 * confirms the gate. True or false when the case says what the right pick is, null when it cannot tell (an item choice, or a record
 * from before picks were kept).
 */

type Certainty = CaseRecord["certainties"][number];

/** The pick of a certainty: its `pick`, or for older records the part of `detail` after «→» («none» is null). */
export function pickOf(certainty: Certainty): string | null | undefined {
  if (certainty.pick !== undefined) return certainty.pick;
  if (certainty.detail === undefined) return undefined;
  if (certainty.source === "action") return certainty.detail;
  const [, chosen] = certainty.detail.split(" → ");
  if (chosen === undefined) return undefined;
  return chosen === "none" ? null : chosen;
}

const sortedValues = (values: readonly string[]) => [...values].sort().join(" ");
const noProductOutcomes: ReadonlySet<OutcomeKind> = new Set<OutcomeKind>(["no_intent", "ambiguous_intent", "not_identified", "image_with_request"]);

function gradeAction(pick: string, expectations: readonly MessageExpectation[]): boolean | null {
  const scorable = expectations.filter(({ tools }) => tools !== undefined && tools.length > 0);
  if (!scorable.length) return null;
  // One expected tool: the Decision chose it. Several: it chose «several».
  return scorable.some(({ tools }) => tools!.length === 1 ? pick === tools![0] : pick === "several");
}

const orderedProducts = (expectations: readonly MessageExpectation[]) => new Set(expectations.flatMap(({ order }) => order?.map(({ product }) => product) ?? []));

/** A product pick (text or visual) in a message case is right when an acceptable final order has that product. */
function gradeMessageProduct(pick: string | null, expectations: readonly MessageExpectation[]): boolean | null {
  // A declined photo leaves its product out of every order, so nothing says which product it showed.
  if (expectations.some(({ tools }) => tools?.includes("decline_shown_product"))) return null;
  const products = orderedProducts(expectations);
  const expectsNoProduct = expectations.every(({ order, outcomes }) => !order?.length && outcomes.every((kind) => noProductOutcomes.has(kind)));
  if (pick === null) {
    if (expectsNoProduct || expectations.some(({ outcomes }) => outcomes.includes("not_identified"))) return true;
    return products.size ? false : null;
  }
  if (products.has(pick as never)) return true;
  // With no product in any acceptable order: wrong when nothing should be identified (a selfie, a product not sold), else unknown
  // (a photo whose product ends in «Falta la variante» names no order line).
  return products.size || expectsNoProduct ? false : null;
}

function gradeMessageVariant(pick: string | null, expectations: readonly MessageExpectation[]): boolean | null {
  const variants = new Set(expectations.flatMap(({ order }) => order?.map(({ variant }) => sortedValues(Object.values(variant))) ?? []));
  if (pick === null) {
    if (expectations.some(({ outcomes }) => outcomes.includes("variant_not_available") || outcomes.includes("variant_missing"))) return true;
    return variants.size ? false : null;
  }
  return variants.size ? variants.has(sortedValues(pick.split(" "))) : null;
}

function gradeText(pick: string | null, expectations: readonly TextExpectation[]): boolean | null {
  return expectations.some((expectation) => {
    if (expectation.kind === "found") return pick === expectation.product;
    if (expectation.kind === "not_found") return pick === null;
    // «Producto no claro»: a pick among the expected candidates is a right reading; «none» is not.
    return pick !== null && (expectation.products === undefined || expectation.products.includes(pick as never));
  });
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
  if (certainty.source === "item") return null;
  const pick = pickOf(certainty);
  if (pick === undefined) return null;
  if (record.pass === "text") return certainty.source.startsWith("text") ? gradeText(pick, record.expected as readonly TextExpectation[]) : null;
  if (record.pass === "image") {
    const expectations = record.expected as readonly ImageExpectation[];
    if (certainty.source === "shows_product") return pick === null ? null : gradeShowsProduct(pick, expectations);
    return certainty.source.startsWith("visual") ? gradeImage(pick, expectations) : null;
  }
  // Whether a message photo is a product is not stated by message expectations (a declined product photo also ends as no intent).
  if (certainty.source === "shows_product") return null;
  const expectations = record.expected as readonly MessageExpectation[];
  if (certainty.source === "action") return pick === null ? null : gradeAction(pick, expectations);
  if (certainty.source.startsWith("variant")) return gradeMessageVariant(pick, expectations);
  return gradeMessageProduct(pick, expectations);
}
