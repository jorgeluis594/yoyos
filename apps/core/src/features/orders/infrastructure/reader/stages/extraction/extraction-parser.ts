import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ContextMessageRef, ExtractedRequest, ItemRef, PendingRef, Quote, TargetReference } from "@core/src/features/orders/domain/reader/readings";
import type { ExtractionInput } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";
import { extractionEntrySchema, type ExtractionEntry } from "@core/src/features/orders/infrastructure/reader/stages/extraction/extraction-schema";

type Entry = ExtractionEntry;
type ParsedQuote = NonNullable<Entry["changeVerb"]>;
type Refusal = Readonly<{ message: string }>;

const refusal = (message: string): Refusal => ({ message });
const listedAnswer = z.object({ requests: z.array(z.unknown()) });

/**
 * Turns the model's JSON into one `ExtractedRequest` for each intent that has a usable entry, in the intents' order. It validates shape and references only:
 * an unverified quote stays until `verifyQuotes` removes it. An entry that is defective (it does not fit the schema, has an invalid target, quote, quantity or
 * price), repeated or missing leaves its request out: the reading then answers for the intent with a doubt, and the other requests still apply.
 * A reason never carries model text.
 */
export function parseExtractionAnswer(answer: unknown, { input, intents }: ExtractionInput): Result<readonly ExtractedRequest[]> {
  const listed = listedAnswer.safeParse(answer);
  if (!listed.success) return err(refusal("The extraction answer does not match its schema"));

  const contextRefs = new Set<string>(input.context.map(({ ref }) => ref));
  const itemRefs = new Set<string>(input.items.map(({ ref }) => ref));
  const pendingRefs = new Set<string>([...input.pendings, ...(input.endedPendings ?? [])].map(({ ref }) => ref));

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
  const repeated = new Set<string>();
  for (const candidate of listed.data.requests) {
    const parsed = extractionEntrySchema.safeParse(candidate);
    if (!parsed.success) continue;
    if (byRequest.has(parsed.data.request)) repeated.add(parsed.data.request);
    else byRequest.set(parsed.data.request, parsed.data);
  }

  const requests: ExtractedRequest[] = [];
  for (const intent of intents) {
    const entry = byRequest.get(intent.id);
    if (!entry || repeated.has(intent.id)) continue;
    const target = targetOf(entry);
    if (target === null) continue;

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
      continue;
    }
    if (entry.quantity && !(Number.isFinite(entry.quantity.value) && entry.quantity.value > 0)) continue;
    if (entry.price && !(Number.isFinite(entry.price.amount) && entry.price.amount >= 0)) continue;

    requests.push({
      request: intent.id, kind: intent.kind, target,
      values: attributes.map(({ attribute, value }) => ({ attributeWords: attribute.quote, valueWords: value as Quote })),
      quantity: entry.quantity && amount.quote ? { value: entry.quantity.value, mode: entry.quantity.mode, quote: amount.quote } : null,
      price: entry.price && priceQuote.quote ? { amount: entry.price.amount, currency: entry.price.currency, basis: entry.price.basis, quote: priceQuote.quote } : null,
      changeVerb: verb.quote,
    });
  }
  // An answer with no usable entry at all is not a reading: it is refused (retried) instead of leaving every request to a doubt.
  return requests.length === 0 && intents.length > 0 ? err(refusal("The extraction answer has no usable entry")) : ok(requests);
}
