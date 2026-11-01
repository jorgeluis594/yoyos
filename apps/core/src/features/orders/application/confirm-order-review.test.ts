import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { ChatPending, ChatPendingId, ChatPendings } from "@core/src/features/orders/domain/chat-pendings";
import { snapshotOf, type ChangeSeq, type OrderItemChange, type OrderItemChangeId, type OrderReviewId } from "@core/src/features/orders/domain/message-changes";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, OrderId, OrderItem, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import { orderRevisions } from "@core/src/features/orders/domain/order-revisions";
import type { OrderLinkActionId } from "@core/src/features/orders/domain/order-review";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import { confirmOrderReview, type ConfirmOrderReviewDependencies, type ConfirmOrderReviewInput } from "@core/src/features/orders/application/confirm-order-review";
import type { StoredReview } from "@core/src/features/orders/application/confirm-order-review";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-10-31T12:00:00Z");
const access = { companyId: id(2) as CompanyId, userId: "seller" as UserId };
const chatId = id(9) as ChatId;
const orderId = id(1) as OrderId;
const reviewId = id(700) as OrderReviewId;
const itemOf = (n: number, name: string, quantity: number): OrderItem => ({ id: id(n) as OrderItemId, variantId: id(n + 100) as VariantId, productName: name, variantAttributes: {}, sku: null,
  quantity: quantity as PositiveInteger, unitPrice: money(20), subtotal: money(20 * quantity), mentionedPrice: null, stockDeductedQuantity: 0 });
const orderOf = (items: readonly OrderItem[], overrides: Partial<OrderAggregate> = {}): OrderAggregate => ({ number: 1023 as OrderNumber, id: orderId, companyId: access.companyId, sellerId: "seller" as UserId,
  fromCatalog: false, chatId, buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt: at, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null,
  cancelled: false, cancelledAt: null, items: items as never, payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false, stockDeductedAt: null,
  itemsTotal: money(0), deliveryCost: money(0), deliveryCharge: money(0), total: money(items.reduce((sum, item) => sum + item.subtotal.amount, 0)), ...overrides } as OrderAggregate);
let counter = 1000;
const changeOf = (kind: OrderItemChange["kind"], before: OrderItem | null, after: OrderItem | null, seq: number, overrides: Partial<OrderItemChange> = {}): OrderItemChange => ({ id: id(counter++) as OrderItemChangeId,
  orderId, messageId: id(200 + seq) as ChatMessageId, position: 0, seq: seq as ChangeSeq, kind, before: before ? snapshotOf(before, 0) : null, after: after ? snapshotOf(after, 0) : null,
  decision: { kind: "applied" }, quoteId: null, supersededBy: null, reviewId: null, verdict: null, createdAt: at, ...overrides });
const doubtful = { kind: "doubtful" as const, reason: { kind: "caption_unread" as const } };
const pendingOf = (n: number): ChatPending => ({ id: id(300 + n) as ChatPendingId, subject: { kind: "variant", productId: id(400 + n) as ProductId }, known: {}, quantity: 1 as PositiveInteger, price: null,
  order: { orderId, attachedAt: at }, lastChangedAt: at, sourceMessageId: id(500 + n) as ChatMessageId, requestId: id(300 + n) as ChatPendingId, doubt: null, pointSince: at, acknowledgedAt: null });

type World = { order: OrderAggregate | null; pendings: ChatPending[]; changes: OrderItemChange[]; review: StoredReview | null };
function setup(world: World) {
  const writes: string[] = [];
  const saved = { review: null as StoredReview | null };
  const deps: ConfirmOrderReviewDependencies = {
    transaction: async (_company, work) => work(), findOrderForUpdate: async () => ok(world.order),
    findChatPendingsForUpdate: async () => ok<ChatPendings>({ pendings: world.pendings, readyRemembered: false }), findLatestChatOrder: async () => ok(orderId),
    findReview: async () => ok(world.review),
    findChangesAfter: async (_order, after) => ok(world.changes.filter((change) => change.seq > after)),
    findChangesByIds: async (_order, ids) => ok(world.changes.filter((change) => ids.includes(change.id))),
    saveReview: vi.fn(async (review: StoredReview) => { writes.push("review"); saved.review = review; return ok(null); }),
    markChangesReviewed: vi.fn(async () => { writes.push("marked"); return ok(null); }),
    saveChatPendings: vi.fn(async () => { writes.push("pendings"); return ok(null); }),
    saveLinkAction: vi.fn(async () => { writes.push("link"); return ok(null); }),
    findSellableVariants: async () => ok([]), newItemId: () => id(990) as OrderItemId,
    saveItemChanges: vi.fn(async () => { writes.push("items"); return ok(null); }), setVerdictsForEdit: vi.fn(async () => { writes.push("edit-verdicts"); return ok(null); }),
    saveSellerActedAt: vi.fn(async () => { writes.push("acted"); return ok(null); }), clock: () => at,
    publishStockEvent: vi.fn(async () => ok({ kind: "not_due" } as never)), publishStockIncreased: vi.fn(async () => ok(null)),
    findVariantStock: async () => ok(new Map()), pendingTtlMs: 7_200_000,
  };
  return { deps, writes, saved };
}
const polo = itemOf(3, "Polo", 2);
const gorra = itemOf(4, "Gorra", 1);
const inputFor = (order: OrderAggregate, changes: OrderItemChange[], overrides: Partial<ConfirmOrderReviewInput> = {}): ConfirmOrderReviewInput => ({ reviewId, orderId, origin: "link", linkAction: null,
  loaded: { changesThrough: Math.max(0, ...changes.map((change) => change.seq)) as ChangeSeq, changeIds: changes.map((change) => change.id), points: [], itemsRevision: orderRevisions(order).items }, corrections: [], ...overrides });

test("confirms a review without corrections: stores it, marks the shown changes and acknowledges the shown points", async () => {
  const order = orderOf([polo, gorra]);
  const changes = [changeOf("added", null, polo, 1, { decision: doubtful })];
  const pending = pendingOf(1);
  const { deps, writes, saved } = setup({ order, pendings: [pending], changes, review: null });
  const result = await confirmOrderReview(inputFor(order, changes, { loaded: { ...inputFor(order, changes).loaded, points: [{ pendingId: pending.id, since: pending.pointSince }] } }), access, deps);
  expect(result).toMatchObject({ success: true, data: { changedMeanwhile: [], total: money(60) } });
  expect(writes).toEqual(["review", "marked", "pendings", "acted"]);
  expect(saved.review).toMatchObject({ id: reviewId, origin: "link", correctedItems: 0, changesThrough: 1, confirmedThrough: 1 });
  expect(deps.saveChatPendings).toHaveBeenCalledWith(chatId, { pendings: [{ ...pending, acknowledgedAt: at }], readyRemembered: false });
  expect(deps.publishStockEvent).not.toHaveBeenCalled();
});

test("removing a doubtful item in a review records removed and the next link action runs directly", async () => {
  const order = orderOf([polo, gorra]);
  const changes = [changeOf("added", null, gorra, 1, { decision: doubtful })];
  const { deps, writes } = setup({ order, pendings: [], changes, review: null });
  const result = await confirmOrderReview(inputFor(order, changes, { corrections: [{ itemId: gorra.id, quantity: 0 }], linkAction: { id: id(800) as OrderLinkActionId, action: "copy" } }), access, deps);
  expect(result).toMatchObject({ success: true, data: { order: { items: [{ id: polo.id }] } } });
  expect(writes).toEqual(["items", "edit-verdicts", "acted", "review", "marked", "link", "acted"]);
  expect(deps.setVerdictsForEdit).toHaveBeenCalledWith(orderId, access.companyId, [{ verdict: "removed", itemIds: [gorra.id] }], at);
  expect(deps.publishStockEvent).toHaveBeenCalledTimes(1);
  expect(deps.saveLinkAction).toHaveBeenCalledWith(expect.objectContaining({ reviewId, action: "copy", orderId }));
});

test("answers REVIEW_OUTDATED and writes nothing when a new change is doubtful", async () => {
  const order = orderOf([polo, gorra]);
  const shown = [changeOf("added", null, polo, 1)];
  const added = changeOf("added", null, gorra, 2, { decision: doubtful });
  const { deps, writes } = setup({ order, pendings: [], changes: [...shown, added], review: null });
  expect(await confirmOrderReview(inputFor(order, shown), access, deps)).toMatchObject({ success: false, error: { code: "REVIEW_OUTDATED", affectedItemIds: [gorra.id], newPoints: 0 } });
  expect(writes).toEqual([]);
});

test("answers REVIEW_OUTDATED when a new point appeared", async () => {
  const order = orderOf([polo]);
  const { deps, writes } = setup({ order, pendings: [pendingOf(1)], changes: [], review: null });
  expect(await confirmOrderReview(inputFor(order, []), access, deps)).toMatchObject({ success: false, error: { code: "REVIEW_OUTDATED", newPoints: 1 } });
  expect(writes).toEqual([]);
});

test("answers REVIEW_OUTDATED when a new sure change touches a corrected item", async () => {
  const order = orderOf([polo, gorra]);
  const newer = changeOf("quantity_changed", itemOf(4, "Gorra", 3), gorra, 2);
  const { deps } = setup({ order, pendings: [], changes: [newer], review: null });
  expect(await confirmOrderReview(inputFor(order, [], { corrections: [{ itemId: gorra.id, quantity: 0 }] }), access, deps)).toMatchObject({ success: false, error: { code: "REVIEW_OUTDATED", affectedItemIds: [gorra.id] } });
});

test("succeeds when a sure message changed another item meanwhile and reports it as changed meanwhile", async () => {
  const before = orderOf([polo, itemOf(4, "Gorra", 3)]);
  const order = orderOf([polo, gorra]);
  const newer = changeOf("quantity_changed", itemOf(4, "Gorra", 3), gorra, 2);
  const { deps, saved } = setup({ order, pendings: [], changes: [newer], review: null });
  const result = await confirmOrderReview(inputFor(before, [], { corrections: [{ itemId: polo.id, quantity: 1 as never }] }), access, deps);
  expect(result).toMatchObject({ success: true, data: { changedMeanwhile: [{ id: newer.id }] } });
  expect(saved.review).toMatchObject({ changesThrough: 0, confirmedThrough: 2 });
});

test("answers ORDER_CHANGED when another seller saved an edit meanwhile", async () => {
  const loaded = orderOf([polo, gorra]);
  const { deps, writes } = setup({ order: orderOf([itemOf(3, "Polo", 5), gorra]), pendings: [], changes: [], review: null });
  expect(await confirmOrderReview(inputFor(loaded, []), access, deps)).toMatchObject({ success: false, error: { code: "ORDER_CHANGED" } });
  expect(writes).toEqual([]);
});

test("answers ORDER_CHANGED when a message was undone between loading and confirming", async () => {
  const loaded = orderOf([polo, itemOf(4, "Gorra", 3)]);
  const { deps } = setup({ order: orderOf([polo, gorra]), pendings: [], changes: [], review: null });
  expect(await confirmOrderReview(inputFor(loaded, []), access, deps)).toMatchObject({ success: false, error: { code: "ORDER_CHANGED" } });
});

test("refuses a shown change id that is newer than the loaded high-water mark", async () => {
  const order = orderOf([polo]);
  const newer = changeOf("added", null, polo, 5);
  const { deps } = setup({ order, pendings: [], changes: [newer], review: null });
  expect(await confirmOrderReview(inputFor(order, [], { loaded: { ...inputFor(order, []).loaded, changesThrough: 2 as ChangeSeq, changeIds: [newer.id] } }), access, deps)).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
});

test("on a shipped order, a review without corrections clears the marks and one with a correction answers DELIVERY_LOCKED", async () => {
  const order = orderOf([polo, gorra], { deliveryStatus: "shipped" } as never);
  const changes = [changeOf("added", null, gorra, 1, { decision: doubtful })];
  const { deps, writes } = setup({ order, pendings: [], changes, review: null });
  expect(await confirmOrderReview(inputFor(order, changes), access, deps)).toMatchObject({ success: true });
  expect(writes).toContain("marked");
  const locked = setup({ order, pendings: [], changes, review: null });
  expect(await confirmOrderReview(inputFor(order, changes, { corrections: [{ itemId: gorra.id, quantity: 0 }] }), access, locked.deps)).toMatchObject({ success: false, error: { code: "DELIVERY_LOCKED" } });
  expect(locked.writes).toEqual([]);
});

test("refuses to remove every item with LAST_ITEM", async () => {
  const order = orderOf([polo]);
  const { deps } = setup({ order, pendings: [], changes: [], review: null });
  expect(await confirmOrderReview(inputFor(order, [], { corrections: [{ itemId: polo.id, quantity: 0 }] }), access, deps)).toMatchObject({ success: false, error: { code: "LAST_ITEM" } });
});

test("confirming a review twice with the same id returns the same answer and writes one review", async () => {
  const order = orderOf([polo, gorra]);
  const changes = [changeOf("added", null, polo, 1)];
  const first = setup({ order, pendings: [], changes, review: null });
  const answered = await confirmOrderReview(inputFor(order, changes), access, first.deps);
  const newer = changeOf("quantity_changed", itemOf(4, "Gorra", 3), gorra, 2);
  const second = setup({ order, pendings: [], changes: [...changes, newer], review: first.saved.review });
  const repeat = await confirmOrderReview(inputFor(order, changes), access, second.deps);
  expect(answered.success && repeat.success && repeat.data.review).toEqual(answered.success && answered.data.review);
  expect(second.writes).toEqual([]);
  expect(repeat).toMatchObject({ success: true, data: { changedMeanwhile: [] } });
});

test("a repeat rebuilds the changes that arrived meanwhile from the stored marks", async () => {
  const order = orderOf([polo, gorra]);
  const arrived = changeOf("quantity_changed", itemOf(4, "Gorra", 3), gorra, 2);
  const later = changeOf("added", null, polo, 3);
  const review: StoredReview = { id: reviewId, orderId, origin: "link", correctedItems: 0, changesThrough: 1 as ChangeSeq, confirmedThrough: 2 as ChangeSeq, confirmedAt: at, shownPoints: [] };
  const { deps } = setup({ order, pendings: [], changes: [arrived, later], review });
  expect(await confirmOrderReview(inputFor(order, []), access, deps)).toMatchObject({ success: true, data: { changedMeanwhile: [{ id: arrived.id }] } });
});

test("answers not found for an order without a chat", async () => {
  const { deps } = setup({ order: orderOf([polo], { chatId: null }), pendings: [], changes: [], review: null });
  expect(await confirmOrderReview(inputFor(orderOf([polo]), []), access, deps)).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
});

test("writes nothing when a store fails", async () => {
  const order = orderOf([polo]);
  const { deps } = setup({ order, pendings: [], changes: [], review: null });
  const failing = { ...deps, saveReview: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" }) };
  expect(await confirmOrderReview(inputFor(order, []), access, failing)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
});
