import { expect, test } from "vitest";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { ChangeSeq, OrderItemChange, OrderItemChangeId } from "@core/src/features/orders/domain/message-changes";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, OrderId, OrderItem, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { ChatPending } from "@core/src/features/orders/domain/chat-pendings";
import { pendingOf } from "@core/src/features/orders/domain/chat-reading-fixtures";
import { messageRows } from "@core/src/features/orders/domain/order-review";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-10-31T12:00:00Z");
const line = (n: number, quantity: number): OrderItem => ({ id: id(n) as OrderItemId, variantId: id(n + 100) as VariantId, productName: `P${n}`, variantAttributes: {}, sku: null,
  quantity: quantity as PositiveInteger, unitPrice: money(10), subtotal: money(10 * quantity), mentionedPrice: null, stockDeductedQuantity: 0 });
const snapshot = (n: number, quantity: number) => ({ itemId: id(n) as OrderItemId, variantId: id(n + 100) as VariantId, productName: `P${n}`, variantAttributes: {}, sku: null,
  quantity: quantity as PositiveInteger, unitPrice: money(10), mentionedPrice: null, position: n - 3 });
const change = (messageId: ChatMessageId, seq: number, n: number, from: number, to: number): OrderItemChange => ({ id: id(900 + seq) as OrderItemChangeId, orderId: id(1) as OrderId, messageId, position: 0,
  seq: seq as ChangeSeq, kind: "quantity_changed", before: snapshot(n, from), after: snapshot(n, to), decision: { kind: "applied" }, quoteId: null, supersededBy: null, reviewId: null, verdict: null, createdAt: at });
const order = { number: 1 as OrderNumber, id: id(1) as OrderId, companyId: id(2) as CompanyId, sellerId: "s" as UserId, fromCatalog: false, chatId: id(9) as ChatId, buyer: null,
  checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt: at, completedAt: null, cancelled: false, items: [line(3, 5), line(4, 2)], payments: [], deliveryStatus: "pending",
  stockDeducted: false, delivery: null } as unknown as OrderAggregate;

const clock = { now: at, pendingTtlMs: 3_600_000, describePoint: (pending: ChatPending) => ({ product: pending.subject.kind === "variant" ? `Producto ${pending.id.slice(-3)}` : null }) };

test("shows each message row with its undo available, refused with a reason, or done", () => {
  const [a, b, c] = [id(201), id(202), id(203)] as ChatMessageId[];
  const first = change(a, 1, 3, 2, 4);
  const second = change(b, 2, 3, 4, 5);
  const third = change(c, 3, 4, 1, 2);
  const rows = messageRows({ order, pendings: [], sellable: [], ...clock, laterChanges: [first, second, third],
    rows: [{ messageId: c, at, undoneAt: null, changes: [third], pendingsBefore: [], pendingsAfter: [] },
      { messageId: b, at, undoneAt: null, changes: [second], pendingsBefore: [], pendingsAfter: [] },
      { messageId: a, at, undoneAt: new Date(at.getTime() + 1), changes: [first], pendingsBefore: [], pendingsAfter: [] }] });
  expect(rows.map((row) => row.undo)).toEqual([{ kind: "available" }, { kind: "available" }, { kind: "undone" }]);
});

test("refuses the row of a message whose item a later message changed again", () => {
  const [a, b] = [id(201), id(202)] as ChatMessageId[];
  const first = change(a, 1, 3, 2, 4);
  const second = change(b, 2, 3, 4, 5);
  const rows = messageRows({ order, pendings: [], sellable: [], ...clock, laterChanges: [first, second],
    rows: [{ messageId: a, at, undoneAt: null, changes: [{ ...first, supersededBy: second.id }], pendingsBefore: [], pendingsAfter: [] }] });
  expect(rows[0]?.undo).toEqual({ kind: "refused", reason: "later_change" });
});

test("lists the points an undo brings back and the ones it ends", () => {
  const a = id(201) as ChatMessageId;
  const first = change(a, 1, 3, 2, 4);
  const [resolved, created] = [pendingOf("polo", { n: 1, lastChangedAt: at }), pendingOf("gorra", { n: 2, lastChangedAt: at })];
  const [row] = messageRows({ order, pendings: [created], sellable: [], laterChanges: [first], ...clock,
    rows: [{ messageId: a, at, undoneAt: null, changes: [first], pendingsBefore: [resolved], pendingsAfter: [created] }] });
  expect(row?.pendings).toEqual({ back: [{ kind: "variant_missing", product: "Producto 301" }], end: [{ kind: "variant_missing", product: "Producto 302" }] });
});

test("lists a pending the message updated in neither list when it can be restored, and under end when it cannot", () => {
  const a = id(201) as ChatMessageId;
  const first = change(a, 1, 3, 2, 4);
  const before = pendingOf("polo", { n: 1, lastChangedAt: at });
  const after = { ...before, quantity: 2 as PositiveInteger };
  const rowOf = (pendingsBefore: ChatPending[]) => ({ messageId: a, at, undoneAt: null, changes: [first], pendingsBefore, pendingsAfter: [after] });
  const [restorable] = messageRows({ order, pendings: [after], sellable: [], laterChanges: [first], ...clock, rows: [rowOf([before])] });
  expect(restorable?.pendings).toEqual({ back: [], end: [] });
  const gone = { ...before, order: { orderId: id(77) as OrderId, attachedAt: at } };
  const [blocked] = messageRows({ order, pendings: [after], sellable: [], laterChanges: [first], ...clock, rows: [rowOf([gone])] });
  expect(blocked?.pendings).toEqual({ back: [], end: [{ kind: "variant_missing", product: "Producto 301" }] });
});

test("ends the least recently changed other point when the restored ones would pass the limit", () => {
  const a = id(201) as ChatMessageId;
  const first = change(a, 1, 3, 2, 4);
  const others = Array.from({ length: 10 }, (_unused, index) => pendingOf("gorra", { n: 10 + index, lastChangedAt: new Date(at.getTime() - index * 1000) }));
  const resolved = pendingOf("polo", { n: 1, lastChangedAt: at });
  const [row] = messageRows({ order, pendings: others, sellable: [], laterChanges: [first], ...clock,
    rows: [{ messageId: a, at, undoneAt: null, changes: [first], pendingsBefore: [resolved], pendingsAfter: [] }] });
  expect(row?.pendings.back).toHaveLength(1);
  expect(row?.pendings.end).toHaveLength(1);
});

test("shows no point changes on an undone message", () => {
  const a = id(201) as ChatMessageId;
  const first = change(a, 1, 3, 2, 4);
  const [row] = messageRows({ order, pendings: [], sellable: [], laterChanges: [first], ...clock,
    rows: [{ messageId: a, at, undoneAt: at, changes: [first], pendingsBefore: [pendingOf("polo")], pendingsAfter: [] }] });
  expect(row?.pendings).toEqual({ back: [], end: [] });
});
