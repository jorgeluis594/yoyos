import { orderReviewResponseSchema, type OrderReviewResponse } from "@shared/contracts/order-review";
import type { LineSnapshot, OrderItemChange } from "@core/src/features/orders/domain/message-changes";
import type { OrderReviewProjection } from "@core/src/features/orders/domain/order-review";
import { suggestedQuestionText } from "@core/src/features/orders/presentation/suggested-question-texts";

const lineJson = (line: LineSnapshot) => ({ ...line, mentionedPrice: line.mentionedPrice ?? null });

export function changeJson(change: OrderItemChange) {
  return { id: change.id, messageId: change.messageId, position: change.position, seq: change.seq, kind: change.kind, before: change.before ? lineJson(change.before) : null,
    after: change.after ? lineJson(change.after) : null, decision: change.decision, verdict: change.verdict ? { kind: change.verdict.kind, at: change.verdict.at.toISOString() } : null,
    createdAt: change.createdAt.toISOString() };
}

/** The wire form of the review projection; the response is checked against the shared contract before it leaves. */
export function toOrderReviewJson(projection: OrderReviewProjection): OrderReviewResponse {
  return orderReviewResponseSchema.parse({
    version: 1,
    status: projection.status,
    doubtful: projection.doubtful.map(({ change, quote }) => ({ change: changeJson(change), quote })),
    points: projection.points.map((point) => ({ pendingId: point.key.pendingId, since: point.key.since.toISOString(), kind: point.kind, product: point.product, quantity: point.quantity,
      missing: point.missing, doubt: point.doubt, acknowledged: point.acknowledged, question: suggestedQuestionText(point.question) })),
    products: projection.products,
    removedSinceLastReview: projection.removedSinceLastReview.map(lineJson),
    messageRows: projection.messageRows.map((row) => ({ messageId: row.messageId, at: row.at.toISOString(), changes: row.changes.map(changeJson), undo: row.undo })),
    moreRows: projection.moreRows,
    loaded: { changesThrough: projection.loaded.changesThrough, changeIds: projection.loaded.changeIds, points: projection.loaded.points.map((key) => ({ pendingId: key.pendingId, since: key.since.toISOString() })),
      itemsRevision: projection.loaded.itemsRevision },
  });
}
