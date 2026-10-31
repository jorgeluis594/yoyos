import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { SellableVariant } from "@core/src/features/orders/domain/catalog-order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { ChatPending, ChatPendingId, ChatPendings } from "@core/src/features/orders/domain/chat-pendings";
import type { ChangeSeq, OrderItemChange, OrderItemChangeId } from "@core/src/features/orders/domain/message-changes";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, OrderId, OrderItem, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import { undoMessageChanges, type UndoMessageChangesDependencies } from "@core/src/features/orders/application/undo-message-changes";
import type { StoredMessageChanges } from "@core/src/features/orders/infrastructure/message-change-repository";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-10-31T12:00:00Z");
const access = { companyId: id(2) as CompanyId, userId: "seller" as UserId };
const chatId = id(9) as ChatId;
const messageId = id(201) as ChatMessageId;
const item = (n: number, name: string, quantity: number, unit: number): OrderItem => ({ id: id(n) as OrderItemId, variantId: id(n + 100) as VariantId, productName: name, variantAttributes: {},
  sku: null, quantity: quantity as PositiveInteger, unitPrice: money(unit), subtotal: money(unit * quantity), mentionedPrice: null, stockDeductedQuantity: 0 });
const orderOf = (items: readonly OrderItem[], overrides: Partial<OrderAggregate> = {}): OrderAggregate => {
  const total = items.reduce((sum, entry) => sum + entry.subtotal.amount, 0);
  return { number: 1042 as OrderNumber, id: id(1) as OrderId, companyId: access.companyId, sellerId: "seller" as UserId, fromCatalog: false, chatId, buyer: null, checkoutEnabledAt: null,
    checkoutConfirmedAt: null, createdAt: at, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelled: false, cancelledAt: null, items: items as never,
    payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false, stockDeductedAt: null, itemsTotal: money(total), deliveryCost: money(0), deliveryCharge: money(0),
    total: money(total), ...overrides } as OrderAggregate;
};
const snapshotOf = (entry: OrderItem, position: number) => ({ itemId: entry.id, variantId: entry.variantId, productName: entry.productName, variantAttributes: entry.variantAttributes, sku: entry.sku,
  quantity: entry.quantity, unitPrice: entry.unitPrice, mentionedPrice: null, position });
const change = (overrides: Partial<OrderItemChange> & Pick<OrderItemChange, "kind" | "before" | "after">): OrderItemChange => ({ id: id(900) as OrderItemChangeId, orderId: id(1) as OrderId, messageId,
  position: 0, seq: 1 as ChangeSeq, decision: { kind: "applied" }, quoteId: null, supersededBy: null, reviewId: null, verdict: null, createdAt: at, ...overrides });
const pendingOf = (n: number, minutes: number): ChatPending => ({ id: id(300 + n) as ChatPendingId, subject: { kind: "variant", productId: id(400 + n) as ProductId }, known: {}, quantity: 1 as PositiveInteger,
  price: null, order: null, lastChangedAt: new Date(at.getTime() + minutes * 60_000), sourceMessageId: id(500 + n) as ChatMessageId, requestId: id(300 + n) as ChatPendingId, doubt: null,
  pointSince: new Date(at.getTime() + minutes * 60_000), acknowledgedAt: null });

type World = { order: OrderAggregate | null; stored: StoredMessageChanges | null; pendings: ChatPendings; sellable: readonly SellableVariant[] };
function dependencies(world: World, overrides: Partial<UndoMessageChangesDependencies> = {}) {
  const writes: string[] = [];
  const saveItemChanges = vi.fn<UndoMessageChangesDependencies["saveItemChanges"]>(async () => { writes.push("items"); return ok(null); });
  const saveChatPendings = vi.fn<UndoMessageChangesDependencies["saveChatPendings"]>(async () => { writes.push("pendings"); return ok(null); });
  const markMessageUndone = vi.fn<UndoMessageChangesDependencies["markMessageUndone"]>(async () => { writes.push("undone"); return ok(null); });
  const setUndoneVerdicts = vi.fn<UndoMessageChangesDependencies["setUndoneVerdicts"]>(async () => { writes.push("verdicts"); return ok(null); });
  const saveSellerActedAt = vi.fn<UndoMessageChangesDependencies["saveSellerActedAt"]>(async () => { writes.push("acted"); return ok(null); });
  const deps: UndoMessageChangesDependencies = { transaction: async (_company, work) => work(), findOrderForUpdate: async () => ok(world.order),
    findChatPendingsForUpdate: async () => ok(world.pendings), findMessageChanges: async () => ok(world.stored), findLaterChanges: async () => ok([]),
    findSellableVariants: async () => ok(world.sellable), saveItemChanges, saveChatPendings, markMessageUndone, setUndoneVerdicts, saveSellerActedAt,
    clock: () => at, newItemId: () => id(990) as OrderItemId, pendingTtlMs: 7 * 86_400_000, ...overrides };
  return { deps, writes, saveItemChanges, saveChatPendings, markMessageUndone, setUndoneVerdicts, saveSellerActedAt };
}
const input = { orderId: id(1) as OrderId, messageId };
const stored = (changes: readonly OrderItemChange[], rest: Partial<StoredMessageChanges> = {}): StoredMessageChanges =>
  ({ messageId, at, undoneAt: null, changes, pendingsBefore: [], pendingsAfter: [], ...rest });
const sellable = (entry: OrderItem): SellableVariant => ({ variantId: entry.variantId, productName: entry.productName, variantAttributes: {}, sku: null, unitPrice: money(39), available: 9 });

test("restores a removed line at its copied price and position, marks the message undone and gives the undone verdict in one transaction", async () => {
  const polo = item(3, "Polo básico", 2, 35);
  const world: World = { order: orderOf([item(4, "Gorra", 1, 20)]), stored: stored([change({ kind: "removed", before: snapshotOf(polo, 0), after: null })]), pendings: { pendings: [], readyRemembered: false }, sellable: [sellable(polo)] };
  const { deps, writes, saveItemChanges, markMessageUndone, setUndoneVerdicts, saveSellerActedAt } = dependencies(world);
  const result = await undoMessageChanges(input, access, deps);
  expect(result).toMatchObject({ success: true, data: { undone: true, order: { items: [{ productName: "Polo básico", unitPrice: money(35), quantity: 2 }, { productName: "Gorra" }], total: money(90) } } });
  expect(writes).toEqual(["items", "undone", "verdicts", "acted"]);
  expect(saveItemChanges.mock.calls[0]?.[1]).toMatchObject({ added: [{ id: id(3) }] });
  expect(markMessageUndone).toHaveBeenCalledWith(input.orderId, messageId, "seller", at);
  expect(setUndoneVerdicts).toHaveBeenCalledWith(input.orderId, messageId, at);
  expect(saveSellerActedAt).toHaveBeenCalledWith(input.orderId, access.companyId, at);
});

test("restores the pendings the message touched and saves only when they differ", async () => {
  const completed = pendingOf(1, -5);
  const gorra = item(4, "Gorra", 2, 20);
  const world: World = { order: orderOf([item(3, "Polo", 1, 35), gorra]), pendings: { pendings: [], readyRemembered: true },
    stored: stored([change({ kind: "added", before: null, after: snapshotOf(gorra, 1) })], { pendingsBefore: [completed] }), sellable: [] };
  const { deps, saveChatPendings } = dependencies(world);
  expect(await undoMessageChanges(input, access, deps)).toMatchObject({ success: true, data: { pendingsRestored: 1, pendingsEnded: 0 } });
  expect(saveChatPendings).toHaveBeenCalledWith(chatId, { pendings: [completed], readyRemembered: true });
});

test("answers success without writing when the message was already undone", async () => {
  const gorra = item(4, "Gorra", 2, 20);
  const world: World = { order: orderOf([item(3, "Polo", 1, 35)]), stored: stored([change({ kind: "added", before: null, after: snapshotOf(gorra, 1) })], { undoneAt: at }),
    pendings: { pendings: [], readyRemembered: false }, sellable: [] };
  const { deps, writes } = dependencies(world);
  expect(await undoMessageChanges(input, access, deps)).toMatchObject({ success: true, data: { undone: false, order: { id: id(1) } } });
  expect(writes).toEqual([]);
});

test("undo writes nothing when refused", async () => {
  const gorra = item(4, "Gorra", 2, 20);
  const world: World = { order: orderOf([item(3, "Polo", 1, 35), item(4, "Gorra", 3, 20)]), stored: stored([change({ kind: "added", before: null, after: snapshotOf(gorra, 1) })]),
    pendings: { pendings: [], readyRemembered: false }, sellable: [] };
  const { deps, writes } = dependencies(world);
  expect(await undoMessageChanges(input, access, deps)).toEqual(err({ code: "UNDO_REFUSED", message: "The message cannot be undone", reason: "later_change" }));
  expect(writes).toEqual([]);
});

test("names the variant that is no longer sold", async () => {
  const polo = item(3, "Polo", 2, 35);
  const world: World = { order: orderOf([item(4, "Gorra", 1, 20)]), stored: stored([change({ kind: "removed", before: snapshotOf(polo, 0), after: null })]), pendings: { pendings: [], readyRemembered: false }, sellable: [] };
  expect(await undoMessageChanges(input, access, dependencies(world).deps)).toMatchObject({ success: false, error: { code: "UNDO_REFUSED", reason: "not_sold", variantId: polo.variantId } });
});

test("answers not found for a missing order, an order without chat and a message without changes", async () => {
  const empty: World = { order: null, stored: null, pendings: { pendings: [], readyRemembered: false }, sellable: [] };
  expect(await undoMessageChanges(input, access, dependencies(empty).deps)).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
  expect(await undoMessageChanges(input, access, dependencies({ ...empty, order: orderOf([item(3, "Polo", 1, 35)], { chatId: null }) }).deps)).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
  expect(await undoMessageChanges(input, access, dependencies({ ...empty, order: orderOf([item(3, "Polo", 1, 35)]) }).deps)).toMatchObject({ success: false, error: { code: "MESSAGE_CHANGES_NOT_FOUND" } });
});

test("fails the transaction when a write fails", async () => {
  const polo = item(3, "Polo", 2, 35);
  const world: World = { order: orderOf([item(4, "Gorra", 1, 20)]), stored: stored([change({ kind: "removed", before: snapshotOf(polo, 0), after: null })]), pendings: { pendings: [], readyRemembered: false }, sellable: [sellable(polo)] };
  const { deps, setUndoneVerdicts } = dependencies(world, { markMessageUndone: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }) });
  expect(await undoMessageChanges(input, access, deps)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
  expect(setUndoneVerdicts).not.toHaveBeenCalled();
});
