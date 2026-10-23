import { expect, test } from "vitest";
import { createOrderSchema, listOrdersSchema } from "@shared/contracts/orders";
import { toLegacyOrderJson } from "@core/src/features/orders/presentation/order-json";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

test("parses only primitive order input", () => {
  const valid = { id: id(1), items: [{ variantId: id(2), quantity: 1 }] };
  expect(createOrderSchema.safeParse(valid).success).toBe(true);
  expect(createOrderSchema.safeParse({ ...valid, contactId: id(3) }).success).toBe(false);
  const completed = { ...valid, payment: { method: "digital_wallet" }, delivery: { method: "handover" } };
  expect(createOrderSchema.safeParse(completed).success).toBe(true);
  for (const invalid of ["{", { ...valid, id: "bad" }, { id: id(1) },
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
  expect(listOrdersSchema.safeParse({ completedFrom: "2026-09-27T00:00:00.000Z", completedBefore: "2026-09-28T00:00:00.000Z" }).success).toBe(true);
  for (const invalid of [{ page: "0" }, { page: "1.5" }, { page: "NaN" }, { customer: "contact" },
    { customer: "contact", contactId: id(1) }, { completedFrom: "2026-13-27" }]) {
    expect(listOrdersSchema.safeParse(invalid).success).toBe(false);
  }
});

test("complete creation accepts optional payments and delivery without client-calculated states", () => {
  const input = { id: id(1), items: [{ variantId: id(2), quantity: 1 }],
    payments: [{ paymentId: id(3), amount: { amount: 12, currency: "PEN" }, method: "bank_transfer", deductStockIfPartial: false }],
    delivery: { delivery: { method: "home", rateId: id(4), recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
      destination: { address: "Av. Lima 1", districtCode: "150122", instructions: null } }, expectedPrice: { amount: 2, currency: "PEN" } },
    deliverImmediately: false };
  expect(createOrderSchema.parse(input)).toEqual(input);
  for (const invalid of [{ ...input, status: "completed" }, { ...input, total: 12 },
    { ...input, payments: [{ ...input.payments[0], paymentId: "invalid" }] },
    { ...input, delivery: { ...input.delivery, cost: 0 } }, { ...input, deliverImmediately: "yes" }]) {
    expect(createOrderSchema.safeParse(invalid).success).toBe(false);
  }
});

test("the legacy order JSON keeps each item's stored mentioned price", () => {
  const money = (amount: number) => ({ amount, currency: "PEN" as const });
  const item = (n: number, mentionedPrice: { amount: ReturnType<typeof money>; units: number } | null) => ({ id: id(n), variantId: id(n + 1), productName: "Camisa",
    variantAttributes: { Talla: "M" }, sku: null, quantity: 2, unitPrice: money(10), subtotal: money(20), mentionedPrice });
  const priced = { amount: money(7.5), units: 2 };
  const order = { number: 1001, id: id(1), companyId: id(9), sellerId: "seller", buyer: null, chatId: null, fromCatalog: false, completedAt: new Date("2026-10-23T00:00:00.000Z"),
    deliveryStatus: "delivered", total: money(40), items: [item(10, priced), item(20, null)] } as unknown as OrderAggregate;
  expect(toLegacyOrderJson(order).items.map((entry) => entry.mentionedPrice)).toEqual([priced, null]);
});
