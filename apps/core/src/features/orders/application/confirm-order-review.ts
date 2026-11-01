import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { TransactionEndingError } from "@core/src/shared/application/contained-failure";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatPending, ChatPendings } from "@core/src/features/orders/domain/chat-pendings";
import type { ChangeSeq, OrderItemChange, OrderItemChangeId, OrderReviewId } from "@core/src/features/orders/domain/message-changes";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, OrderId, OrderItemId, UserId } from "@core/src/features/orders/domain/order";
import { orderEdit, type OrderLineRequest, type OrderLineQuantity, type VariantNotFound } from "@core/src/features/orders/domain/order-edit";
import { loadedItemsRevision, pointsOfOrder, reviewDelta, type OrderLinkActionId, type PointKey } from "@core/src/features/orders/domain/order-review";
import type { OrderRevision } from "@core/src/features/orders/domain/order-revisions";
import type { OrderAggregate, OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { StockEventResult } from "@core/src/features/orders/application/describe-order-stock-due";
import { planItemsEdit, settleEditStock, writeItemsEdit, type ItemsEditRecords, type PlannedItemsEdit, type PlanItemsEditDependencies, type SettleEditStockDependencies } from "@core/src/features/orders/application/apply-items-edit";
import type { LinkActionKind } from "@core/src/features/orders/application/record-link-action";

export type ConfirmOrderReviewInput = Readonly<{
  /** Client UUID, the idempotency key. */
  reviewId: OrderReviewId;
  orderId: OrderId;
  origin: "link" | "detail";
  /** Mobile records the link action here; web records it on the click. */
  linkAction: Readonly<{ id: OrderLinkActionId; action: LinkActionKind }> | null;
  loaded: Readonly<{ changesThrough: ChangeSeq; changeIds: readonly OrderItemChangeId[]; points: readonly PointKey[]; itemsRevision: OrderRevision }>;
  /** A quantity of 0 removes the item. */
  corrections: readonly Readonly<{ itemId: OrderItemId; quantity: OrderLineQuantity | 0 }>[];
}>;

type Failure = Readonly<{ code: "ORDER_NOT_FOUND" | "INVALID_INPUT" | "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA" | "ORDER_CHANGED" | "LAST_ITEM"; message: string }>;
export type ConfirmOrderReviewError =
  | Failure | OrderDomainError | VariantNotFound | TransactionEndingError
  | Readonly<{ code: "REVIEW_OUTDATED"; message: string; affectedItemIds: readonly OrderItemId[]; newPoints: number }>;

export type StoredReview = Readonly<{ id: OrderReviewId; orderId: OrderId; origin: "link" | "detail"; correctedItems: number; changesThrough: ChangeSeq; confirmedThrough: ChangeSeq; confirmedAt: Date;
  shownPoints: readonly PointKey[] }>;

export type ConfirmedReview = Readonly<{ review: StoredReview; order: OrderAggregate; changedMeanwhile: readonly OrderItemChange[]; total: Money; stockDue: StockEventResult["stockDue"]; doubtfulShown: number; pointsAcknowledged: number }>;

export type ConfirmOrderReviewDependencies = PlanItemsEditDependencies<ConfirmOrderReviewError> & SettleEditStockDependencies & ItemsEditRecords<ConfirmOrderReviewError> & Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, ConfirmOrderReviewError>>) => Promise<Result<T, ConfirmOrderReviewError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, ConfirmOrderReviewError>>;
  findChatPendingsForUpdate: (chatId: ChatId) => Promise<Result<ChatPendings, ConfirmOrderReviewError>>;
  findLatestChatOrder: (chatId: ChatId) => Promise<Result<OrderId | null, ConfirmOrderReviewError>>;
  findReview: (reviewId: OrderReviewId) => Promise<Result<StoredReview | null, ConfirmOrderReviewError>>;
  findChangesAfter: (orderId: OrderId, afterSeq: number) => Promise<Result<readonly OrderItemChange[], ConfirmOrderReviewError>>;
  findChangesByIds: (orderId: OrderId, ids: readonly OrderItemChangeId[]) => Promise<Result<readonly OrderItemChange[], ConfirmOrderReviewError>>;
  saveReview: (review: StoredReview, reviewedById: UserId) => Promise<Result<null, ConfirmOrderReviewError>>;
  markChangesReviewed: (orderId: OrderId, reviewId: OrderReviewId, ids: readonly OrderItemChangeId[], at: Date) => Promise<Result<null, ConfirmOrderReviewError>>;
  saveChatPendings: (chatId: ChatId, pendings: ChatPendings) => Promise<Result<null, ConfirmOrderReviewError>>;
  saveLinkAction: (action: Readonly<{ id: OrderLinkActionId; orderId: OrderId; userId: UserId; action: LinkActionKind; reviewId: OrderReviewId | null; takenAt: Date }>) => Promise<Result<null, ConfirmOrderReviewError>>;
  pendingTtlMs: number;
}>;

const itemIdOf = (change: OrderItemChange) => (change.after ?? change.before)!.itemId;
const samePoint = (pending: ChatPending, key: PointKey) => pending.id === key.pendingId && pending.pointSince.getTime() === key.since.getTime();

/** The sure changes that arrived between loading and confirming: `changesThrough < seq <= confirmedThrough`, the same set the first answer gave. */
function changedMeanwhileOf(after: readonly OrderItemChange[], through: number, confirmedThrough: number): readonly OrderItemChange[] {
  return after.filter((change) => change.seq > through && change.seq <= confirmedThrough);
}

/**
 * Confirms the seller's review under the order lock, all or nothing: the changes the review showed get their verdicts, the corrections run through the items step shared with `editOrder`,
 * the shown points are acknowledged and the review (and its link action) is stored. The same `reviewId` answers the same again.
 */
export async function confirmOrderReview(input: ConfirmOrderReviewInput, access: OrderAccess, deps: ConfirmOrderReviewDependencies): Promise<Result<ConfirmedReview, ConfirmOrderReviewError>> {
  return deps.transaction(access.companyId, async () => {
    const found = await deps.findOrderForUpdate(input.orderId, access.companyId);
    if (!found.success) return found;
    const order = found.data;
    if (!order || !order.chatId) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const stored = await deps.findChatPendingsForUpdate(order.chatId);
    if (!stored.success) return stored;
    // The lock is taken before this read, so a repeat that waited on the first request finds its review here.
    const existing = await deps.findReview(input.reviewId);
    if (!existing.success) return existing;
    if (existing.data) return existing.data.orderId === order.id ? rebuilt(order, existing.data, deps) : err({ code: "INVALID_INPUT", message: "The review belongs to another order" });

    const shown = await deps.findChangesByIds(order.id, input.loaded.changeIds);
    if (!shown.success) return shown;
    if (shown.data.length !== new Set(input.loaded.changeIds).size || shown.data.some((change) => change.seq > input.loaded.changesThrough))
      return err({ code: "INVALID_INPUT", message: "The review shows a change that is not part of what it loaded" });
    const after = await deps.findChangesAfter(order.id, input.loaded.changesThrough);
    if (!after.success) return after;
    const latest = await deps.findLatestChatOrder(order.chatId);
    if (!latest.success) return latest;
    const now = deps.clock();
    const points = pointsOfOrder(stored.data.pendings, order, latest.data, now, deps.pendingTtlMs);
    const delta = reviewDelta(input.loaded, after.data, points.map((pending) => ({ key: { pendingId: pending.id, since: pending.pointSince }, acknowledged: (pending.acknowledgedAt?.getTime() ?? -1) >= pending.pointSince.getTime() })));

    const corrected = new Set(input.corrections.map((correction) => correction.itemId));
    const live = delta.newChanges.filter((change) => change.verdict?.kind !== "undone");
    const affected = live.filter((change) => change.decision.kind === "doubtful" || corrected.has(itemIdOf(change)));
    if (affected.length > 0 || delta.newPoints.length > 0)
      return err({ code: "REVIEW_OUTDATED", message: "The order changed while it was being reviewed", affectedItemIds: [...new Set(affected.map(itemIdOf))], newPoints: delta.newPoints.length });
    if (loadedItemsRevision(order.items, delta.newChanges) !== input.loaded.itemsRevision) return err({ code: "ORDER_CHANGED", message: "The order changed since it was loaded" });

    let next = order;
    let returns: PlannedItemsEdit["returns"] = [];
    let edited = false;
    if (input.corrections.length > 0) {
      const lines = linesAfter(order, input.corrections);
      if (!lines.success) return lines;
      const locked = orderEdit.checkLocks(order, new Set(["items"]));
      if (!locked.success) return locked;
      if (lines.data.length === 0) return err({ code: "LAST_ITEM", message: "The order keeps at least one item" });
      const unchanged = order.items.length === lines.data.length && order.items.every((item) => lines.data.some((line) => line.variantId === item.variantId && Number(line.quantity) === Number(item.quantity)));
      if (!unchanged) {
        const planned = await planItemsEdit(order, lines.data, deps);
        if (!planned.success) return planned;
        const saved = await writeItemsEdit(order, planned.data, deps);
        if (!saved.success) return saved;
        next = planned.data.order;
        returns = planned.data.returns;
        edited = true;
      }
    }

    const confirmedThrough = Math.max(input.loaded.changesThrough, ...after.data.map((change) => change.seq)) as ChangeSeq;
    const review: StoredReview = { id: input.reviewId, orderId: order.id, origin: input.origin, correctedItems: input.corrections.length, changesThrough: input.loaded.changesThrough, confirmedThrough,
      confirmedAt: now, shownPoints: input.loaded.points };
    const savedReview = await deps.saveReview(review, access.userId);
    if (!savedReview.success) return savedReview;
    const marked = await deps.markChangesReviewed(order.id, input.reviewId, input.loaded.changeIds, now);
    if (!marked.success) return marked;
    const acknowledged = stored.data.pendings.map((pending) => (points.includes(pending) && input.loaded.points.some((key) => samePoint(pending, key)) ? { ...pending, acknowledgedAt: now } : pending));
    if (acknowledged.some((pending, index) => pending !== stored.data.pendings[index])) {
      const savedPendings = await deps.saveChatPendings(order.chatId, { ...stored.data, pendings: acknowledged });
      if (!savedPendings.success) return savedPendings;
    }
    if (input.linkAction) {
      const savedAction = await deps.saveLinkAction({ ...input.linkAction, orderId: order.id, userId: access.userId, reviewId: input.reviewId, takenAt: now });
      if (!savedAction.success) return savedAction;
    }
    const acted = await deps.saveSellerActedAt(order.id, order.companyId, now);
    if (!acted.success) return acted;

    const settled = await settleEditStock(order, next, { items: edited, delivery: false }, returns, deps);
    if (!settled.success) return settled;
    const shownIds = new Set(input.loaded.changeIds);
    const doubtfulShown = shown.data.filter((change) => shownIds.has(change.id) && change.decision.kind === "doubtful").length;
    const pointsAcknowledged = acknowledged.filter((pending, index) => pending !== stored.data.pendings[index]).length;
    return ok({ review, order: settled.data.order, changedMeanwhile: changedMeanwhileOf(after.data, input.loaded.changesThrough, confirmedThrough), total: settled.data.order.total, stockDue: settled.data.stockDue, doubtfulShown, pointsAcknowledged });
  });
}

/** The final lines: each item keeps its quantity unless corrected, and a correction of 0 removes it. A correction for an item the order does not have is invalid input. */
function linesAfter(order: OrderAggregate, corrections: ConfirmOrderReviewInput["corrections"]): Result<readonly OrderLineRequest[], Failure> {
  const byItem = new Map(corrections.map((correction) => [correction.itemId, correction.quantity]));
  if (byItem.size !== corrections.length || corrections.some((correction) => !order.items.some((item) => item.id === correction.itemId)))
    return err({ code: "INVALID_INPUT", message: "A correction names an item the order does not have" });
  return ok(order.items.flatMap((item) => {
    const quantity = byItem.get(item.id) ?? item.quantity;
    return quantity === 0 ? [] : [{ variantId: item.variantId, quantity: quantity as unknown as OrderLineQuantity }];
  }));
}

async function rebuilt(order: OrderAggregate, review: StoredReview, deps: ConfirmOrderReviewDependencies): Promise<Result<ConfirmedReview, ConfirmOrderReviewError>> {
  const after = await deps.findChangesAfter(order.id, review.changesThrough);
  if (!after.success) return after;
  const settled = await settleEditStock(order, order, { items: false, delivery: false }, [], deps);
  if (!settled.success) return settled;
  return ok({ review, order, changedMeanwhile: changedMeanwhileOf(after.data, review.changesThrough, review.confirmedThrough), total: order.total, stockDue: settled.data.stockDue, doubtfulShown: 0, pointsAcknowledged: 0 });
}

export type { ChatMessageId };
