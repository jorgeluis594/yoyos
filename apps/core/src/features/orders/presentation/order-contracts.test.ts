import { expect, test } from "vitest";
import { deliverySnapshotSchema, deliverySelectionSchema, setOrderDeliverySchema, listOrdersSchema, orderApiErrorSchema, registerPaymentSchema, stockOutcomeSchema } from "@shared/contracts/orders";
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

test("payment and delivery contracts reject invented fields and incomplete agency identity", () => {
  const payment = { paymentId: "00000000-0000-4000-8000-000000000001", amount: { amount: 1, currency: "PEN" },
    method: "digital_wallet", deductStockIfPartial: false };
  expect(registerPaymentSchema.safeParse(payment).success).toBe(true);
  expect(registerPaymentSchema.safeParse({ ...payment, stockDeducted: true }).success).toBe(false);
  expect(registerPaymentSchema.safeParse({ ...payment, amount: { amount: 1, currency: "XYZ" } }).success).toBe(false);
  const agency = { method: "agency", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
    courier: { id: "00000000-0000-4000-8000-000000000002", name: "Courier" }, agency: "Lima", recordedBy: { kind: "seller", userId: "seller" } };
  expect(deliverySnapshotSchema.safeParse(agency).success).toBe(false);
  expect(deliverySnapshotSchema.safeParse({ ...agency, recipient: { ...agency.recipient,
    identity: { kind: "document", documentType: "passport", document: "A-001" } } }).success).toBe(true);
  expect(stockOutcomeSchema.safeParse({ kind: "pending", reason: "INSUFFICIENT_STOCK" }).success).toBe(true);
});

test("delivery selections cannot supply authority or resolved destinations", () => {
  const selection = { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } };
  expect(deliverySelectionSchema.safeParse(selection).success).toBe(true);
  for (const extra of [{ recordedBy: { kind: "buyer" } }, { pickupPoint: { name: "Fake", address: "Fake", instructions: null } },
    { cost: 0 }, { courier: { id: "foreign", name: "Fake" } }, { destination: { storeId: "old" } }]) {
    expect(deliverySelectionSchema.safeParse({ ...selection, ...extra }).success).toBe(false);
  }
  expect(setOrderDeliverySchema.safeParse({ delivery: selection, chargeDeliveryToCustomer: true, companyId: "other" }).success).toBe(false);
  const snapshot = { ...selection, pickupPoint: { name: "Tienda", address: "Av. Lima 123", instructions: null } };
  expect(deliverySnapshotSchema.safeParse(snapshot).success).toBe(false);
  expect(deliverySnapshotSchema.safeParse({ ...snapshot, recordedBy: { kind: "seller" } }).success).toBe(false);
  expect(deliverySnapshotSchema.safeParse({ ...snapshot, recordedBy: { kind: "buyer" } }).success).toBe(true);
});
