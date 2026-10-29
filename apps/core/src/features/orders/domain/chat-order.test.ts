import { describe, expect, test } from "vitest";
import { createChat, doubtfulPendingOf, pendingOf, reader, productId as scenarioProductId } from "@core/src/features/orders/domain/chat-reading-fixtures";
import { applyChatActions, needsNewChatOrder, type ChatOrderCatalogItem, type ChatOrderTarget, type ItemTarget, type NewChatOrderSeed, type ReportOutcome, type ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import { buildPendingOrder, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { ChatPendingId, ChatPendings } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, ContactId, MentionedPrice, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-10-22T12:00:00Z");
const limits = { maxItemQuantity: 99 as PositiveInteger };
const seed: NewChatOrderSeed = { number: 1024 as OrderNumber, companyId: id(2) as CompanyId, sellerId: "seller" as UserId, chatId: id(50) as ChatId, contactId: id(60) as ContactId, messageId: id(70) as ChatMessageId };
let counter = 200;
let pendingCounter = 300;
const ids = { newOrderId: () => id(900) as OrderId, newItemId: () => id(counter++) as OrderItemId, newPendingId: () => id(pendingCounter++) as ChatPendingId };
const noPendings: ChatPendings = { pendings: [], readyRemembered: false };

type Item = ChatOrderCatalogItem;
const poloM: Item = { variantId: id(11) as VariantId, productName: "Polo", variantAttributes: { Talla: "M" }, sku: null, unitPrice: money(35) };
const poloL: Item = { ...poloM, variantId: id(12) as VariantId, variantAttributes: { Talla: "L" } };
const gorra: Item = { variantId: id(13) as VariantId, productName: "Gorra", variantAttributes: {}, sku: null, unitPrice: money(25) };
const productOf = (variantId: VariantId) => ({ [poloM.variantId]: id(21), [poloL.variantId]: id(21), [gorra.variantId]: id(22) })[variantId] as ProductId;
const identification = (item: { variantId: VariantId }) => ({ method: "text" as const, productId: productOf(item.variantId), confidence: 0.9 });

const orderWith = (...lines: [Item, number][]): OrderAggregate => {
  const built = buildPendingOrder({ number: 1023 as OrderNumber, id: id(1) as OrderId, companyId: id(2) as CompanyId, sellerId: "seller" as UserId,
    customer: { kind: "general_public" }, createdAt: at,
    items: lines.map(([item, quantity], index) => ({ id: id(100 + index) as OrderItemId, ...item, quantity })) });
  if (!built.success) throw new Error(built.error.message);
  return { ...built.data, chatId: id(50) as ChatId };
};
const open = (...lines: [Item, number][]): ChatOrderTarget => ({ kind: "open", order: orderWith(...lines),
  productIds: new Map(lines.map(([item]) => [item.variantId, productOf(item.variantId)])) });
const closed: ChatOrderTarget = { kind: "closed", orderId: id(1) as OrderId, number: 1023 as OrderNumber };

const add = (item: Item, quantity = 1, mentionedPrice: MentionedPrice | null = null): ResolvedChatAction =>
  ({ kind: "add", item, quantity: quantity as PositiveInteger, mentionedPrice, identification: identification(item) });
const named = (item: Item): ItemTarget => ({ kind: "variant", variantId: item.variantId });
const unnamed: ItemTarget = { kind: "unnamed" };
const run = (target: ChatOrderTarget, ...actions: ResolvedChatAction[]) => {
  const result = applyChatActions(target, noPendings, actions, ids, at, limits, seed);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
};
const lines = (order: OrderAggregate | null | undefined) => order?.items.map((item) => [item.productName + (item.variantAttributes["Talla"] ? ` ${item.variantAttributes["Talla"]}` : ""), item.quantity]);
const finalOrder = (result: ReturnType<typeof run>) => result.createdOrder ?? (result.target.kind === "open" ? result.target.order : null);
const kinds = (result: ReturnType<typeof run>) => result.outcomes.map((outcome) => outcome.kind);

describe("applyChatActions", () => {
  test("adds a new item with the interpreted quantity and the current catalog price", () => {
    const result = run(open([gorra, 1]), add(poloM, 2));
    expect(lines(finalOrder(result))).toEqual([["Gorra", 1], ["Polo M", 2]]);
    expect(finalOrder(result)?.total).toEqual(money(95));
    expect(result.outcomes[0]).toMatchObject({ kind: "added", variantId: poloM.variantId, quantity: 2 });
    expect(result.changes.added.map((item) => item.variantId)).toEqual([poloM.variantId]);
  });

  test("grows the quantity when the variant is already in the open order", () => {
    const result = run(open([poloM, 2]), add(poloM, 3));
    expect(lines(finalOrder(result))).toEqual([["Polo M", 5]]);
    expect(result.changes.updated.map((item) => item.quantity)).toEqual([5]);
    expect(result.changes.added).toEqual([]);
  });

  test("keeps the item and reports quantity above limit when 98 units plus 2 would exceed 99", () => {
    const result = run(open([poloM, 98], [gorra, 1]), add(poloM, 2));
    expect(lines(finalOrder(result))).toEqual([["Polo M", 98], ["Gorra", 1]]);
    expect(result.outcomes).toEqual([{ kind: "quantity_above_limit", productId: id(21), identification: identification(poloM) }]);
    expect(result.changes).toEqual({ added: [], updated: [], removedItemIds: [] });
  });

  test("reports quantity above limit for a request of 1000 units", () => {
    const withOrder = run(open([gorra, 1]), add(poloM, 1000));
    expect(lines(finalOrder(withOrder))).toEqual([["Gorra", 1]]);
    expect(kinds(withOrder)).toEqual(["quantity_above_limit"]);
    const without = run({ kind: "none" }, add(poloM, 1000));
    expect(without.createdOrder).toBeNull();
    expect(kinds(without)).toEqual(["quantity_above_limit"]);
  });

  test("creates a new order and reports a new order after the latest order was paid", () => {
    const result = run(closed, add(gorra), add(poloM, 2));
    expect(result.createdOrder).toMatchObject({ id: id(900), number: 1024, companyId: id(2), sellerId: "seller", chatId: id(50), buyer: { contactId: id(60) } });
    expect(lines(result.createdOrder)).toEqual([["Gorra", 1], ["Polo M", 2]]);
    expect(kinds(result)).toEqual(["new_order_after_closed", "added", "added"]);
    expect(result.outcomes[0]).toEqual({ kind: "new_order_after_closed", orderId: id(900), previousOrderId: id(1) });
    expect(result.target).toMatchObject({ kind: "open", order: { id: id(900) } });
    expect(needsNewChatOrder(closed, noPendings, [add(gorra)], limits)).toBe(true);
  });

  test("creates a new order without a closed-order outcome after the latest order was cancelled", () => {
    for (const target of [{ kind: "cancelled" }, { kind: "none" }] as const) {
      const result = run(target, add(gorra));
      expect(kinds(result)).toEqual(["added"]);
      expect(lines(result.createdOrder)).toEqual([["Gorra", 1]]);
    }
    expect(needsNewChatOrder({ kind: "none" }, noPendings, [{ kind: "remove", target: unnamed, amount: "all" }], limits)).toBe(false);
    expect(needsNewChatOrder({ kind: "none" }, noPendings, [add(poloM, 1000)], limits)).toBe(false);
    expect(needsNewChatOrder(open([gorra, 1]), noPendings, [add(poloM)], limits)).toBe(false);
  });

  test("removes a named item and keeps the others", () => {
    const result = run(open([poloM, 2], [gorra, 1]), { kind: "remove", target: named(gorra), amount: "all" });
    expect(lines(finalOrder(result))).toEqual([["Polo M", 2]]);
    expect(finalOrder(result)?.total).toEqual(money(70));
    expect(result.outcomes).toEqual([{ kind: "removed", variantId: gorra.variantId, namedItem: true }]);
    expect(result.changes.removedItemIds).toEqual([id(101)]);
  });

  test("keeps the only item and reports only item kept when it is removed", () => {
    const result = run(open([gorra, 1]), { kind: "remove", target: unnamed, amount: "all" });
    expect(lines(finalOrder(result))).toEqual([["Gorra", 1]]);
    expect(result.outcomes).toEqual([{ kind: "only_item_kept", orderId: id(1) }]);
    expect(result.changes.removedItemIds).toEqual([]);
  });

  test("lowers the quantity by one for remove one and removes the item at quantity one", () => {
    const lowered = run(open([poloM, 2], [gorra, 1]), { kind: "remove", target: named(poloM), amount: "one" });
    expect(lines(finalOrder(lowered))).toEqual([["Polo M", 1], ["Gorra", 1]]);
    expect(lowered.outcomes).toEqual([{ kind: "quantity_lowered", variantId: poloM.variantId, namedItem: true }]);
    const removed = run(open([poloM, 1], [gorra, 1]), { kind: "remove", target: named(gorra), amount: "one" });
    expect(lines(finalOrder(removed))).toEqual([["Polo M", 1]]);
    expect(kinds(removed)).toEqual(["removed"]);
    expect(kinds(run(open([gorra, 1]), { kind: "remove", target: unnamed, amount: "one" }))).toEqual(["only_item_kept"]);
  });

  test("treats a quantity change to zero as a removal", () => {
    const result = run(open([poloM, 2], [gorra, 1]), { kind: "set_quantity", target: named(poloM), quantity: 0 });
    expect(lines(finalOrder(result))).toEqual([["Gorra", 1]]);
    expect(kinds(result)).toEqual(["removed"]);
    expect(kinds(run(open([gorra, 1]), { kind: "set_quantity", target: unnamed, quantity: 0 }))).toEqual(["only_item_kept"]);
  });

  test("sets the quantity of the only item and reports a quantity above the limit", () => {
    const changed = run(open([poloM, 2]), { kind: "set_quantity", target: unnamed, quantity: 3 });
    expect(lines(finalOrder(changed))).toEqual([["Polo M", 3]]);
    expect(changed.outcomes).toEqual([{ kind: "quantity_changed", variantId: poloM.variantId, quantity: 3, namedItem: false }]);
    const above = run(open([poloM, 2]), { kind: "set_quantity", target: unnamed, quantity: 100 });
    expect(lines(finalOrder(above))).toEqual([["Polo M", 2]]);
    expect(above.outcomes).toEqual([{ kind: "quantity_above_limit", productId: id(21), identification: null }]);
  });

  test("replaces the variant with the same quantity and merges into an existing variant", () => {
    const replaced = run(open([poloM, 2], [gorra, 1]), { kind: "change_variant", target: named(poloM), to: { kind: "resolved", item: poloL }, mentionedPrice: null });
    expect(lines(finalOrder(replaced))).toEqual([["Polo L", 2], ["Gorra", 1]]);
    expect(replaced.outcomes).toEqual([{ kind: "variant_changed", fromVariantId: poloM.variantId, toVariantId: poloL.variantId, namedItem: true }]);
    const merged = run(open([poloM, 2], [poloL, 1]), { kind: "change_variant", target: named(poloM), to: { kind: "resolved", item: poloL }, mentionedPrice: null });
    expect(lines(finalOrder(merged))).toEqual([["Polo L", 3]]);
    const above = run(open([poloM, 60], [poloL, 40]), { kind: "change_variant", target: named(poloM), to: { kind: "resolved", item: poloL }, mentionedPrice: null });
    expect(lines(finalOrder(above))).toEqual([["Polo M", 60], ["Polo L", 40]]);
    expect(kinds(above)).toEqual(["quantity_above_limit"]);
  });

  test("reports the unresolved variant of a change without touching the order", () => {
    const target = open([poloM, 2]);
    const missing = run(target, { kind: "change_variant", target: unnamed, to: { kind: "missing", productId: id(21) as ProductId }, mentionedPrice: null });
    expect(missing.outcomes).toEqual([{ kind: "variant_missing", productId: id(21), identification: null }]);
    const unavailable = run(target, { kind: "change_variant", target: unnamed, to: { kind: "not_available", productId: id(21) as ProductId }, mentionedPrice: null });
    expect(kinds(unavailable)).toEqual(["variant_not_available"]);
    expect(lines(finalOrder(unavailable))).toEqual([["Polo M", 2]]);
  });

  test("applies an unnamed reference only when the order has exactly one item", () => {
    const result = run(open([poloM, 2]), { kind: "remove", target: unnamed, amount: "one" });
    expect(lines(finalOrder(result))).toEqual([["Polo M", 1]]);
    expect(result.outcomes).toEqual([{ kind: "quantity_lowered", variantId: poloM.variantId, namedItem: false }]);
  });

  test("reports an unclear item when an unnamed reference meets two items", () => {
    const result = run(open([poloM, 2], [gorra, 1]), { kind: "set_quantity", target: unnamed, quantity: 3 });
    expect(result.outcomes).toEqual([{ kind: "unclear_item", orderId: id(1), namedItem: false, namedProductId: null }]);
    expect(lines(finalOrder(result))).toEqual([["Polo M", 2], ["Gorra", 1]]);
    const passed = run(open([poloM, 2]), { kind: "remove", target: { kind: "unclear", namedItem: true, namedProductId: id(22) as ProductId }, amount: "all" });
    expect(passed.outcomes).toEqual([{ kind: "unclear_item", orderId: id(1), namedItem: true, namedProductId: id(22) }]);
  });

  test("reports an unclear item when the targeted variant left the order before the lock", () => {
    const result = run(open([poloM, 2]), { kind: "remove", target: named(gorra), amount: "all" });
    expect(result.outcomes).toEqual([{ kind: "unclear_item", orderId: id(1), namedItem: true, namedProductId: null }]);
    expect(lines(finalOrder(result))).toEqual([["Polo M", 2]]);
  });

  test("reports order closed for a removal after checkout was confirmed", () => {
    const result = run(closed, { kind: "remove", target: named(poloM), amount: "all" });
    expect(result.outcomes).toEqual([{ kind: "order_closed", orderId: id(1) }]);
    expect(result.createdOrder).toBeNull();
    expect(kinds(run(closed, { kind: "set_quantity", target: unnamed, quantity: 2 }))).toEqual(["order_closed"]);
  });

  test("resolves item actions against the target before this message created an order, whatever the action order", () => {
    const removal: ResolvedChatAction = { kind: "remove", target: named(poloM), amount: "all" };
    for (const actions of [[add(gorra), removal], [removal, add(gorra)]]) {
      const result = run(closed, ...actions);
      expect(lines(result.createdOrder)).toEqual([["Gorra", 1]]);
      expect(kinds(result).sort()).toEqual(["added", "new_order_after_closed", "order_closed"]);
    }
  });

  test("degrades to an unclear item when the target does not know the product of an item", () => {
    const target = open([poloM, 60], [poloL, 40]);
    const unknown: ChatOrderTarget = target.kind === "open" ? { ...target, productIds: new Map() } : target;
    expect(run(unknown, { kind: "set_quantity", target: named(poloM), quantity: 100 }).outcomes)
      .toEqual([{ kind: "unclear_item", orderId: id(1), namedItem: true, namedProductId: null }]);
    expect(run(unknown, { kind: "change_variant", target: named(poloM), to: { kind: "resolved", item: poloL }, mentionedPrice: null }).outcomes)
      .toEqual([{ kind: "unclear_item", orderId: id(1), namedItem: true, namedProductId: null }]);
  });

  test("fills the order of an unclear item reported by a tool when the chat has an open order", () => {
    const outcome: ReportOutcome = { kind: "unclear_item", orderId: null, namedItem: true, namedProductId: null };
    expect(run(open([poloM, 1]), { kind: "report", outcome }).outcomes).toEqual([{ ...outcome, orderId: id(1) }]);
    expect(run(closed, { kind: "report", outcome }).outcomes).toEqual([outcome]);
  });

  test("reports no open order for a removal when the chat has no order", () => {
    for (const target of [{ kind: "none" }, { kind: "cancelled" }] as const)
      expect(run(target, { kind: "remove", target: { kind: "unclear", namedItem: true, namedProductId: null }, amount: "all" }).outcomes).toEqual([{ kind: "no_open_order" }]);
  });

  test("reports ready only when the open order has at least one item", () => {
    expect(run(open([gorra, 1]), { kind: "ready" }).outcomes).toEqual([{ kind: "ready", orderId: id(1) }]);
    expect(run(closed, { kind: "ready" }).outcomes).toEqual([{ kind: "no_intent" }]);
    expect(run({ kind: "none" }, { kind: "ready" }).outcomes).toEqual([{ kind: "no_intent" }]);
    expect(run({ kind: "cancelled" }, { kind: "ready" }).outcomes).toEqual([{ kind: "no_intent" }]);
  });

  test("keeps the mentioned price on a variant change only when the message states a price", () => {
    const price: MentionedPrice = { amount: money(30), units: 1 };
    const target = open([poloM, 1]);
    const priced = run(target, add(poloM, 1, price));
    expect(finalOrder(priced)?.items[0]?.mentionedPrice).toEqual(price);
    const withPrice = priced.target;
    const dropped = run(withPrice, { kind: "change_variant", target: named(poloM), to: { kind: "resolved", item: poloL }, mentionedPrice: null });
    expect(finalOrder(dropped)?.items[0]?.mentionedPrice).toBeNull();
    const stated = run(withPrice, { kind: "change_variant", target: named(poloM), to: { kind: "resolved", item: poloL }, mentionedPrice: { amount: money(50), units: 2 } });
    expect(finalOrder(stated)?.items[0]?.mentionedPrice).toEqual({ amount: money(50), units: 2 });
  });

  test("replaces the mentioned price of an item and leaves it when a later message states none", () => {
    const price: MentionedPrice = { amount: money(20), units: 1 };
    const set = run(open([gorra, 1]), { kind: "set_mentioned_price", target: unnamed, price });
    expect(set.outcomes).toEqual([{ kind: "mentioned_price_set", variantId: gorra.variantId }]);
    expect(finalOrder(set)?.items[0]?.mentionedPrice).toEqual(price);
    expect(finalOrder(set)?.total).toEqual(money(25));
    const grown = run(set.target, add(gorra, 1));
    expect(finalOrder(grown)?.items[0]).toMatchObject({ quantity: 2, mentionedPrice: price });
    const replaced = run(set.target, add(gorra, 1, { amount: money(50), units: 3 }));
    expect(finalOrder(replaced)?.items[0]?.mentionedPrice).toEqual({ amount: money(50), units: 3 });
    expect(kinds(run(set.target, { kind: "set_mentioned_price", target: unnamed, price: null }))).toEqual(["no_intent"]);
  });

  test("records the report of a report action in any target state", () => {
    const report: ResolvedChatAction = { kind: "report", outcome: { kind: "unnamed_add" } };
    for (const target of [open([gorra, 1]), closed, { kind: "none" } as const, { kind: "cancelled" } as const])
      expect(run(target, report).outcomes).toEqual([{ kind: "unnamed_add" }]);
  });

  test("applies the other actions of a message after a failed one", () => {
    const miss: ReportOutcome = { kind: "variant_missing", productId: id(22) as ProductId, identification: null };
    const result = run(open([poloM, 1]), add(poloL, 2), { kind: "report", outcome: miss });
    expect(lines(finalOrder(result))).toEqual([["Polo M", 1], ["Polo L", 2]]);
    expect(kinds(result)).toEqual(["added", "variant_missing"]);
  });

  test("never leaves an order without items", () => {
    const target = open([poloM, 1], [gorra, 1]);
    const result = run(target, { kind: "remove", target: named(poloM), amount: "all" }, { kind: "remove", target: named(gorra), amount: "all" },
      { kind: "set_quantity", target: unnamed, quantity: 0 });
    expect(finalOrder(result)?.items.length).toBe(1);
    expect(kinds(result)).toEqual(["removed", "only_item_kept", "only_item_kept"]);
  });

  test("rejects an empty list of actions and an invalid new order seed", () => {
    expect(applyChatActions(open([gorra, 1]), noPendings, [], ids, at, limits, seed)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
    expect(applyChatActions({ kind: "none" }, noPendings, [add(gorra)], ids, at, limits, { ...seed, number: 0 as OrderNumber })).toMatchObject({ success: false });
  });
});

describe("applyChatActions with chat pendings", () => {
  const { add, complete, say } = reader;
  const ref = (n: number): string => `I${n}`;
  const withPolo = () => createChat({ items: [["polo", { Talla: "M", Color: "Negro" }, 2]] });

  test("increases the item quantity by the stated units for «uno más» and sets it for «que sean»", () => {
    const chat = withPolo();
    chat.say(say({ kind: "change_quantity", item: { kind: "ref", ref: ref(1) }, mode: "increase", quantity: 1 }));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×3"]);
    chat.say(say({ kind: "change_quantity", item: { kind: "unnamed" }, mode: "set", quantity: 5 }));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×5"]);
  });

  test("reports quantity above limit when «uno más» would pass 99", () => {
    const chat = createChat({ items: [["polo", { Talla: "M", Color: "Negro" }, 99]] });
    expect(chat.say(say({ kind: "change_quantity", item: { kind: "unnamed" }, mode: "increase", quantity: 1 })).kinds).toEqual(["quantity_above_limit"]);
  });

  test("creates the chat order when a pending completes without an open order", () => {
    const pendings = { pendings: [pendingOf("polo")], readyRemembered: false };
    const chat = createChat({ pendings: pendings.pendings });
    const actions = chat.say(say(complete(1, { Talla: "M", Color: "Negro" }))).actions;
    expect(chat.order).not.toBeNull();
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1"]);
    expect(needsNewChatOrder({ kind: "none" }, pendings, actions, limits)).toBe(true);
    expect(needsNewChatOrder({ kind: "none" }, pendings, [{ kind: "decline_pending", pendingId: pendings.pendings[0]!.id }], limits)).toBe(false);
  });

  test("adds a completed pending to the chat's open order", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [pendingOf("polo")] });
    chat.say(say(complete(1, { Talla: "M", Color: "Negro" })));
    expect(chat.items()).toEqual(["Gorra trucker · Negro · ×1", "Polo básico · M · Negro · ×1"]);
  });

  test("remembers ready when ready leaves a pending and reports ready with pendings", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [pendingOf("polo"), doubtfulPendingOf(["gorra", "polera"], 2)] });
    const said = chat.say(say(reader.ready));
    expect(said.outcomes).toEqual([{ kind: "ready_with_pendings", orderId: chat.order?.id, productIds: [scenarioProductId("polo")], unnamed: 1 }]);
    expect(chat.pendings.readyRemembered).toBe(true);
  });

  test("reports ready when a later message completes the last pending after a remembered ready", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [pendingOf("polo")], readyRemembered: true });
    expect(chat.say(say(complete(1, { Talla: "M", Color: "Negro" }))).kinds).toEqual(["pending_completed", "added", "ready"]);
    expect(chat.pendings.readyRemembered).toBe(false);
  });

  test("reports ready for «quita la gorra y listo»", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1], ["polo", { Talla: "M", Color: "Negro" }, 1]] });
    expect(chat.say(say({ kind: "remove", item: { kind: "ref", ref: ref(1) }, amount: "all" }, reader.ready)).kinds).toEqual(["removed", "ready"]);
  });

  test("reports variant missing and remembers ready for a photo captioned «eso nomás, listo» whose product has variants", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]] });
    const photo = { shown: [["polo"]] } as const;
    expect(chat.say(say(add({ product: "polo" }), reader.ready), photo).kinds).toEqual(["pending_created", "variant_missing", "ready_with_pendings"]);
    expect(chat.pendings.readyRemembered).toBe(true);
    expect(chat.say(say(complete(1, { Talla: "M", Color: "Negro" }))).kinds).toEqual(["pending_completed", "added", "ready"]);
  });

  test("reports ready when the buyer declines the last pending with items left after a remembered ready", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [pendingOf("polo")], readyRemembered: true });
    expect(chat.say(say(reader.decline(1))).kinds).toEqual(["pending_ended", "ready"]);
  });

  test("sends nothing when the buyer declines the last pending with no items after a remembered ready", () => {
    const chat = createChat({ pendings: [pendingOf("polo")], readyRemembered: true });
    expect(chat.say(say(reader.decline(1))).kinds).toEqual(["pending_ended"]);
    expect(chat.pendings).toEqual({ pendings: [], readyRemembered: false });
  });

  test("drops the remembered ready when a later message adds a new item", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [pendingOf("polo")], readyRemembered: true });
    expect(chat.say(say(add({ product: "gorra", attributes: { Color: "Rojo" } }))).kinds).toEqual(["added"]);
    expect(chat.pendings.readyRemembered).toBe(false);
    expect(chat.say(say(complete(1, { Talla: "M", Color: "Negro" }))).kinds).toEqual(["pending_completed", "added"]);
  });

  test("keeps the remembered ready when a later message completes a pending that is not the last", () => {
    const chat = createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [pendingOf("polo", { n: 1 }), pendingOf("polera", { n: 2 })], readyRemembered: true });
    expect(chat.say(say(complete(1, { Talla: "M", Color: "Negro" }))).kinds).toEqual(["pending_completed", "added"]);
    expect(chat.pendings.readyRemembered).toBe(true);
  });

  test("reports no intent for ready with no items and no pending", () => {
    expect(createChat().say(say(reader.ready)).kinds).toEqual(["no_intent"]);
  });

  test("applies the passing actions of a message when one fails a check", () => {
    const chat = createChat();
    const said = chat.say(say(add({ product: "gorra", attributes: { Color: "Rojo" } }), { kind: "remove", item: { kind: "ref", ref: "I9" }, amount: "all" }));
    expect(said.kinds).toEqual(["added", "no_open_order"]);
    expect(chat.items()).toEqual(["Gorra trucker · Rojo · ×1"]);
  });

  test("resolves item actions against the order as it was before the message", () => {
    const chat = createChat();
    chat.say(say(add({ product: "gorra", attributes: { Color: "Rojo" } }), { kind: "remove", item: { kind: "unnamed" }, amount: "all" }));
    expect(chat.items()).toEqual(["Gorra trucker · Rojo · ×1"]);
  });
});
