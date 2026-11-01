import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ContextMessageRef, ExtractedRequest, ItemRef, PendingRef, Quote, ReadingInput, RequestIntent, TargetReference } from "@core/src/features/orders/domain/reader/readings";
import { extractionAnswerSchema, type ExtractionAnswer } from "@core/src/features/orders/infrastructure/reader/stages/extraction/extraction-schema";

/** What the stage reads; structurally the registry's `ExtractionInput`, declared here so the stage files do not import the registry that imports them. */
export type ExtractionStageInput = Readonly<{ input: ReadingInput; intents: readonly RequestIntent[] }>;
type Entry = ExtractionAnswer["requests"][number];
type ParsedQuote = NonNullable<Entry["changeVerb"]>;
type Refusal = Readonly<{ message: string }>;

const refusal = (message: string): Refusal => ({ message });

/**
 * Turns the model's JSON into one `ExtractedRequest` for each intent, in the intents' order. It validates shape and references only, and
 * drops nothing: an unverified quote stays until `verifyQuotes` removes it. A reason never carries model text.
 */
export function parseExtractionAnswer(answer: unknown, { input, intents }: ExtractionStageInput): Result<readonly ExtractedRequest[]> {
  const parsed = extractionAnswerSchema.safeParse(answer);
  if (!parsed.success) return err(refusal(`The extraction answer does not match its schema at ${parsed.error.issues.map(({ path }) => path.join(".") || "root").join(", ")}`));

  const contextRefs = new Set<string>(input.context.map(({ ref }) => ref));
  const itemRefs = new Set<string>(input.items.map(({ ref }) => ref));
  const pendingRefs = new Set<string>(input.pendings.map(({ ref }) => ref));

  const quoteOf = (value: ParsedQuote): Quote | null =>
    value.message === "current" ? { source: "current", text: value.text }
      : contextRefs.has(value.message) ? { source: "context", ref: value.message as ContextMessageRef, text: value.text } : null;

  const targetOf = (entry: Entry): TargetReference | null => {
    const { kind, ref, named, basis } = entry.target;
    const namedQuote = named === null ? null : quoteOf(named);
    if (named !== null && namedQuote === null) return null;
    switch (kind) {
      case "named": return namedQuote ? { kind, words: namedQuote } : null;
      case "item": return ref !== null && itemRefs.has(ref) ? { kind, ref: ref as ItemRef, named: namedQuote } : null;
      case "pending": return ref !== null && pendingRefs.has(ref) ? { kind, ref: ref as PendingRef, named: namedQuote } : null;
      case "context":
        if (basis === null || ref === null) return null;
        return (basis === "only_item" ? itemRefs : contextRefs).has(ref) ? { kind, basis, ref: ref as ContextMessageRef | ItemRef } : null;
      default: return { kind };
    }
  };

  const byRequest = new Map<string, Entry>();
  for (const entry of parsed.data.requests) {
    if (byRequest.has(entry.request)) return err(refusal("The extraction answer repeats a request"));
    byRequest.set(entry.request, entry);
  }
  if (byRequest.size !== intents.length) return err(refusal("The extraction answer does not hold one entry for each request"));

  const requests: ExtractedRequest[] = [];
  for (const intent of intents) {
    const entry = byRequest.get(intent.id);
    if (!entry) return err(refusal("The extraction answer misses a request"));
    const target = targetOf(entry);
    if (target === null) return err(refusal(`The extraction answer has an invalid target for ${intent.id}`));

    const optional = (value: ParsedQuote | null): Readonly<{ ok: boolean; quote: Quote | null }> => {
      if (value === null) return { ok: true, quote: null };
      const quote = quoteOf(value);
      return { ok: quote !== null, quote };
    };
    const verb = optional(entry.changeVerb);
    const attributes = entry.values.map((value) => ({ attribute: optional(value.attribute), value: quoteOf(value.value) }));
    const amount = optional(entry.quantity?.quote ?? null);
    const priceQuote = optional(entry.price?.quote ?? null);
    if (!verb.ok || !amount.ok || !priceQuote.ok || attributes.some(({ attribute, value }) => !attribute.ok || value === null)) {
      return err(refusal(`The extraction answer quotes a message that is not listed for ${intent.id}`));
    }
    if (entry.quantity && !(Number.isFinite(entry.quantity.value) && entry.quantity.value > 0)) return err(refusal(`The extraction answer has an invalid quantity for ${intent.id}`));
    if (entry.price && !(Number.isFinite(entry.price.amount) && entry.price.amount >= 0)) return err(refusal(`The extraction answer has an invalid price for ${intent.id}`));

    requests.push({
      request: intent.id, kind: intent.kind, target,
      values: attributes.map(({ attribute, value }) => ({ attributeWords: attribute.quote, valueWords: value as Quote })),
      quantity: entry.quantity && amount.quote ? { value: entry.quantity.value, mode: entry.quantity.mode, quote: amount.quote } : null,
      price: entry.price && priceQuote.quote ? { amount: entry.price.amount, currency: entry.price.currency, basis: entry.price.basis, quote: priceQuote.quote } : null,
      changeVerb: verb.quote,
    });
  }
  return ok(requests);
}
