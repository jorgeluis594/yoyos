import { describe, expect, test } from "vitest";
import { memoryAfterFailure, nextLastIncomingPhoto, photoJustSentOf } from "@core/src/features/orders/domain/photo-just-sent";
import type { AppliedChatActions, ChatOrderTarget } from "@core/src/features/orders/domain/chat-order";
import type { ChatPending, ChatPendingId, ChatPendings } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import { buildPendingOrder } from "@core/src/features/orders/domain/order-state-machine";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const productPolo = id(21) as ProductId;
const productCap = id(22) as ProductId;
const capVariant = id(13) as VariantId;
const orderId = id(1) as OrderId;
const quantity = (n: number) => n as PositiveInteger;

const orderWith = (amount: number) => {
  const built = buildPendingOrder({ number: 1023 as OrderNumber, id: orderId, companyId: id(2) as CompanyId, sellerId: "seller" as UserId, customer: { kind: "general_public" },
    createdAt: new Date("2026-10-22T12:00:00Z"), items: [{ id: id(100) as OrderItemId, variantId: capVariant, productName: "Gorra", variantAttributes: {}, sku: null, unitPrice: money(25), quantity: amount }] });
  if (!built.success) throw new Error(built.error.message);
  return built.data;
};
const openWith = (amount: number): ChatOrderTarget => ({ kind: "open", order: orderWith(amount), productIds: new Map([[capVariant, productCap]]) });
const pending = (n: number, productId = productPolo): ChatPending => ({ id: id(n) as ChatPendingId, subject: { kind: "variant", productId }, known: {}, quantity: quantity(1), price: null, order: null,
  lastChangedAt: new Date("2026-10-22T11:00:00Z"), sourceMessageId: id(900) as ChatMessageId, requestId: id(n) as ChatPendingId });
const applied = (outcomes: ChatMessageOutcome[], over: Partial<AppliedChatActions> = {}): AppliedChatActions => ({ target: { kind: "none" }, createdOrder: null,
  changes: { added: [], updated: [], removedItemIds: [] }, pendings: { pendings: [], readyRemembered: false }, outcomes: outcomes as unknown as AppliedChatActions["outcomes"], ...over });
const withPendings = (...list: ChatPending[]): ChatPendings => ({ pendings: list, readyRemembered: false });
const next = (over: Partial<Parameters<typeof nextLastIncomingPhoto>[0]>, result: AppliedChatActions) =>
  nextLastIncomingPhoto({ kind: "photo", previous: null, shownProductIds: [productPolo], applied: result, ...over });
const identification = (productId: ProductId) => ({ method: "visual" as const, productId, confidence: 0.9 });

describe("nextLastIncomingPhoto", () => {
  test("a single product photo that left a pending remembers the pending", () => {
    const result = applied([{ kind: "pending_created", pendingId: id(30) as ChatPendingId }], { pendings: withPendings(pending(30)) });
    expect(next({}, result)).toEqual({ left: { kind: "pending", pendingId: id(30) } });
  });

  test("a single product photo that added a single-variant product remembers the item and its quantity", () => {
    const result = applied([{ kind: "added", variantId: capVariant, quantity: quantity(1), identification: identification(productCap) }], { target: openWith(1) });
    expect(next({ shownProductIds: [productCap] }, result)).toEqual({ left: { kind: "item", orderId, variantId: capVariant, quantity: 1 } });
  });

  test("a single product photo that grew an existing item remembers the grown quantity", () => {
    const result = applied([{ kind: "added", variantId: capVariant, quantity: quantity(1), identification: identification(productCap) }], { target: openWith(3) });
    expect(next({ shownProductIds: [productCap] }, result)).toEqual({ left: { kind: "item", orderId, variantId: capVariant, quantity: 3 } });
  });

  test("a photo right after another photo remembers no leftover", () => {
    const result = applied([{ kind: "pending_created", pendingId: id(30) as ChatPendingId }], { pendings: withPendings(pending(30)) });
    expect(next({ previous: { left: { kind: "pending", pendingId: id(31) as ChatPendingId } } }, result)).toEqual({ left: null });
    expect(next({ previous: { left: null } }, result)).toEqual({ left: null });
  });

  test("a non-product photo, a photo that matched nothing and a declined photo remember no leftover", () => {
    const result = applied([{ kind: "no_intent" }]);
    expect(next({ shownProductIds: [] }, result)).toEqual({ left: null });
    expect(next({ shownProductIds: [productPolo, productCap] }, result)).toEqual({ left: null });
    expect(next({}, applied([{ kind: "pending_ended", pendingId: id(30) as ChatPendingId, reason: "declined" }]))).toEqual({ left: null });
  });

  test("a read text clears the memory", () => {
    expect(next({ kind: "text", previous: { left: { kind: "pending", pendingId: id(30) as ChatPendingId } } }, applied([{ kind: "no_intent" }]))).toBeNull();
  });
});

describe("memoryAfterFailure", () => {
  test("a failed message leaves a memory with no leftover", () => {
    expect(memoryAfterFailure()).toEqual({ left: null });
  });

  test("a photo right after a failed message remembers no leftover", () => {
    const result = applied([{ kind: "pending_created", pendingId: id(30) as ChatPendingId }], { pendings: withPendings(pending(30)) });
    expect(next({ previous: memoryAfterFailure() }, result)).toEqual({ left: null });
  });
});

describe("photoJustSentOf", () => {
  const pendingLeft = { left: { kind: "pending" as const, pendingId: id(30) as ChatPendingId } };
  const itemLeft = { left: { kind: "item" as const, orderId, variantId: capVariant, quantity: quantity(2) } };

  test("a photo message is read with no marker, even right after a photo just sent", () => {
    expect(photoJustSentOf("photo", pendingLeft, { kind: "none" }, [pending(30)])).toBeNull();
    expect(photoJustSentOf("photo", itemLeft, openWith(2), [])).toBeNull();
  });

  test("a text keeps the marker while the pending or the item is what the photo left", () => {
    expect(photoJustSentOf("text", pendingLeft, { kind: "none" }, [pending(30)])).toEqual(pendingLeft.left);
    expect(photoJustSentOf("text", itemLeft, openWith(2), [])).toEqual(itemLeft.left);
    expect(photoJustSentOf("text", null, openWith(2), [pending(30)])).toBeNull();
    expect(photoJustSentOf("text", { left: null }, openWith(2), [pending(30)])).toBeNull();
  });

  test("the marker is dropped when the photo's pending ended", () => {
    expect(photoJustSentOf("text", pendingLeft, { kind: "none" }, [pending(31)])).toBeNull();
  });

  test("the marker is dropped when the photo's item changed quantity or its order is no longer open", () => {
    expect(photoJustSentOf("text", itemLeft, openWith(3), [])).toBeNull();
    expect(photoJustSentOf("text", itemLeft, { kind: "closed", orderId, number: 1023 as OrderNumber }, [])).toBeNull();
    expect(photoJustSentOf("text", itemLeft, { kind: "none" }, [])).toBeNull();
  });
});
