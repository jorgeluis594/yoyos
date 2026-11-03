import { describe, expect, test } from "vitest";
import type { ChatPending, ChatPendingId } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { DoubtReason } from "@core/src/features/orders/domain/reader/decision";
import { inheritedMark, isAcknowledged, withDecisionOnPending } from "@core/src/features/orders/domain/reader/pending-doubt";
import type { ProductId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const earlier = new Date("2026-10-31T10:00:00Z");
const later = new Date("2026-10-31T10:05:00Z");
const quantitySet: DoubtReason = { kind: "quantity_set", quantity: 3 as PositiveInteger };
const pending = (over: Partial<ChatPending> = {}): ChatPending => ({ id: id(30) as ChatPendingId, subject: { kind: "variant", productId: id(21) as ProductId }, known: {},
  quantity: 3 as PositiveInteger, price: null, order: null, lastChangedAt: earlier, sourceMessageId: id(70) as ChatMessageId, requestId: id(30) as ChatPendingId,
  doubt: null, pointSince: earlier, acknowledgedAt: null, ...over });
const doubted = pending({ doubt: { reason: quantitySet } });
const noStatement = { quantity: null, values: [] } as const;

describe("withDecisionOnPending", () => {
  test("applies a doubtful pending quantity change to the pending with its reason", () => {
    const next = withDecisionOnPending(pending({ acknowledgedAt: earlier }), { kind: "doubtful", reason: quantitySet }, later);
    expect(next.doubt).toEqual({ reason: quantitySet });
    expect(next.pointSince).toEqual(later);
    expect(next.acknowledgedAt).toBeNull();
  });

  test("keeps the pending as it is for a decision that carries no doubt", () => {
    expect(withDecisionOnPending(doubted, { kind: "pending" }, later)).toBe(doubted);
    expect(withDecisionOnPending(doubted, { kind: "applied" }, later)).toBe(doubted);
  });

  test("never replaces a doubt the pending already has with the values-alone doubt", () => {
    const values: DoubtReason = { kind: "added_by_reference", quantity: 3 as PositiveInteger, quote: null };
    expect(withDecisionOnPending(doubted, { kind: "doubtful", reason: values }, later)).toBe(doubted);
    expect(withDecisionOnPending(pending(), { kind: "doubtful", reason: values }, later).doubt).toEqual({ reason: values });
  });

  test("stores the original reason when the decision carries an inherited one", () => {
    const next = withDecisionOnPending(pending(), { kind: "doubtful", reason: { kind: "inherited", from: quantitySet } }, later);
    expect(next.doubt).toEqual({ reason: quantitySet });
  });
});

describe("isAcknowledged", () => {
  test("holds when the acknowledgement is not before the point", () => {
    expect(isAcknowledged(pending({ doubt: { reason: quantitySet }, pointSince: earlier, acknowledgedAt: earlier }))).toBe(true);
    expect(isAcknowledged(pending({ doubt: { reason: quantitySet }, pointSince: later, acknowledgedAt: earlier }))).toBe(false);
    expect(isAcknowledged(doubted)).toBe(false);
  });
});

describe("inheritedMark", () => {
  test("carries a pending's unacknowledged doubt to every item created from it, splits included", () => {
    const marks = [1, 2].map(() => inheritedMark(doubted, noStatement));
    expect(marks).toEqual([{ kind: "inherited", from: quantitySet }, { kind: "inherited", from: quantitySet }]);
  });

  test("gives no inherited mark when the completing message restates the doubted value", () => {
    expect(inheritedMark(doubted, { quantity: 3, values: [] })).toBeNull();
    const variant = pending({ doubt: { reason: { kind: "variant_changed", attribute: "Color", from: "Negro", to: "Rojo" } } });
    expect(inheritedMark(variant, { quantity: null, values: [{ name: "color", value: "ROJO" }] })).toBeNull();
    expect(inheritedMark(variant, { quantity: null, values: [{ name: "Talla", value: "M" }] })).toEqual({ kind: "inherited", from: { kind: "variant_changed", attribute: "Color", from: "Negro", to: "Rojo" } });
  });

  test("gives a partial completion the mark when it states fewer units than the doubted quantity", () => {
    expect(inheritedMark(doubted, { quantity: 1, values: [] })).toEqual({ kind: "inherited", from: quantitySet });
  });

  test("gives no inherited mark when a confirmed review acknowledged the pending's doubt", () => {
    expect(inheritedMark(pending({ doubt: { reason: quantitySet }, acknowledgedAt: later }), noStatement)).toBeNull();
  });

  test("gives no inherited mark to a pending without a doubt and never nests an inherited reason", () => {
    expect(inheritedMark(pending(), noStatement)).toBeNull();
    const stored = pending({ doubt: { reason: { kind: "inherited", from: quantitySet } } });
    expect(inheritedMark(stored, noStatement)).toEqual({ kind: "inherited", from: quantitySet });
  });
});
