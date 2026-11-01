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
/** `candidateIds` are the products the mention may be resolved to (from `assembleCandidates`); absent means any candidate listed with it. */
export type ProductMention = Readonly<{ request: RequestRef; words: Quote; values: ExtractedRequest["values"]; candidateIds?: readonly ProductId[] }>;
export type ProductResolution =
  | Readonly<{ request: RequestRef; kind: "chosen"; productId: ProductId; values: readonly Readonly<{ attribute: string; value: string; quote: Quote }>[] }>
  /** Two to four products. */
  | Readonly<{ request: RequestRef; kind: "between"; productIds: readonly ProductId[] }>
  | Readonly<{ request: RequestRef; kind: "none" }>;

/** What the three stages read: built by code from a bounded context, rendered into prompts by infrastructure. */
export type ReadingContextMessage = Readonly<{ ref: ContextMessageRef; direction: "incoming" | "outgoing"; kind: string; text: string | null; sentAt: Date;
  /** True once a mask is stored for the message; while it is false the intent stage reports the message's address spans. */
  masked: boolean }>;
export type ReadingItem = Readonly<{ ref: ItemRef; itemId: OrderItemId; productId: ProductId | null; variantId: VariantId; productName: string;
  variantAttributes: Readonly<Record<string, string>>; quantity: PositiveInteger }>;
export type ReadingPending = Readonly<{ ref: PendingRef; pendingId: ChatPendingId; productIds: readonly ProductId[]; known: Readonly<Record<string, string>>;
  quantity: PositiveInteger; doubtful: boolean }>;
export type ReadingInput = Readonly<{
  current: Readonly<{ messageId: ChatMessageId; kind: string; text: string }>;
  context: readonly ReadingContextMessage[];
  items: readonly ReadingItem[];
  pendings: readonly ReadingPending[];
  photoMemory: LastIncomingPhoto | null;
  /** The photo of this message and the product it was identified as, if any. */
  photo: Readonly<{ productId: ProductId | null }> | null;
}>;
