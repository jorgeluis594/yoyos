import { describe, expect, test } from "vitest";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { SellableVariant } from "@core/src/features/orders/domain/catalog-order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import { maxChatPendings, type ChatPending, type ChatPendingId } from "@core/src/features/orders/domain/chat-pendings";
import { diffMessageChanges, isMarked, lineSnapshotSchema, nextVerdict, undoability, undoPlan, type ChangeSeq, type LineSnapshot, type OrderItemChange, type OrderItemChangeId } from "@core/src/features/orders/domain/message-changes";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, OrderId, OrderItem, OrderItemId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { QuoteId } from "@core/src/features/orders/domain/reader/refs";
import type { VariantId, ProductId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-10-31T12:00:00Z");
const minutes = (n: number) => new Date(at.getTime() + n * 60_000);
const chatId = id(9) as ChatId;
const orderId = id(1) as OrderId;
const messageA = id(201) as ChatMessageId;
const messageB = id(202) as ChatMessageId;
const variantOf = (n: number) => id(n + 100) as VariantId;
const itemOf = (n: number, name: string, attributes: Record<string, string>, quantity: number, unit: number): OrderItem => ({ id: id(n) as OrderItemId, variantId: variantOf(n),
  productName: name, variantAttributes: attributes, sku: `SKU-${n}`, quantity: quantity as PositiveInteger, unitPrice: money(unit), subtotal: money(unit * quantity), mentionedPrice: null, stockDeductedQuantity: 0 });
const polo = (quantity = 2, unit = 35) => itemOf(3, "Polo básico", { Talla: "M" }, quantity, unit);
const gorra = (quantity = 2) => itemOf(4, "Gorra trucker", { Color: "Negro" }, quantity, 20);
const camisa = () => itemOf(5, "Camisa", { Talla: "L" }, 1, 50);

const orderOf = (items: readonly OrderItem[], overrides: Partial<OrderAggregate> = {}): OrderAggregate => {
  const total = items.reduce((sum, item) => sum + item.subtotal.amount, 0);
  return { number: 1042 as OrderNumber, id: orderId, companyId: id(2) as CompanyId, sellerId: "seller" as UserId, fromCatalog: false, chatId, buyer: null,
    checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt: at, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelled: false, cancelledAt: null,
    items: items as never, payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false, stockDeductedAt: null,
    itemsTotal: money(total), deliveryCost: money(0), deliveryCharge: money(0), total: money(total), ...overrides } as OrderAggregate;
};

const pendingOf = (n: number, lastChangedMinutes: number, overrides: Partial<ChatPending> = {}): ChatPending => ({ id: id(300 + n) as ChatPendingId,
  subject: { kind: "variant", productId: id(400 + n) as ProductId }, known: {}, quantity: 1 as PositiveInteger, price: null, order: null, lastChangedAt: minutes(lastChangedMinutes),
  sourceMessageId: id(500 + n) as ChatMessageId, requestId: id(300 + n) as ChatPendingId, doubt: null, pointSince: minutes(lastChangedMinutes), acknowledgedAt: null, ...overrides });

let counter = 1000;
const newChangeId = () => id(counter++) as OrderItemChangeId;
const decideApplied = () => ({ kind: "applied" as const });

const diff = (before: readonly OrderItem[], after: readonly OrderItem[], extra: Partial<Parameters<typeof diffMessageChanges>[0]> = {}) => diffMessageChanges({
  orderId, messageId: messageA, before, after, decision: decideApplied, openChanges: [], pendingsBefore: [], pendingsAfter: [], newChangeId, at, nextSeq: 1 as ChangeSeq, ...extra });

const snapshotOf = (item: OrderItem, position: number): LineSnapshot => ({ itemId: item.id, variantId: item.variantId, productName: item.productName, variantAttributes: item.variantAttributes,
  sku: item.sku, quantity: item.quantity, unitPrice: item.unitPrice, mentionedPrice: item.mentionedPrice ?? null, position });
const changeOf = (overrides: Partial<OrderItemChange> & Pick<OrderItemChange, "kind" | "before" | "after">): OrderItemChange => ({ id: newChangeId(), orderId, messageId: messageA, position: 0,
  seq: 1 as ChangeSeq, decision: { kind: "applied" }, quoteId: null as QuoteId | null, supersededBy: null, reviewId: null, verdict: null, createdAt: at, ...overrides });
const planOf = (input: Parameters<typeof undoPlan>[0]) => {
  const plan = undoPlan(input);
  if (!plan.success) throw new Error(plan.error.message);
  return plan.data;
};
const sellable = (item: OrderItem): SellableVariant => ({ variantId: item.variantId, productName: item.productName, variantAttributes: item.variantAttributes, sku: item.sku, unitPrice: item.unitPrice, available: 5 });

describe("diffMessageChanges", () => {
  test("records one change per line a message touched with the line before and after", () => {
    const result = diff([polo(2), gorra(2), camisa()], [polo(3), gorra(2), itemOf(6, "Short", { Talla: "S" }, 1, 40)], { nextSeq: 7 as ChangeSeq });
    expect(result.changes.map(({ kind, seq, position }) => ({ kind, seq, position }))).toEqual([
      { kind: "quantity_changed", seq: 7, position: 0 }, { kind: "added", seq: 8, position: 1 }, { kind: "removed", seq: 9, position: 2 }]);
    expect(result.changes[0]).toMatchObject({ before: { quantity: 2, position: 0 }, after: { quantity: 3, position: 0 }, decision: { kind: "applied" }, verdict: null, messageId: messageA, orderId });
    expect(result.changes[1]).toMatchObject({ before: null, after: { productName: "Short", quantity: 1, position: 2 } });
    expect(result.changes[2]).toMatchObject({ before: { productName: "Camisa", position: 2 }, after: null });
  });

  test("records a mentioned price set on a line whose quantity did not change", () => {
    const priced = { ...polo(2), mentionedPrice: { amount: money(30), units: 2 } };
    const result = diff([polo(2)], [priced]);
    expect(result.changes).toMatchObject([{ kind: "mentioned_price_set", before: { mentionedPrice: null }, after: { mentionedPrice: { amount: money(30), units: 2 } } }]);
  });

  test("records no change for a line the message left as it was", () => {
    expect(diff([polo(2)], [polo(2)]).changes).toEqual([]);
  });

  test("records only the pendings whose value the message changed", () => {
    const [kept, changed, created, ended] = [pendingOf(1, 0), pendingOf(2, 1), pendingOf(3, 2), pendingOf(4, 3)];
    const result = diff([polo()], [polo()], { pendingsBefore: [kept, changed, ended], pendingsAfter: [kept, { ...changed, quantity: 3 as PositiveInteger, lastChangedAt: minutes(5) }, created] });
    expect(result.pendingsBefore.map(({ id: pendingId }) => pendingId)).toEqual([changed.id, ended.id]);
    expect(result.pendingsAfter.map(({ id: pendingId }) => pendingId)).toEqual([changed.id, created.id]);
  });

  test("supersedes the earlier unverdicted change of an item a later message changed", () => {
    const earlier = changeOf({ kind: "added", before: null, after: snapshotOf(gorra(2), 1), messageId: messageB, seq: 3 as ChangeSeq });
    const other = changeOf({ kind: "added", before: null, after: snapshotOf(polo(2), 0), messageId: messageB, seq: 2 as ChangeSeq });
    const result = diff([polo(2), gorra(2)], [polo(2), gorra(3)], { openChanges: [earlier, other], nextSeq: 4 as ChangeSeq });
    expect(result.supersedes).toEqual([earlier.id]);
  });
});

describe("isMarked", () => {
  const doubtful = changeOf({ kind: "added", before: null, after: snapshotOf(polo(), 0), decision: { kind: "doubtful", reason: { kind: "caption_unread" } } });
  const open = orderOf([polo()]);
  test("marks a doubtful change without verdict, review or supersession on an open order", () => {
    expect(isMarked(doubtful, open)).toBe(true);
  });
  test.each([
    ["an applied change", changeOf({ kind: "added", before: null, after: snapshotOf(polo(), 0) }), open],
    ["a verdicted change", { ...doubtful, verdict: { kind: "kept" as const, at } }, open],
    ["a superseded change", { ...doubtful, supersededBy: id(999) as OrderItemChangeId }, open],
    ["a reviewed change", { ...doubtful, reviewId: id(998) as never }, open],
    ["a change of a cancelled order", doubtful, orderOf([polo()], { cancelled: true })],
    ["a change of a completed order", doubtful, orderOf([polo()], { completedAt: at })],
  ])("does not mark %s", (_name, change, order) => {
    expect(isMarked(change, order)).toBe(false);
  });
});

describe("undoability and undoPlan", () => {
  const limits = { pendingTtlMs: 24 * 3600_000 };
  const message = (changes: readonly OrderItemChange[], pendingsBefore: readonly ChatPending[] = [], pendingsAfter: readonly ChatPending[] = []) =>
    ({ messageId: messageA, changes, pendingsBefore, pendingsAfter });
  const check = (input: { order: OrderAggregate; changes: readonly OrderItemChange[]; pendings?: readonly ChatPending[]; before?: readonly ChatPending[]; after?: readonly ChatPending[];
    later?: readonly OrderItemChange[]; sellableItems?: readonly OrderItem[] }) =>
    undoability({ order: input.order, message: message(input.changes, input.before, input.after), pendings: input.pendings ?? [], laterChanges: input.later ?? [],
      sellable: (input.sellableItems ?? []).map(sellable) });

  // «Polo básico · M · ×2 · S/ 35.00» removed by the message, and the catalog price is S/ 39.00 now.
  const removedPolo = () => changeOf({ kind: "removed", before: snapshotOf(polo(2, 35), 0), after: null });

  test("offers undo for a message whose lines and pendings are as it left them", () => {
    const created = pendingOf(1, 0);
    const changes = [changeOf({ kind: "quantity_changed", before: snapshotOf(gorra(2), 1), after: snapshotOf(gorra(3), 1) })];
    expect(check({ order: orderOf([polo(), gorra(3)]), changes, before: [], after: [created], pendings: [created] })).toEqual({ kind: "available" });
  });

  test("refuses undo with later_change when the seller edited a line the message touched", () => {
    const changes = [changeOf({ kind: "quantity_changed", before: snapshotOf(gorra(2), 1), after: snapshotOf(gorra(3), 1) })];
    expect(check({ order: orderOf([polo(), gorra(5)]), changes })).toEqual({ kind: "refused", reason: "later_change" });
  });

  test("refuses undo with later_change when a later message set the added item to a new quantity", () => {
    const first = changeOf({ kind: "added", before: null, after: snapshotOf(gorra(2), 1), seq: 1 as ChangeSeq });
    const second = changeOf({ kind: "quantity_changed", before: snapshotOf(gorra(2), 1), after: snapshotOf(gorra(3), 1), messageId: messageB, seq: 2 as ChangeSeq });
    expect(check({ order: orderOf([polo(), gorra(3)]), changes: [{ ...first, supersededBy: second.id }], later: [second] })).toEqual({ kind: "refused", reason: "later_change" });
  });

  test("refuses undo with later_change when a removed variant is back in the order", () => {
    expect(check({ order: orderOf([polo(1), gorra()]), changes: [removedPolo()] })).toEqual({ kind: "refused", reason: "later_change" });
  });

  test("refuses undo with later_change when a later message changed a pending the message touched", () => {
    const created = pendingOf(1, 0);
    const changes = [changeOf({ kind: "added", before: null, after: snapshotOf(gorra(2), 1) })];
    const later = { ...created, quantity: 4 as PositiveInteger, lastChangedAt: minutes(10) };
    expect(check({ order: orderOf([polo(), gorra(2)]), changes, before: [], after: [created], pendings: [later] })).toEqual({ kind: "refused", reason: "later_change" });
  });

  test("refuses undo with later_change when a pending the message ended exists again", () => {
    const ended = pendingOf(1, 0);
    const changes = [changeOf({ kind: "added", before: null, after: snapshotOf(gorra(2), 1) })];
    expect(check({ order: orderOf([polo(), gorra(2)]), changes, before: [ended], after: [], pendings: [ended] })).toEqual({ kind: "refused", reason: "later_change" });
  });

  test("allows undo when a review only acknowledged a pending the message touched", () => {
    const created = pendingOf(1, 0, { doubt: { reason: { kind: "caption_unread" } } });
    const changes = [changeOf({ kind: "added", before: null, after: snapshotOf(gorra(2), 1) })];
    const acknowledged = { ...created, acknowledgedAt: minutes(30) };
    expect(check({ order: orderOf([polo(), gorra(2)]), changes, before: [], after: [created], pendings: [acknowledged] })).toEqual({ kind: "available" });
  });

  test("refuses undo with would_empty when the message created the only item", () => {
    const changes = [changeOf({ kind: "added", before: null, after: snapshotOf(polo(2), 0) })];
    expect(check({ order: orderOf([polo(2)]), changes })).toEqual({ kind: "refused", reason: "would_empty" });
  });

  test("refuses undo with not_sold when a removed variant was deactivated", () => {
    expect(check({ order: orderOf([gorra()]), changes: [removedPolo()], sellableItems: [] })).toEqual({ kind: "refused", reason: "not_sold", variantId: variantOf(3) });
  });

  test("offers undo of a removal when the variant is still sold, whatever its catalog price", () => {
    expect(check({ order: orderOf([gorra()]), changes: [removedPolo()], sellableItems: [{ ...polo(), unitPrice: money(39) }] })).toEqual({ kind: "available" });
  });

  test("refuses undo with order_moved_on once the order has a reported payment", () => {
    const payment = { id: id(60) as PaymentId, orderId, amount: money(10), status: "reported", method: "digital_wallet", deductStockIfPartial: false, data: {} } as never;
    expect(check({ order: orderOf([polo(), gorra()], { payments: [payment] }), changes: [changeOf({ kind: "quantity_changed", before: snapshotOf(gorra(1), 1), after: snapshotOf(gorra(2), 1) })] }))
      .toEqual({ kind: "refused", reason: "order_moved_on" });
  });

  test("plans undo restoring a removed line at its copied price and position", () => {
    const order = orderOf([gorra(2), camisa()]);
    const plan = planOf({ order, message: message([removedPolo()]), pendings: [], ...limits, now: minutes(60), newItemId: () => id(900) as OrderItemId });
    expect(plan.order.items.map((item) => [item.productName, item.quantity, item.unitPrice.amount])).toEqual([["Polo básico", 2, 35], ["Gorra trucker", 2, 20], ["Camisa", 1, 50]]);
    expect(plan.order.items[0]).toMatchObject({ id: id(3), subtotal: money(70), stockDeductedQuantity: 0 });
    expect(plan.order.total).toEqual(money(70 + 40 + 50));
    expect(plan.changes).toMatchObject({ added: [{ id: id(3) }], updated: [], removedItemIds: [] });
  });

  test("plans undo of an added line and of a quantity change", () => {
    const changes = [changeOf({ kind: "added", before: null, after: snapshotOf(gorra(2), 1), position: 0 }),
      changeOf({ kind: "quantity_changed", before: snapshotOf(polo(1), 0), after: snapshotOf(polo(3), 0), position: 1, seq: 2 as ChangeSeq })];
    const plan = planOf({ order: orderOf([polo(3), gorra(2)]), message: message(changes), pendings: [], ...limits, now: minutes(60), newItemId: () => id(900) as OrderItemId });
    expect(plan.order.items.map((item) => [item.productName, item.quantity])).toEqual([["Polo básico", 1]]);
    expect(plan.changes).toMatchObject({ added: [], updated: [{ id: id(3), quantity: 1 }], removedItemIds: [id(4)] });
  });

  test("plans undo leaving untouched a pending a later message created", () => {
    const [touched, later] = [pendingOf(1, 0), pendingOf(2, 5)];
    const changes = [changeOf({ kind: "added", before: null, after: snapshotOf(gorra(2), 1) })];
    const plan = planOf({ order: orderOf([polo(), gorra(2)]), message: message(changes, [], [touched]), pendings: [touched, later], ...limits, now: minutes(60), newItemId: () => id(900) as OrderItemId });
    expect(plan.pendings.map(({ id: pendingId }) => pendingId)).toEqual([later.id]);
    expect(plan.pendingsEnded).toBe(0);
  });

  test("plans undo restoring a completed pending with its earlier last change and ending the least recently changed one past the limit", () => {
    const others = Array.from({ length: maxChatPendings }, (_, n) => pendingOf(10 + n, 20 + n));
    const completed = pendingOf(1, 3, { quantity: 2 as PositiveInteger });
    const changes = [changeOf({ kind: "added", before: null, after: snapshotOf(gorra(2), 1) })];
    const plan = planOf({ order: orderOf([polo(), gorra(2)]), message: message(changes, [completed], []), pendings: others, ...limits, now: minutes(60), newItemId: () => id(900) as OrderItemId });
    expect(plan.pendings).toHaveLength(maxChatPendings);
    expect(plan.pendings.find((pending) => pending.id === completed.id)).toEqual(completed);
    expect(plan.pendings.map(({ id: pendingId }) => pendingId)).not.toContain(others[0]!.id);
    expect(plan).toMatchObject({ pendingsRestored: 1, pendingsEnded: 1 });
  });

  test("drops a restored orderless pending whose life ended", () => {
    const old = pendingOf(1, -48 * 60);
    const changes = [changeOf({ kind: "added", before: null, after: snapshotOf(gorra(2), 1) })];
    const plan = planOf({ order: orderOf([polo(), gorra(2)]), message: message(changes, [old], []), pendings: [], ...limits, now: minutes(60), newItemId: () => id(900) as OrderItemId });
    expect(plan.pendings).toEqual([]);
    expect(plan.pendingsRestored).toBe(0);
  });
});

describe("nextVerdict", () => {
  test("keeps the first verdict except undone while the order is open", () => {
    expect(nextVerdict(null, "kept", true)).toBe("kept");
    expect(nextVerdict("kept", "removed", true)).toBeNull();
    expect(nextVerdict("quantity_changed", "undone", true)).toBe("undone");
    expect(nextVerdict("removed", "undone", true)).toBe("undone");
    expect(nextVerdict("kept", "undone", false)).toBeNull();
    expect(nextVerdict("undone", "kept", true)).toBeNull();
  });
  test("treats not_reviewed as final", () => {
    expect(nextVerdict("not_reviewed", "undone", true)).toBeNull();
    expect(nextVerdict(null, "not_reviewed", false)).toBe("not_reviewed");
  });
});

describe("lineSnapshotSchema", () => {
  test("round-trips a snapshot through JSON and rejects an unknown field", () => {
    const snapshot: LineSnapshot = { ...snapshotOf({ ...polo(2), mentionedPrice: { amount: money(30), units: 2 } }, 1) };
    expect(lineSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(lineSnapshotSchema.safeParse({ ...JSON.parse(JSON.stringify(snapshot)), extra: 1 }).success).toBe(false);
  });
});
