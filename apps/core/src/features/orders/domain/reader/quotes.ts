import type { ContextMessageRef, ExtractedRequest, ExtractedValue, Quote, ReadingInput, RequestIntent, TargetReference } from "@core/src/features/orders/domain/reader/readings";

/** A request after its quotes were checked: `complete` is false when some datum of it was dropped, which is certainty signal 1. */
export type VerifiedRequest = Readonly<{ request: ExtractedRequest; complete: boolean }>;

/** Case and whitespace are ignored, and so is «⏎», the mark the stage inputs render a line break as; nothing else is normalized. */
const squash = (text: string): string => text.toLowerCase().replace(/[\s⏎]+/g, "");

function isFound(quote: Quote, input: ReadingInput, allowContext: boolean): boolean {
  const wanted = squash(quote.text);
  if (wanted === "") return false;
  if (quote.source === "current") return squash(input.current.text).includes(wanted);
  if (!allowContext) return false;
  const message = input.context.find((candidate) => candidate.ref === (quote.ref satisfies ContextMessageRef));
  return message?.text != null && squash(message.text).includes(wanted);
}

/**
 * Drops every datum whose justifying words are not a substring of the current message (a target may also be justified by a context message).
 * A dropped target quote leaves the target without the buyer's naming; a request keeps going without the data it lost.
 */
export function verifyQuotes(requests: readonly ExtractedRequest[], input: ReadingInput): readonly VerifiedRequest[] {
  return requests.map((request) => {
    let complete = true;
    const keep = (quote: Quote | null, allowContext = false): boolean => {
      if (quote === null) return true;
      if (isFound(quote, input, allowContext)) return true;
      complete = false;
      return false;
    };
    const target = verifiedTarget(request.target, keep);
    const values: readonly ExtractedValue[] = request.values.filter((value) => keep(value.valueWords) && (value.attributeWords === null || keep(value.attributeWords)));
    const quantity = request.quantity && keep(request.quantity.quote) ? request.quantity : null;
    const price = request.price && keep(request.price.quote) ? request.price : null;
    const changeVerb = request.changeVerb && keep(request.changeVerb) ? request.changeVerb : null;
    return { request: { ...request, target, values, quantity, price, changeVerb }, complete };
  });
}

function verifiedTarget(target: TargetReference, keep: (quote: Quote | null, allowContext?: boolean) => boolean): TargetReference {
  switch (target.kind) {
    case "named": return keep(target.words, true) ? target : { kind: "none" };
    case "item": return { ...target, named: keep(target.named, true) ? target.named : null };
    case "pending": return { ...target, named: keep(target.named, true) ? target.named : null };
    default: return target;
  }
}

/** Intent quotes are verified like extraction quotes (the current message, or the context message they name): an intent with an unverified quote is dropped. */
export function verifyIntentQuotes(intents: readonly RequestIntent[], input: ReadingInput): Readonly<{ kept: readonly RequestIntent[]; dropped: readonly RequestIntent[] }> {
  const found = (intent: RequestIntent) => isFound(intent.quote, input, true);
  return { kept: intents.filter(found), dropped: intents.filter((intent) => !found(intent)) };
}

const occurrencesOf = (quote: Quote, input: ReadingInput): number => {
  const text = quote.source === "current" ? input.current.text : input.context.find((candidate) => candidate.ref === quote.ref)?.text ?? "";
  return Math.max(1, squash(text).split(squash(quote.text)).length - 1);
};

/**
 * Keeps one intent per span: the same kind with the same quote counts as one request, unless the message says those words more than once (the buyer
 * asked twice). A duplicated intent would add or change the same thing twice.
 */
export function dedupeIntents(intents: readonly RequestIntent[], input: ReadingInput): readonly RequestIntent[] {
  const seen = new Map<string, number>();
  return intents.filter((intent) => {
    const key = JSON.stringify([intent.kind, intent.quote.source === "current" ? "current" : intent.quote.ref, squash(intent.quote.text)]);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return count <= occurrencesOf(intent.quote, input);
  });
}

export type QuoteDrop = Readonly<{ requestKind: RequestIntent["kind"]; field: "intent" | "target" | "values" | "quantity" | "price" | "change_verb" }>;

const namedQuoteOf = (target: TargetReference): Quote | null => (target.kind === "named" ? target.words : target.kind === "item" || target.kind === "pending" ? target.named : null);

/** What verifying the quotes took from a request, by field: for the `reader_quote_dropped` log. */
export function droppedFields(before: ExtractedRequest, after: ExtractedRequest): readonly QuoteDrop["field"][] {
  const dropped: QuoteDrop["field"][] = [];
  if (namedQuoteOf(before.target) !== null && namedQuoteOf(after.target) === null) dropped.push("target");
  if (after.values.length < before.values.length) dropped.push("values");
  if (before.quantity && !after.quantity) dropped.push("quantity");
  if (before.price && !after.price) dropped.push("price");
  if (before.changeVerb && !after.changeVerb) dropped.push("change_verb");
  return dropped;
}
