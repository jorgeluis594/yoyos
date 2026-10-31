import { describe, expect, test } from "vitest";
import { changeDecisionSchema, doubtReasonSchema } from "@core/src/features/orders/domain/reader/decision";

const reasons = [
  { kind: "variant_changed", attribute: "Talla", from: "M", to: "L" },
  { kind: "quantity_set", quantity: 3 },
  { kind: "added_by_reference", quantity: 1, quote: 2 },
  { kind: "added_by_reference", quantity: 1, quote: null },
  { kind: "removed", product: "Polera" },
  { kind: "caption_unread" },
  { kind: "inherited", from: { kind: "inherited", from: { kind: "caption_unread" } } },
];

describe("doubtReasonSchema", () => {
  test.each(reasons)("round-trips %j", (reason) => {
    expect(doubtReasonSchema.parse(JSON.parse(JSON.stringify(reason)))).toEqual(reason);
  });

  test.each([
    ["an unknown kind", { kind: "gut_feeling" }],
    ["a zero quantity", { kind: "quantity_set", quantity: 0 }],
    ["a fractional quantity", { kind: "quantity_set", quantity: 1.5 }],
    ["an inherited reason without its origin", { kind: "inherited" }],
    ["an inherited reason from an unknown kind", { kind: "inherited", from: { kind: "gut_feeling" } }],
    ["an extra field", { kind: "caption_unread", text: "hola" }],
  ])("rejects %s", (_title, stored) => {
    expect(doubtReasonSchema.safeParse(stored).success).toBe(false);
  });
});

describe("changeDecisionSchema", () => {
  test.each([
    { kind: "applied" },
    { kind: "doubtful", reason: { kind: "caption_unread" } },
    { kind: "pending" },
    { kind: "urgent", problem: "not_clear", question: { language: "es", kind: "which_product", products: ["Polera", "Short"] } },
    { kind: "urgent", problem: "no_open_order", question: null },
    { kind: "silent" },
  ])("round-trips %j", (decision) => {
    expect(changeDecisionSchema.parse(JSON.parse(JSON.stringify(decision)))).toEqual(decision);
  });

  test.each([
    ["a doubtful decision without a reason", { kind: "doubtful" }],
    ["an urgent decision with an unknown problem", { kind: "urgent", problem: "weather", question: null }],
    ["an unknown decision", { kind: "maybe" }],
  ])("rejects %s", (_title, stored) => {
    expect(changeDecisionSchema.safeParse(stored).success).toBe(false);
  });
});
