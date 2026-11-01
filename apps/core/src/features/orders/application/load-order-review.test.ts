import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { ChatPending, ChatPendingId } from "@core/src/features/orders/domain/chat-pendings";
import { snapshotOf, type ChangeSeq, type OrderItemChange, type OrderItemChangeId } from "@core/src/features/orders/domain/message-changes";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, OrderId, OrderItem, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { QuoteId } from "@core/src/features/orders/domain/reader/refs";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import { loadOrderReview, questionOfPending, type LoadOrderReviewDependencies } from "@core/src/features/orders/application/load-order-review";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-10-31T12:00:00Z");
const access = { companyId: id(2) as CompanyId, userId: "seller" as UserId };
const chatId = id(9) as ChatId;
const orderId = id(1) as OrderId;
const polo: OrderItem = { id: id(3) as OrderItemId, variantId: id(103) as VariantId, productName: "Polo", variantAttributes: { Talla: "M" }, sku: null, quantity: 2 as PositiveInteger, unitPrice: money(20),
  subtotal: money(40), mentionedPrice: null, stockDeductedQuantity: 0 };
const order = { number: 1023 as OrderNumber, id: orderId, companyId: access.companyId, sellerId: "seller" as UserId, fromCatalog: false, chatId, buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null,
  createdAt: at, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelled: false, cancelledAt: null, items: [polo], payments: [], delivery: null, deliveryStatus: "pending",
  stockDeducted: false, stockDeductedAt: null, itemsTotal: money(40), deliveryCost: money(0), deliveryCharge: money(0), total: money(40) } as unknown as OrderAggregate;
const doubtfulChange: OrderItemChange = { id: id(900) as OrderItemChangeId, orderId, messageId: id(201) as ChatMessageId, position: 0, seq: 1 as ChangeSeq, kind: "added", before: null, after: snapshotOf(polo, 0),
  decision: { kind: "doubtful", reason: { kind: "added_by_reference", quantity: 2 as PositiveInteger, quote: 4 } }, quoteId: 4 as QuoteId, supersededBy: null, reviewId: null, verdict: null, createdAt: at };
const pending: ChatPending = { id: id(300) as ChatPendingId, subject: { kind: "variant", productId: id(400) as ProductId }, known: { talla: "M" }, quantity: 1 as PositiveInteger, price: null, order: null,
  lastChangedAt: new Date(at.getTime() - 60_000), sourceMessageId: id(500) as ChatMessageId, requestId: id(300) as ChatPendingId, doubt: null, pointSince: at, acknowledgedAt: null };

const deps = (overrides: Partial<LoadOrderReviewDependencies> = {}): LoadOrderReviewDependencies => ({ inSnapshot: (read) => read(), findOrder: async () => ok(order),
  findOrderChanges: async () => ok({ unreviewed: [doubtfulChange], lastSeq: 1 as ChangeSeq, hasPreviousReview: false, rows: [], moreRows: 0, laterChanges: [] }),
  findChatPendings: async () => ok({ pendings: [pending], readyRemembered: false }), findLatestChatOrder: async () => ok(orderId),
  findTraceQuotes: async () => ok([{ id: 4 as QuoteId, text: "la quiero en M" }]), findSellableVariants: async () => ok([]),
  findProductNames: async () => ok(new Map([[id(400) as ProductId, { name: "Polo", attributeNames: ["talla", "color"] }]])), clock: () => at, pendingTtlMs: 7_200_000, ...overrides });

test("shows a doubtful item with its quote, the point with its question and nothing else to confirm", async () => {
  const result = await loadOrderReview({ orderId }, access, deps());
  expect(result).toMatchObject({ success: true, data: { status: { toReview: true, doubtfulCount: 1, pointCount: 1, entry: "link" }, doubtful: [{ quote: "la quiero en M" }],
    points: [{ kind: "variant_missing", product: "Polo", missing: ["color"], question: { kind: "which_variant", attribute: "color" } }], loaded: { changesThrough: 1 } } });
});

test("keeps the reasons and drops the quotes when the trace no longer exists", async () => {
  const result = await loadOrderReview({ orderId }, access, deps({ findTraceQuotes: async () => ok(null) }));
  expect(result).toMatchObject({ success: true, data: { doubtful: [{ quote: null, change: { decision: { reason: { kind: "added_by_reference" } } } }] } });
});

test("a second load reports nothing to review once the changes are reviewed", async () => {
  const result = await loadOrderReview({ orderId }, access, deps({ findOrderChanges: async () => ok({ unreviewed: [], lastSeq: 1 as ChangeSeq, hasPreviousReview: true, rows: [], moreRows: 0, laterChanges: [] }),
    findChatPendings: async () => ok({ pendings: [{ ...pending, acknowledgedAt: at }], readyRemembered: false }) }));
  expect(result).toMatchObject({ success: true, data: { status: { toReview: false, hasPreviousReview: true }, doubtful: [] } });
});

test("answers not found for an order the company does not have", async () => {
  expect(await loadOrderReview({ orderId }, access, deps({ findOrder: async () => ok(null) }))).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
});

test("asks which product when a pending has several candidates", () => {
  const several: ChatPending = { ...pending, subject: { kind: "product", candidates: [id(400) as ProductId, id(401) as ProductId] } };
  const names = new Map([[id(400) as ProductId, { name: "Polo", attributeNames: [] }], [id(401) as ProductId, { name: "Gorra", attributeNames: [] }]]);
  expect(questionOfPending(several, names)).toMatchObject({ question: { kind: "which_product", products: ["Polo", "Gorra"] } });
});
