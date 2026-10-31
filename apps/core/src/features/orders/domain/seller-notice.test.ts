import { describe, expect, expectTypeOf, test } from "vitest";
import { chooseSellerNotice, closesLinkCycle, isNoticeDue, noticeReferences, sellerNoticeKinds, sellerNoticeTarget, type SellerNotice, type SellerNoticeKind } from "@core/src/features/orders/domain/seller-notice";
import type { ChatMessageOutcome, ChatMessageOutcomes, PaymentOrder } from "@core/src/features/orders/domain/chat-message-outcome";
import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";
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

  test("sends no notice for silent misses and no purchase intent", () => {
    expect(chooseSellerNotice(outcomes({ kind: "not_identified", source: "photo", identification: null, silent: true }))).toBeNull();
    expect(chooseSellerNotice(outcomes({ kind: "not_clear", productIds: [product(31)], silent: true }))).toBeNull();
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

describe("chooseSellerNotice with the single reader", () => {
  const pendingId = id(90) as never;
  const readyWithPendings: ChatMessageOutcome = { kind: "ready_with_pendings", orderId: order(1), productIds: [product(31)], unnamed: 1 };

  test("chooses the generic not-applied notice for reader doubt, a request not allowed and an invalid action", () => {
    for (const outcome of [
      { kind: "reader_doubt", orderId: order(1) },
      { kind: "request_not_allowed", orderId: order(1) },
      { kind: "invalid_action", orderId: order(1), reason: "unknown_reference" },
    ] as const) expect(chooseSellerNotice(outcomes(outcome))).toEqual({ kind: "not_applied", orderId: order(1), newOrderId: null });
    expect(chooseSellerNotice(outcomes({ kind: "reader_doubt", orderId: null }))).toEqual({ kind: "not_applied", orderId: null, newOrderId: null });
  });

  test("chooses ready with pendings only when the message has no problem", () => {
    expect(chooseSellerNotice(outcomes(added, readyWithPendings))).toEqual({ kind: "ready_with_pendings", orderId: order(1), productIds: [product(31)], unnamed: 1 });
    expect(chooseSellerNotice(outcomes(readyWithPendings, missing(32)))).toEqual({ kind: "variant_missing", productId: product(32), newOrderId: null });
    const kept: ChatMessageOutcome = { kind: "only_item_kept", orderId: order(2) };
    const ready: ChatMessageOutcome = { kind: "ready", orderId: order(2) };
    expect(chooseSellerNotice(outcomes(kept, ready, readyWithPendings))).toMatchObject({ kind: "ready_with_pendings" });
  });

  test("never counts ready with pendings in several problems", () => {
    expect(chooseSellerNotice(outcomes(readyWithPendings, missing(32), { kind: "unnamed_add" })))
      .toEqual({ kind: "several_problems", problemCount: 2, productIds: [product(32)], newOrderId: null });
  });

  test("counts product not available as a problem", () => {
    expect(chooseSellerNotice(outcomes({ kind: "product_not_available", productId: product(33) }))).toEqual({ kind: "product_not_available", productId: product(33), newOrderId: null });
    expect(chooseSellerNotice(outcomes({ kind: "product_not_available", productId: null }))).toEqual({ kind: "product_not_available", productId: null, newOrderId: null });
    expect(chooseSellerNotice(outcomes({ kind: "variant_for_several_pendings", productIds: [product(31), product(32)], unnamed: 1 })))
      .toEqual({ kind: "variant_for_several_pendings", productIds: [product(31), product(32)], unnamed: 1, newOrderId: null });
    expect(chooseSellerNotice(outcomes({ kind: "product_not_available", productId: product(33) }, { kind: "reader_doubt", orderId: null }, missing(34))))
      .toEqual({ kind: "several_problems", problemCount: 3, productIds: [product(33), product(34)], newOrderId: null });
  });

  test("sends no notice for pending created, updated, completed or ended outcomes alone", () => {
    expect(chooseSellerNotice(outcomes(
      { kind: "pending_created", pendingId }, { kind: "pending_updated", pendingId }, { kind: "pending_completed", pendingId },
      { kind: "pending_split", pendingId, newPendingId: id(91) as never }, { kind: "pending_ended", pendingId, reason: "declined" },
    ))).toBeNull();
  });

  test("opens the chat on the message for every new notice", () => {
    for (const notice of [
      { kind: "not_applied", orderId: order(1), newOrderId: null },
      { kind: "payment_request", order: { kind: "none" }, productIds: [], unnamed: 0, newOrderId: null },
      { kind: "product_not_available", productId: null, newOrderId: null },
      { kind: "variant_for_several_pendings", productIds: [], unnamed: 2, newOrderId: null },
      { kind: "ready_with_pendings", orderId: order(1), productIds: [], unnamed: 1 },
    ] satisfies SellerNotice[]) expect(sellerNoticeTarget(notice)).toEqual({ kind: "message" });
  });

  test("drops a repeated product so two pendings of one product are named once", () => {
    expect(chooseSellerNotice(outcomes({ kind: "ready_with_pendings", orderId: order(1), productIds: [product(1), product(2), product(1)], unnamed: 1 })))
      .toEqual({ kind: "ready_with_pendings", orderId: order(1), productIds: [product(1), product(2)], unnamed: 1 });
    expect(chooseSellerNotice(outcomes({ kind: "variant_for_several_pendings", productIds: [product(1), product(1)], unnamed: 0 })))
      .toEqual({ kind: "variant_for_several_pendings", productIds: [product(1)], unnamed: 0, newOrderId: null });
  });

  test("carries each product once and the order of the new notices for the names", () => {
    expect(noticeReferences({ kind: "ready_with_pendings", orderId: order(1), productIds: [product(1), product(2)], unnamed: 1 }))
      .toEqual({ orderIds: [order(1)], productIds: [product(1), product(2)] });
    expect(noticeReferences({ kind: "variant_for_several_pendings", productIds: [product(1), product(1)], unnamed: 0, newOrderId: null }).productIds).toEqual([product(1)]);
    expect(noticeReferences({ kind: "not_applied", orderId: order(3), newOrderId: order(4) }).orderIds).toEqual([order(3), order(4)]);
    expect(noticeReferences({ kind: "product_not_available", productId: null, newOrderId: null })).toEqual({ orderIds: [], productIds: [] });
  });
});

const question: SuggestedQuestion = { language: "es", kind: "which_variant", product: "Polo básico", attribute: "talla", values: ["S", "M", "L"] };
const otherQuestion: SuggestedQuestion = { language: "es", kind: "photo_product_name" };
const paymentRequested = (order: PaymentOrder, productIds: ProductId[] = [], unnamed = 0): ChatMessageOutcome => ({ kind: "payment_requested", order, productIds, unnamed });
const changedAfterLink: ChatMessageOutcome = { kind: "changed_after_link", orderId: order(1) };

describe("chooseSellerNotice for payment requests, the changed order and questions", () => {
  test("a caption that was not applied is no longer a notice", () => {
    expect(chooseSellerNotice(outcomes(added, { kind: "caption_not_applied", productId: product(34), orderId: order(1) }))).toBeNull();
  });

  test("chooses the payment request notice over «Pedido #N listo»", () => {
    const ready: ChatMessageOutcome = { kind: "ready", orderId: order(1) };
    const open = { kind: "open", orderId: order(1) } as const;
    expect(chooseSellerNotice(outcomes(ready, paymentRequested(open))))
      .toEqual({ kind: "payment_request", order: open, productIds: [], unnamed: 0, newOrderId: null });
    expect(chooseSellerNotice(outcomes(paymentRequested(open, [product(1), product(1), product(2)], 1), { kind: "ready_with_pendings", orderId: order(1), productIds: [product(1)], unnamed: 1 })))
      .toMatchObject({ kind: "payment_request", productIds: [product(1), product(2)], unnamed: 1 });
  });

  test("counts a payment request with another problem as several problems", () => {
    expect(chooseSellerNotice(outcomes(paymentRequested({ kind: "none" }), missing(31))))
      .toEqual({ kind: "several_problems", problemCount: 2, productIds: [product(31)], newOrderId: null });
  });

  test("names the order of a payment request and opens the chat on the message", () => {
    const notice = chooseSellerNotice(outcomes(paymentRequested({ kind: "closed", orderId: order(7) })))!;
    expect(noticeReferences(notice).orderIds).toEqual([order(7)]);
    expect(sellerNoticeTarget(notice)).toEqual({ kind: "message" });
  });

  test("chooses «Pedido #N cambió» over «Revisa el pedido #N», «listo» and «Pedido nuevo» when armed", () => {
    const kept: ChatMessageOutcome = { kind: "only_item_kept", orderId: order(1) };
    const ready: ChatMessageOutcome = { kind: "ready", orderId: order(1) };
    const fresh: ChatMessageOutcome = { kind: "new_order_after_closed", orderId: order(4), previousOrderId: order(3) };
    expect(chooseSellerNotice(outcomes(fresh, ready, kept, changedAfterLink))).toEqual({ kind: "order_changed_after_link", orderId: order(1) });
    expect(sellerNoticeTarget({ kind: "order_changed_after_link", orderId: order(1) })).toEqual({ kind: "order", orderId: order(1) });
    expect(noticeReferences({ kind: "order_changed_after_link", orderId: order(1) }).orderIds).toEqual([order(1)]);
  });

  test("appends the changed-after-link sentence to an urgent problem when armed", () => {
    expect(chooseSellerNotice(outcomes(missing(31), changedAfterLink))).toEqual({ kind: "variant_missing", productId: product(31), newOrderId: null, changedAfterLink: true });
    expect(chooseSellerNotice(outcomes(missing(31)))).not.toHaveProperty("changedAfterLink");
  });

  test("closes the link cycle with an urgent notice carrying the changed-after-link sentence", () => {
    const readyWithPendings: ChatMessageOutcome = { kind: "ready_with_pendings", orderId: order(1), productIds: [product(31)], unnamed: 0 };
    expect(chooseSellerNotice(outcomes(readyWithPendings, changedAfterLink))).toMatchObject({ kind: "ready_with_pendings", changedAfterLink: true });
    expect(closesLinkCycle(chooseSellerNotice(outcomes(readyWithPendings, changedAfterLink)))).toBe(true);
    expect(closesLinkCycle(chooseSellerNotice(outcomes(added, changedAfterLink)))).toBe(true);
    expect(closesLinkCycle(chooseSellerNotice(outcomes(missing(31))))).toBe(false);
    expect(closesLinkCycle(chooseSellerNotice(outcomes(added)))).toBe(false);
  });

  test("appends the first problem's suggested question to the notice body", () => {
    expect(chooseSellerNotice(outcomes(missing(31), { kind: "questions", questions: [question] })))
      .toEqual({ kind: "variant_missing", productId: product(31), newOrderId: null, question });
  });

  test("one notice for two problems carries the first problem's question", () => {
    expect(chooseSellerNotice(outcomes(missing(31), { kind: "not_identified", source: "photo", identification: null, silent: false }, { kind: "questions", questions: [question, otherQuestion] })))
      .toMatchObject({ kind: "several_problems", problemCount: 2, question });
  });

  test("carries no question on a notice that is not a problem", () => {
    expect(chooseSellerNotice(outcomes({ kind: "ready", orderId: order(1) }, { kind: "questions", questions: [question] }))).toEqual({ kind: "ready", orderId: order(1) });
  });
});

describe("sellerNoticeKinds", () => {
  test("lists each kind once and covers every kind the notice union already has", () => {
    expect(new Set(sellerNoticeKinds).size).toBe(sellerNoticeKinds.length);
    expect(sellerNoticeKinds).toEqual(expect.arrayContaining(["several_problems", "new_order", "not_applied", "ready_with_pendings"]));
    expectTypeOf<SellerNotice["kind"]>().toEqualTypeOf<SellerNoticeKind>();
  });
});
