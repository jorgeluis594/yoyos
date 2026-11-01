import { describe, expect, test } from "vitest";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-message-outcome";
import type { OrderItemId, PositiveInteger } from "@core/src/features/orders/domain/order";
import { capContextText, defaultReadingBudgets, fitReadingInput, readingInputChars } from "@core/src/features/orders/domain/reader/budgets";
import type { ContextMessageRef, ItemRef, PendingRef, ReadingContextMessage, ReadingInput, ReadingItem, ReadingPending } from "@core/src/features/orders/domain/reader/readings";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const budgets = defaultReadingBudgets;
const at = new Date("2026-10-30T12:00:00Z");

function context(count: number, chars: number): ReadingContextMessage[] {
  return Array.from({ length: count }, (_, index) => ({ ref: `M${index + 1}` as ContextMessageRef, direction: index % 2 ? "outgoing" : "incoming", kind: "text",
    text: "x".repeat(chars), sentAt: at, masked: false }));
}
function items(count: number, nameChars: number): ReadingItem[] {
  return Array.from({ length: count }, (_, index) => ({ ref: `I${index + 1}` as ItemRef, itemId: `item-${index}` as OrderItemId, productId: `product-${index}` as ProductId,
    variantId: `variant-${index}` as VariantId, productName: "n".repeat(nameChars),
    variantAttributes: { ["a".repeat(30)]: "v".repeat(30), ["b".repeat(30)]: "v".repeat(30), ["c".repeat(30)]: "v".repeat(30) }, quantity: 1 as PositiveInteger }));
}
function pendings(count: number): ReadingPending[] {
  return Array.from({ length: count }, (_, index) => ({ ref: `Q${index + 1}` as PendingRef, pendingId: `pending-${index}` as ChatPendingId,
    productIds: ["p1", "p2", "p3", "p4"] as ProductId[], known: { talla: "M" }, quantity: 2 as PositiveInteger, doubtful: false }));
}
function input(over: Partial<ReadingInput> = {}): ReadingInput {
  return { current: { messageId: "current" as ChatMessageId, kind: "text", text: "quiero dos" }, context: [], items: [], pendings: [], photoMemory: null, photo: null, ...over };
}

describe("reading budgets", () => {
  test("cuts a context text to its character cap without splitting a character", () => {
    expect(capContextText("a".repeat(600), 500)).toHaveLength(500);
    expect(capContextText("hola", 500)).toBe("hola");
    const capped = capContextText("a".repeat(499) + "😀😀", 500);
    expect(capped).toBe("a".repeat(499));
  });

  test("keeps an input under its budget untouched", () => {
    const small = input({ context: context(3, 50), items: items(2, 20) });
    expect(fitReadingInput(small, budgets.stageInputMaxChars)).toEqual({ input: small, cut: { contextDropped: 0, itemsOmitted: 0, pendingsOmitted: 0 } });
  });

  test("cuts the oldest context messages first when a stage input exceeds its budget", () => {
    const full = input({ context: context(12, 500) });
    const limit = readingInputChars(full) - 1;
    const fitted = fitReadingInput(full, limit);
    expect(fitted.cut).toEqual({ contextDropped: 1, itemsOmitted: 0, pendingsOmitted: 0 });
    expect(fitted.input.context.map(({ ref }) => ref)).toEqual(full.context.slice(1).map(({ ref }) => ref));
    expect(readingInputChars(fitted.input)).toBeLessThanOrEqual(limit);
  });

  test("drops the context before omitting any order line or pending", () => {
    const full = input({ context: context(12, 500), items: items(10, 50), pendings: pendings(3) });
    const withoutContext = readingInputChars({ ...full, context: [] });
    const fitted = fitReadingInput(full, withoutContext);
    expect(fitted.input.context).toEqual([]);
    expect(fitted.input.items).toEqual(full.items);
    expect(fitted.input.pendings).toEqual(full.pendings);
  });

  test("omits the oldest order lines first, then the last pendings, once the context is gone", () => {
    const full = input({ items: items(10, 200), pendings: pendings(10) });
    const pendingsOnly = fitReadingInput(full, readingInputChars(full) - 1);
    expect(pendingsOnly.cut).toEqual({ contextDropped: 0, itemsOmitted: 0, pendingsOmitted: 1 });
    expect(pendingsOnly.input.pendings).toEqual(full.pendings.slice(0, 9));
    const limit = readingInputChars({ ...full, pendings: [] }) - 1;
    const fitted = fitReadingInput(full, limit);
    expect(fitted.input.items).toEqual(full.items.slice(fitted.cut.itemsOmitted));
    expect(fitted.cut.itemsOmitted).toBeGreaterThan(0);
    expect(readingInputChars(fitted.input)).toBeLessThanOrEqual(limit);
  });

  test("never exceeds the stage input budget at every fixed limit", () => {
    const worst = input({ current: { messageId: "current" as ChatMessageId, kind: "text", text: "t".repeat(2000) },
      context: context(budgets.contextMessages, budgets.contextMessageChars), items: items(budgets.maxItems, 200), pendings: pendings(10) });
    expect(readingInputChars(worst)).toBeGreaterThan(budgets.stageInputMaxChars);
    for (const limit of [budgets.stageInputMaxChars, 12_000, 6_000, 3_000]) {
      const fitted = fitReadingInput(worst, limit);
      expect(readingInputChars(fitted.input)).toBeLessThanOrEqual(limit);
      expect(fitted.input.current).toEqual(worst.current);
    }
  });
});
