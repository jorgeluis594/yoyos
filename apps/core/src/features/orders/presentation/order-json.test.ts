import { expect, test } from "vitest";
import { createOrderSchema, listOrdersSchema } from "@shared/contracts/orders";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

test("parses only primitive order input", () => {
  const valid = { id: id(1), contactId: null, items: [{ variantId: id(2), quantity: 1 }] };
  expect(createOrderSchema.safeParse(valid).success).toBe(true);
  expect(createOrderSchema.safeParse({ ...valid, contactId: id(3) }).success).toBe(true);
  const completed = { ...valid, payment: { method: "digital_wallet" }, delivery: { method: "handover" } };
  expect(createOrderSchema.safeParse(completed).success).toBe(true);
  for (const invalid of ["{", { ...valid, id: "bad" }, { id: id(1), contactId: null },
    { ...valid, items: [{ variantId: id(2), quantity: 0 }] }, { ...valid, items: [{ variantId: id(2), quantity: 1.5 }] },
    { ...valid, total: 0.01 }, { ...valid, companyId: id(3) }, { ...valid, sellerId: "attacker" },
    { ...valid, completedAt: "2026-09-27T12:00:00.000Z" }, { ...valid, items: [{ variantId: id(2), quantity: 1, unitPrice: 0.01 }] },
    { ...valid, payment: completed.payment }, { ...valid, delivery: completed.delivery },
    { ...valid, payment: null, delivery: null }, { ...completed, payment: { method: "cash" } },
    { ...completed, delivery: { method: "home" } }, { ...completed, payment: { ...completed.payment, id: id(4) } },
    { ...completed, delivery: { ...completed.delivery, address: "Here" } }]) {
    expect(createOrderSchema.safeParse(invalid).success).toBe(false);
  }
});

test("parses all customer filters and validates date and pagination", () => {
  expect(listOrdersSchema.safeParse({}).data).toMatchObject({ page: 1, customer: "all" });
  expect(listOrdersSchema.safeParse({ customer: "general_public", page: "2" }).success).toBe(true);
  expect(listOrdersSchema.safeParse({ customer: "contact", contactId: id(1), completedFrom: "2026-09-27T00:00:00.000Z", completedBefore: "2026-09-28T00:00:00.000Z" }).success).toBe(true);
  for (const invalid of [{ page: "0" }, { page: "1.5" }, { page: "NaN" }, { customer: "contact" },
    { customer: "contact", contactId: "bad" }, { completedFrom: "2026-13-27" }]) {
    expect(listOrdersSchema.safeParse(invalid).success).toBe(false);
  }
});
