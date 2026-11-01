import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-message-outcome";
import type { OrderItemId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ContextMessageRef, ItemRef, PendingRef, Quote, ReadingContextMessage, ReadingInput, ReadingItem, ReadingPending, RequestIntent, RequestKind, RequestRef } from "@core/src/features/orders/domain/reader/readings";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ExtractionInput } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";

const at = new Date("2026-10-30T12:00:00Z");

export const contextMessage = (index: number, over: Partial<ReadingContextMessage> = {}): ReadingContextMessage =>
  ({ ref: `M${index}` as ContextMessageRef, direction: index % 2 ? "incoming" : "outgoing", kind: "text", text: `mensaje ${index}`, sentAt: at, masked: false, ...over });

export const item = (index: number, over: Partial<ReadingItem> = {}): ReadingItem =>
  ({ ref: `I${index}` as ItemRef, itemId: `item-${index}` as OrderItemId, productId: `product-${index}` as ProductId, variantId: `variant-${index}` as VariantId,
    productName: `Producto ${index}`, variantAttributes: { Talla: "M" }, quantity: 2 as PositiveInteger, ...over });

export const pending = (index: number, over: Partial<ReadingPending> = {}): ReadingPending =>
  ({ ref: `Q${index}` as PendingRef, pendingId: `pending-${index}` as ChatPendingId, productIds: [`product-${index}` as ProductId], known: {}, quantity: 1 as PositiveInteger, doubtful: false, ...over });

export const readingInput = (over: Partial<ReadingInput> = {}): ReadingInput =>
  ({ current: { messageId: "current" as ChatMessageId, kind: "text", text: "quiero dos" }, context: [], items: [], pendings: [], photoMemory: null, photo: null, ...over });

export const currentQuote = (text: string): Quote => ({ source: "current", text });

export const intent = (index: number, kind: RequestKind, text: string): RequestIntent =>
  ({ id: `R${index}` as RequestRef, kind, quote: currentQuote(text) });

export const extractionInput = (input: ReadingInput, intents: readonly RequestIntent[]): ExtractionInput => ({ input, intents });

/** A model answer entry with every field present, the way the strict schema requires. */
export const answerEntry = (request: string, over: Record<string, unknown> = {}) =>
  ({ request, target: { kind: "none", ref: null, named: null, basis: null }, values: [], quantity: null, price: null, changeVerb: null, ...over });
