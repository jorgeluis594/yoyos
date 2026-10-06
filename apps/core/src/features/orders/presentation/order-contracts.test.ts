import { parseDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
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
  expect(stockOutcomeSchema.safeParse({ kind: "pending", reason: "INSUFFICIENT_STOCK" }).success).toBe(false);
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

test("delivery text boundaries accept their limits and reject excess without limiting recipient strings", () => {
  const recipient = { name: "n".repeat(1000), phone: "p".repeat(1000), identity: { kind: "document", documentType: "foreign_id", document: `00-${"a".repeat(1000)}` } };
  const home = { method: "home", recipient, destination: { address: "a".repeat(500), district: "d".repeat(120), instructions: "i".repeat(1000) } };
  const agency = { method: "agency", recipient, courierId: "00000000-0000-4000-8000-000000000002", agency: "a".repeat(500) };
  for (const parse of [deliverySelectionSchema.safeParse.bind(deliverySelectionSchema), parseDeliverySelection]) {
    expect(parse(home).success).toBe(true);
    expect(parse(agency).success).toBe(true);
    for (const [key, limit] of [["address", 500], ["district", 120], ["instructions", 1000]] as const) {
      expect(parse({ ...home, destination: { ...home.destination, [key]: "x".repeat(limit + 1) } }).success).toBe(false);
    }
    expect(parse({ ...agency, agency: "x".repeat(501) }).success).toBe(false);
  }
});
