import { findVariant, type ProductKey } from "@core/evals/fixtures/catalog";
import type { FinalLine, ImageExpectation, MessageExpectation, OrderLine, OutcomeKind, TextExpectation } from "@core/evals/cases/schema";

/**
 * Exact-match scorers. Each field scores true, false, or null when the expectation does not state it. A case passes when every
 * scored field of one acceptable expectation passes; the report counts fields against the expectation that matched best.
 */

export type FieldScores = Readonly<Record<string, boolean | null>>;
export type Scored = Readonly<{ passed: boolean; fields: FieldScores; expectationIndex: number }>;

export type ActualLine = Readonly<{ product: ProductKey | null; variant: Readonly<Record<string, string>>; quantity: number; unitPrice: number;
  mentionedPrice: Readonly<{ amount: number; units: number }> | null }>;

export type MessageActual = Readonly<{
  tools: readonly string[];
  /** Outcome kinds; empty when the message was skipped, `["failed"]` when the use case returned an error. */
  outcomes: readonly OutcomeKind[];
  order: readonly ActualLine[];
}>;

const sorted = (values: readonly string[]) => [...values].sort();
const sameMultiset = (left: readonly string[], right: readonly string[]) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
const sameSet = (left: readonly string[], right: readonly string[]) => sameMultiset([...new Set(left)], [...new Set(right)]);

const variantText = (variant: Readonly<Record<string, string>>) => Object.entries(variant).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${name}=${value}`).join(",");
const productOf = (line: Pick<ActualLine, "product">) => line.product ?? "unknown";
const variantOf = (line: Pick<ActualLine, "product" | "variant">) => `${productOf(line)}[${variantText(line.variant)}]`;
const priceText = (price: Readonly<{ amount: number; units: number }>) => `${price.amount.toFixed(2)}/${price.units}`;

/** The expected order after the message: the stated one, or the initial order unchanged. */
export const expectedOrder = (expectation: MessageExpectation, initial: readonly OrderLine[]): readonly FinalLine[] =>
  expectation.order ?? initial.map((line) => ({ ...line, mentionedPrice: null }));

/** Field scores of one message against one expectation. */
export function scoreMessageFields(actual: MessageActual, expectation: MessageExpectation, initial: readonly OrderLine[]): FieldScores {
  const order = expectedOrder(expectation, initial);
  const priced = (lines: readonly Pick<ActualLine, "product" | "variant" | "mentionedPrice">[]) =>
    lines.flatMap((line) => line.mentionedPrice ? [`${variantOf(line)}@${priceText(line.mentionedPrice)}`] : []);
  return {
    tool: expectation.tools === undefined ? null : sameSet(actual.tools, expectation.tools),
    outcome: sameMultiset(actual.outcomes, expectation.outcomes),
    product: sameMultiset(actual.order.map(productOf), order.map(productOf)),
    variant: sameMultiset(actual.order.map(variantOf), order.map(variantOf)),
    quantity: sameMultiset(actual.order.map((line) => `${variantOf(line)}x${line.quantity}`), order.map((line) => `${variantOf(line)}x${line.quantity}`)),
    mentionedPrice: sameMultiset(priced(actual.order), priced(order)),
  };
}

/** True when every unit price is the catalog price: no message may change prices, whatever it says. */
export function unitPricesIntact(order: readonly ActualLine[]): boolean {
  return order.every((line) => {
    if (line.product === null) return false;
    try {
      return findVariant(line.product, line.variant).price === line.unitPrice;
    } catch {
      return false; // a variant outside the eval catalog
    }
  });
}

const passes = (fields: FieldScores) => Object.values(fields).every((value) => value !== false);
const passedCount = (fields: FieldScores) => Object.values(fields).filter((value) => value === true).length;

/** Picks the first expectation that passes, else the one with the most passing fields. */
function best<Expectation>(expectations: readonly Expectation[], score: (expectation: Expectation) => FieldScores): Scored {
  const scored = expectations.map((expectation, index) => ({ fields: score(expectation), index }));
  const winner = scored.find(({ fields }) => passes(fields)) ?? scored.reduce((top, next) => passedCount(next.fields) > passedCount(top.fields) ? next : top);
  return { passed: passes(winner.fields), fields: winner.fields, expectationIndex: winner.index };
}

export function scoreMessage(actual: MessageActual, expectations: readonly MessageExpectation[], initial: readonly OrderLine[]): Scored {
  const scored = best(expectations, (expectation) => scoreMessageFields(actual, expectation, initial));
  // Price integrity is checked on every message, whatever the expectation.
  const unitPrice = unitPricesIntact(actual.order);
  return { ...scored, passed: scored.passed && unitPrice, fields: { ...scored.fields, unitPrice } };
}

export type TextActual = Readonly<{ kind: "found"; product: ProductKey | null } | { kind: "not_clear"; products: readonly (ProductKey | null)[] } | { kind: "not_found" } | { kind: "error"; code: string }>;

export function scoreText(actual: TextActual, expectations: readonly TextExpectation[]): Scored {
  return best(expectations, (expectation) => {
    if (expectation.kind !== actual.kind) return { identification: false };
    if (expectation.kind === "found" && actual.kind === "found") return { identification: actual.product === expectation.product };
    // «Producto no claro» passes when it names at least the expected candidates.
    if (expectation.kind === "not_clear" && actual.kind === "not_clear") return { identification: (expectation.products ?? []).every((product) => actual.products.includes(product)) };
    return { identification: true };
  });
}

export type ImageActual = Readonly<{ kind: "found"; products: readonly (ProductKey | null)[] } | { kind: "not_product" } | { kind: "not_found"; reason: string } | { kind: "error"; code: string }>;

export function scoreImage(actual: ImageActual, expectations: readonly ImageExpectation[]): Scored {
  return best(expectations, (expectation) => {
    if (expectation.kind !== actual.kind) return { identification: false };
    if (expectation.kind === "found" && actual.kind === "found") return { identification: actual.products.length === 1 && actual.products[0] === expectation.product };
    return { identification: true };
  });
}

/** Outcomes that make the seller act (docs/message-to-order.md «Notices», problems first). */
export const problemOutcomes: ReadonlySet<OutcomeKind> = new Set<OutcomeKind>(["not_identified", "not_clear", "variant_missing", "variant_not_available",
  "quantity_above_limit", "unclear_item", "unnamed_add", "variant_only", "image_with_request", "order_closed", "no_open_order", "failed"]);
/** Outcomes that change the order's items or notes. */
export const changeOutcomes: ReadonlySet<OutcomeKind> = new Set<OutcomeKind>(["added", "removed", "quantity_lowered", "quantity_changed", "variant_changed", "mentioned_price_set"]);

export type NoticeError = "false_notice" | "silent_error" | "wrong_change" | null;

/**
 * How a failed message misled the seller. False notice: a change was expected and the seller got a problem notice instead.
 * Silent error: a notice was expected and an item changed without one. Wrong change: a change was expected and another one applied silently.
 */
export function noticeErrorOf(passed: boolean, expected: readonly OutcomeKind[], actual: readonly OutcomeKind[]): NoticeError {
  if (passed) return null;
  const expectedProblem = expected.some((kind) => problemOutcomes.has(kind));
  const actualProblem = actual.some((kind) => problemOutcomes.has(kind));
  const expectedChange = expected.some((kind) => changeOutcomes.has(kind));
  const actualChange = actual.some((kind) => changeOutcomes.has(kind));
  if (expectedChange && !expectedProblem && actualProblem) return "false_notice";
  if (expectedProblem && !actualProblem && actualChange) return "silent_error";
  if (!expectedProblem && !actualProblem && actualChange) return "wrong_change";
  return null;
}
