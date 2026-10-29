import { describe, expect, test } from "vitest";
import { chatPendingsSchema } from "@core/src/features/orders/domain/chat-pendings";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const variantPending = {
  id: id(1), subject: { kind: "variant", productId: id(2) }, known: { Talla: "M" }, quantity: 2,
  price: { amount: { amount: 70, currency: "PEN" }, per: "lot", forQuantity: 2 },
  order: null, lastChangedAt: "2026-10-28T12:00:00.000Z", sourceMessageId: id(3), requestId: id(1),
};

describe("chatPendingsSchema", () => {
  test("parses stored pendings and rejects an unknown subject kind as invalid stored data", () => {
    const parsed = chatPendingsSchema.parse({ pendings: [variantPending], readyRemembered: true });
    expect(parsed.readyRemembered).toBe(true);
    expect(parsed.pendings[0]).toMatchObject({ lastChangedAt: new Date("2026-10-28T12:00:00.000Z"), order: null, known: { Talla: "M" } });
    expect(chatPendingsSchema.safeParse({ pendings: [{ ...variantPending, subject: { kind: "other", productId: id(2) } }], readyRemembered: false }).success).toBe(false);
  });

  test("parses a doubtful-product pending attached to an order", () => {
    const doubtful = { ...variantPending, id: id(4), requestId: id(4), price: null,
      subject: { kind: "product", candidates: [id(5), id(6)] }, order: { orderId: id(7), attachedAt: "2026-10-28T13:00:00.000Z" } };
    expect(chatPendingsSchema.parse({ pendings: [doubtful], readyRemembered: false }).pendings[0]).toMatchObject({
      subject: { kind: "product", candidates: [id(5), id(6)] }, order: { orderId: id(7), attachedAt: new Date("2026-10-28T13:00:00.000Z") } });
  });

  test.each([
    ["more than ten pendings", { pendings: Array.from({ length: 11 }, (_, n) => ({ ...variantPending, id: id(100 + n), requestId: id(100 + n) })), readyRemembered: false }],
    ["a doubtful pending with a single candidate", { pendings: [{ ...variantPending, subject: { kind: "product", candidates: [id(5)] } }], readyRemembered: false }],
    ["a doubtful pending with more than four candidates", { pendings: [{ ...variantPending, subject: { kind: "product", candidates: [5, 6, 7, 8, 9].map(id) } }], readyRemembered: false }],
    ["a zero quantity", { pendings: [{ ...variantPending, quantity: 0 }], readyRemembered: false }],
    ["a fractional quantity", { pendings: [{ ...variantPending, quantity: 1.5 }], readyRemembered: false }],
    ["a date that is not ISO", { pendings: [{ ...variantPending, lastChangedAt: "yesterday" }], readyRemembered: false }],
    ["an unknown field", { pendings: [{ ...variantPending, text: "quiero una polera" }], readyRemembered: false }],
    ["an unknown price basis", { pendings: [{ ...variantPending, price: { ...variantPending.price, per: "dozen" } }], readyRemembered: false }],
    ["a missing ready flag", { pendings: [] }],
  ])("rejects %s", (_title, stored) => {
    expect(chatPendingsSchema.safeParse(stored).success).toBe(false);
  });

  test("accepts an empty set", () => {
    expect(chatPendingsSchema.parse({ pendings: [], readyRemembered: false })).toEqual({ pendings: [], readyRemembered: false });
  });
});
