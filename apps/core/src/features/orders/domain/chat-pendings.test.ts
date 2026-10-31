import { describe, expect, test } from "vitest";
import { fixedShownAnswer } from "@core/src/features/orders/domain/chat-reading";
import { createChat, doubtfulPendingOf, pendingOf, productId as productIdOf, reader, t0 as scenarioStart } from "@core/src/features/orders/domain/chat-reading-fixtures";
import { chatPendingsSchema, pendingLife, type ChatPending, type ChatPendingId } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order-target";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { ConfirmedPayment, ReportedPayment, VoidedPayment } from "@core/src/features/orders/domain/payment";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CompanyId, OrderId, OrderItemId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const variantPending = {
  id: id(1), subject: { kind: "variant", productId: id(2) }, known: { Talla: "M" }, quantity: 2,
  price: { amount: { amount: 70, currency: "PEN" }, per: "lot", forQuantity: 2 },
  order: null, lastChangedAt: "2026-10-28T12:00:00.000Z", sourceMessageId: id(3), requestId: id(1),
};

describe("chatPendingsSchema", () => {
  test("parses stored pendings and rejects an unknown subject kind as invalid stored data", () => {
    const parsed = chatPendingsSchema.parse({ pendings: [variantPending], readyRemembered: true, lastIncomingPhoto: null });
    expect(parsed.readyRemembered).toBe(true);
    expect(parsed.pendings[0]).toMatchObject({ lastChangedAt: new Date("2026-10-28T12:00:00.000Z"), order: null, known: { Talla: "M" } });
    expect(chatPendingsSchema.safeParse({ pendings: [{ ...variantPending, subject: { kind: "other", productId: id(2) } }], readyRemembered: false, lastIncomingPhoto: null }).success).toBe(false);
  });

  test("parses a doubtful-product pending attached to an order", () => {
    const doubtful = { ...variantPending, id: id(4), requestId: id(4), price: null,
      subject: { kind: "product", candidates: [id(5), id(6)] }, order: { orderId: id(7), attachedAt: "2026-10-28T13:00:00.000Z" } };
    expect(chatPendingsSchema.parse({ pendings: [doubtful], readyRemembered: false, lastIncomingPhoto: null }).pendings[0]).toMatchObject({
      subject: { kind: "product", candidates: [id(5), id(6)] }, order: { orderId: id(7), attachedAt: new Date("2026-10-28T13:00:00.000Z") } });
  });

  test.each([
    ["more than ten pendings", { pendings: Array.from({ length: 11 }, (_, n) => ({ ...variantPending, id: id(100 + n), requestId: id(100 + n) })), readyRemembered: false, lastIncomingPhoto: null }],
    ["a doubtful pending with a single candidate", { pendings: [{ ...variantPending, subject: { kind: "product", candidates: [id(5)] } }], readyRemembered: false, lastIncomingPhoto: null }],
    ["a doubtful pending with more than four candidates", { pendings: [{ ...variantPending, subject: { kind: "product", candidates: [5, 6, 7, 8, 9].map(id) } }], readyRemembered: false, lastIncomingPhoto: null }],
    ["a zero quantity", { pendings: [{ ...variantPending, quantity: 0 }], readyRemembered: false, lastIncomingPhoto: null }],
    ["a fractional quantity", { pendings: [{ ...variantPending, quantity: 1.5 }], readyRemembered: false, lastIncomingPhoto: null }],
    ["a date that is not ISO", { pendings: [{ ...variantPending, lastChangedAt: "yesterday" }], readyRemembered: false, lastIncomingPhoto: null }],
    ["an unknown field", { pendings: [{ ...variantPending, text: "quiero una polera" }], readyRemembered: false, lastIncomingPhoto: null }],
    ["an unknown price basis", { pendings: [{ ...variantPending, price: { ...variantPending.price, per: "dozen" } }], readyRemembered: false, lastIncomingPhoto: null }],
    ["a missing ready flag", { pendings: [], lastIncomingPhoto: null }],
    ["a missing last incoming photo", { pendings: [], readyRemembered: false }],
  ])("rejects %s", (_title, stored) => {
    expect(chatPendingsSchema.safeParse(stored).success).toBe(false);
  });

  test("a stored pendings row with a last incoming photo reads back equal", () => {
    const parse = (lastIncomingPhoto: unknown) => chatPendingsSchema.parse({ pendings: [], readyRemembered: false, lastIncomingPhoto });
    for (const lastIncomingPhoto of [
      { left: { kind: "pending", pendingId: id(1) } },
      { left: { kind: "item", orderId: id(7), variantId: id(8), quantity: 3 } },
      { left: null },
    ]) expect(parse(lastIncomingPhoto)).toEqual({ pendings: [], readyRemembered: false, lastIncomingPhoto });
  });

  test("a stored last incoming photo with an item of quantity 0 reads as invalid stored data", () => {
    expect(chatPendingsSchema.safeParse({ pendings: [], readyRemembered: false, lastIncomingPhoto: { left: { kind: "item", orderId: id(7), variantId: id(8), quantity: 0 } } }).success).toBe(false);
  });

  test.each([
    ["a quantity of 100", { left: { kind: "item", orderId: id(7), variantId: id(8), quantity: 100 } }],
    ["a fractional quantity", { left: { kind: "item", orderId: id(7), variantId: id(8), quantity: 1.5 } }],
    ["a pending id that is not a uuid", { left: { kind: "pending", pendingId: "Q1" } }],
    ["an unknown kind", { left: { kind: "order", orderId: id(7) } }],
    ["an extra field", { left: null, messageId: id(9) }],
    ["a missing left", {}],
  ])("rejects a last incoming photo with %s", (_title, lastIncomingPhoto) => {
    expect(chatPendingsSchema.safeParse({ pendings: [], readyRemembered: false, lastIncomingPhoto }).success).toBe(false);
  });

  test("accepts an empty set", () => {
    expect(chatPendingsSchema.parse({ pendings: [], readyRemembered: false, lastIncomingPhoto: null })).toEqual({ pendings: [], readyRemembered: false, lastIncomingPhoto: null });
  });
});

const day = 24 * 3600_000;
const t0 = new Date("2026-10-01T12:00:00Z");
const after = (ms: number) => new Date(t0.getTime() + ms);
const ttl = 7 * day;
const chatId = id(50) as ChatId;
const money = (amount: number) => ({ amount, currency: "PEN" as const });

const orderOf = (n: number, createdAt: Date, changes: Partial<OrderAggregate> = {}): OrderAggregate => ({
  number: (1000 + n) as OrderNumber, id: id(200 + n) as OrderId, companyId: id(2) as CompanyId, sellerId: "seller" as UserId, chatId,
  buyer: null, fromCatalog: false, checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null,
  completedAt: null, cancelled: false, cancelledAt: null,
  items: [{ id: id(3) as OrderItemId, variantId: id(4) as VariantId, productName: "Item", variantAttributes: {}, sku: null, quantity: 1 as PositiveInteger, unitPrice: money(10), subtotal: money(10) }],
  payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false, stockDeductedAt: null,
  itemsTotal: money(10), deliveryCost: money(0), deliveryCharge: money(0), total: money(10), ...changes,
});
const confirmed = (order: OrderAggregate, paymentId: number, at: Date): ConfirmedPayment => ({ id: id(paymentId) as PaymentId, orderId: order.id, status: "confirmed", amount: money(4), method: "digital_wallet", deductStockIfPartial: false,
  data: { confirmedAt: at, confirmedBy: { kind: "seller", userId: "seller" as UserId }, evidence: { kind: "manual" } } });
const voided = (payment: ConfirmedPayment, at: Date): VoidedPayment => ({ ...payment, status: "voided", data: { ...payment.data, voidedAt: at, voidedBy: "seller" as UserId } });
const reported = (order: OrderAggregate, paymentId: number, at: Date): ReportedPayment => ({ id: id(paymentId) as PaymentId, orderId: order.id, status: "reported", currency: "PEN", amount: null, method: null,
  data: { receiptImageId: id(70) as never, reportedAt: at } });
const openTarget = (order: OrderAggregate): ChatOrderTarget => ({ kind: "open", order, productIds: new Map() });
const none: ChatOrderTarget = { kind: "none" };
const pending = (n: number, lastChangedAt: Date, order: ChatPending["order"] = null): ChatPending => ({ ...(variantPending as unknown as ChatPending),
  id: id(n) as ChatPendingId, requestId: id(n) as ChatPendingId, subject: { kind: "variant", productId: id(2) as ProductId }, price: null, order, lastChangedAt, sourceMessageId: id(3) as ChatMessageId });
const life = (pendings: ChatPending[], target: ChatOrderTarget, openedSince: OrderAggregate[], now: Date) =>
  pendingLife({ pendings, readyRemembered: false, lastIncomingPhoto: null }, { target, openedSince }, now, ttl);
const summary = (result: ReturnType<typeof life>) => ({ alive: result.alive.map((item) => Number(item.id.slice(-12))), ended: result.ended.map((item) => [Number(item.id.slice(-12)), item.reason]) });

describe("pendingLife", () => {
  test("ends an attached pending when its order is no longer the open target", () => {
    const order = orderOf(1, t0);
    const attached = pending(1, t0, { orderId: order.id, attachedAt: t0 });
    expect(summary(life([attached], none, [], after(day)))).toEqual({ alive: [], ended: [[1, "order_closed"]] });
    expect(summary(life([attached], { kind: "closed", orderId: order.id, number: order.number }, [], after(day)))).toEqual({ alive: [], ended: [[1, "order_closed"]] });
    expect(summary(life([attached], openTarget(orderOf(2, after(day))), [], after(day)))).toEqual({ alive: [], ended: [[1, "order_closed"]] });
  });

  test("ends an attached pending when its order had a payment reported after it joined, even if voided since", () => {
    const base = orderOf(1, t0);
    const order = { ...base, payments: [voided(confirmed(base, 60, after(day)), after(2 * day))] };
    const attached = pending(1, t0, { orderId: order.id, attachedAt: t0 });
    expect(summary(life([attached], openTarget(order), [], after(3 * day)))).toEqual({ alive: [], ended: [[1, "order_closed"]] });
  });

  test("keeps a pending attached at an order's reopening void alive", () => {
    const base = orderOf(1, t0);
    const order = { ...base, payments: [voided(confirmed(base, 60, after(day)), after(2 * day))] };
    const attached = pending(1, after(2 * day), { orderId: order.id, attachedAt: after(2 * day) });
    expect(summary(life([attached], openTarget(order), [], after(3 * day)))).toEqual({ alive: [1], ended: [] });
  });

  test("keeps an attached pending of an open order alive after ten days", () => {
    const order = orderOf(1, t0);
    expect(summary(life([pending(1, t0, { orderId: order.id, attachedAt: t0 })], openTarget(order), [], after(10 * day)))).toEqual({ alive: [1], ended: [] });
  });

  test("joins an order reopened by the second of two voids and keeps the pending after nine days", () => {
    const base = orderOf(1, t0);
    const order = { ...base, payments: [voided(confirmed(base, 60, after(day)), after(3 * day)), voided(confirmed(base, 62, after(2 * day)), after(5 * day))] };
    const result = life([pending(1, after(4 * day))], openTarget(order), [order], after(14 * day));
    expect(summary(result)).toEqual({ alive: [1], ended: [] });
    expect(result.alive[0]?.order).toEqual({ orderId: order.id, attachedAt: after(5 * day) });
  });

  test("keeps a pending orderless when a void leaves another payment confirmed", () => {
    const base = orderOf(1, t0);
    const order = { ...base, payments: [voided(confirmed(base, 60, after(day)), after(3 * day)), confirmed(base, 62, after(2 * day))] };
    const result = life([pending(1, after(2 * day))], none, [order], after(4 * day));
    expect(summary(result)).toEqual({ alive: [1], ended: [] });
    expect(result.alive[0]?.order).toBeNull();
  });

  test("keeps a pending orderless when the void came after the order shipped", () => {
    const base = orderOf(1, t0);
    const order = { ...base, shippedAt: after(day), deliveryStatus: "shipped" as const, payments: [voided(confirmed(base, 60, after(day / 2)), after(3 * day))] };
    expect(life([pending(1, after(2 * day))], none, [order], after(4 * day)).alive[0]?.order).toBeNull();
  });

  test("derives each orderless pending's order on its own from all chat orders opened since", () => {
    const first = orderOf(1, t0);
    const second = orderOf(2, t0);
    const firstPaid = { ...first, payments: [voided(confirmed(first, 60, after(2 * day)), after(3 * day))] };
    const secondPaid = { ...second, payments: [voided(confirmed(second, 61, after(6 * day)), after(7 * day)), reported(second, 62, after(7.5 * day))] };
    const p1 = pending(1, after(day / 2));
    const p2 = pending(2, after(5 * day));
    const result = life([p1, p2], none, [firstPaid, secondPaid], after(8 * day));
    expect(summary(result)).toEqual({ alive: [], ended: [[1, "order_closed"], [2, "order_closed"]] });
    const reopened = life([p1], openTarget(firstPaid), [firstPaid], after(4 * day));
    expect(summary(reopened)).toEqual({ alive: [1], ended: [] });
    expect(reopened.alive[0]?.order).toEqual({ orderId: firstPaid.id, attachedAt: after(3 * day) });
  });

  test("expires a pending without order seven days after its last change", () => {
    expect(summary(life([pending(1, t0)], none, [], after(7 * day - 1)))).toEqual({ alive: [1], ended: [] });
    expect(summary(life([pending(1, t0)], none, [], after(8 * day)))).toEqual({ alive: [], ended: [[1, "expired"]] });
  });

  test("restarts the seven days when a partial completion changes the pending", () => {
    expect(summary(life([pending(1, after(6 * day))], none, [], after(12 * day)))).toEqual({ alive: [1], ended: [] });
  });

  test("joins a pending without order to an order reopened within its seven days", () => {
    const base = orderOf(1, t0);
    const order = { ...base, payments: [voided(confirmed(base, 60, after(day / 2)), after(3 * day))] };
    const result = life([pending(1, after(day))], openTarget(order), [order], after(20 * day));
    expect(summary(result)).toEqual({ alive: [1], ended: [] });
  });

  test("expires a pending without order when the only reopening came after its seven days", () => {
    const base = orderOf(1, t0);
    const order = { ...base, payments: [voided(confirmed(base, 60, after(day / 2)), after(9 * day))] };
    expect(summary(life([pending(1, after(day))], openTarget(order), [order], after(10 * day)))).toEqual({ alive: [], ended: [[1, "expired"]] });
  });

  test("ends a pending without order when the order it joined by a void closed again", () => {
    const base = orderOf(1, t0);
    const order = { ...base, payments: [voided(confirmed(base, 60, after(day / 2)), after(3 * day)), reported(base, 62, after(4 * day))] };
    expect(summary(life([pending(1, after(day))], none, [order], after(5 * day)))).toEqual({ alive: [], ended: [[1, "order_closed"]] });
  });
});

const { add, complete, say } = reader;
const M_NEGRO = { Talla: "M", Color: "Negro" } as const;
const requestOf = (pending: ChatPending | undefined) => pending?.requestId;

describe("pending transitions", () => {
  test("attaches every orderless pending to the order a message creates", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { n: 1 }), pendingOf("oversize", { n: 2 })] });
    chat.say(say(add({ product: "gorra", attributes: { Color: "Rojo" } })));
    expect(chat.pendings.pendings.map((pending) => pending.order)).toEqual(Array(2).fill({ orderId: chat.order?.id, attachedAt: chat.now }));
  });

  test("advances the pending of a later add of the same product, keeping values the new message does not restate", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { known: { Talla: "M" } })] });
    expect(chat.say(say(add({ product: "polo", quantity: 2 }))).kinds).toEqual(["pending_updated"]);
    expect(chat.pendingLines()).toEqual(['Polo básico ×2 {"Talla":"M"}']);
  });

  test("makes the pending ×2 silently for «y el polo básico x2» with values still missing", () => {
    const chat = createChat();
    expect(chat.say(say(add({ product: "polo" }))).kinds).toEqual(["pending_created", "variant_missing"]);
    expect(chat.say(say(add({ product: "polo", quantity: 2 }))).kinds).toEqual(["pending_updated"]);
    expect(chat.say(say(complete(1, M_NEGRO))).kinds).toEqual(["pending_completed", "added"]);
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×2"]);
  });

  test("reports variant not available and keeps ×2 for «y el polo básico rojo x2» on a ×1 pending", () => {
    const chat = createChat({ pendings: [pendingOf("polo")] });
    expect(chat.say(say(add({ product: "polo", quantity: 2, attributes: { Color: "Rojo" } }))).kinds).toEqual(["pending_updated", "variant_not_available"]);
    expect(chat.pendingLines()).toEqual(['Polo básico ×2 {}']);
    chat.say(say(complete(1, { Talla: "M", Color: "Blanco" })));
    expect(chat.items()).toEqual(["Polo básico · M · Blanco · ×2"]);
  });

  test("resolves a doubtful pending when a message names one of its candidates", () => {
    const chat = createChat({ pendings: [doubtfulPendingOf(["polo", "gorra"])] });
    chat.say(say(add({ product: "gorra", attributes: { Color: "Rojo" } })));
    expect(chat.items()).toEqual(["Gorra trucker · Rojo · ×1"]);
    expect(chat.pendings.pendings).toEqual([]);
  });

  test("turns a doubtful pending resolved to a product without its variant into a variant pending silently", () => {
    const chat = createChat({ pendings: [doubtfulPendingOf(["polo", "oversize"])] });
    expect(chat.say(say(add({ product: "polo" }))).kinds).toEqual(["pending_updated"]);
    expect(chat.pendings.pendings[0]?.subject).toEqual({ kind: "variant", productId: productIdOf("polo") });
  });

  test("completes a pending into two items and ends it", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })] });
    const said = chat.say(say(complete(1, M_NEGRO, 1), complete(1, { Talla: "L", Color: "Blanco" }, 1)));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1", "Polo básico · L · Blanco · ×1"]);
    expect(chat.pendings.pendings).toEqual([]);
    expect(said.kinds.filter((kind) => kind === "pending_completed")).toHaveLength(1);
  });

  test("completes two pendings from one message", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { n: 1 }), pendingOf("polera", { n: 2 })] });
    chat.say(say(complete(1, M_NEGRO), complete(2, { Talla: "M" })));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1", "Polera con capucha · M · ×1"]);
    expect(chat.pendings.pendings).toEqual([]);
  });

  test("leaves the unassigned units as a pending without a notice", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })] });
    chat.advance(1000);
    const said = chat.say(say(complete(1, M_NEGRO, 1)));
    expect(said.kinds).toEqual(["pending_updated", "added"]);
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1"]);
    expect(chat.pendingLines()).toEqual(['Polo básico ×1 {}']);
    expect(chat.pendings.pendings[0]?.lastChangedAt).toEqual(chat.now);
  });

  test("uses the message quantity when it assigns more units than the pending had", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })] });
    chat.say(say(complete(1, M_NEGRO, 3)));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×3"]);
    expect(chat.pendings.pendings).toEqual([]);
  });

  test("splits «uno en M» on a ×2 pending with Talla and Color missing into ×1 {M} and a ×1 remainder with the earlier values, silently", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })] });
    const said = chat.say(say(complete(1, { Talla: "M" }, 1)));
    expect(said.kinds).toEqual(["pending_split"]);
    expect(chat.pendingLines()).toEqual(['Polo básico ×1 {}', 'Polo básico ×1 {"Talla":"M"}']);
    expect(chat.items()).toEqual([]);
    expect(requestOf(chat.pendings.pendings[1])).toBe(requestOf(chat.pendings.pendings[0]));
  });

  test.each([
    ["two completions", () => say(complete(1, { Talla: "M" }, 1), complete(1, { Talla: "L" }, 1))],
    ["two adds of the pending's product", () => say(add({ product: "polo", attributes: { Talla: "M" } }), add({ product: "polo", attributes: { Talla: "L" } }))],
  ])("turns «uno en M y otro en L» on a ×2 pending with Color missing into two ×1 pendings, silently (%s)", (_title, answer) => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })] });
    const said = chat.say(answer());
    expect(said.kinds).toEqual(["pending_split", "pending_updated"]);
    expect(chat.pendingLines()).toEqual(['Polo básico ×1 {"Talla":"L"}', 'Polo básico ×1 {"Talla":"M"}']);
    expect(chat.items()).toEqual([]);
  });

  test("adds one M/Negro and keeps ×1 {Negro} for «uno en M» on a ×2 pending with Color known, and a later «el otro en L» adds L/Negro", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2, known: { Color: "Negro" } })] });
    chat.say(say(complete(1, { Talla: "M" }, 1)));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1"]);
    expect(chat.pendingLines()).toEqual(['Polo básico ×1 {"Color":"Negro"}']);
    chat.say(say(complete(1, { Talla: "L" })));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1", "Polo básico · L · Negro · ×1"]);
    expect(chat.pendings.pendings).toEqual([]);
  });

  test("answers a remainder with one value by merging it with the remainder's own values only", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })] });
    chat.say(say(complete(1, { Talla: "M" }, 1)));
    chat.say(say(complete(1, { Color: "Negro" })));
    expect(chat.pendingLines()).toEqual(['Polo básico ×1 {"Color":"Negro"}', 'Polo básico ×1 {"Talla":"M"}']);
  });

  test("reports variant not available and changes nothing for a partial assignment naming a value that does not exist", () => {
    const pendings = [pendingOf("polo", { quantity: 2 })];
    const chat = createChat({ pendings });
    expect(chat.say(say(complete(1, { Color: "Rojo" }, 1))).kinds).toEqual(["variant_not_available"]);
    expect(chat.pendings.pendings).toEqual(pendings);
  });

  test("reads «x2» in an add of the pending's product as the new total and in a completion as the units assigned", () => {
    const total = createChat({ pendings: [pendingOf("polo", { quantity: 3 })] });
    total.say(say(add({ product: "polo", quantity: 2 })));
    expect(total.pendingLines()).toEqual(['Polo básico ×2 {}']);
    const assigned = createChat({ pendings: [pendingOf("polo", { quantity: 3 })] });
    assigned.say(say(complete(1, { Talla: "M" }, 2)));
    expect(assigned.pendingLines()).toEqual(['Polo básico ×1 {}', 'Polo básico ×2 {"Talla":"M"}']);
  });

  test("reports above-99 and leaves the pending as it was for «y el polo básico x150»", () => {
    const pendings = [pendingOf("polo")];
    const chat = createChat({ pendings });
    expect(chat.say(say(add({ product: "polo", quantity: 150 }))).kinds).toEqual(["quantity_above_limit"]);
    expect(chat.pendings.pendings).toEqual(pendings);
  });

  test("assigns one unit each for two adds of the pending's product in one answer with values still missing", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })] });
    chat.say(say(add({ product: "polo", attributes: { Talla: "M" } }), add({ product: "polo", attributes: { Talla: "L" } })));
    expect(chat.pendings.pendings.map((pending) => pending.quantity)).toEqual([1, 1]);
  });

  test("adds two items and completes the pending for two adds of the pending's product that each resolve a variant", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })] });
    chat.say(say(add({ product: "polo", attributes: M_NEGRO }), add({ product: "polo", attributes: { Talla: "L", Color: "Blanco" } })));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1", "Polo básico · L · Blanco · ×1"]);
    expect(chat.pendings.pendings).toEqual([]);
  });

  test("checks an action whose pending an earlier action of the same message completed as if there were no pending", () => {
    const chat = createChat({ pendings: [pendingOf("polo")] });
    chat.say(say(complete(1, M_NEGRO), add({ product: "polo", attributes: { Talla: "L", Color: "Blanco" } }), add({ product: "polo", attributes: { Talla: "L" } })));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1", "Polo básico · L · Blanco · ×1"]);
    expect(chat.pendingLines()).toEqual(['Polo básico ×1 {"Talla":"L"}']);
  });

  test("reports variant only when the pending the reader completed ended under the lock", () => {
    const chat = createChat({ pendings: [pendingOf("polo")] });
    const said = chat.say(say(complete(1, { Talla: "M" })), { underLock: { pendings: [], readyRemembered: false, lastIncomingPhoto: null } });
    expect(said.outcomes).toEqual([{ kind: "variant_only" }]);
    expect(chat.items()).toEqual([]);
  });

  test("keeps ×2 when a photo of the pending product arrives without a caption", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })] });
    const photo = { shown: [["polo"]] } as const;
    expect(chat.say(fixedShownAnswerOf(chat, photo), photo).kinds).toEqual(["pending_updated"]);
    expect(chat.pendingLines()).toEqual(['Polo básico ×2 {}']);
  });

  test("adds ×2 when a photo's QR completes a ×2 pending", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })] });
    const photo = { shown: [["polo", M_NEGRO]] } as const;
    chat.say(fixedShownAnswerOf(chat, photo), photo);
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×2"]);
  });

  test("keeps ×2 when a doubted caption's photo advances a ×2 pending", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })] });
    chat.say({ kind: "doubt" }, { shown: [["polo"]] });
    expect(chat.pendingLines()).toEqual(['Polo básico ×2 {}']);
  });

  test("judges a lot price stated for two with two when only one unit is completed, and shows it whole on that item", () => {
    const price = { amount: { amount: 70, currency: "PEN" as const }, per: "not_explicit" as const, forQuantity: 2 as never };
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2, price })] });
    chat.say(say(complete(1, M_NEGRO, 1)));
    expect(chat.order?.items[0]?.mentionedPrice).toEqual({ amount: { amount: 70, currency: "PEN" }, units: 2 });
  });

  test("clears the lot price of the split parts and of the remainder once one item carries it", () => {
    const price = { amount: { amount: 70, currency: "PEN" as const }, per: "not_explicit" as const, forQuantity: 2 as never };
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2, price })] });
    chat.say(say(complete(1, { Talla: "M" }, 1)));
    expect(chat.pendings.pendings.map((pending) => pending.price)).toEqual([price, price]);
    chat.say(say(complete(2, { Color: "Negro" })));
    expect(chat.order?.items[0]?.mentionedPrice?.units).toBe(2);
    expect(chat.pendings.pendings.map((pending) => pending.price)).toEqual([null]);
  });

  test("clears the request's remainder when the completing message states the lot price", () => {
    const old = { amount: { amount: 50, currency: "PEN" as const }, per: "unit" as const, forQuantity: 2 as never };
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 3, price: old })] });
    chat.say(say(complete(1, M_NEGRO, 2, null, { amount: "70", currency: "not_named", per: "lot" })));
    expect(chat.order?.items[0]).toMatchObject({ quantity: 2, mentionedPrice: { units: 2 } });
    expect(chat.pendings.pendings.map((pending) => pending.price)).toEqual([null]);
  });

  test("keeps the lot price of another request of the same product from the same message", () => {
    const price = { amount: { amount: 70, currency: "PEN" as const }, per: "not_explicit" as const, forQuantity: 2 as never };
    const chat = createChat({ pendings: [pendingOf("polo", { n: 1, quantity: 2, price }), pendingOf("polo", { n: 2, quantity: 2, price, known: { Color: "Blanco" } })] });
    chat.say(say(complete(1, M_NEGRO, 1)));
    expect(chat.pendings.pendings.map((pending) => pending.price)).toEqual([null, price]);
  });

  test("applies a per-unit price to every item made from the request", () => {
    const price = { amount: { amount: 40, currency: "PEN" as const }, per: "unit" as const, forQuantity: 2 as never };
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2, price })] });
    chat.say(say(complete(1, M_NEGRO, 1), complete(1, { Talla: "L", Color: "Blanco" })));
    expect(chat.order?.items.map((item) => item.mentionedPrice?.units)).toEqual([1, 1]);
  });

  test("replaces the most recently changed of two pendings of one product when the add fits neither", () => {
    const older = pendingOf("polo", { n: 1, known: { Talla: "M" }, lastChangedAt: scenarioStart });
    const newer = pendingOf("polo", { n: 2, known: { Color: "Negro" }, lastChangedAt: new Date(scenarioStart.getTime() + 1000) });
    const chat = createChat({ pendings: [older, newer] });
    chat.advance(5000);
    chat.say(say(add({ product: "polo", attributes: { Talla: "L", Color: "Blanco" } })));
    expect(chat.items()).toEqual(["Polo básico · L · Blanco · ×1"]);
    expect(chat.pendings.pendings.map((pending) => pending.id)).toEqual([older.id]);
  });

  test("advances the only pending of a product whose known values fit the message when the product has two", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { n: 1, known: { Talla: "M" } }), pendingOf("polo", { n: 2, known: { Talla: "L" } })] });
    chat.say(say(add({ product: "polo", attributes: { Talla: "L", Color: "Negro" } })));
    expect(chat.items()).toEqual(["Polo básico · L · Negro · ×1"]);
    expect(chat.pendingLines()).toEqual(['Polo básico ×1 {"Talla":"M"}']);
  });

  test("reports a variant for several pendings when two pendings of one product fit the message", () => {
    const pendings = [pendingOf("polo", { n: 1, known: { Talla: "M" } }), pendingOf("polo", { n: 2 })];
    const chat = createChat({ pendings });
    expect(chat.say(say(add({ product: "polo", attributes: { Color: "Negro" } }))).kinds).toEqual(["variant_for_several_pendings"]);
    expect(chat.pendings.pendings).toEqual(pendings);
  });

  test("completing by naming the product in full adds one item and ends the pending", () => {
    const chat = createChat({ pendings: [pendingOf("polo")] });
    chat.say(say(add({ product: "polo", attributes: M_NEGRO })));
    expect(chat.items()).toEqual(["Polo básico · M · Negro · ×1"]);
    expect(chat.pendings.pendings).toEqual([]);
  });

  test("ends a pending whose product was deleted with product not available without a name when a message addresses it", () => {
    const chat = createChat({ pendings: [pendingOf("polo")], deleted: ["polo"] });
    const said = chat.say(say(complete(1, { Talla: "M" })));
    expect(said.outcomes).toEqual([{ kind: "pending_ended", pendingId: pendingOf("polo").id, reason: "product_not_available" }, { kind: "product_not_available", productId: null }]);
    expect(chat.pendings.pendings).toEqual([]);
  });

  test("ends a pending whose product is no longer sellable and reports product not available", () => {
    const chat = createChat({ pendings: [pendingOf("polo")], unsellable: ["polo"] });
    expect(chat.say(say(complete(1, M_NEGRO))).outcomes).toEqual([{ kind: "pending_ended", pendingId: pendingOf("polo").id, reason: "product_not_available" },
      { kind: "product_not_available", productId: productIdOf("polo") }]);
    expect(chat.items()).toEqual([]);
  });

  test("keeps the pending when only the chosen variant is not sellable", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { known: { Talla: "M" } })] });
    expect(chat.say(say(complete(1, { Color: "Rojo" }))).kinds).toEqual(["pending_updated", "variant_not_available"]);
    expect(chat.pendingLines()).toEqual(['Polo básico ×1 {"Talla":"M"}']);
  });

  test("keeps the remembered ready when a partial completion splits a pending", () => {
    const chat = createChat({ pendings: [pendingOf("polo", { quantity: 2 })], readyRemembered: true });
    expect(chat.say(say(complete(1, { Talla: "M" }, 1))).kinds).toEqual(["pending_split"]);
    expect(chat.pendings.readyRemembered).toBe(true);
  });

  test("ends the least recently changed pending silently when an eleventh is created", () => {
    const pendings = Array.from({ length: 10 }, (_unused, index) => pendingOf("polo", { n: index + 1, lastChangedAt: new Date(scenarioStart.getTime() - (index === 3 ? 9000 : index) * 1000) }));
    const chat = createChat({ pendings });
    const said = chat.say(say(add({ product: "gorra" })));
    expect(said.outcomes).toContainEqual({ kind: "pending_ended", pendingId: pendings[3]!.id, reason: "limit" });
    expect(chat.pendings.pendings).toHaveLength(10);
    expect(chat.pendings.pendings.some((pending) => pending.id === pendings[3]!.id)).toBe(false);
  });
});

function fixedShownAnswerOf(chat: ReturnType<typeof createChat>, reading: Parameters<ReturnType<typeof createChat>["context"]>[0]) {
  return fixedShownAnswer(chat.context(reading));
}

describe("changePendingQuantity", () => {
  const { say, change } = reader;
  const lot = { amount: { amount: 70, currency: "PEN" as const }, per: "lot" as const, forQuantity: 2 as PositiveInteger };
  const chatWith = (quantity: number) => createChat({ items: [["gorra", { Color: "Negro" }, 1]], pendings: [pendingOf("polo", { known: { Talla: "M" }, quantity, price: lot })] });

  test("setting a pending's quantity keeps its values and price and sends no notice", () => {
    const chat = chatWith(2);
    expect(chat.say(say(change("Q1", "set", 3))).kinds).toEqual(["pending_updated"]);
    expect(chat.pendings.pendings[0]).toMatchObject({ quantity: 3, known: { Talla: "M" }, price: lot, lastChangedAt: chat.now });
  });

  test("raising a pending by one adds a unit", () => {
    const chat = chatWith(2);
    expect(chat.say(say(change("Q1", "increase", 1))).kinds).toEqual(["pending_updated"]);
    expect(chat.pendings.pendings[0]?.quantity).toBe(3);
  });

  test("lowering a pending by one leaves the rest", () => {
    const chat = chatWith(2);
    expect(chat.say(say(change("Q1", "decrease", 1))).kinds).toEqual(["pending_updated"]);
    expect(chat.pendings.pendings[0]?.quantity).toBe(1);
  });

  test("lowering a pending to zero ends it as declined", () => {
    const chat = chatWith(2);
    const said = chat.say(say(change("Q1", "decrease", 2)));
    expect(said.outcomes).toEqual([{ kind: "pending_ended", pendingId: id(301) as ChatPendingId, reason: "declined" }]);
    expect(chat.pendings.pendings).toEqual([]);
  });

  test("lowering a pending below zero changes nothing and reports quantity_below_zero", () => {
    const chat = chatWith(2);
    expect(chat.say(say(change("Q1", "decrease", 3))).outcomes).toEqual([{ kind: "invalid_action", orderId: id(1), reason: "quantity_below_zero" }]);
    expect(chat.pendings.pendings[0]?.quantity).toBe(2);
  });

  test("setting a pending above 99 changes nothing and reports quantity_above_limit", () => {
    const chat = chatWith(98);
    expect(chat.say(say(change("Q1", "increase", 2))).outcomes).toEqual([{ kind: "quantity_above_limit", productId: productIdOf("polo"), identification: null }]);
    expect(chat.say(say(change("Q1", "set", 100))).kinds).toEqual(["quantity_above_limit"]);
    expect(chat.pendings.pendings[0]?.quantity).toBe(98);
  });

  test("a doubtful pending changes its quantity too and names its first candidate above the limit", () => {
    const chat = createChat({ pendings: [doubtfulPendingOf(["polo", "oversize"])] });
    expect(chat.say(say(change("Q1", "set", 4))).kinds).toEqual(["pending_updated"]);
    expect(chat.say(say(change("Q1", "set", 100))).outcomes).toEqual([{ kind: "quantity_above_limit", productId: productIdOf("polo"), identification: null }]);
  });
});

describe("chatPendingsSchema: last incoming photo", () => {
  const stored = (lastIncomingPhoto: unknown) => ({ pendings: [], readyRemembered: false, lastIncomingPhoto });

  test("a stored pendings row with a last incoming photo reads back equal", () => {
    const pendingLeft = { left: { kind: "pending", pendingId: id(5) } };
    const itemLeft = { left: { kind: "item", orderId: id(6), variantId: id(7), quantity: 3 } };
    for (const photo of [pendingLeft, itemLeft, { left: null }]) expect(chatPendingsSchema.parse(stored(photo)).lastIncomingPhoto).toEqual(photo);
  });

  test("a stored last incoming photo with an item of quantity 0 reads as invalid stored data", () => {
    expect(chatPendingsSchema.safeParse(stored({ left: { kind: "item", orderId: id(6), variantId: id(7), quantity: 0 } })).success).toBe(false);
  });
});
