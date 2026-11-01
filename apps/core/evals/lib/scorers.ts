import { findVariant, type CatalogScope, type ProductKey } from "@core/evals/fixtures/catalog";
import type { FinalLine, ImageExpectation, MessageExpectation, OrderLine, OutcomeKind } from "@core/evals/cases/schema";
import type { SellerNoticeKind } from "@core/src/features/orders/domain/seller-notice";

/**
 * Exact-match scorers. Each field scores true, false, or null when the expectation does not state it. A case passes when every
 * scored field of one acceptable expectation passes; the report counts fields against the expectation that matched best.
 */

export type FieldScores = Readonly<Record<string, boolean | null>>;
/** `Scored` of a message also says how a miss misled the seller (see `ignoredActionsOf`, `wrongVisibleField`, `extraNotice`). */
export type Scored = Readonly<{ passed: boolean; fields: FieldScores; expectationIndex: number }>;
export type MessageScored = Scored & Readonly<{
  /** Actions the buyer asked for that produced neither their effect nor a notice, counted per action. */
  ignoredActions: number;
  /** A visible field of the order is wrong and the seller got no notice, marked or not: a diagnostic, not the founder's silent-change gate (`silentWrongChangeOf`, per changed line). */
  wrongVisibleField: boolean;
  /** A notice was sent where the expectation says the message is silent. */
  extraNotice: boolean;
  expectedSilent: boolean;
}>;

export type ActualLine = Readonly<{ product: ProductKey | null; variant: Readonly<Record<string, string>>; quantity: number; unitPrice: number;
  mentionedPrice: Readonly<{ amount: number; units: number }> | null }>;

export type MessageActual = Readonly<{
  /** Outcome kinds; empty when the message was skipped, `["failed"]` when the use case returned an error. */
  outcomes: readonly OutcomeKind[];
  /** The kind of the one notice of the message (`chooseSellerNotice(outcomes)?.kind`); null when the seller gets none. */
  notice: SellerNoticeKind | null;
  /** The products the notice names, as catalog keys (or ids outside the catalog). */
  noticeProducts: readonly string[];
  order: readonly ActualLine[];
}>;

const sorted = (values: readonly string[]) => [...values].sort();
const sameMultiset = (left: readonly string[], right: readonly string[]) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

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
    notice: expectation.notice === undefined ? null : actual.notice === expectation.notice,
    outcome: expectation.outcomes === undefined ? null : sameMultiset(actual.outcomes, expectation.outcomes),
    product: sameMultiset(actual.order.map(productOf), order.map(productOf)),
    variant: sameMultiset(actual.order.map(variantOf), order.map(variantOf)),
    quantity: sameMultiset(actual.order.map((line) => `${variantOf(line)}x${line.quantity}`), order.map((line) => `${variantOf(line)}x${line.quantity}`)),
    mentionedPrice: sameMultiset(priced(actual.order), priced(order)),
  };
}

/** True when every unit price is the catalog price: no message may change prices, whatever it says. */
export function unitPricesIntact(order: readonly ActualLine[], scope: CatalogScope = "eval"): boolean {
  return order.every((line) => {
    if (line.product === null) return false;
    try {
      return findVariant(line.product, line.variant, scope).price === line.unitPrice;
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

/** Outcomes that are something the buyer asked for: a change, a «listo» or a pending. A missing one with no notice is an ignored action. */
export const askedOutcomes: ReadonlySet<OutcomeKind> = new Set<OutcomeKind>(["added", "removed", "quantity_lowered", "quantity_changed", "variant_changed",
  "mentioned_price_set", "ready", "ready_with_pendings", "pending_created", "pending_updated", "pending_completed", "pending_split"]);

const lineKey = (line: Pick<ActualLine, "product" | "variant" | "quantity" | "mentionedPrice">) =>
  `${variantOf(line)}x${line.quantity}${line.mentionedPrice ? `@${priceText(line.mentionedPrice)}` : ""}`;

/** Elements of `wanted` the multiset `have` lacks. */
function missingFrom(wanted: readonly string[], have: readonly string[]): number {
  const left = [...have];
  return wanted.filter((item) => { const index = left.indexOf(item); if (index < 0) return true; left.splice(index, 1); return false; }).length;
}

/**
 * Actions the buyer asked for that produced neither their effect nor any notice for the message, per action («quita la gorra y
 * listo» with the removal applied and «listo» lost is one). With outcomes stated, an asked outcome the message lacks is one. Without,
 * each expected order line the order lacks is one, and so is an expected notice that never came (a new order notice rides on an
 * add and is not counted again).
 */
export function ignoredActionsOf(actual: MessageActual, expectation: MessageExpectation, initial: readonly OrderLine[]): number {
  if (actual.notice !== null) return 0;
  if (expectation.outcomes !== undefined) return missingFrom(expectation.outcomes.filter((kind) => askedOutcomes.has(kind)), actual.outcomes);
  const lines = expectedOrder(expectation, initial);
  const initialKeys = initial.map((line) => lineKey({ ...line, mentionedPrice: null }));
  const changed = lines.map(lineKey).filter((key) => !initialKeys.includes(key) || missingFrom([key], actual.order.map(lineKey)) > 0);
  const missingLines = missingFrom(changed, actual.order.map(lineKey));
  const lostNotice = expectation.notice != null && expectation.notice !== "new_order" ? 1 : 0;
  return missingLines + lostNotice;
}

const orderFields = ["product", "variant", "quantity", "mentionedPrice"] as const;

const statusOf = (fields: FieldScores, actual: MessageActual, expectation: MessageExpectation, initial: readonly OrderLine[]) => ({
  ignoredActions: ignoredActionsOf(actual, expectation, initial),
  wrongVisibleField: actual.notice === null && orderFields.some((name) => fields[name] === false),
  extraNotice: expectation.notice === null && actual.notice !== null,
  expectedSilent: expectation.notice === null,
});

export function scoreMessage(actual: MessageActual, expectations: readonly MessageExpectation[], initial: readonly OrderLine[], scope: CatalogScope = "eval"): MessageScored {
  const scored = best(expectations, (expectation) => scoreMessageFields(actual, expectation, initial));
  // Price integrity is checked on every message, whatever the expectation.
  const unitPrice = unitPricesIntact(actual.order, scope);
  const fields = { ...scored.fields, unitPrice };
  return { ...scored, passed: scored.passed && unitPrice, fields, ...statusOf(fields, actual, expectations[scored.expectationIndex]!, initial) };
}

/** What a conversation step leaves for the one-notice-per-product check. */
export type StepNotice = Readonly<{ noticeProducts: readonly string[]; expectsRepeatNotice: boolean }>;

/**
 * Products named by the notices of two or more messages of a conversation, unless the later message is marked as an expected
 * repeat (rules sheet exception). A product named twice by one notice counts once.
 */
export function repeatedNoticeProducts(steps: readonly StepNotice[]): readonly string[] {
  const seen = new Map<string, number>();
  const repeated = new Set<string>();
  for (const step of steps) {
    for (const product of new Set(step.noticeProducts)) {
      if (seen.has(product) && !step.expectsRepeatNotice) repeated.add(product);
      seen.set(product, (seen.get(product) ?? 0) + 1);
    }
  }
  return [...repeated];
}

/** A found photo lists its products and, for a QR label, the color of each variant read (null for a visual match). */
export type ImageActual = Readonly<{ kind: "found"; products: readonly (ProductKey | null)[]; colors: readonly (string | null)[] } | { kind: "not_product" }
  | { kind: "not_found"; reason: string } | { kind: "error"; code: string }>;

/** `identification` is the product; `color` is scored only when the expectation states it (a QR label of a known color). */
export function scoreImage(actual: ImageActual, expectations: readonly ImageExpectation[]): Scored {
  return best(expectations, (expectation) => {
    const color = expectation.kind === "found" && expectation.color !== undefined ? false : null;
    if (expectation.kind !== actual.kind) return { identification: false, color };
    if (expectation.kind === "found" && actual.kind === "found") {
      return { identification: actual.products.length === 1 && actual.products[0] === expectation.product,
        color: expectation.color === undefined ? null : actual.colors.length === 1 && actual.colors[0] === expectation.color };
    }
    return { identification: true, color: null };
  });
}
