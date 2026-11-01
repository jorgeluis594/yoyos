import { describe, expect, test } from "vitest";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { ChatPending, ChatPendingId } from "@core/src/features/orders/domain/chat-pendings";
import { diffMessageChanges, snapshotOf, type ChangeSeq, type OrderItemChange, type OrderItemChangeId } from "@core/src/features/orders/domain/message-changes";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, OrderId, OrderItem, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import { loadedItemsRevision, pointsOfOrder, reviewDelta, reviewProjection, reviewStatus, type ReviewPoint } from "@core/src/features/orders/domain/order-review";
import { orderRevisions } from "@core/src/features/orders/domain/order-revisions";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-10-31T12:00:00Z");
const minutes = (n: number) => new Date(at.getTime() + n * 60_000);
const chatId = id(9) as ChatId;
const orderId = id(1) as OrderId;
const ttlMs = 2 * 60 * 60_000;
const itemOf = (n: number, name: string, quantity: number, unit = 20): OrderItem => ({ id: id(n) as OrderItemId, variantId: id(n + 100) as VariantId, productName: name,
  variantAttributes: { Talla: "M" }, sku: null, quantity: quantity as PositiveInteger, unitPrice: money(unit), subtotal: money(unit * quantity), mentionedPrice: null, stockDeductedQuantity: 0 });
const orderOf = (items: readonly OrderItem[], overrides: Partial<OrderAggregate> = {}): OrderAggregate => ({ number: 1023 as OrderNumber, id: orderId, companyId: id(2) as CompanyId,
  sellerId: "seller" as UserId, fromCatalog: false, chatId, buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt: at, scheduledDispatchDate: null, shippedAt: null,
  deliveredAt: null, completedAt: null, cancelled: false, cancelledAt: null, items: items as never, payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false,
  stockDeductedAt: null, itemsTotal: money(0), deliveryCost: money(0), deliveryCharge: money(0), total: money(0), ...overrides } as OrderAggregate);
const pendingOf = (n: number, overrides: Partial<ChatPending> = {}): ChatPending => ({ id: id(300 + n) as ChatPendingId, subject: { kind: "variant", productId: id(400 + n) as ProductId },
  known: {}, quantity: 1 as PositiveInteger, price: null, order: null, lastChangedAt: minutes(n), sourceMessageId: id(500 + n) as ChatMessageId, requestId: id(300 + n) as ChatPendingId,
  doubt: null, pointSince: minutes(n), acknowledgedAt: null, ...overrides });

let counter = 1000;
const changeOf = (kind: OrderItemChange["kind"], before: OrderItem | null, after: OrderItem | null, seq: number, overrides: Partial<OrderItemChange> = {}): OrderItemChange => ({
  id: id(counter++) as OrderItemChangeId, orderId, messageId: id(200 + seq) as ChatMessageId, position: 0, seq: seq as ChangeSeq, kind,
  before: before ? snapshotOf(before, 0) : null, after: after ? snapshotOf(after, 0) : null, decision: { kind: "applied" }, quoteId: null, supersededBy: null, reviewId: null,
  verdict: null, createdAt: minutes(seq), ...overrides });
const doubtful = { kind: "doubtful" as const, reason: { kind: "quantity_set" as const, quantity: 3 as PositiveInteger } };
const describePoint = (_pending: ChatPending): Pick<ReviewPoint, "product" | "missing" | "question"> => ({ product: "Polo", missing: ["talla"], question: { language: "es", kind: "photo_product_name" } });

describe("pointsOfOrder", () => {
  test("shows an orderless pending only on the chat's latest open order created after it", () => {
    const pending = pendingOf(0, { lastChangedAt: minutes(-5) });
    const order = orderOf([itemOf(3, "Polo", 1)]);
    expect(pointsOfOrder([pending], order, orderId, at, ttlMs)).toEqual([pending]);
    expect(pointsOfOrder([pending], order, id(77) as OrderId, at, ttlMs)).toEqual([]);
    expect(pointsOfOrder([pendingOf(0, { lastChangedAt: minutes(5) })], order, orderId, at, ttlMs)).toEqual([]);
  });

  test("never shows another order's pendings on an older order of the same chat", () => {
    const other = pendingOf(1, { order: { orderId: id(88) as OrderId, attachedAt: minutes(1) } });
    const own = pendingOf(2, { order: { orderId: orderId, attachedAt: minutes(1) } });
    expect(pointsOfOrder([other, own], orderOf([itemOf(3, "Polo", 1)]), id(88) as OrderId, at, ttlMs)).toEqual([own]);
  });

  test("drops an orderless pending past its lifetime", () => {
    expect(pointsOfOrder([pendingOf(0, { lastChangedAt: minutes(-300) })], orderOf([itemOf(3, "Polo", 1)]), orderId, at, ttlMs)).toEqual([]);
  });
});

describe("reviewStatus", () => {
  const status = (order: OrderAggregate, changes: OrderItemChange[], points: ChatPending[] = [], hasPreviousReview = false) =>
    reviewStatus({ order, unreviewed: changes, points: points.map((pending) => ({ ...describePoint(pending), key: { pendingId: pending.id, since: pending.pointSince }, kind: "variant_missing", quantity: pending.quantity,
      doubt: pending.doubt?.reason ?? null, acknowledged: (pending.acknowledgedAt?.getTime() ?? -1) >= pending.pointSince.getTime() })), hasPreviousReview });
  const polo = itemOf(3, "Polo", 2);

  test("reports to review on an open WhatsApp order with an unreviewed sure change", () => {
    expect(status(orderOf([polo]), [changeOf("added", null, polo, 1)])).toMatchObject({ openForMessages: true, toReview: true, entry: "link", doubtfulCount: 0 });
  });

  test("reports nothing to review on a paid order whose only unreviewed changes are sure", () => {
    const paid = orderOf([polo], { deliveryStatus: "shipped" } as never);
    expect(status(paid, [changeOf("added", null, polo, 1)])).toMatchObject({ openForMessages: false, toReview: false, entry: "detail" });
    expect(status(paid, [changeOf("added", null, polo, 1, { decision: doubtful })])).toMatchObject({ toReview: true, doubtfulCount: 1, entry: "detail" });
  });

  test("counts a doubtful pending once as a point until it becomes an item", () => {
    const pending = pendingOf(0, { doubt: { reason: { kind: "caption_unread" } } });
    expect(status(orderOf([polo]), [], [pending])).toMatchObject({ toReview: true, pointCount: 1, doubtfulCount: 0 });
    expect(status(orderOf([polo]), [], [{ ...pending, acknowledgedAt: minutes(10) }])).toMatchObject({ toReview: false, pointCount: 0 });
  });

  test("hides marks and review on cancelled and completed orders", () => {
    const marked = [changeOf("added", null, polo, 1, { decision: doubtful })];
    expect(status(orderOf([polo], { cancelled: true, cancelledAt: at }), marked)).toMatchObject({ toReview: false, entry: "none", doubtfulCount: 0 });
    expect(status(orderOf([polo], { completedAt: at }), marked)).toMatchObject({ toReview: false, entry: "none", doubtfulCount: 0 });
  });

  test("never reviews an order without a chat", () => {
    expect(status(orderOf([polo], { chatId: null }), [changeOf("added", null, polo, 1, { decision: doubtful })])).toMatchObject({ toReview: false, entry: "none" });
  });

  test("counts a doubtful removal as a visible mark", () => {
    expect(status(orderOf([polo]), [changeOf("removed", polo, null, 1, { decision: doubtful })])).toMatchObject({ doubtfulCount: 1, toReview: true });
  });
});

describe("reviewDelta", () => {
  const polo = itemOf(3, "Polo", 2);
  const key = { pendingId: id(300) as ChatPendingId, since: minutes(0) };

  test("finds the changes after the high-water mark and the unacknowledged points that were not loaded", () => {
    const changes = [changeOf("added", null, polo, 2), changeOf("added", null, itemOf(4, "Gorra", 1), 3)];
    const delta = reviewDelta({ changesThrough: 2 as ChangeSeq, points: [key] }, changes, [{ key, acknowledged: false }, { key: { pendingId: id(301) as ChatPendingId, since: minutes(1) }, acknowledged: false }]);
    expect(delta.newChanges.map((change) => change.seq)).toEqual([3]);
    expect(delta.newPoints).toHaveLength(1);
  });

  test("does not report an acknowledged point or a loaded point as new", () => {
    const other = { pendingId: id(301) as ChatPendingId, since: minutes(1) };
    expect(reviewDelta({ changesThrough: 0 as ChangeSeq, points: [key] }, [], [{ key, acknowledged: false }, { key: other, acknowledged: true }]).newPoints).toEqual([]);
  });

  test("a point whose doubt was set again after loading is new", () => {
    expect(reviewDelta({ changesThrough: 0 as ChangeSeq, points: [key] }, [], [{ key: { ...key, since: minutes(9) }, acknowledged: false }]).newPoints).toHaveLength(1);
  });
});

describe("loadedItemsRevision", () => {
  const [polo, gorra] = [itemOf(3, "Polo", 2), itemOf(4, "Gorra", 1)];

  test("rebuilds the loaded items revision by inverting added, removed and changed lines", () => {
    const loaded = orderOf([polo, gorra]);
    const now = orderOf([itemOf(3, "Polo", 5), itemOf(6, "Short", 1)]);
    const newChanges = [changeOf("quantity_changed", polo, itemOf(3, "Polo", 5), 3), changeOf("removed", gorra, null, 4), changeOf("added", null, itemOf(6, "Short", 1), 5)];
    expect(loadedItemsRevision(now.items, newChanges)).toBe(orderRevisions(loaded).items);
  });

  test("detects a seller edit when the rebuilt revision differs from the loaded one", () => {
    const loaded = orderOf([polo, gorra]);
    const edited = orderOf([itemOf(3, "Polo", 9), gorra]);
    expect(loadedItemsRevision(edited.items, [])).not.toBe(orderRevisions(loaded).items);
  });

  test("rebuilds the loaded revision ignoring changes reviewed or verdicted before the load", () => {
    const now = orderOf([polo, gorra]);
    expect(loadedItemsRevision(now.items, [])).toBe(orderRevisions(now).items);
  });

  test("answers a changed order when a message was undone between loading and confirming", () => {
    const loaded = orderOf([polo, itemOf(4, "Gorra", 3)]);
    const afterUndo = orderOf([polo, gorra]);
    expect(loadedItemsRevision(afterUndo.items, [])).not.toBe(orderRevisions(loaded).items);
  });

  test("restores the revision of the diff a message wrote", () => {
    const before = [polo];
    const after = [itemOf(3, "Polo", 4)];
    const { changes } = diffMessageChanges({ orderId, messageId: id(200) as ChatMessageId, before, after, decision: () => ({ kind: "applied" }), openChanges: [], pendingsBefore: [], pendingsAfter: [],
      newChangeId: () => id(counter++) as OrderItemChangeId, at, nextSeq: 1 as ChangeSeq });
    expect(loadedItemsRevision(orderOf(after).items, changes)).toBe(orderRevisions(orderOf(before)).items);
  });
});

describe("reviewProjection", () => {
  const polo = itemOf(3, "Polo", 2);
  const gorra = itemOf(4, "Gorra", 1);
  const project = (order: OrderAggregate, unreviewed: OrderItemChange[], overrides: Partial<Parameters<typeof reviewProjection>[0]> = {}) => reviewProjection({
    order, latestChatOrderId: orderId, pendings: [], unreviewed, lastSeq: Math.max(0, ...unreviewed.map((change) => change.seq)) as ChangeSeq, hasPreviousReview: false, now: at, pendingTtlMs: ttlMs,
    quoteOf: () => null, describePoint, rows: [], laterChanges: [], sellable: [], moreRows: 0, ...overrides });

  test("lists the doubtful change with its quote and the loaded snapshot", () => {
    const mark = changeOf("added", null, polo, 1, { decision: doubtful, quoteId: 4 as never });
    const projection = project(orderOf([polo]), [mark, changeOf("added", null, gorra, 2)], { quoteOf: (change) => (change.id === mark.id ? "la quiero en M" : null) });
    expect(projection.doubtful).toEqual([{ change: mark, quote: "la quiero en M" }]);
    expect(projection.loaded).toMatchObject({ changesThrough: 2, changeIds: [mark.id, projection.loaded.changeIds[1]] });
    expect(projection.loaded.itemsRevision).toBe(orderRevisions(orderOf([polo])).items);
    expect(projection.products.find((product) => product.itemId === polo.id)?.changedSinceLastReview).toBe(true);
  });

  test("a sure removal after the last review shows as removed since your last review", () => {
    const removed = changeOf("removed", gorra, null, 3);
    const projection = project(orderOf([polo]), [removed], { hasPreviousReview: true });
    expect(projection.removedSinceLastReview).toEqual([removed.before]);
    expect(projection.status.hasPreviousReview).toBe(true);
  });

  test("brings back the mark of an earlier change after the later change was undone", () => {
    const earlier = changeOf("quantity_changed", itemOf(3, "Polo", 1), polo, 1, { decision: doubtful });
    const projection = project(orderOf([polo]), [earlier]);
    expect(projection.status).toMatchObject({ doubtfulCount: 1, toReview: true });
  });

  test("lists the points of the order with their question", () => {
    const pending = pendingOf(0, { lastChangedAt: minutes(-1) });
    const projection = project(orderOf([polo]), [], { pendings: [pending] });
    expect(projection.points).toMatchObject([{ key: { pendingId: pending.id }, kind: "variant_missing", product: "Polo", acknowledged: false }]);
    expect(projection.loaded.points).toEqual([{ pendingId: pending.id, since: pending.pointSince }]);
  });
});
