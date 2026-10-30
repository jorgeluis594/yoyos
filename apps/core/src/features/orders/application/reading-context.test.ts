import { describe, expect, test } from "vitest";
import { buildReadingContext, selectReadingProducts, type ReadingContextInput } from "@core/src/features/orders/application/reading-context";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order-target";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { OrderId } from "@core/src/features/orders/domain/order";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-pendings";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import { pending } from "@core/src/features/orders/infrastructure/chat-reading-fixtures";

const base: ReadingContextInput = { kind: "text", text: "hola", target: { kind: "none" }, pendings: [], shown: [], productIds: [], found: [], truncated: false, maxItems: 40, photoJustSent: null };
const context = (target: ChatOrderTarget, over: Partial<ReadingContextInput> = {}) => buildReadingContext({ ...base, target, ...over });

describe("buildReadingContext", () => {
  test.each<[string, ChatOrderTarget, "open" | "closed" | "none"]>([
    ["an open order", { kind: "open", order: { id: "o1", items: [] } as unknown as OrderAggregate, productIds: new Map() }, "open"],
    ["a closed order", { kind: "closed", orderId: "o1" as OrderId, number: 1023 as OrderNumber }, "closed"],
    ["a cancelled order", { kind: "cancelled" }, "none"],
    ["no order", { kind: "none" }, "none"],
  ])("sets the latest order from %s", (_title, target, latestOrder) => {
    expect(context(target).latestOrder).toBe(latestOrder);
  });

  test("starts with no photo just sent and no line marked", () => {
    const built = context({ kind: "none" }, { pendings: [pending(1, {})] });
    expect(built.photoJustSent).toBeNull();
    expect(built.pendings).toMatchObject([{ ref: "Q1", photoJustSent: false }]);
  });

  test("marks the pending the photo just sent left and carries the marker for a text", () => {
    const pendings = [pending(1, {}), pending(2, {})];
    const built = context({ kind: "none" }, { pendings, photoJustSent: { kind: "pending", pendingId: pendings[1]!.id as ChatPendingId } });
    expect(built.pendings.map(({ photoJustSent }) => photoJustSent)).toEqual([false, true]);
    expect(built.photoJustSent).toEqual({ kind: "pending", pendingId: pendings[1]!.id });
  });

  test("marks the item the photo just sent left and keeps the marker when the item is not listed", () => {
    const variantId = "v2" as VariantId;
    const order = { id: "o1", items: [{ variantId: "v1", productName: "A", variantAttributes: {}, quantity: 1, unitPrice: { amount: 1, currency: "PEN" } },
      { variantId, productName: "B", variantAttributes: {}, quantity: 2, unitPrice: { amount: 1, currency: "PEN" } }] } as unknown as OrderAggregate;
    const target: ChatOrderTarget = { kind: "open", order, productIds: new Map() };
    const marker = { kind: "item" as const, orderId: "o1" as OrderId, variantId, quantity: 2 as never };
    expect(context(target, { photoJustSent: marker }).items.map(({ photoJustSent }) => photoJustSent)).toEqual([false, true]);
    const past = context(target, { photoJustSent: marker, maxItems: 1 });
    expect(past.items.map(({ photoJustSent }) => photoJustSent)).toEqual([false]);
    expect(past.photoJustSent).toEqual(marker);
  });

  test("a photo context carries no marker even when one is given", () => {
    const pendings = [pending(1, {})];
    const built = context({ kind: "none" }, { kind: "photo_product", pendings, photoJustSent: { kind: "pending", pendingId: pendings[0]!.id as ChatPendingId } });
    expect(built.photoJustSent).toBeNull();
  });
});

describe("selectReadingProducts", () => {
  const ids = (...n: number[]) => n.map((value) => `p${value}` as ProductId);
  test("not-sellable candidates come after the text candidates, within the ceiling", () => {
    const base = { shown: [], pendings: [], itemProductIds: ids(1), candidateIds: ids(2, 3), unavailableIds: ids(4, 5) };
    expect(selectReadingProducts({ ...base, maxProducts: 24 })).toEqual({ productIds: ids(1, 2, 3, 4, 5), truncated: false });
    expect(selectReadingProducts({ ...base, maxProducts: 4 })).toEqual({ productIds: ids(1, 2, 3, 4), truncated: true });
  });
});
