import { expect, test } from "vitest";
import { checkoutPathSchema, publicCheckoutDeliverySchema, confirmCheckoutSchema, publicCheckoutSchema } from "@shared/contracts/order-checkout";

const valid = { buyer: { name: "Ana", phone: "+51987654321" }, expectedTotal: { amount: 10.5, currency: "PEN" } };

test("checkout boundaries reject extra authority, malformed UUIDs and invalid money or buyer values", () => {
  expect(confirmCheckoutSchema.safeParse(valid).success).toBe(true);
  for (const body of [{ ...valid, companyId: "foreign" }, { ...valid, orderId: "foreign" }, { ...valid, contactId: "contact" },
    { ...valid, checkoutConfirmedAt: new Date().toISOString() }, { ...valid, buyer: { ...valid.buyer, contactId: "contact" } },
    { ...valid, buyer: { name: " ", phone: valid.buyer.phone } }, { ...valid, expectedTotal: { amount: 10.501, currency: "PEN" } },
    { ...valid, expectedTotal: { amount: Infinity, currency: "PEN" } }, { ...valid, expectedTotal: { amount: -1, currency: "PEN" } },
    { ...valid, expectedTotal: { amount: 10, currency: "XXX" } }, { buyer: valid.buyer }]) expect(confirmCheckoutSchema.safeParse(body).success).toBe(false);
  expect(checkoutPathSchema.safeParse({ companyId: "company", orderId: "1001" }).success).toBe(false);
});

test("public response validates confirmed buyers and excludes private aggregate fields", () => {
  const view = { companyName: "Store", number: 1001, buyer: null, delivery: null, deliveryCharge: { amount: 0, currency: "PEN" }, itemsTotal: valid.expectedTotal, total: valid.expectedTotal,
    items: [{ productName: "Product", variantAttributes: {}, sku: null, quantity: 1, unitPrice: valid.expectedTotal, subtotal: valid.expectedTotal }], state: { kind: "pending" } };
  expect(publicCheckoutSchema.safeParse(view).success).toBe(true);
  for (const response of [{ ...view, sellerId: "seller" }, { ...view, payments: [] }, { ...view, deliveryCost: valid.expectedTotal },
    { ...view, buyer: { ...valid.buyer, contactId: "contact" } }, { ...view, state: { kind: "confirmed", confirmedAt: "2026-01-01T00:00:00.000Z" } }])
    expect(publicCheckoutSchema.safeParse(response).success).toBe(false);
});


test("public delivery keeps historical and pending agency snapshots and excludes author identity", () => {
  const recipient = { name: "Ana", phone: "999", identity: { kind: "absent" } };
  const historical = { method: "home", recipient, destination: { address: "Street", district: "Old district", instructions: null } };
  expect(publicCheckoutDeliverySchema.safeParse(historical).success).toBe(true);
  expect(publicCheckoutDeliverySchema.safeParse({ ...historical, recordedBy: { kind: "seller", userId: "private" } }).success).toBe(false);
  const agency = { method: "agency", recipient: { ...recipient, identity: { kind: "document", documentType: "passport", document: "001" } },
    destination: { country: "PE", districtCode: "150122", district: "MIRAFLORES", province: "LIMA METROPOLITANA", department: "LIMA" },
    pricing: { quotationId: "00000000-0000-4000-8000-000000000001", rateId: "00000000-0000-4000-8000-000000000002",
      zoneId: "00000000-0000-4000-8000-000000000003", settingsVersion: 2 }, courier: null, agency: null };
  expect(publicCheckoutDeliverySchema.safeParse(agency).success).toBe(true);
  expect(publicCheckoutDeliverySchema.safeParse({ ...agency, courier: { id: agency.pricing.zoneId, name: "Courier" }, agency: "Office" }).success).toBe(true);
  const store = { method: "store", recipient, pickupPoint: { name: "Shop", address: "Street", instructions: null } };
  expect(publicCheckoutDeliverySchema.safeParse(store).success).toBe(true);
  expect(publicCheckoutDeliverySchema.safeParse({ ...store, settingsVersion: 2 }).success).toBe(true);
  expect(publicCheckoutDeliverySchema.safeParse({ ...agency, courier: { id: agency.pricing.zoneId, name: "Courier" } }).success).toBe(false);
});
