import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, OrderId, OrderItemId, UserId } from "@core/src/features/orders/domain/order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { VariantId } from "@core/src/features/products/domain/product";
import { toOrderAggregateJson } from "@core/src/features/orders/presentation/order-json";
import { buildPendingOrder, parseRatedDeliverySelection, parseDeliverySnapshot } from "@core/src/features/orders/domain/order-state-machine";
import { expect, test } from "vitest";
import { orderSchema, orderBuyerSchema, orderCustomerSchema, completeOrderSchema, deliverySnapshotSchema, ratedDeliverySelectionSchema, setRatedOrderDeliverySchema, listOrdersSchema, orderApiErrorSchema, registerPaymentSchema } from "@shared/contracts/orders";
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

test("list filters reject a contact and reversed interval", () => {
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
  const id = "00000000-0000-4000-8000-000000000002";
  const agency = { method: "agency", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
    destination: { country: "PE", districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima" },
    pricing: { quotationId: id, rateId: id, optionId: id, settingsVersion: 1 }, recordedBy: { kind: "seller", userId: "seller" },
    courier: { id, name: "Courier" }, agency: { id, name: "Branch", address: "Av. Test 123", location: { country: "PE", districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima" } } };
  expect(deliverySnapshotSchema.safeParse(agency).success).toBe(false);
  const documented = { ...agency, recipient: { ...agency.recipient, identity: { kind: "document", documentType: "passport", document: "A-001" } } };
  expect(deliverySnapshotSchema.safeParse(documented).success).toBe(true);
  for (const change of [{ agency: "Lima" }, { courier: null }, { agency: null }, { courier: null, agency: null }, { agency: { ...agency.agency, location: undefined } }])
    expect(deliverySnapshotSchema.safeParse({ ...documented, ...change }).success).toBe(false);
});

test("delivery selections cannot supply authority or resolved destinations", () => {
  const selection = { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } };
  expect(ratedDeliverySelectionSchema.safeParse(selection).success).toBe(true);
  for (const extra of [{ recordedBy: { kind: "buyer" } }, { pickupPoint: { name: "Fake", address: "Fake", instructions: null } },
    { cost: 0 }, { courier: { id: "foreign", name: "Fake" } }, { destination: { storeId: "old" } }]) {
    expect(ratedDeliverySelectionSchema.safeParse({ ...selection, ...extra }).success).toBe(false);
  }
  expect(setRatedOrderDeliverySchema.safeParse({ delivery: selection, obsoleteCharge: true, companyId: "other" }).success).toBe(false);
  const snapshot = { ...selection, settingsVersion: 1, pickupPoint: { name: "Tienda", address: "Av. Lima 123", instructions: null } };
  expect(deliverySnapshotSchema.safeParse(snapshot).success).toBe(false);
  expect(deliverySnapshotSchema.safeParse({ ...snapshot, recordedBy: { kind: "seller" } }).success).toBe(false);
  expect(deliverySnapshotSchema.safeParse({ ...snapshot, recordedBy: { kind: "buyer" } }).success).toBe(true);
});

test("delivery text boundaries accept their limits and reject excess without limiting recipient strings", () => {
  const recipient = { name: "n".repeat(1000), phone: "p".repeat(1000), identity: { kind: "document", documentType: "foreign_id", document: `00-${"a".repeat(1000)}` } };
  const rateId = "00000000-0000-4000-8000-000000000002";
  const home = { method: "home", rateId, recipient, destination: { districtCode: "150122", address: "a".repeat(500), instructions: "i".repeat(1000) } };
  for (const parse of [ratedDeliverySelectionSchema.safeParse.bind(ratedDeliverySelectionSchema), parseRatedDeliverySelection]) {
    expect(parse(home).success).toBe(true);
    for (const [key, limit] of [["address", 500], ["instructions", 1000]] as const) {
      expect(parse({ ...home, destination: { ...home.destination, [key]: "x".repeat(limit + 1) } }).success).toBe(false);
    }
  }
});

test("rated snapshots require complete pricing and geographic references and reject free-text agencies and snapshots without pricing", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const recipient = { name: "Ana", phone: "999", identity: { kind: "document", documentType: "national_id", document: "12345678" } };
  const pricing = { quotationId: id, rateId: id, optionId: id, settingsVersion: 2 };
  const district = { country: "PE", districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima" };
  const author = { kind: "buyer" };
  const home = { method: "home", recipient, destination: { ...district, address: "Street", instructions: null }, pricing, recordedBy: author };
  const catalogAgency = { id, name: "Branch", address: "Av. Test 123", location: district };
  const assignedAgency = { method: "agency", recipient, destination: district, pricing, courier: { id, name: "Courier" }, agency: catalogAgency, recordedBy: author };
  const pendingAgency = { ...assignedAgency, courier: null, agency: null };
  const freeTextAgency = { ...assignedAgency, agency: "Office" };
  const pickup = { method: "store", recipient, pickupPoint: { name: "Shop", address: "Street", instructions: null }, settingsVersion: 2, recordedBy: author };
  for (const value of [home, assignedAgency, pickup]) {
    expect(deliverySnapshotSchema.safeParse(value).success).toBe(true);
    expect(parseDeliverySnapshot(value).success).toBe(true);
  }
  const obsolete = { method: "home", recipient, destination: { address: "Street", district: "Old free text", instructions: null }, recordedBy: author };
  expect(parseDeliverySnapshot(obsolete).success).toBe(false);
  expect(deliverySnapshotSchema.safeParse(obsolete).success).toBe(false);
  for (const value of [{ ...home, pricing: { ...pricing, rateId: null } }, { ...home, pricing: { rateId: id } },
    { ...home, destination: obsolete.destination }, pendingAgency, freeTextAgency,
    { ...assignedAgency, courier: null }, { ...assignedAgency, agency: null }, { ...assignedAgency, agency: "" }, { ...pickup, settingsVersion: undefined }, { ...assignedAgency, courier: { id, name: "" } },
    { ...assignedAgency, pricing: { ...pricing, settingsVersion: -1 } }, { ...pickup, pricing }, { ...pickup, destination: district },
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
  for (const value of [{ ...home, obsoleteCharge: false }, { ...home, price: home.expectedPrice }, { ...home, expectedPrice: undefined },
    { ...home, delivery: { ...home.delivery, rateId: undefined } }, { ...home, delivery: { method: "store", recipient, rateId: id } }]) {
    expect(setRatedOrderDeliverySchema.safeParse(value).success).toBe(false);
  }
});


test("price conflict metadata validates a nonnegative current price, including explicit zero", () => {
  const base = { code: "TOTAL_CHANGED", error: "Review" };
  for (const amount of [-1, 8.001, Infinity]) expect(orderApiErrorSchema.safeParse({ ...base, currentPrice: { amount, currency: "PEN" } }).success).toBe(false);
  expect(orderApiErrorSchema.safeParse({ ...base, currentPrice: { amount: 0, currency: "PEN" } }).success).toBe(true);
});

test("the canonical assignment contract requires a reviewed price and rejects obsolete charge choices", () => {
  const delivery = { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } };
  const current = { delivery, expectedPrice: { amount: 0, currency: "PEN" } };
  expect(setRatedOrderDeliverySchema.safeParse(current).success).toBe(true);
  expect(setRatedOrderDeliverySchema.safeParse({ delivery }).success).toBe(false);
  for (const obsoleteCharge of [true, false]) {
    expect(setRatedOrderDeliverySchema.safeParse({ delivery, obsoleteCharge }).success).toBe(false);
    expect(setRatedOrderDeliverySchema.safeParse({ ...current, obsoleteCharge }).success).toBe(false);
  }
});

test("creation rejects obsolete deliveries and accepts reviewed rated deliveries", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const base = { id, items: [{ variantId: id, quantity: 1 }] };
  const delivery = { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } };
  expect(completeOrderSchema.safeParse(base).success).toBe(true);
  expect(completeOrderSchema.safeParse({ ...base, delivery: { delivery, expectedPrice: { amount: 0, currency: "PEN" } } }).success).toBe(true);
  for (const obsoleteCharge of [true, false]) {
    expect(completeOrderSchema.safeParse({ ...base, delivery: { delivery, obsoleteCharge } }).success).toBe(false);
  }
});

test("accepts orders whose buyer and contact customer have a null phone", () => {
  const contactId = "00000000-0000-4000-8000-000000000001";
  expect(orderBuyerSchema.safeParse({ contactId, name: null, phone: null }).success).toBe(true);
  expect(orderCustomerSchema.safeParse({ kind: "contact", contactId, name: null, phone: null }).success).toBe(true);
});

test("serializes the order source and defaults to manual", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const built = buildPendingOrder({ number: 1001 as OrderNumber, id: id(2) as OrderId, companyId: id(1) as CompanyId, sellerId: "seller" as UserId,
    customer: { kind: "general_public" }, createdAt: new Date("2026-10-01"), items: [{ id: id(3) as OrderItemId, variantId: id(4) as VariantId,
      productName: "Item", variantAttributes: {}, sku: null, quantity: 1, unitPrice: { amount: 10, currency: "PEN" } }] });
  if (!built.success) throw new Error("Invalid fixture");
  expect(toOrderAggregateJson({ ...built.data, chatId: id(5) as ChatId }).source).toBe("whatsapp");
  expect(toOrderAggregateJson(built.data).source).toBe("manual");
  expect(orderSchema.shape.source.safeParse("telegram").success).toBe(false);
});
