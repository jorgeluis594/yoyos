import { describe, expect, test } from "vitest";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, ContactId, OrderId, OrderItemId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { ConfirmedPayment } from "@core/src/features/orders/domain/payment";
import type { DeliveryPricing, DeliverySnapshot, OrderAggregate, PeruDeliveryDistrict } from "@core/src/features/orders/domain/order-state-machine";
import { orderRevisions, parseOrderRevision } from "@core/src/features/orders/domain/order-revisions";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-09-29T12:00:00Z");
const seller = { kind: "seller", userId: "seller" as UserId } as const;
const district = { country: "PE", districtCode: "150101", district: "Lima", province: "Lima", department: "Lima" } as unknown as PeruDeliveryDistrict;
const pricing = { quotationId: id(20), rateId: id(21), optionId: id(22), settingsVersion: 1 } as DeliveryPricing;
const home: DeliverySnapshot = { method: "home", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
  destination: { ...district, address: "Av. Lima 123", instructions: null }, pricing, recordedBy: seller };
const item = (n: number, quantity: number, unit: number) => ({ id: id(n) as OrderItemId, variantId: id(n + 100) as VariantId, productName: "Traje",
  variantAttributes: { Talla: "S" }, sku: null, quantity: quantity as PositiveInteger, unitPrice: money(unit), subtotal: money(unit * quantity), mentionedPrice: null });
const order = (): OrderAggregate => ({
  number: 1042 as OrderNumber, id: id(1) as OrderId, companyId: id(2) as CompanyId, sellerId: "seller" as UserId, fromCatalog: false,
  buyer: { contactId: id(50) as ContactId, name: "Luis", phone: "+51999111222" }, checkoutEnabledAt: null, checkoutConfirmedAt: null,
  createdAt: at, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelled: false, cancelledAt: null,
  items: [item(3, 1, 89), item(4, 2, 30)], payments: [], delivery: home, deliveryStatus: "pending", stockDeducted: false, stockDeductedAt: null,
  itemsTotal: money(149), deliveryCost: money(10), deliveryCharge: money(10), total: money(159),
});
const payment = (n: number, status: "confirmed" = "confirmed"): ConfirmedPayment => ({ id: id(n) as PaymentId, orderId: id(1) as OrderId, status, amount: money(50),
  method: "digital_wallet", deductStockIfPartial: false, data: { confirmedAt: at, confirmedBy: seller, evidence: { kind: "manual" } } });

describe("order revisions", () => {
  test("gives the same revisions for the same order read twice", () => {
    expect(orderRevisions(order())).toEqual(orderRevisions(order()));
  });

  test("gives 43-character url-safe tokens that parse back", () => {
    const revisions = orderRevisions(order());
    for (const token of Object.values(revisions)) expect(parseOrderRevision(token)).toEqual({ success: true, data: token });
    expect(parseOrderRevision("short")).toMatchObject({ success: false });
  });

  test("changes only the items revision when a quantity changes", () => {
    const before = orderRevisions(order());
    const base = order();
    const after = orderRevisions({ ...base, items: [{ ...base.items[0], quantity: 2 as PositiveInteger }, base.items[1]!] });
    expect(after.items).not.toBe(before.items);
    expect(after.customer).toBe(before.customer);
    expect(after.delivery).toBe(before.delivery);
  });

  test("keeps the items revision when only copied catalog data or the stored order of the array changes", () => {
    const base = order();
    const renamed = { ...base, items: [{ ...base.items[0], productName: "Otro", variantAttributes: { Talla: "M" }, sku: "X" }, base.items[1]!] as typeof base.items };
    const swapped = { ...base, items: [base.items[1]!, base.items[0]] as unknown as typeof base.items };
    expect(orderRevisions(renamed).items).toBe(orderRevisions(base).items);
    expect(orderRevisions(swapped).items).toBe(orderRevisions(base).items);
  });

  test("changes only the customer revision when the buyer phone changes", () => {
    const before = orderRevisions(order());
    const after = orderRevisions({ ...order(), buyer: { contactId: id(50) as ContactId, name: "Luis", phone: "+51999111333" } });
    expect(after.customer).not.toBe(before.customer);
    expect(after.items).toBe(before.items);
    expect(after.delivery).toBe(before.delivery);
  });

  test("tells a missing buyer from a contact with empty details", () => {
    const none = orderRevisions({ ...order(), buyer: null }).customer;
    const empty = orderRevisions({ ...order(), buyer: { contactId: id(50) as ContactId, name: null, phone: null } }).customer;
    expect(none).not.toBe(empty);
  });

  test("changes only the delivery revision when the delivery author changes", () => {
    const before = orderRevisions(order());
    const after = orderRevisions({ ...order(), delivery: { ...home, recordedBy: { kind: "buyer" } } });
    expect(after.delivery).not.toBe(before.delivery);
    expect(after.items).toBe(before.items);
    expect(after.customer).toBe(before.customer);
  });

  test("gives different tokens to parts with equal content", () => {
    const revisions = orderRevisions({ ...order(), buyer: null, delivery: null });
    expect(revisions.customer).not.toBe(revisions.delivery);
  });

  test("keeps every revision when a payment is added, voided or rejected", () => {
    const before = orderRevisions(order());
    const withPayment = { ...order(), payments: [payment(60)] };
    const voided = { ...withPayment, payments: [{ ...payment(60), status: "voided" } as unknown as ConfirmedPayment] };
    expect(orderRevisions(withPayment)).toEqual(before);
    expect(orderRevisions(voided)).toEqual(before);
  });

  test("keeps every revision when stock is deducted or the order is shipped", () => {
    const before = orderRevisions(order());
    const deducted = { ...order(), stockDeducted: true, stockDeductedAt: at };
    const shipped = { ...deducted, deliveryStatus: "shipped" as const, shippedAt: at };
    expect(orderRevisions(deducted)).toEqual(before);
    expect(orderRevisions(shipped)).toEqual(before);
  });
});
