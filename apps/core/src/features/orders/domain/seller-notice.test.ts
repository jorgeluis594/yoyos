import { describe, expect, test } from "vitest";
import { chooseSellerNotice, isNoticeDue, sellerNoticeTarget } from "@core/src/features/orders/domain/seller-notice";
import type { ChatMessageOutcome, ChatMessageOutcomes } from "@core/src/features/orders/domain/chat-message-outcome";
import type { OrderId } from "@core/src/features/orders/domain/order";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const order = (n: number) => id(n) as OrderId;
const product = (n: number) => id(n) as ProductId;
const variant = (n: number) => id(n) as VariantId;
const outcomes = (...list: ChatMessageOutcome[]) => list as unknown as ChatMessageOutcomes;
const added: ChatMessageOutcome = { kind: "added", variantId: variant(40), quantity: 1 as never, identification: { method: "text", productId: product(30), confidence: 0.9 } };
const missing = (n: number): ChatMessageOutcome => ({ kind: "variant_missing", productId: product(n), identification: null });

describe("chooseSellerNotice", () => {
  test("chooses the problem's own notice when exactly one problem exists", () => {
    expect(chooseSellerNotice(outcomes(added, missing(31)))).toEqual({ kind: "variant_missing", productId: product(31), newOrderId: null });
    expect(chooseSellerNotice(outcomes({ kind: "not_identified", source: "text", identification: null, silent: false })))
      .toEqual({ kind: "not_identified", source: "text", newOrderId: null });
    expect(chooseSellerNotice(outcomes({ kind: "not_clear", productIds: [product(31), product(32)], silent: false })))
      .toEqual({ kind: "not_clear", productIds: [product(31), product(32)], newOrderId: null });
    expect(chooseSellerNotice(outcomes({ kind: "unclear_item", orderId: order(1), namedItem: true, namedProductId: null })))
      .toEqual({ kind: "unclear_item", orderId: order(1), namedItem: true, namedProductId: null, newOrderId: null });
    expect(chooseSellerNotice(outcomes({ kind: "order_closed", orderId: order(1) }))).toEqual({ kind: "order_closed", orderId: order(1), newOrderId: null });
    expect(chooseSellerNotice(outcomes({ kind: "failed", errorCode: "RETRIES_EXHAUSTED" }))).toEqual({ kind: "failed", newOrderId: null });
    for (const kind of ["unnamed_add", "variant_only", "image_with_request", "no_open_order"] as const)
      expect(chooseSellerNotice(outcomes({ kind }))).toEqual({ kind, newOrderId: null });
  });

  test("chooses several problems naming up to three products and counting the rest", () => {
    const notice = chooseSellerNotice(outcomes(missing(31), { kind: "not_identified", source: "text", identification: null, silent: false }));
    expect(notice).toEqual({ kind: "several_problems", problemCount: 2, productIds: [product(31)], newOrderId: null });
    const many = chooseSellerNotice(outcomes(missing(31), missing(32), missing(31), missing(33), missing(34), { kind: "unnamed_add" }));
    expect(many).toMatchObject({ kind: "several_problems", problemCount: 6, productIds: [product(31), product(32), product(33)] });
  });

  test("prefers only item kept over ready over new order when there is no problem", () => {
    const kept: ChatMessageOutcome = { kind: "only_item_kept", orderId: order(1) };
    const ready: ChatMessageOutcome = { kind: "ready", orderId: order(2) };
    const fresh: ChatMessageOutcome = { kind: "new_order_after_closed", orderId: order(4), previousOrderId: order(3) };
    expect(chooseSellerNotice(outcomes(fresh, ready, kept))).toEqual({ kind: "only_item_kept", orderId: order(1) });
    expect(chooseSellerNotice(outcomes(fresh, ready))).toEqual({ kind: "ready", orderId: order(2) });
    expect(chooseSellerNotice(outcomes(added, fresh))).toEqual({ kind: "new_order", orderId: order(4), previousOrderId: order(3) });
  });

  test("adds the new order number to a problem notice when the message created an order", () => {
    const fresh: ChatMessageOutcome = { kind: "new_order_after_closed", orderId: order(4), previousOrderId: order(3) };
    expect(chooseSellerNotice(outcomes(fresh, added, missing(31)))).toEqual({ kind: "variant_missing", productId: product(31), newOrderId: order(4) });
    expect(chooseSellerNotice(outcomes(fresh, missing(31), missing(32)))).toMatchObject({ kind: "several_problems", newOrderId: order(4) });
  });

  test("sends no notice for silent misses, ambiguous intent and no purchase intent", () => {
    expect(chooseSellerNotice(outcomes({ kind: "not_identified", source: "photo", identification: null, silent: true }))).toBeNull();
    expect(chooseSellerNotice(outcomes({ kind: "not_clear", productIds: [product(31)], silent: true }))).toBeNull();
    expect(chooseSellerNotice(outcomes({ kind: "ambiguous_intent" }))).toBeNull();
    expect(chooseSellerNotice(outcomes({ kind: "no_intent" }))).toBeNull();
    expect(chooseSellerNotice(outcomes(added))).toBeNull();
    expect(chooseSellerNotice(outcomes({ kind: "removed", variantId: variant(40), namedItem: true }, { kind: "mentioned_price_set", variantId: variant(40) }))).toBeNull();
  });

  test("opens the order for order notices and the message for the rest", () => {
    expect(sellerNoticeTarget({ kind: "ready", orderId: order(2) })).toEqual({ kind: "order", orderId: order(2) });
    expect(sellerNoticeTarget({ kind: "new_order", orderId: order(4), previousOrderId: order(3) })).toEqual({ kind: "order", orderId: order(4) });
    expect(sellerNoticeTarget({ kind: "only_item_kept", orderId: order(1) })).toEqual({ kind: "order", orderId: order(1) });
    expect(sellerNoticeTarget({ kind: "failed", newOrderId: null })).toEqual({ kind: "message" });
    expect(sellerNoticeTarget({ kind: "order_closed", orderId: order(1), newOrderId: null })).toEqual({ kind: "message" });
  });
});

describe("isNoticeDue", () => {
  test("is due only while the outcomes call for a notice and it was not claimed", () => {
    const failed: ChatMessageOutcomes = [{ kind: "failed", errorCode: "RETRIES_EXHAUSTED" }];
    expect(isNoticeDue(failed, null)).toBe(true);
    expect(isNoticeDue(failed, new Date())).toBe(false);
    expect(isNoticeDue([{ kind: "no_intent" }], null)).toBe(false);
  });
});
