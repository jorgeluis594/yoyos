import { describe, expect, test } from "vitest";
import { notAvailableReason, refusesRaise } from "@core/src/features/orders/domain/product-availability";

describe("product availability", () => {
  test("a hidden product's reason is hidden and a missing product's is not sold", () => {
    expect(notAvailableReason({ hidden: true })).toBe("hidden");
    expect(notAvailableReason({ hidden: false })).toBe("not_sold");
    expect(notAvailableReason(null)).toBe("not_sold");
  });

  test("raising or setting above the quantity is refused only for a hidden product", () => {
    const item = { quantity: 2 };
    expect(refusesRaise({ hidden: true }, item, { kind: "increase_quantity" })).toBe(true);
    expect(refusesRaise({ hidden: true }, item, { kind: "set_quantity", quantity: 3 })).toBe(true);
    expect(refusesRaise({ hidden: true }, item, { kind: "set_quantity", quantity: 2 })).toBe(false);
    expect(refusesRaise({ hidden: true }, item, { kind: "set_quantity", quantity: 0 })).toBe(false);
    expect(refusesRaise({ hidden: false }, item, { kind: "increase_quantity" })).toBe(false);
    expect(refusesRaise({ hidden: false }, item, { kind: "set_quantity", quantity: 9 })).toBe(false);
    expect(refusesRaise(null, item, { kind: "increase_quantity" })).toBe(false);
  });
});
