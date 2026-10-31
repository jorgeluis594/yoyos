import { describe, expect, test } from "vitest";
import { chatMessageOutcomesSchema } from "@core/src/features/orders/domain/chat-message-outcome";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("chatMessageOutcomesSchema", () => {
  test("accepts the stored outcomes of a message", () => {
    const outcomes = [
      { kind: "added", variantId: id(1), quantity: 2, identification: { method: "qr", productId: id(2), confidence: null } },
      { kind: "not_clear", productIds: [id(2), id(3)], silent: false },
      { kind: "new_order_after_closed", orderId: id(4), previousOrderId: id(5) },
      { kind: "failed", errorCode: "RETRIES_EXHAUSTED" },
    ];
    expect(chatMessageOutcomesSchema.parse(outcomes)).toEqual(outcomes);
  });

  test("rejects an empty list, unknown kinds, extra fields and invalid ids", () => {
    expect(chatMessageOutcomesSchema.safeParse([]).success).toBe(false);
    expect(chatMessageOutcomesSchema.safeParse([{ kind: "teleported" }]).success).toBe(false);
    expect(chatMessageOutcomesSchema.safeParse([{ kind: "no_intent", extra: 1 }]).success).toBe(false);
    expect(chatMessageOutcomesSchema.safeParse([{ kind: "ready", orderId: "not-a-uuid" }]).success).toBe(false);
    expect(chatMessageOutcomesSchema.safeParse([{ kind: "failed", errorCode: "BOOM" }]).success).toBe(false);
  });

  test("accepts the outcomes of pendings, doubts and notices introduced with the single reader", () => {
    const outcomes = [
      { kind: "pending_created", pendingId: id(10) },
      { kind: "pending_updated", pendingId: id(10) },
      { kind: "pending_completed", pendingId: id(10) },
      { kind: "pending_split", pendingId: id(10), newPendingId: id(11) },
      { kind: "pending_ended", pendingId: id(10), reason: "order_closed" },
      { kind: "reader_doubt", orderId: id(4) },
      { kind: "request_not_allowed", orderId: null },
      { kind: "invalid_action", orderId: null, reason: "too_many_actions" },
      { kind: "product_not_available", productId: null },
      { kind: "variant_for_several_pendings", productIds: [id(2), id(3)], unnamed: 1 },
      { kind: "ready_with_pendings", orderId: null, productIds: [id(2)], unnamed: 0 },
      { kind: "caption_not_applied", productId: id(2), orderId: id(4) },
    ];
    expect(chatMessageOutcomesSchema.parse(outcomes)).toEqual(outcomes);
  });

  test("still reads the outcomes stored before pendings", () => {
    const outcomes = [{ kind: "no_intent" }, { kind: "ready", orderId: id(4) }];
    expect(chatMessageOutcomesSchema.parse(outcomes)).toEqual(outcomes);
  });

  test.each([
    ["an unknown pending end reason", { kind: "pending_ended", pendingId: id(10), reason: "forgotten" }],
    ["an unknown invalid action reason", { kind: "invalid_action", orderId: null, reason: "bad_mood" }],
    ["a pending id that is not a uuid", { kind: "pending_created", pendingId: "Q1" }],
    ["a doubt without its order id", { kind: "reader_doubt" }],
    ["a missing split remainder", { kind: "pending_split", pendingId: id(10) }],
  ])("rejects %s", (_title, outcome) => {
    expect(chatMessageOutcomesSchema.safeParse([outcome]).success).toBe(false);
  });

  test("accepts the outcomes of the staged reader and round-trips their structured questions", () => {
    const outcomes = [
      { kind: "payment_requested", order: { kind: "open", orderId: id(4) }, productIds: [id(2)], unnamed: 1 },
      { kind: "payment_requested", order: { kind: "none" }, productIds: [], unnamed: 0 },
      { kind: "changed_after_link", orderId: id(4) },
      { kind: "invalid_action", orderId: null, reason: "quantity_below_zero" },
      { kind: "questions", questions: [{ language: "pt", kind: "which_variant", product: "Polera", attribute: "Talla", values: ["S", "M"] }, { language: "es", kind: "photo_product_name" }] },
    ];
    expect(chatMessageOutcomesSchema.parse(JSON.parse(JSON.stringify(outcomes)))).toEqual(outcomes);
  });

  test.each([
    ["an empty list of questions", { kind: "questions", questions: [] }],
    ["a question of an unknown kind", { kind: "questions", questions: [{ language: "es", kind: "free_text", text: "hola" }] }],
    ["a question in an unsupported language", { kind: "questions", questions: [{ language: "en", kind: "photo_product_name" }] }],
    ["a payment request with an unknown order kind", { kind: "payment_requested", order: { kind: "later" }, productIds: [], unnamed: 0 }],
    ["a changed-after-link outcome without its order", { kind: "changed_after_link" }],
    ["the malformed reason the staged reader no longer has", { kind: "invalid_action", orderId: null, reason: "malformed" }],
  ])("rejects %s", (_title, outcome) => {
    expect(chatMessageOutcomesSchema.safeParse([outcome]).success).toBe(false);
  });
});
