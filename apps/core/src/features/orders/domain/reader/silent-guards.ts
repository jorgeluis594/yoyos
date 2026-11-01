import type { CheckedAction } from "@core/src/features/orders/domain/reader/decide";
import type { RequestRef } from "@core/src/features/orders/domain/reader/refs";

const minimumStem = 4;

/** Lowercase letters and digits of a text, without accents: the catalog words and the buyer's words are compared in this form. */
const wordsOf = (text: string): readonly string[] =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

const sharedStem = (a: string, b: string): number => {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return length;
};

/**
 * Whether the words of a quote name something the catalog calls `names` (a product's name and its variant values). A word names it when it is one of
 * them or shares a stem of four letters with one (plural, diminutive). Only catalog data is compared, so a pronoun or a demonstrative never names a
 * product: it is how a quote of a target «taken from context» is told from one the buyer named.
 */
export function quoteNames(quote: string, names: readonly string[]): boolean {
  const catalog = names.flatMap(wordsOf);
  return wordsOf(quote).some((word) => catalog.some((entry) => word === entry || sharedStem(word, entry) >= minimumStem));
}

/**
 * The urgent action for a request of the message that has no checked action: an intent whose quote was not found (dropped) or that the extraction left
 * out. A request never gets lost silently: the seller learns that the message asked for something the reader could not read.
 */
export const lostRequest = (request: RequestRef): CheckedAction => ({ request, action: { kind: "report", outcome: { kind: "reader_doubt", orderId: null } },
  signals: { quotesComplete: false, targetNamed: "context", variantChangeVerb: "not_applicable", candidates: "single" }, doubt: null,
  urgent: { problem: "reader_doubt", question: null }, blocked: null });

/** The refs of the intents that have no checked action: the ones dropped, and the kept ones no extracted request answers. */
export function lostRequests(dropped: readonly RequestRef[], kept: readonly RequestRef[], checked: readonly CheckedAction[]): readonly CheckedAction[] {
  const answered = new Set(checked.map(({ request }) => request));
  return [...dropped, ...kept.filter((request) => !answered.has(request))].map(lostRequest);
}
