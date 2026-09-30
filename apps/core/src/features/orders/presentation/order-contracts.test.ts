import { expect, test } from "vitest";
import { listOrdersSchema, orderApiErrorSchema } from "@shared/contracts/orders";
import { limaMidnightUtc, nextCalendarDay } from "@shared/orders-date";

test("a Lima calendar day has its own UTC bounds across an offset change", () => {
  expect(limaMidnightUtc("1989-12-31")).toBe("1989-12-31T05:00:00.000Z");
  expect(limaMidnightUtc(nextCalendarDay("1989-12-31"))).toBe("1990-01-01T04:00:00.000Z");
  expect(limaMidnightUtc(nextCalendarDay("2026-12-31"))).toBe("2027-01-01T05:00:00.000Z");
});

test("order API errors retain an affected item without accepting other feature codes", () => {
  expect(orderApiErrorSchema.safeParse({ code: "INSUFFICIENT_STOCK", error: "Stock", issues: [
    { field: "items", reason: "Unavailable", index: 0, variantId: "00000000-0000-4000-8000-000000000001" },
  ] }).success).toBe(true);
  expect(orderApiErrorSchema.safeParse({ code: "DUPLICATE_SKU", error: "Wrong feature" }).success).toBe(false);
});

test("list filters reject an unrelated contact and reversed interval", () => {
  expect(listOrdersSchema.safeParse({ customer: "all", contactId: "00000000-0000-4000-8000-000000000001" }).success).toBe(false);
  expect(listOrdersSchema.safeParse({ completedFrom: "2026-09-29T05:00:00.000Z", completedBefore: "2026-09-28T05:00:00.000Z" }).success).toBe(false);
  expect(listOrdersSchema.safeParse({ page: String(Number.MAX_SAFE_INTEGER) }).success).toBe(false);
  expect(listOrdersSchema.safeParse({ completedFrom: "2026-09-28T05:00:00Z", completedBefore: "2026-09-28T05:00:00.001Z" }).success).toBe(true);
});
