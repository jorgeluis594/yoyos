import type { Currency } from "@shared/money";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-message-outcome";
import type { LastIncomingPhoto } from "@core/src/features/orders/domain/chat-pendings";
import type { OrderItemId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

import type { BuyerLanguage, ContextMessageRef, ItemRef, PendingRef, QuoteId, RequestRef } from "@core/src/features/orders/domain/reader/refs";

export type { BuyerLanguage, ContextMessageRef, ItemRef, PendingRef, QuoteId, RequestRef };

export type ReaderStage = "intent" | "extraction" | "resolution";
export type Reading = "primary" | "confirming";
export type ModelUsage = Readonly<{ inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number }>;
/** What the trace stores for each stage call. It never carries prompt text. */
export type StageCall = Readonly<{ stage: ReaderStage; reading: Reading; provider: "openai" | "fake"; model: string; promptVersion: string;
  usage: ModelUsage | null; costUsd: number | null; durationMs: number; attempts: 1 | 2 }>;

export type Quote = Readonly<{ source: "current" } | { source: "context"; ref: ContextMessageRef }> & Readonly<{ text: string }>;
export type RequestKind = "add" | "remove" | "change_quantity" | "change_variant" | "complete_pending" | "decline"
  | "mention_price" | "ready" | "payment_request" | "not_allowed";
export type NoIntentReason = "greeting" | "thanks" | "question" | "payment_report" | "other";
export type IntentReading =
  | Readonly<{ kind: "requests"; requests: readonly RequestIntent[]; language: BuyerLanguage; addresses: readonly AddressSpan[] }>
  | Readonly<{ kind: "no_intent"; reason: NoIntentReason; language: BuyerLanguage; addresses: readonly AddressSpan[] }>
  | Readonly<{ kind: "unsure"; language: BuyerLanguage; addresses: readonly AddressSpan[] }>;
export type RequestIntent = Readonly<{ id: RequestRef; kind: RequestKind; quote: Quote }>;
/** Only for messages marked unmasked. */
export type AddressSpan = Readonly<{ message: "current" | ContextMessageRef; text: string }>;

export type TargetReference =
  | Readonly<{ kind: "named"; words: Quote }>
  /** `named` null = the item was taken from context. */
  | Readonly<{ kind: "item"; ref: ItemRef; named: Quote | null }>
  | Readonly<{ kind: "pending"; ref: PendingRef; named: Quote | null }>
  | Readonly<{ kind: "photo_same_message" }>
  | Readonly<{ kind: "photo_just_sent" }>
  | Readonly<{ kind: "context"; basis: "last_photo" | "mentioned_product" | "only_item"; ref: ContextMessageRef | ItemRef }>
  | Readonly<{ kind: "none" }>;
export type ExtractedValue = Readonly<{ attributeWords: Quote | null; valueWords: Quote }>;
export type ExtractedRequest = Readonly<{
  request: RequestRef; kind: RequestKind; target: TargetReference;
  values: readonly ExtractedValue[];
  quantity: Readonly<{ value: number; mode: "add" | "set" | "decrease"; quote: Quote }> | null;
  price: Readonly<{ amount: number; currency: "order" | "other"; basis: "unit" | "lot" | "not_explicit"; quote: Quote }> | null;
  changeVerb: Quote | null;
}>;
/** `price` is the price the request states, so that the resolution can tell products apart by it; `units` is the quantity the request states (1 when none). */
export type MentionPrice = Readonly<{ amount: number; units: number; basis: "unit" | "lot" | "not_explicit" }>;
/**
 * `candidateIds` are the products the mention may be resolved to (from `assembleCandidates`); absent means any candidate listed with it.
 * `valuesOnly` marks a request that names no product by words but carries values: its target already fixes the candidates, and `words` repeats its first value words.
 */
export type ProductMention = Readonly<{ request: RequestRef; words: Quote; values: ExtractedRequest["values"]; candidateIds?: readonly ProductId[]; valuesOnly?: boolean; price?: MentionPrice }>;
/** A buyer's value words mapped to a catalog value. */
export type ResolvedValue = Readonly<{ attribute: string; value: string; quote: Quote }>;
export type ProductResolution =
  /** `unmatched` are the buyer's value words that fit no value of the product: the checks then report the value as not available instead of missing. */
  | Readonly<{ request: RequestRef; kind: "chosen"; productId: ProductId; values: readonly ResolvedValue[]; unmatched?: readonly Quote[] }>
  /** Two to four products. `values` are the ones every candidate offers. */
  | Readonly<{ request: RequestRef; kind: "between"; productIds: readonly ProductId[]; values?: readonly ResolvedValue[] }>
  | Readonly<{ request: RequestRef; kind: "none" }>;

/** What the three stages read: built by code from a bounded context, rendered into prompts by infrastructure. */
export type ReadingContextMessage = Readonly<{ ref: ContextMessageRef; direction: "incoming" | "outgoing"; kind: string; text: string | null; sentAt: Date;
  /** True once a mask is stored for the message; while it is false the intent stage reports the message's address spans. */
  masked: boolean }>;
export type ReadingItem = Readonly<{ ref: ItemRef; itemId: OrderItemId; productId: ProductId | null; variantId: VariantId; productName: string;
  variantAttributes: Readonly<Record<string, string>>; quantity: PositiveInteger }>;
export type ReadingPending = Readonly<{ ref: PendingRef; pendingId: ChatPendingId; productIds: readonly ProductId[]; known: Readonly<Record<string, string>>;
  quantity: PositiveInteger; doubtful: boolean;
  /** The names of the pending's products (catalog data the stages read), in `productIds` order; absent when the catalog could not name them. */
  productNames?: readonly string[];
  /** For a pending on one product: each attribute its known values leave open, with the sellable values that fit what is known. */
  missing?: readonly Readonly<{ name: string; values: readonly string[] }>[] }>;
export type ReadingInput = Readonly<{
  current: Readonly<{ messageId: ChatMessageId; kind: string; text: string }>;
  context: readonly ReadingContextMessage[];
  items: readonly ReadingItem[];
  pendings: readonly ReadingPending[];
  photoMemory: LastIncomingPhoto | null;
  /** The photo of this message and the product it was identified as, if any. */
  photo: Readonly<{ productId: ProductId | null }> | null;
  /** The currency of the shop's prices (from the company's country); the extraction names it to the model so that a price in it counts as the order's. */
  currency?: Currency;
}>;
