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
});
