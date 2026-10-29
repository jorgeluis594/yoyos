import { describe, expect, test } from "vitest";
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
    const parsed = chatPendingsSchema.parse({ pendings: [variantPending], readyRemembered: true });
    expect(parsed.readyRemembered).toBe(true);
    expect(parsed.pendings[0]).toMatchObject({ lastChangedAt: new Date("2026-10-28T12:00:00.000Z"), order: null, known: { Talla: "M" } });
    expect(chatPendingsSchema.safeParse({ pendings: [{ ...variantPending, subject: { kind: "other", productId: id(2) } }], readyRemembered: false }).success).toBe(false);
  });

  test("parses a doubtful-product pending attached to an order", () => {
    const doubtful = { ...variantPending, id: id(4), requestId: id(4), price: null,
      subject: { kind: "product", candidates: [id(5), id(6)] }, order: { orderId: id(7), attachedAt: "2026-10-28T13:00:00.000Z" } };
    expect(chatPendingsSchema.parse({ pendings: [doubtful], readyRemembered: false }).pendings[0]).toMatchObject({
      subject: { kind: "product", candidates: [id(5), id(6)] }, order: { orderId: id(7), attachedAt: new Date("2026-10-28T13:00:00.000Z") } });
  });

  test.each([
    ["more than ten pendings", { pendings: Array.from({ length: 11 }, (_, n) => ({ ...variantPending, id: id(100 + n), requestId: id(100 + n) })), readyRemembered: false }],
    ["a doubtful pending with a single candidate", { pendings: [{ ...variantPending, subject: { kind: "product", candidates: [id(5)] } }], readyRemembered: false }],
    ["a doubtful pending with more than four candidates", { pendings: [{ ...variantPending, subject: { kind: "product", candidates: [5, 6, 7, 8, 9].map(id) } }], readyRemembered: false }],
    ["a zero quantity", { pendings: [{ ...variantPending, quantity: 0 }], readyRemembered: false }],
    ["a fractional quantity", { pendings: [{ ...variantPending, quantity: 1.5 }], readyRemembered: false }],
    ["a date that is not ISO", { pendings: [{ ...variantPending, lastChangedAt: "yesterday" }], readyRemembered: false }],
    ["an unknown field", { pendings: [{ ...variantPending, text: "quiero una polera" }], readyRemembered: false }],
    ["an unknown price basis", { pendings: [{ ...variantPending, price: { ...variantPending.price, per: "dozen" } }], readyRemembered: false }],
    ["a missing ready flag", { pendings: [] }],
  ])("rejects %s", (_title, stored) => {
    expect(chatPendingsSchema.safeParse(stored).success).toBe(false);
  });

  test("accepts an empty set", () => {
    expect(chatPendingsSchema.parse({ pendings: [], readyRemembered: false })).toEqual({ pendings: [], readyRemembered: false });
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
const confirmed = (order: OrderAggregate, paymentId: number, at: Date): ConfirmedPayment => ({ id: id(paymentId) as PaymentId, orderId: order.id, status: "confirmed", amount: money(4), method: "digital_wallet",
  data: { confirmedAt: at, confirmedBy: { kind: "seller", userId: "seller" as UserId }, evidence: { kind: "manual" } } });
const voided = (payment: ConfirmedPayment, at: Date): VoidedPayment => ({ ...payment, status: "voided", data: { ...payment.data, voidedAt: at, voidedBy: "seller" as UserId } });
const reported = (order: OrderAggregate, paymentId: number, at: Date): ReportedPayment => ({ id: id(paymentId) as PaymentId, orderId: order.id, status: "reported", currency: "PEN", amount: null, method: null,
  data: { receiptImageId: id(70) as never, reportedAt: at } });
const openTarget = (order: OrderAggregate): ChatOrderTarget => ({ kind: "open", order, productIds: new Map() });
const none: ChatOrderTarget = { kind: "none" };
const pending = (n: number, lastChangedAt: Date, order: ChatPending["order"] = null): ChatPending => ({ ...(variantPending as unknown as ChatPending),
  id: id(n) as ChatPendingId, requestId: id(n) as ChatPendingId, subject: { kind: "variant", productId: id(2) as ProductId }, price: null, order, lastChangedAt, sourceMessageId: id(3) as ChatMessageId });
const life = (pendings: ChatPending[], target: ChatOrderTarget, openedSince: OrderAggregate[], now: Date) =>
  pendingLife({ pendings, readyRemembered: false }, { target, openedSince }, now, ttl);
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
