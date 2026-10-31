import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-message-outcome";
import type { SellableVariant } from "@core/src/features/orders/domain/catalog-order";
import type { ChatPending } from "@core/src/features/orders/domain/chat-pendings";
import { undoability, type ChangeSeq, type LineSnapshot, type OrderItemChange, type OrderItemChangeId, type UndoRefusal } from "@core/src/features/orders/domain/message-changes";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderItemId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { OrderRevision } from "@core/src/features/orders/domain/order-revisions";
import type { DoubtReason } from "@core/src/features/orders/domain/reader/decision";
import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";

export type OrderLinkActionId = string & { readonly __brand: "OrderLinkActionId" };
export type { UndoRefusal };

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

/** A message of the order that changed lines or pendings, as `OrderMessage` and its change rows are read. */
export type MessageRowSource = Readonly<{ messageId: ChatMessageId; at: Date; undoneAt: Date | null; changes: readonly OrderItemChange[];
  pendingsBefore: readonly ChatPending[]; pendingsAfter: readonly ChatPending[] }>;
export type MessageRows = OrderReviewProjection["messageRows"];

/** «Cambios por mensajes»: each message with its changes and whether its undo is available, refused with a reason, or done. */
export function messageRows(input: Readonly<{ order: OrderAggregate; rows: readonly MessageRowSource[]; pendings: readonly ChatPending[];
  /** Changes of the order newer than the oldest row, whatever their message. */
  laterChanges: readonly OrderItemChange[]; sellable: readonly SellableVariant[] }>): MessageRows {
  return input.rows.map((row): MessageRows[number] => {
    if (row.undoneAt) return { messageId: row.messageId, at: row.at, changes: row.changes, undo: { kind: "undone" } };
    const verdict = undoability({ order: input.order, message: row, pendings: input.pendings, laterChanges: input.laterChanges, sellable: input.sellable });
    return { messageId: row.messageId, at: row.at, changes: row.changes, undo: verdict.kind === "available" ? { kind: "available" } : { kind: "refused", reason: verdict.reason } };
  });
}
