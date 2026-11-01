import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-message-outcome";
import type { OrderItemId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ContextMessageRef, ItemRef, PendingRef, ReadingContextMessage, ReadingInput, ReadingItem, ReadingPending } from "@core/src/features/orders/domain/reader/readings";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

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
