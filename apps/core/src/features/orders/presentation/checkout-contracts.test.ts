import { expect, test } from "vitest";
import { checkoutPathSchema, publicCheckoutDeliverySchema, confirmCheckoutDeliverySchema, confirmCheckoutSchema, publicCheckoutSchema, checkoutDeliveryOptionsSchema } from "@shared/contracts/order-checkout";

const valid = { buyer: { name: "Ana", phone: "+51987654321" }, expectedTotal: { amount: 10.5, currency: "PEN" } };

test("checkout boundaries reject extra authority, malformed UUIDs and invalid money or buyer values", () => {
  expect(confirmCheckoutSchema.safeParse(valid).success).toBe(true);
  for (const body of [{ ...valid, companyId: "foreign" }, { ...valid, orderId: "foreign" }, { ...valid, contactId: "contact" },
    { ...valid, checkoutConfirmedAt: new Date().toISOString() }, { ...valid, buyer: { ...valid.buyer, contactId: "contact" } },
    { ...valid, buyer: { name: " ", phone: valid.buyer.phone } }, { ...valid, expectedTotal: { amount: 10.501, currency: "PEN" } },
    { ...valid, expectedTotal: { amount: Infinity, currency: "PEN" } }, { ...valid, expectedTotal: { amount: -1, currency: "PEN" } },
    { ...valid, expectedTotal: { amount: 10, currency: "XXX" } }, { buyer: valid.buyer }]) expect(confirmCheckoutSchema.safeParse(body).success).toBe(false);
  expect(checkoutPathSchema.safeParse({ orderId: "1001" }).success).toBe(false);
});

test("public response validates confirmed buyers and excludes private aggregate fields", () => {
  const view = { companyName: "Store", number: 1001, buyer: null, delivery: null, deliveryCharge: { amount: 0, currency: "PEN" }, itemsTotal: valid.expectedTotal, total: valid.expectedTotal,
    items: [{ productName: "Product", variantAttributes: {}, sku: null, imageUrl: null, quantity: 1, unitPrice: valid.expectedTotal, subtotal: valid.expectedTotal }], state: { kind: "pending" } };
  expect(publicCheckoutSchema.safeParse(view).success).toBe(true);
  for (const response of [{ ...view, sellerId: "seller" }, { ...view, payments: [] }, { ...view, deliveryCost: valid.expectedTotal },
    { ...view, buyer: { ...valid.buyer, contactId: "contact" } }, { ...view, state: { kind: "confirmed", confirmedAt: "2026-01-01T00:00:00.000Z" } }])
    expect(publicCheckoutSchema.safeParse(response).success).toBe(false);
});


test("public delivery keeps rated snapshots, rejects obsolete shapes and excludes author identity", () => {
  const recipient = { name: "Ana", phone: "999", identity: { kind: "absent" } };
  const pricing = { quotationId: "00000000-0000-4000-8000-000000000001", rateId: "00000000-0000-4000-8000-000000000002",
    optionId: "00000000-0000-4000-8000-000000000003", settingsVersion: 2 };
  const district = { country: "PE", districtCode: "150122", district: "MIRAFLORES", province: "LIMA METROPOLITANA", department: "LIMA" };
  const home = { method: "home", recipient, destination: { ...district, address: "Street", instructions: null }, pricing };
  expect(publicCheckoutDeliverySchema.safeParse(home).success).toBe(true);
  expect(publicCheckoutDeliverySchema.safeParse({ ...home, recordedBy: { kind: "seller", userId: "private" } }).success).toBe(false);
  expect(publicCheckoutDeliverySchema.safeParse({ ...home, pricing: undefined, destination: { address: "Street", district: "Old district", instructions: null } }).success).toBe(false);
  const agency = { method: "agency", recipient: { ...recipient, identity: { kind: "document", documentType: "passport", document: "001" } },
    destination: district, pricing, courier: { id: pricing.optionId, name: "Courier" },
    agency: { id: pricing.rateId, name: "Branch", address: "Av. Test 123", location: district } };
  expect(publicCheckoutDeliverySchema.safeParse(agency).success).toBe(true);
  expect(publicCheckoutDeliverySchema.safeParse({ ...agency, agency: "Office" }).success).toBe(false);
  expect(publicCheckoutDeliverySchema.safeParse({ ...agency, courier: null, agency: null }).success).toBe(false);
  const store = { method: "store", recipient, pickupPoint: { name: "Shop", address: "Street", instructions: null }, settingsVersion: 2 };
  expect(publicCheckoutDeliverySchema.safeParse(store).success).toBe(true);
  expect(publicCheckoutDeliverySchema.safeParse({ ...store, settingsVersion: undefined }).success).toBe(false);
});

test("delivery confirmation requires explicit change, rate identity and independently valid expected price", () => {
  expect(confirmCheckoutDeliverySchema.safeParse({ ...valid, delivery: { kind: "keep" } }).success).toBe(true);
  const recipient = { name: "Ana", phone: "999", identity: { kind: "absent" } };
  const delivery = { kind: "replace", selection: { method: "store", recipient }, expectedPrice: { amount: 0, currency: "PEN" } };
  expect(confirmCheckoutDeliverySchema.safeParse({ ...valid, delivery }).success).toBe(true);
  for (const change of [null, { kind: "keep", expectedPrice: delivery.expectedPrice }, { ...delivery, expectedPrice: { amount: 0.001, currency: "PEN" } },
    { ...delivery, selection: { ...delivery.selection, rateId: "fake" } }, { ...delivery, obsoleteCharge: false },
    { ...delivery, selection: { method: "home", recipient, destination: { districtCode: "150122", address: "Street", instructions: null } } }])
    expect(confirmCheckoutDeliverySchema.safeParse({ ...valid, delivery: change }).success).toBe(false);
  expect(confirmCheckoutDeliverySchema.safeParse(valid).success).toBe(false);
});

test("accepts a checkout buyer with a null phone", () => {
  const view = { companyName: "Store", number: 1001, buyer: { name: null, phone: null }, delivery: null, deliveryCharge: { amount: 0, currency: "PEN" }, itemsTotal: valid.expectedTotal, total: valid.expectedTotal,
    items: [{ productName: "Product", variantAttributes: {}, sku: null, imageUrl: null, quantity: 1, unitPrice: valid.expectedTotal, subtotal: valid.expectedTotal }], state: { kind: "pending" } };
  expect(publicCheckoutSchema.safeParse(view).success).toBe(true);
  expect(confirmCheckoutSchema.safeParse({ ...valid, buyer: { name: "Ana", phone: null } }).success).toBe(false);
});

test("checkout delivery options contract accepts offered methods with places and rejects offered without places, unknown codes and extra fields", () => {
  const places = { departmentCodes: [], provinceCodes: ["1501"], districtCodes: ["040101"] };
  const options = { home: { offered: true, places }, agency: { offered: false }, store: { enabled: false, pickupPoint: null } };
  expect(checkoutDeliveryOptionsSchema.safeParse(options).success).toBe(true);
  expect(checkoutDeliveryOptionsSchema.safeParse({ ...options, agency: { offered: true } }).success).toBe(false);
  expect(checkoutDeliveryOptionsSchema.safeParse({ ...options, agency: { offered: false, places } }).success).toBe(false);
  expect(checkoutDeliveryOptionsSchema.safeParse({ ...options, home: { offered: true, places: { ...places, districtCodes: ["999999"] } } }).success).toBe(false);
  expect(checkoutDeliveryOptionsSchema.safeParse({ ...options, home: { offered: true, places: { ...places, districtCodes: [] }, name: "Zone" } }).success).toBe(false);
  expect(checkoutDeliveryOptionsSchema.safeParse({ ...options, home: { enabled: true } }).success).toBe(false);
  expect(checkoutDeliveryOptionsSchema.safeParse({ ...options, home: { offered: true, places: { departmentCodes: [], provinceCodes: [], districtCodes: [] } } }).success).toBe(false);
});

test("the other-recipient flag is a form-only boolean that defaults to the buyer receiving", () => {
  const request = { ...valid, delivery: { kind: "keep" } };
  expect(confirmCheckoutDeliverySchema.parse(request).otherRecipient).toBe(false);
  expect(confirmCheckoutDeliverySchema.parse({ ...request, otherRecipient: true }).otherRecipient).toBe(true);
  expect(confirmCheckoutDeliverySchema.safeParse({ ...request, otherRecipient: "yes" }).success).toBe(false);
});

test("a kept delivery may carry the recipient of the form, and nothing else", () => {
  expect(confirmCheckoutDeliverySchema.safeParse({ ...valid, delivery: { kind: "keep", recipient: { name: "Luis", phone: "+14155552671" } } }).success).toBe(true);
  expect(confirmCheckoutDeliverySchema.safeParse({ ...valid, delivery: { kind: "keep", recipient: { name: "Luis", phone: "1", identity: {} } } }).success).toBe(false);
});
