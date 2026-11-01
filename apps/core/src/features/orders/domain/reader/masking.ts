import { z } from "zod";
import type { ProductId } from "@core/src/features/products/domain/product";
import type {
  AddressSpan, ContextMessageRef, ExtractedRequest, IntentReading, ItemRef, NoIntentReason, PendingRef, ProductResolution, Quote, ResolvedValue, ReaderStage, RequestIntent, RequestKind, RequestRef,
} from "@core/src/features/orders/domain/reader/readings";
import type { BuyerLanguage } from "@core/src/features/orders/domain/reader/refs";

export const addressPlaceholder = "[dirección]";
const minPhoneDigits = 7;
const keptLeadingDigits = 3;
const keptTrailingDigits = 2;
const maskDigit = "•";

/** A run of at least 7 digits that may be split by spaces, dots, dashes or parentheses, with an optional leading `+`. */
const digitRun = /\+?\d(?:[ .\-()]*\d){6,}/g;

function maskDigitRun(run: string): string {
  const total = [...run].filter((char) => char >= "0" && char <= "9").length;
  let seen = 0;
  return [...run].map((char) => {
    if (char < "0" || char > "9") return char;
    const index = seen;
    seen += 1;
    return index >= keptLeadingDigits && index < total - keptTrailingDigits ? maskDigit : char;
  }).join("");
}

/** The stage inputs render line breaks as «⏎», so a reported span may hold one where the message has the real break. */
const lineBreak = "(?:\\r\\n|[\\n\\r\\u0085\\u2028\\u2029])";
const spanPattern = (span: string): RegExp => new RegExp(span.split("⏎").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(lineBreak), "g");

/**
 * Addresses first (the longest span wins when two overlap), then phone-like digit runs.
 * A span that is not a substring of the text is ignored. A text masked once is never masked again by the callers.
 */
export function maskPersonalData(text: string, addressSpans: readonly string[]): string {
  const spans = [...new Set(addressSpans)].filter((span) => span.length > 0).map(spanPattern).filter((pattern) => pattern.test(text)).sort((a, b) => b.source.length - a.source.length);
  const withoutAddresses = spans.reduce((masked, pattern) => masked.replace(pattern, addressPlaceholder), text);
  return withoutAddresses.replace(digitRun, (run) => run.replace(/\d/g, "0").length >= minPhoneDigits ? maskDigitRun(run) : run);
}

type StoredQuote = Quote;
type StoredRequestIntent = Readonly<{ id: RequestRef; kind: RequestKind; quote: StoredQuote }>;
type AddressCount = Readonly<{ message: "current" | ContextMessageRef; count: number }>;

/** What the trace keeps of a stage answer. The intent addresses are only counted: no span text is stored. */
export type StoredStageOutput =
  | Readonly<{ stage: "intent"; kind: "requests"; requests: readonly StoredRequestIntent[]; language: BuyerLanguage; addressSpans: readonly AddressCount[] }>
  | Readonly<{ stage: "intent"; kind: "no_intent"; reason: NoIntentReason; language: BuyerLanguage; addressSpans: readonly AddressCount[] }>
  | Readonly<{ stage: "intent"; kind: "unsure"; language: BuyerLanguage; addressSpans: readonly AddressCount[] }>
  | Readonly<{ stage: "extraction"; requests: readonly ExtractedRequest[] }>
  | Readonly<{ stage: "resolution"; resolutions: readonly ProductResolution[] }>;

const messageKey = (message: "current" | ContextMessageRef): string => message;
const spansOf = (spans: readonly AddressSpan[], message: "current" | ContextMessageRef) => spans.filter((span) => messageKey(span.message) === messageKey(message)).map((span) => span.text);
const quoteMessage = (quote: Quote): "current" | ContextMessageRef => quote.source === "current" ? "current" : quote.ref;

function maskQuote(quote: Quote, addresses: readonly AddressSpan[]): Quote {
  const text = maskPersonalData(quote.text, spansOf(addresses, quoteMessage(quote)));
  return quote.source === "current" ? { source: "current", text } : { source: "context", ref: quote.ref, text };
}
const maskOptional = (quote: Quote | null, addresses: readonly AddressSpan[]) => quote === null ? null : maskQuote(quote, addresses);

function countByMessage(addresses: readonly AddressSpan[]): readonly AddressCount[] {
  const counts = new Map<string, AddressCount>();
  for (const span of addresses) counts.set(messageKey(span.message), { message: span.message, count: (counts.get(messageKey(span.message))?.count ?? 0) + 1 });
  return [...counts.values()];
}

function maskTarget(target: ExtractedRequest["target"], addresses: readonly AddressSpan[]): ExtractedRequest["target"] {
  switch (target.kind) {
    case "named": return { kind: "named", words: maskQuote(target.words, addresses) };
    case "item": return { kind: "item", ref: target.ref, named: maskOptional(target.named, addresses) };
    case "pending": return { kind: "pending", ref: target.ref, named: maskOptional(target.named, addresses) };
    default: return target;
  }
}

function maskExtracted(request: ExtractedRequest, addresses: readonly AddressSpan[]): ExtractedRequest {
  return { ...request, target: maskTarget(request.target, addresses),
    values: request.values.map((value) => ({ attributeWords: maskOptional(value.attributeWords, addresses), valueWords: maskQuote(value.valueWords, addresses) })),
    quantity: request.quantity && { ...request.quantity, quote: maskQuote(request.quantity.quote, addresses) },
    price: request.price && { ...request.price, quote: maskQuote(request.price.quote, addresses) },
    changeVerb: maskOptional(request.changeVerb, addresses) };
}

function maskResolution(resolution: ProductResolution, addresses: readonly AddressSpan[]): ProductResolution {
  if (resolution.kind === "none") return resolution;
  const maskValues = (values: readonly ResolvedValue[]) => values.map((value) => ({ attribute: value.attribute, value: value.value, quote: maskQuote(value.quote, addresses) }));
  if (resolution.kind === "between") return resolution.values ? { ...resolution, values: maskValues(resolution.values) } : resolution;
  const unmatched = resolution.unmatched ? { unmatched: resolution.unmatched.map((quote) => maskQuote(quote, addresses)) } : {};
  return { ...resolution, values: maskValues(resolution.values), ...unmatched };
}

function maskIntent(reading: IntentReading, addresses: readonly AddressSpan[]): StoredStageOutput {
  const addressSpans = countByMessage(reading.addresses);
  switch (reading.kind) {
    case "requests": return { stage: "intent", kind: "requests", language: reading.language, addressSpans,
      requests: reading.requests.map((request: RequestIntent) => ({ id: request.id, kind: request.kind, quote: maskQuote(request.quote, addresses) })) };
    case "no_intent": return { stage: "intent", kind: "no_intent", reason: reading.reason, language: reading.language, addressSpans };
    case "unsure": return { stage: "intent", kind: "unsure", language: reading.language, addressSpans };
  }
}

/**
 * The whole stage answer in its stored form: every string passes through `maskPersonalData` with the address spans the intent stage reported
 * for that message, and the intent's own `addresses` become a count per message.
 */
export function maskStageOutput(stage: "intent", output: IntentReading, addresses: readonly AddressSpan[]): StoredStageOutput;
export function maskStageOutput(stage: "extraction", output: readonly ExtractedRequest[], addresses: readonly AddressSpan[]): StoredStageOutput;
export function maskStageOutput(stage: "resolution", output: readonly ProductResolution[], addresses: readonly AddressSpan[]): StoredStageOutput;
export function maskStageOutput(stage: ReaderStage, output: IntentReading | readonly ExtractedRequest[] | readonly ProductResolution[], addresses: readonly AddressSpan[]): StoredStageOutput {
  if (stage === "intent") return maskIntent(output as IntentReading, addresses);
  if (stage === "extraction") return { stage, requests: (output as readonly ExtractedRequest[]).map((request) => maskExtracted(request, addresses)) };
  return { stage, resolutions: (output as readonly ProductResolution[]).map((resolution) => maskResolution(resolution, addresses)) };
}

const ref = <T extends string>() => z.string().min(1).max(20).transform((value) => value as T);
const messageRef = z.union([z.literal("current"), ref<ContextMessageRef>()]);
const storedQuote: z.ZodType<Quote> = z.union([
  z.strictObject({ source: z.literal("current"), text: z.string() }),
  z.strictObject({ source: z.literal("context"), ref: ref<ContextMessageRef>(), text: z.string() }),
]);
const requestKind = z.enum(["add", "remove", "change_quantity", "change_variant", "complete_pending", "decline", "mention_price", "ready", "payment_request", "not_allowed"]);
const language = z.enum(["es", "pt"]);
const addressSpans = z.array(z.strictObject({ message: messageRef, count: z.number().int().min(1) })) as unknown as z.ZodType<readonly AddressCount[]>;
const productId = z.string().min(1).transform((value) => value as ProductId);

const extractedRequest: z.ZodType<ExtractedRequest> = z.strictObject({
  request: ref<RequestRef>(), kind: requestKind,
  target: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("named"), words: storedQuote }),
    z.strictObject({ kind: z.literal("item"), ref: ref<ItemRef>(), named: storedQuote.nullable() }),
    z.strictObject({ kind: z.literal("pending"), ref: ref<PendingRef>(), named: storedQuote.nullable() }),
    z.strictObject({ kind: z.literal("photo_same_message") }),
    z.strictObject({ kind: z.literal("photo_just_sent") }),
    z.strictObject({ kind: z.literal("context"), basis: z.enum(["last_photo", "mentioned_product", "only_item"]), ref: z.string().min(1).max(20).transform((value) => value as ContextMessageRef | ItemRef) }),
    z.strictObject({ kind: z.literal("none") }),
  ]),
  values: z.array(z.strictObject({ attributeWords: storedQuote.nullable(), valueWords: storedQuote })),
  quantity: z.strictObject({ value: z.number(), mode: z.enum(["add", "set", "decrease"]), quote: storedQuote }).nullable(),
  price: z.strictObject({ amount: z.number(), currency: z.enum(["order", "other"]), basis: z.enum(["unit", "lot", "not_explicit"]), quote: storedQuote }).nullable(),
  changeVerb: storedQuote.nullable(),
}) as unknown as z.ZodType<ExtractedRequest>;

const resolvedValue = z.strictObject({ attribute: z.string(), value: z.string(), quote: storedQuote });
const productResolution: z.ZodType<ProductResolution> = z.discriminatedUnion("kind", [
  z.strictObject({ request: ref<RequestRef>(), kind: z.literal("chosen"), productId,
    values: z.array(resolvedValue), unmatched: z.array(storedQuote).optional() }),
  z.strictObject({ request: ref<RequestRef>(), kind: z.literal("between"), productIds: z.array(productId).min(2).max(4), values: z.array(resolvedValue).optional() }),
  z.strictObject({ request: ref<RequestRef>(), kind: z.literal("none") }),
]) as unknown as z.ZodType<ProductResolution>;

const intentRequest = z.strictObject({ id: ref<RequestRef>(), kind: requestKind, quote: storedQuote });

export const storedStageOutputSchema: z.ZodType<StoredStageOutput> = z.union([
  z.strictObject({ stage: z.literal("intent"), kind: z.literal("requests"), requests: z.array(intentRequest), language, addressSpans }),
  z.strictObject({ stage: z.literal("intent"), kind: z.literal("no_intent"), reason: z.enum(["greeting", "thanks", "question", "payment_report", "other"]), language, addressSpans }),
  z.strictObject({ stage: z.literal("intent"), kind: z.literal("unsure"), language, addressSpans }),
  z.strictObject({ stage: z.literal("extraction"), requests: z.array(extractedRequest) }),
  z.strictObject({ stage: z.literal("resolution"), resolutions: z.array(productResolution) }),
]) as unknown as z.ZodType<StoredStageOutput>;
