import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChangeSeq, LineSnapshot, OrderItemChange, OrderItemChangeId } from "@core/src/features/orders/domain/message-changes";
import type { OrderItemId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { OrderRevision } from "@core/src/features/orders/domain/order-revisions";
import type { DoubtReason } from "@core/src/features/orders/domain/reader/decision";
import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";

export type OrderLinkActionId = string & { readonly __brand: "OrderLinkActionId" };
export type UndoRefusal = "order_moved_on" | "later_change" | "would_empty" | "not_sold";

export type PointKey = Readonly<{ pendingId: ChatPendingId; since: Date }>;
export type ReviewPoint = Readonly<{ key: PointKey; kind: "variant_missing" | "not_clear" | "variant_not_available"; product: string | null;
  quantity: PositiveInteger; missing: readonly string[]; doubt: DoubtReason | null; acknowledged: boolean; question: SuggestedQuestion }>;
export type ReviewStatus = Readonly<{ openForMessages: boolean; toReview: boolean; doubtfulCount: number; pointCount: number;
  entry: "link" | "detail" | "none"; hasPreviousReview: boolean }>;
export type OrderReviewProjection = Readonly<{
  status: ReviewStatus;
  doubtful: readonly Readonly<{ change: OrderItemChange; quote: string | null }>[];
  points: readonly ReviewPoint[];
  products: readonly Readonly<{ itemId: OrderItemId; changedSinceLastReview: boolean }>[];
  removedSinceLastReview: readonly LineSnapshot[];
  messageRows: readonly Readonly<{ messageId: ChatMessageId; at: Date; changes: readonly OrderItemChange[];
    undo: Readonly<{ kind: "available" } | { kind: "refused"; reason: UndoRefusal } | { kind: "undone" }> }>[];
  moreRows: number;
  loaded: Readonly<{ changesThrough: ChangeSeq; changeIds: readonly OrderItemChangeId[]; points: readonly PointKey[]; itemsRevision: OrderRevision }>;
}>;
