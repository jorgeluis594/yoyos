import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatPending } from "@core/src/features/orders/domain/chat-pendings";
import type { OrderId, OrderItemId, PositiveInteger, MentionedPrice } from "@core/src/features/orders/domain/order";
import type { OrderReviewId } from "@core/src/features/orders/domain/order-review";
import type { ChangeDecision } from "@core/src/features/orders/domain/reader/decision";
import type { QuoteId } from "@core/src/features/orders/domain/reader/readings";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { Money } from "@shared/money";

export type OrderItemChangeId = string & { readonly __brand: "OrderItemChangeId" };
/** Per-order, assigned under the order lock as the order's previous highest plus one. */
export type ChangeSeq = number & { readonly __brand: "ChangeSeq" };

export type LineSnapshot = Readonly<{ itemId: OrderItemId; variantId: VariantId; productName: string; variantAttributes: Readonly<Record<string, string>>;
  sku: string | null; quantity: PositiveInteger; unitPrice: Money; mentionedPrice: MentionedPrice | null; position: number }>;
export type OrderItemChangeKind = "added" | "removed" | "quantity_changed" | "variant_changed" | "mentioned_price_set";
export type ChangeVerdict = "kept" | "quantity_changed" | "removed" | "undone" | "not_reviewed";
/** One row per item change a message made. Marks, «Cambios por mensajes», undo, verdicts and labels derive from it. */
export type OrderItemChange = Readonly<{
  id: OrderItemChangeId; orderId: OrderId; messageId: ChatMessageId; position: number; seq: ChangeSeq; kind: OrderItemChangeKind;
  /** Null before = added, null after = removed. */
  before: LineSnapshot | null; after: LineSnapshot | null;
  decision: Extract<ChangeDecision, { kind: "applied" }> | Extract<ChangeDecision, { kind: "doubtful" }>;
  quoteId: QuoteId | null; supersededBy: OrderItemChangeId | null; reviewId: OrderReviewId | null;
  verdict: Readonly<{ kind: ChangeVerdict; at: Date }> | null; createdAt: Date;
}>;
export type MessageChanges = Readonly<{ orderId: OrderId; messageId: ChatMessageId; changes: readonly OrderItemChange[];
  pendingsBefore: readonly ChatPending[]; pendingsAfter: readonly ChatPending[]; supersedes: readonly OrderItemChangeId[] }>;
