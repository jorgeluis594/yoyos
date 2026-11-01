import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { RecentChatMessage, RecentChatMessagesQuery } from "@core/src/features/chats/composition";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import { loadReadingContext, type LoadReadingContextDependencies, type ReadingMessage } from "@core/src/features/orders/application/reader/load-reading-context";
import type { StoredChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";
import type { ChatPending, ChatPendingId } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order-target";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, ContactId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import { defaultReadingBudgets } from "@core/src/features/orders/domain/reader/budgets";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hour = 3_600_000;
const now = new Date("2026-10-30T12:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * hour);
const chatId = id(3) as ChatId;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const message = (over: Partial<ReadingMessage> = {}): ReadingMessage => ({ id: id(900) as ChatMessageId, companyId: id(1) as CompanyId, chatId, contactId: id(4) as ContactId,
  direction: "incoming", uploadedByUserId: "uploader" as UserId, imageId: null, text: "quiero dos", caption: null, sentAt: ago(1), receivedAt: ago(0.9), ...over });
const recent = (n: number, over: Partial<RecentChatMessage> = {}): RecentChatMessage => ({ id: id(100 + n) as ChatMessageId, direction: n % 2 ? "incoming" : "outgoing", type: "text",
  text: `mensaje ${n}`, caption: null, sentAt: ago(40 - n), imageId: null, ...over });
const noTarget: ChatOrderTarget = { kind: "none" };
const noPendings = { pendings: [], readyRemembered: false };

function fakes(over: Partial<LoadReadingContextDependencies> & { messages?: readonly RecentChatMessage[]; masks?: Map<ChatMessageId, string>; outcomes?: Map<string, StoredChatMessageOutcome> } = {}) {
  const calls = { recent: [] as RecentChatMessagesQuery[], masks: [] as (readonly ChatMessageId[])[], outcomes: [] as ChatMessageId[], openedSince: [] as Date[] };
  const deps: LoadReadingContextDependencies = {
    findRecentChatMessages: async (query) => { calls.recent.push(query); return ok(over.messages ?? []); },
    findMaskedTexts: async (ids) => { calls.masks.push(ids); return ok(over.masks ?? new Map()); },
    findShopCurrency: async () => ok("PEN" as const),
    findProductsForReading: async () => ok([]),
    findOutcome: async (messageId) => { calls.outcomes.push(messageId); return ok(over.outcomes?.get(messageId) ?? null); },
    findChatOrdersOpenedSince: async (_chat, since) => { calls.openedSince.push(since); return ok([]); },
    clock: () => now, pendingTtlMs: 7 * 24 * hour, budgets: defaultReadingBudgets, ...over,
  };
  return { deps, calls };
}

const orderWith = (count: number): OrderAggregate => ({ id: id(9) as OrderId, companyId: id(1) as CompanyId, sellerId: "uploader" as UserId, chatId, number: 7 as OrderNumber,
  items: Array.from({ length: count }, (_, index) => ({ id: id(200 + index) as OrderItemId, variantId: id(300 + index) as VariantId, productName: `Polo ${index + 1}`,
    variantAttributes: { Talla: "M" }, sku: null, quantity: 2 as PositiveInteger, unitPrice: money(35), subtotal: money(70), mentionedPrice: null, stockDeductedQuantity: 0 })),
  payments: [], delivery: null, createdAt: ago(5), checkoutConfirmedAt: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelledAt: null, cancelled: false } as unknown as OrderAggregate);

describe("loadReadingContext", () => {
  test("puts the currency of the shop's prices in the input, and leaves it out when the company has none on record", async () => {
    const known = await loadReadingContext(fakes().deps, message(), noTarget, noPendings, null);
    expect(known.success && known.data.input.currency).toBe("PEN");
    const unknown = await loadReadingContext(fakes({ findShopCurrency: async () => ok(null) }).deps, message(), noTarget, noPendings, null);
    expect(unknown.success && "currency" in unknown.data.input).toBe(false);
  });

  test("asks for the messages before the anchor, anchored at sentAt or at receivedAt when it is missing", async () => {
    const withSent = fakes();
    await loadReadingContext(withSent.deps, message(), noTarget, noPendings, null);
    expect(withSent.calls.recent).toEqual([{ chatId, anchor: ago(1), messageId: id(900), limit: 12, windowHours: 48 }]);
    const withoutSent = fakes();
    await loadReadingContext(withoutSent.deps, message({ sentAt: null }), noTarget, noPendings, null);
    expect(withoutSent.calls.recent[0]).toMatchObject({ anchor: ago(0.9) });
  });

  test("gives the context messages oldest first with short refs, both directions and each text cut to its cap", async () => {
    const long = "a".repeat(800);
    const { deps } = fakes({ messages: [recent(3, { text: long }), recent(2), recent(1, { type: "image", text: null, caption: "polo rojo", imageId: id(5) })] });
    const loaded = await loadReadingContext(deps, message(), noTarget, noPendings, null);
    expect(loaded.success).toBe(true);
    if (!loaded.success) return;
    const { context } = loaded.data.input;
    expect(context.map(({ ref, direction, kind }) => [ref, direction, kind])).toEqual([["M1", "incoming", "image"], ["M2", "outgoing", "text"], ["M3", "incoming", "text"]]);
    expect(context.map(({ text }) => text)).toEqual(["polo rojo", "mensaje 2", "a".repeat(500)]);
    expect(loaded.data.contextMessageIds.get(context[0]!.ref)).toBe(id(101));
  });

  test("reads the masks of the context messages once and marks the messages that have one", async () => {
    const { deps, calls } = fakes({ messages: [recent(2), recent(1)], masks: new Map([[id(101) as ChatMessageId, "mi número 987******21"]]) });
    const loaded = await loadReadingContext(deps, message(), noTarget, noPendings, null);
    expect(calls.masks).toEqual([[id(101), id(102)]]);
    if (!loaded.success) throw new Error("expected context");
    expect(loaded.data.input.context.map(({ masked }) => masked)).toEqual([true, false]);
    expect(loaded.data.masks).toEqual(new Map([[id(101), "mi número 987******21"]]));
  });

  test("reads the outcome of the latest incoming photo of the window and no other", async () => {
    const outcome: StoredChatMessageOutcome = { outcomes: [{ kind: "no_intent" }], noticeSentAt: null };
    const photos = [recent(5, { type: "image", text: null, imageId: id(6) }), recent(4, { type: "image", direction: "outgoing", text: null, imageId: id(7) }),
      recent(3, { type: "image", text: null, imageId: id(8) }), recent(2)];
    const { deps, calls } = fakes({ messages: photos, outcomes: new Map([[id(105), outcome]]) });
    const loaded = await loadReadingContext(deps, message(), noTarget, noPendings, null);
    expect(calls.outcomes).toEqual([id(105)]);
    expect(loaded.success && loaded.data.photoOutcome).toEqual({ ref: "M4", messageId: id(105), outcome });
  });

  test("makes no outcome read when the window holds no incoming photo", async () => {
    const { deps, calls } = fakes({ messages: [recent(1), recent(2, { type: "image", direction: "outgoing", text: null, imageId: id(7) })] });
    const loaded = await loadReadingContext(deps, message(), noTarget, noPendings, null);
    expect(calls.outcomes).toEqual([]);
    expect(loaded.success && loaded.data.photoOutcome).toBeNull();
  });

  test("lists the open order's lines and the alive pendings with short refs, and the photo memory", async () => {
    const order = orderWith(2);
    const target: ChatOrderTarget = { kind: "open", order, productIds: new Map(order.items.map((item, index) => [item.variantId, id(400 + index) as ProductId])) };
    const pending = (n: number, subject: ChatPending["subject"], doubt: ChatPending["doubt"] = null): ChatPending => ({ id: id(500 + n) as ChatPendingId, subject, known: { Talla: "M" },
      quantity: 3 as PositiveInteger, price: null, order: null, lastChangedAt: ago(2), sourceMessageId: id(2) as ChatMessageId, requestId: id(500 + n) as ChatPendingId, doubt, pointSince: ago(2), acknowledgedAt: null });
    const expired = { ...pending(3, { kind: "variant", productId: id(1) as ProductId }), lastChangedAt: ago(24 * 9) };
    const pendings = { pendings: [pending(1, { kind: "variant", productId: id(410) as ProductId }), pending(2, { kind: "product", candidates: [id(411), id(412)] as [ProductId, ProductId] },
      { reason: { kind: "quantity_set", quantity: 3 as PositiveInteger } }), expired], readyRemembered: false };
    const photoMemory = { left: { kind: "pending" as const, pendingId: id(501) as ChatPendingId } };
    const { deps, calls } = fakes();
    const loaded = await loadReadingContext(deps, message(), target, pendings, photoMemory);
    if (!loaded.success) throw new Error("expected context");
    expect(loaded.data.input.items.map(({ ref, itemId, productId, productName, quantity }) => [ref, itemId, productId, productName, quantity])).toEqual([
      ["I1", id(200), id(400), "Polo 1", 2], ["I2", id(201), id(401), "Polo 2", 2]]);
    expect(loaded.data.input.pendings.map(({ ref, pendingId, productIds, doubtful }) => [ref, pendingId, productIds, doubtful])).toEqual([
      ["Q1", id(501), [id(410)], false], ["Q2", id(502), [id(411), id(412)], true]]);
    // The catalog could not name them (the fake knows no product): the pendings carry no names and no open values.
    expect(loaded.data.input.pendings.every((listed) => !("productNames" in listed) && !("missing" in listed))).toBe(true);
    expect(loaded.data.life.ended).toEqual([{ id: id(503), reason: "expired" }]);
    expect(loaded.data.input.photoMemory).toEqual(photoMemory);
    expect(loaded.data.target).toBe(target);
    expect(calls.openedSince).toEqual([ago(24 * 9)]);
  });

  test("names each pending's products and lists the open attributes with the sellable values that fit what is known", async () => {
    const variant = (n: number, attributes: Record<string, string>) => ({ variantId: id(600 + n), productName: "Polera", variantAttributes: attributes, sku: null, unitPrice: money(50) });
    const capucha = { productId: id(410) as ProductId, name: "Polera con capucha", sellable: true,
      attributes: [{ name: "Talla", values: ["M", "L"] }, { name: "Color", values: ["Gris", "Negro"] }],
      variants: [variant(1, { Talla: "M", Color: "Gris" }), variant(2, { Talla: "M", Color: "Negro" }), variant(3, { Talla: "L", Color: "Negro" })] } as unknown as ProductForReading;
    const polo = { productId: id(411) as ProductId, name: "Polo", sellable: true, attributes: [], variants: [] } as unknown as ProductForReading;
    const requested: (readonly ProductId[])[] = [];
    const base = { price: null, order: null, lastChangedAt: ago(2), sourceMessageId: id(2) as ChatMessageId, doubt: null, pointSince: ago(2), acknowledgedAt: null, quantity: 1 as PositiveInteger };
    const pendings = { pendings: [
      { ...base, id: id(501) as ChatPendingId, requestId: id(501) as ChatPendingId, subject: { kind: "variant", productId: id(410) as ProductId }, known: { Talla: "M" } },
      { ...base, id: id(502) as ChatPendingId, requestId: id(502) as ChatPendingId, subject: { kind: "product", candidates: [id(410), id(411)] as [ProductId, ProductId] }, known: {} },
    ] as ChatPending[], readyRemembered: false };
    const { deps } = fakes({ findProductsForReading: async (ids) => { requested.push(ids); return ok([capucha, polo]); } });
    const loaded = await loadReadingContext(deps, message(), noTarget, pendings, null);
    if (!loaded.success) throw new Error("expected context");
    expect(requested).toEqual([[id(410), id(411)]]);
    expect(loaded.data.input.pendings[0]).toMatchObject({ productNames: ["Polera con capucha"], missing: [{ name: "Color", values: ["Gris", "Negro"] }] });
    expect(loaded.data.input.pendings[1]).toMatchObject({ productNames: ["Polera con capucha", "Polo"] });
    expect(loaded.data.input.pendings[1]).not.toHaveProperty("missing");
  });

  test("does not read the catalog when there are no pendings", async () => {
    let reads = 0;
    const { deps } = fakes({ findProductsForReading: async () => { reads += 1; return ok([]); } });
    await loadReadingContext(deps, message(), noTarget, noPendings, null);
    expect(reads).toBe(0);
  });

  test("lists at most the budgeted order lines", async () => {
    const order = orderWith(5);
    const target: ChatOrderTarget = { kind: "open", order, productIds: new Map() };
    const { deps } = fakes({ budgets: { ...defaultReadingBudgets, maxItems: 3 } });
    const loaded = await loadReadingContext(deps, message(), target, noPendings, null);
    expect(loaded.success && loaded.data.input.items.map(({ ref }) => ref)).toEqual(["I1", "I2", "I3"]);
  });

  test("describes the current message as text or photo and keeps the caption of a photo as its text", async () => {
    const { deps } = fakes();
    const text = await loadReadingContext(deps, message(), noTarget, noPendings, null);
    const photo = await loadReadingContext(deps, message({ imageId: id(5) as never, text: null, caption: "este" }), noTarget, noPendings, null);
    expect(text.success && text.data.input.current).toEqual({ messageId: id(900), kind: "text", text: "quiero dos" });
    expect(photo.success && photo.data.input.current).toEqual({ messageId: id(900), kind: "image", text: "este" });
  });

  test("drops the oldest context messages first and stays under the stage input budget", async () => {
    const messages = Array.from({ length: 12 }, (_, index) => recent(12 - index, { text: "x".repeat(500) }));
    const { deps } = fakes({ messages, budgets: { ...defaultReadingBudgets, stageInputMaxChars: 3500 } });
    const loaded = await loadReadingContext(deps, message(), noTarget, noPendings, null);
    if (!loaded.success) throw new Error("expected context");
    expect(loaded.data.cut.contextDropped).toBeGreaterThan(0);
    const kept = loaded.data.input.context.map(({ ref }) => ref);
    expect(kept.at(-1)).toBe("M12");
    expect(kept).toEqual(Array.from({ length: kept.length }, (_, index) => `M${12 - kept.length + 1 + index}`));
    expect([...loaded.data.contextMessageIds.keys()]).toEqual(kept);
  });

  test.each([
    ["messages", { findRecentChatMessages: async (): Promise<Result<readonly RecentChatMessage[], { code: "PERSISTENCE_UNAVAILABLE"; message: string }>> => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }) }],
    ["shop currency", { findShopCurrency: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" }), messages: [recent(1)] }],
    ["masks", { findMaskedTexts: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" }), messages: [recent(1)] }],
  ])("fails with the persistence error when the %s read fails", async (_name, over) => {
    const { deps } = fakes(over);
    expect(await loadReadingContext(deps, message(), noTarget, noPendings, null)).toEqual({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "down" } });
  });
});
