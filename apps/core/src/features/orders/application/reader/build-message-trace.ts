import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { BuildMessageTrace, BuildMessageTraceInput } from "@core/src/features/orders/application/reader/trace-ports";
import type { DecidedAction } from "@core/src/features/orders/domain/reader/decide-changes";
import { maskPersonalData } from "@core/src/features/orders/domain/reader/masking";
import type { AddressSpan, IntentReading, ItemRef, PendingRef, Quote } from "@core/src/features/orders/domain/reader/readings";
import { maxTraceQuoteChars, type MaskedText, type TraceDecision, type TraceQuote, type TraceStage } from "@core/src/features/orders/domain/reader/trace";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const dayMs = 24 * 60 * 60 * 1000;

const spansOf = (intent: IntentReading, message: "current" | string): readonly string[] =>
  intent.addresses.filter((span: AddressSpan) => span.message === message).map((span) => span.text);

/** At most `maxTraceQuoteChars` UTF-16 units, never ending in half a surrogate pair. */
function clip(text: string): string {
  const cut = text.slice(0, maxTraceQuoteChars);
  const last = cut.charCodeAt(cut.length - 1);
  return cut.length < text.length && last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

function maskedQuote(quote: Quote, intent: IntentReading): string {
  return clip(maskPersonalData(quote.text, spansOf(intent, quote.source === "current" ? "current" : quote.ref)));
}

function quotesOf(input: BuildMessageTraceInput): readonly TraceQuote[] {
  return input.requests.map(({ request }, index): TraceQuote => {
    const quote = input.intents.find((intent) => intent.id === request.request)?.quote;
    return { id: index as TraceQuote["id"], text: quote && input.intent ? maskedQuote(quote, input.intent) : "" };
  });
}

type ActionIds = Readonly<{ variantId: VariantId | null; pendingId: string | null; productId: ProductId | null }>;

function idsOf(action: ResolvedChatAction): ActionIds {
  const none: ActionIds = { variantId: null, pendingId: null, productId: null };
  switch (action.kind) {
    case "add": return { ...none, variantId: action.item.variantId, productId: action.identification.productId };
    case "remove": case "set_quantity": case "increase_quantity": case "lower_quantity": case "set_mentioned_price": case "change_unfound_item":
      return { ...none, variantId: action.target.kind === "variant" ? action.target.variantId : null, productId: action.target.kind === "unclear" ? action.target.namedProductId : null };
    case "change_variant": return { ...none, variantId: action.target.kind === "variant" ? action.target.variantId : null, productId: action.to.kind === "resolved" ? null : action.to.productId };
    case "set_photo_item_quantity": return { ...none, variantId: action.variantId };
    case "change_pending_quantity": return { ...none, pendingId: action.pendingId };
    case "advance_pending": return { ...none, pendingId: action.request.pendingId };
    case "decline_pending": return { ...none, pendingId: action.pendingId };
    case "caption_doubt": return { ...none, productId: action.productId };
    default: return none;
  }
}

function decisionOf(decided: DecidedAction, input: BuildMessageTraceInput): TraceDecision {
  const { action, request, signals } = decided.checked;
  const ids = idsOf(action);
  const items = input.context?.input.items ?? [];
  const pendings = input.context?.input.pendings ?? [];
  const item = ids.variantId === null ? null : items.find((candidate) => candidate.variantId === ids.variantId);
  const pending = ids.pendingId === null ? null : pendings.find((candidate) => candidate.pendingId === ids.pendingId);
  return { action: { kind: action.kind, request, item: item ? item.ref satisfies ItemRef : null, pending: pending ? pending.ref satisfies PendingRef : null,
    productId: ids.productId ?? item?.productId ?? null, variantId: ids.variantId },
  signals, risk: decided.risk, agreement: decided.agreement, decision: decided.decision.kind };
}

/** Texts with no stored mask: the current message and the context messages the intent stage saw unmasked. Nothing without the intent's address spans. */
function masksOf(input: BuildMessageTraceInput, expiresAt: Date): readonly MaskedText[] {
  const { intent, context, message } = input;
  if (intent === null) return [];
  const masks: MaskedText[] = [];
  const current = message.text ?? message.caption;
  if (current !== null) masks.push({ messageId: message.id, text: maskPersonalData(current, spansOf(intent, "current")), expiresAt });
  for (const kept of context?.input.context ?? []) {
    const messageId: ChatMessageId | undefined = context?.contextMessageIds.get(kept.ref);
    if (kept.masked || kept.text === null || messageId === undefined || context?.masks.has(messageId)) continue;
    // A masked text expires after its own message, not after the current one.
    const ownExpiry = new Date((kept.sentAt ?? message.receivedAt).getTime() + input.retentionDays * dayMs);
    masks.push({ messageId, text: maskPersonalData(kept.text, spansOf(intent, kept.ref)), expiresAt: ownExpiry });
  }
  return masks;
}

function totalCost(input: BuildMessageTraceInput): number | null {
  const costs = [input.photo?.costUsd ?? null, ...input.records.map((record) => record.call?.costUsd ?? null)].filter((cost): cost is number => cost !== null);
  return costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0);
}

/**
 * A record with no call (a stage that failed before any model call) cannot be stored as a `TraceStage`, so it is left out; the reading's own
 * log carries that failure.
 */
const stagesOf = (input: BuildMessageTraceInput): readonly TraceStage[] =>
  input.records.flatMap(({ call, input: summary, output, errorCode }) => (call === null ? [] : [{ call, input: summary, output, errorCode }]));

export const buildMessageTrace: BuildMessageTrace = (input) => {
  const expiresAt = new Date(input.message.receivedAt.getTime() + input.retentionDays * dayMs);
  return {
    trace: {
      companyId: input.message.companyId, messageId: input.message.id, messageReceivedAt: input.message.receivedAt, expiresAt,
      startedAt: input.startedAt, decidedAt: input.decidedAt, queuedMs: input.queuedMs, shadowWaitMs: input.shadowWaitMs,
      textState: input.intent === null ? "withheld" : "masked",
      contextMessageIds: input.context ? [...input.context.contextMessageIds.values()] : [],
      photo: input.photo, stages: stagesOf(input), quotes: quotesOf(input), decisions: input.decisions.map((decided) => decisionOf(decided, input)),
      shadow: input.shadow, costUsd: totalCost(input),
    },
    masks: masksOf(input, expiresAt),
  };
};
