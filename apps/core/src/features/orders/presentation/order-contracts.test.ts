import { parseDeliverySelection, parseDeliverySnapshot } from "@core/src/features/orders/domain/order-state-machine";
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


test("rated snapshots require complete pricing and geographic references while historical snapshots stay explicit", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const recipient = { name: "Ana", phone: "999", identity: { kind: "document", documentType: "national_id", document: "12345678" } };
  const pricing = { quotationId: id, rateId: id, zoneId: id, settingsVersion: 2 };
  const district = { country: "PE", districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima" };
  const author = { kind: "buyer" };
  const home = { method: "home", recipient, destination: { ...district, address: "Street", instructions: null }, pricing, recordedBy: author };
  const pendingAgency = { method: "agency", recipient, destination: district, pricing, courier: null, agency: null, recordedBy: author };
  const assignedAgency = { ...pendingAgency, courier: { id, name: "Courier" }, agency: "Office" };
  const pickup = { method: "store", recipient, pickupPoint: { name: "Shop", address: "Street", instructions: null }, settingsVersion: 2, recordedBy: author };
  for (const value of [home, pendingAgency, assignedAgency, pickup]) {
    expect(deliverySnapshotSchema.safeParse(value).success).toBe(true);
    expect(parseDeliverySnapshot(value).success).toBe(true);
  }
  const legacy = { method: "home", recipient, destination: { address: "Street", district: "Old free text", instructions: null }, recordedBy: author };
  expect(parseDeliverySnapshot(legacy)).toMatchObject({ success: true, data: legacy });
  expect(deliverySnapshotSchema.parse(legacy)).not.toHaveProperty("pricing");
  for (const value of [{ ...home, pricing: { ...pricing, rateId: null } }, { ...home, pricing: { rateId: id } },
    { ...home, destination: legacy.destination }, { ...pendingAgency, courier: null, agency: "Office" },
    { ...pendingAgency, courier: assignedAgency.courier, agency: null }, { ...pendingAgency, courier: { id, name: "" }, agency: "" },
    { ...pendingAgency, pricing: { ...pricing, settingsVersion: -1 } }, { ...pickup, pricing }, { ...pickup, destination: district },
    { ...pickup, settingsVersion: -1 }]) {
    expect(deliverySnapshotSchema.safeParse(value).success).toBe(false);
    expect(parseDeliverySnapshot(value).success).toBe(false);
  }
  expect(parseDeliverySnapshot({ ...home, destination: { ...home.destination, districtCode: "999999" } }).success).toBe(false);
});

test("rated requests require a rate for shipping, reject manual charge decisions and forbid rates for pickup", async () => {
  const { setRatedOrderDeliverySchema } = await import("@shared/contracts/orders");
  const recipient = { name: "Ana", phone: "999", identity: { kind: "absent" } };
  const id = "00000000-0000-4000-8000-000000000001";
  const home = { delivery: { method: "home", rateId: id, recipient, destination: { districtCode: "150122", address: "Street", instructions: null } }, expectedPrice: { amount: 8, currency: "PEN" } };
  expect(setRatedOrderDeliverySchema.safeParse(home).success).toBe(true);
  expect(setRatedOrderDeliverySchema.safeParse({ delivery: { method: "store", recipient }, expectedPrice: { amount: 0, currency: "PEN" } }).success).toBe(true);
  for (const value of [{ ...home, chargeDeliveryToCustomer: false }, { ...home, price: home.expectedPrice }, { ...home, expectedPrice: undefined },
    { ...home, delivery: { ...home.delivery, rateId: undefined } }, { ...home, delivery: { method: "store", recipient, rateId: id } }]) {
    expect(setRatedOrderDeliverySchema.safeParse(value).success).toBe(false);
  }
});


test("price conflict metadata validates a nonnegative current price, including explicit zero", () => {
  const base = { code: "TOTAL_CHANGED", error: "Review" };
  for (const amount of [-1, 8.001, Infinity]) expect(orderApiErrorSchema.safeParse({ ...base, currentPrice: { amount, currency: "PEN" } }).success).toBe(false);
  expect(orderApiErrorSchema.safeParse({ ...base, currentPrice: { amount: 0, currency: "PEN" } }).success).toBe(true);
});
