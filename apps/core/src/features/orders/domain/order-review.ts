import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-message-outcome";
import type { SellableVariant } from "@core/src/features/orders/domain/catalog-order";
import { maxChatPendings, type ChatPending } from "@core/src/features/orders/domain/chat-pendings";
import { isMarked, itemOfSnapshot, undoability, undoPendings, type ChangeSeq, type LineSnapshot, type OrderItemChange, type OrderItemChangeId, type UndoRefusal } from "@core/src/features/orders/domain/message-changes";
import { isOpenForMessageItems, type ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderId, OrderItem, OrderItemId, PositiveInteger } from "@core/src/features/orders/domain/order";
import { orderRevisions, type OrderRevision } from "@core/src/features/orders/domain/order-revisions";
import type { DoubtReason } from "@core/src/features/orders/domain/reader/decision";
import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";

export type OrderLinkActionId = string & { readonly __brand: "OrderLinkActionId" };
export type { UndoRefusal };

export type PointKey = Readonly<{ pendingId: ChatPendingId; since: Date }>;
export type ReviewPoint = Readonly<{ key: PointKey; kind: "variant_missing" | "not_clear" | "variant_not_available"; product: string | null;
  quantity: PositiveInteger; missing: readonly string[]; doubt: DoubtReason | null; acknowledged: boolean; question: SuggestedQuestion }>;
export type PointLabel = Pick<ReviewPoint, "kind" | "product">;
export type ReviewStatus = Readonly<{ openForMessages: boolean; toReview: boolean; doubtfulCount: number; pointCount: number;
  entry: "link" | "detail" | "none"; hasPreviousReview: boolean }>;
export type OrderReviewProjection = Readonly<{
  status: ReviewStatus;
  doubtful: readonly Readonly<{ change: OrderItemChange; quote: string | null }>[];
  points: readonly ReviewPoint[];
  products: readonly Readonly<{ itemId: OrderItemId; changedSinceLastReview: boolean }>[];
  removedSinceLastReview: readonly LineSnapshot[];
  messageRows: readonly Readonly<{ messageId: ChatMessageId; at: Date; changes: readonly OrderItemChange[];
    undo: Readonly<{ kind: "available" } | { kind: "refused"; reason: UndoRefusal } | { kind: "undone" }>;
    /** What undoing the message would change in the points: the ones that come back and the ones that end. */
    pendings: Readonly<{ back: readonly PointLabel[]; end: readonly PointLabel[] }> }>[];
  moreRows: number;
  loaded: Readonly<{ changesThrough: ChangeSeq; changeIds: readonly OrderItemChangeId[]; points: readonly PointKey[]; itemsRevision: OrderRevision }>;
}>;

/** A message of the order that changed lines or pendings, as `OrderMessage` and its change rows are read. */
export type MessageRowSource = Readonly<{ messageId: ChatMessageId; at: Date; undoneAt: Date | null; changes: readonly OrderItemChange[];
  pendingsBefore: readonly ChatPending[]; pendingsAfter: readonly ChatPending[] }>;
export type MessageRows = OrderReviewProjection["messageRows"];

/** «Cambios por mensajes»: each message with its changes, whether its undo is available, refused with a reason, or done, and the points an undo would bring back or end. */
export function messageRows(input: Readonly<{ order: OrderAggregate; rows: readonly MessageRowSource[]; pendings: readonly ChatPending[];
  /** Changes of the order newer than the oldest row, whatever their message. */
  laterChanges: readonly OrderItemChange[]; sellable: readonly SellableVariant[]; now: Date; pendingTtlMs: number;
  describePoint: (pending: ChatPending) => Pick<ReviewPoint, "product"> }>): MessageRows {
  const label = (pending: ChatPending): PointLabel => ({ kind: pending.subject.kind === "variant" ? "variant_missing" : "not_clear", product: input.describePoint(pending).product });
  return input.rows.map((row): MessageRows[number] => {
    const base = { messageId: row.messageId, at: row.at, changes: row.changes };
    if (row.undoneAt) return { ...base, undo: { kind: "undone" }, pendings: { back: [], end: [] } };
    const verdict = undoability({ order: input.order, message: row, pendings: input.pendings, laterChanges: input.laterChanges, sellable: input.sellable });
    const undo = verdict.kind === "available" ? { kind: "available" } as const : { kind: "refused", reason: verdict.reason } as const;
    const plan = undoPendings({ order: input.order, message: row, pendings: input.pendings, pendingTtlMs: input.pendingTtlMs, now: input.now });
    const before = new Set(row.pendingsBefore.map((pending) => pending.id));
    const after = new Set(row.pendingsAfter.map((pending) => pending.id));
    const restored = new Set(plan.restored.map((pending) => pending.id));
    const back = plan.restored.filter((pending) => !after.has(pending.id));
    const end = [...row.pendingsAfter.filter((pending) => !restored.has(pending.id) || !before.has(pending.id)), ...plan.overflow];
    return { ...base, undo, pendings: { back: back.slice(0, maxChatPendings).map(label), end: end.slice(0, maxChatPendings).map(label) } };
  });
}

const isWhatsAppOrder = (order: OrderAggregate): order is OrderAggregate & { chatId: ChatId } => Boolean(order.chatId);
const isFinished = (order: Pick<OrderAggregate, "cancelled" | "completedAt">) => order.cancelled || order.completedAt !== null;

/**
 * The pendings that belong to this order: the ones attached to it, plus the orderless ones when this is the chat's latest order, it was created at or after the pending's
 * last change and within the pending's lifetime. A pending is only alive while its order is open for messages, so a closed order shows none.
 */
export function pointsOfOrder(pendings: readonly ChatPending[], order: OrderAggregate, latestChatOrderId: OrderId | null, now: Date, ttlMs: number): readonly ChatPending[] {
  if (!isWhatsAppOrder(order) || !isOpenForMessageItems(order, order.chatId)) return [];
  return pendings.filter((pending) => {
    if (pending.order) return pending.order.orderId === order.id;
    return latestChatOrderId === order.id && order.createdAt.getTime() >= pending.lastChangedAt.getTime() && now.getTime() < pending.lastChangedAt.getTime() + ttlMs;
  });
}

export type ReviewStatusInput = Readonly<{ order: OrderAggregate; unreviewed: readonly OrderItemChange[]; points: readonly ReviewPoint[]; hasPreviousReview: boolean }>;

/** Whether the order has something to review and where the review opens from. Marks and points are never counted on cancelled or completed orders. */
export function reviewStatus(input: ReviewStatusInput): ReviewStatus {
  const { order, hasPreviousReview } = input;
  const none = { openForMessages: false, toReview: false, doubtfulCount: 0, pointCount: 0, entry: "none", hasPreviousReview } as const;
  if (!isWhatsAppOrder(order) || isFinished(order)) return { ...none, openForMessages: isWhatsAppOrder(order) && isOpenForMessageItems(order, order.chatId) };
  const openForMessages = isOpenForMessageItems(order, order.chatId);
  const doubtfulCount = input.unreviewed.filter((change) => isMarked(change, order)).length;
  if (!openForMessages) return { openForMessages, toReview: doubtfulCount > 0, doubtfulCount, pointCount: 0, entry: "detail", hasPreviousReview };
  const pointCount = input.points.filter((point) => !point.acknowledged).length;
  return { openForMessages, toReview: input.unreviewed.length > 0 || doubtfulCount > 0 || pointCount > 0, doubtfulCount, pointCount, entry: "link", hasPreviousReview };
}

const samePointKey = (a: PointKey, b: PointKey) => a.pendingId === b.pendingId && a.since.getTime() === b.since.getTime();

/** What came in since the review loaded: the changes past its high-water mark and the unacknowledged points it did not show. */
export function reviewDelta(loaded: Readonly<{ changesThrough: ChangeSeq; points: readonly PointKey[] }>, changes: readonly OrderItemChange[],
  current: readonly Readonly<{ key: PointKey; acknowledged: boolean }>[]): Readonly<{ newChanges: readonly OrderItemChange[]; newPoints: readonly PointKey[] }> {
  return {
    newChanges: changes.filter((change) => change.seq > loaded.changesThrough),
    newPoints: current.filter((point) => !point.acknowledged && !loaded.points.some((key) => samePointKey(key, point.key))).map((point) => point.key),
  };
}

/**
 * The lines as they were when the review loaded: every change past the high-water mark is inverted, newest first. The caller compares the revision of the result
 * with the loaded one; equal means messages explain the whole difference.
 */
export function loadedItemsRevision(lockedLines: readonly OrderItem[], newChanges: readonly Pick<OrderItemChange, "seq" | "before" | "after">[]): OrderRevision {
  let lines = [...lockedLines];
  for (const change of [...newChanges].sort((a, b) => b.seq - a.seq)) {
    const { before, after } = change;
    if (!before) lines = lines.filter((line) => line.id !== after!.itemId);
    else if (!after) lines.push(itemOfSnapshot(before));
    else lines = lines.map((line) => (line.id === after.itemId ? itemOfSnapshot(before) : line));
  }
  return orderRevisions({ items: lines } as unknown as OrderAggregate).items;
}

export type ReviewProjectionInput = Readonly<{
  order: OrderAggregate;
  latestChatOrderId: OrderId | null;
  pendings: readonly ChatPending[];
  /** The order's changes with no verdict, no review and no live superseder. */
  unreviewed: readonly OrderItemChange[];
  lastSeq: ChangeSeq;
  hasPreviousReview: boolean;
  now: Date;
  pendingTtlMs: number;
  quoteOf: (change: OrderItemChange) => string | null;
  describePoint: (pending: ChatPending) => Pick<ReviewPoint, "product" | "missing" | "question">;
  rows: readonly MessageRowSource[];
  laterChanges: readonly OrderItemChange[];
  sellable: readonly SellableVariant[];
  moreRows: number;
}>;

/** The review of an order: marks, points, products, removals since the last review and «Cambios por mensajes», with the snapshot a confirmation will compare. */
export function reviewProjection(input: ReviewProjectionInput): OrderReviewProjection {
  const { order, unreviewed } = input;
  const points = pointsOfOrder(input.pendings, order, input.latestChatOrderId, input.now, input.pendingTtlMs).map((pending): ReviewPoint => ({
    key: { pendingId: pending.id, since: pending.pointSince }, kind: pending.subject.kind === "variant" ? "variant_missing" : "not_clear", quantity: pending.quantity,
    doubt: pending.doubt?.reason ?? null, acknowledged: (pending.acknowledgedAt?.getTime() ?? Number.NEGATIVE_INFINITY) >= pending.pointSince.getTime(), ...input.describePoint(pending) }));
  const shown = isWhatsAppOrder(order) && !isFinished(order);
  const touched = new Set(unreviewed.flatMap((change) => (change.after ? [change.after.itemId] : [])));
  const kept = new Set(order.items.map((item) => item.id));
  return {
    status: reviewStatus({ order, unreviewed, points, hasPreviousReview: input.hasPreviousReview }),
    doubtful: shown ? unreviewed.filter((change) => isMarked(change, order)).map((change) => ({ change, quote: input.quoteOf(change) })) : [],
    points: shown ? points : [],
    products: order.items.map((item) => ({ itemId: item.id, changedSinceLastReview: touched.has(item.id) })),
    removedSinceLastReview: shown ? unreviewed.filter((change) => change.decision.kind === "applied" && change.before && !change.after && !kept.has(change.before.itemId)).map((change) => change.before!) : [],
    messageRows: shown ? messageRows({ order, rows: input.rows, pendings: input.pendings, laterChanges: input.laterChanges, sellable: input.sellable,
      now: input.now, pendingTtlMs: input.pendingTtlMs, describePoint: input.describePoint }) : [],
    moreRows: shown ? input.moreRows : 0,
    loaded: { changesThrough: input.lastSeq, changeIds: unreviewed.map((change) => change.id), points: points.map((point) => point.key), itemsRevision: orderRevisions(order).items },
  };
}
