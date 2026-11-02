import { describe, expect, test } from "vitest";
import { isOffered } from "@core/src/features/products/domain/product-visibility";
import type { Product } from "@core/src/features/products/domain/product";

const withVariants = (...statuses: ("active" | "inactive")[]) => statuses.map((status) => ({ status })) as unknown as Product["variants"];
const product = (hidden: boolean, ...statuses: ("active" | "inactive")[]) => ({ status: "active" as const, hidden, variants: withVariants(...statuses) });

describe("offered products", () => {
  test("a visible active product with an active variant is offered", () => {
    expect(isOffered(product(false, "inactive", "active"))).toBe(true);
  });

  test("a hidden product is not offered even with active variants", () => {
    expect(isOffered(product(true, "active", "active"))).toBe(false);
  });

  test("a product without active variants is not offered whether hidden or not", () => {
    expect(isOffered(product(false, "inactive"))).toBe(false);
    expect(isOffered(product(true, "inactive"))).toBe(false);
  });
});
