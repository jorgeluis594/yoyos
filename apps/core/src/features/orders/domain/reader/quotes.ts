import type { ContextMessageRef, ExtractedRequest, ExtractedValue, Quote, ReadingInput, RequestRef, RequestIntent, TargetReference } from "@core/src/features/orders/domain/reader/readings";

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

const quoteKey = (quote: Quote): string => JSON.stringify([quote.source === "current" ? "current" : quote.ref, squash(quote.text)]);

function targetKey(target: TargetReference): unknown {
  switch (target.kind) {
    case "named": return [target.kind, quoteKey(target.words)];
    case "item": case "pending": return [target.kind, target.ref, target.named && quoteKey(target.named)];
    case "context": return [target.kind, target.basis, target.ref];
    default: return target;
  }
}

/** What a request says, by what was extracted and not by which intent produced it: two requests with the same signature say the same thing. */
const signatureOf = (request: ExtractedRequest): string => JSON.stringify([request.kind, targetKey(request.target),
  request.values.map(({ attributeWords, valueWords }) => [attributeWords && quoteKey(attributeWords), quoteKey(valueWords)]),
  request.quantity && [request.quantity.value, request.quantity.mode, quoteKey(request.quantity.quote)], request.price && [request.price.amount, request.price.currency, request.price.basis, quoteKey(request.price.quote)],
  request.changeVerb && quoteKey(request.changeVerb)]);

/** The words that justify a request, to tell «said twice» from «extracted twice»; null when the request carries none. */
const justifyingQuote = (request: ExtractedRequest): Quote | null =>
  request.quantity?.quote ?? request.values[0]?.valueWords ?? request.price?.quote ?? (request.target.kind === "named" ? request.target.words : null);

/**
 * Keeps one request per extracted signature (kind, target, values, quantity, price): the same thing extracted twice would add or change it twice, unless the
 * message says those words more than once (the buyer asked twice). Two intents that quote the same words but extract different requests both stay.
 * The refs of the removed ones are `absorbed`: another request of the message answers for them, so they are not lost.
 */
export function dedupeRequests(requests: readonly VerifiedRequest[], input: ReadingInput): Readonly<{ kept: readonly VerifiedRequest[]; absorbed: readonly RequestRef[] }> {
  const seen = new Map<string, number>();
  const absorbed: RequestRef[] = [];
  const kept = requests.filter((entry) => {
    const key = signatureOf(entry.request);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    const quote = justifyingQuote(entry.request);
    if (count <= (quote ? occurrencesOf(quote, input) : 1)) return true;
    absorbed.push(entry.request.request);
    return false;
  });
  return { kept, absorbed };
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
