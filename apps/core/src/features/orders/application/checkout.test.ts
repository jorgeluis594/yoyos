import { initialDeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { confirmOrderCheckout, enableOrderCheckout, getOrderCheckout, type CheckoutDependencies } from "@core/src/features/orders/application/checkout";
import { parseBuyer, parseOrderNumber, type BuyerData, type CheckoutAccess, type CheckoutOrder } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, ContactId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const access: CheckoutAccess = { companyId: uuid(1) as CompanyId, orderId: uuid(2) as OrderId };
const seller = { companyId: access.companyId, userId: "seller" as UserId };
const now = new Date("2026-10-05T00:00:00Z");
const parsedBuyer = parseBuyer({ name: "Ana", phone: "+51987654321" });
const number = parseOrderNumber(1001);
if (!parsedBuyer.success || !number.success) throw new Error("Invalid test data");
const buyer = parsedBuyer.data;
const total = { amount: 120, currency: "PEN" as const };
const base: CheckoutOrder = { delivery: null, checkoutDeliveryRequest: null, deliveryStatus: "pending", deliveryCharge: { amount: 2, currency: "PEN" },
  ...access, id: access.orderId, companyName: "Store", number: number.data, buyer: null,
  items: [{ id: uuid(3) as OrderItemId, variantId: uuid(4) as VariantId, productName: "Product", variantAttributes: {}, sku: null,
    quantity: 2 as PositiveInteger, unitPrice: { amount: 50, currency: "PEN" }, subtotal: { amount: 100, currency: "PEN" } }],
  itemsTotal: { amount: 100, currency: "PEN" }, total, cancelled: false,
  checkoutEnabledAt: new Date("2020-01-01T00:00:00Z"), checkoutConfirmedAt: null,
};

function fixture(initial: CheckoutOrder | null = base) {
  let order = initial ? { ...initial } : null;
  const writes: string[] = [];
  const deps: CheckoutDependencies = {
    getDeliverySettings: async () => ok(initialDeliverySettings()),
    saveDeliveryRequest: async (_access, delivery) => { order = { ...order!, checkoutDeliveryRequest: delivery }; return ok(null); },
    transaction: async (_companyId, work) => work(),
    findOrder: async () => ok(order),
    findOrderForUpdate: async () => ok(order),
    saveEnabled: async (_access, at) => { writes.push("enabled"); order = { ...order!, checkoutEnabledAt: at }; return ok(null); },
    saveBuyer: async (_access, data) => { writes.push("buyer"); order = { ...order!, buyer: data }; return ok(null); },
    saveConfirmed: async (_access, at) => { writes.push("confirmed"); order = { ...order!, checkoutConfirmedAt: at }; return ok(null); },
  };
  return { deps, writes, stored: () => order };
}

test("enables once and preserves the original enable timestamp on reuse", async () => {
  const f = fixture({ ...base, checkoutEnabledAt: null });
  expect(await enableOrderCheckout(access.orderId, seller, now, f.deps)).toMatchObject({ data: { number: 1001, changed: true } });
  expect(await enableOrderCheckout(access.orderId, seller, new Date("2027-01-01"), f.deps)).toMatchObject({ data: { changed: false } });
  expect(f.stored()?.checkoutEnabledAt).toEqual(now);
  expect(f.writes).toEqual(["enabled"]);
});

test("public view exposes only checkout data and uses the order total, not a recomputed subtotal", async () => {
  const f = fixture({ ...base, buyer: { name: null, phone: buyer.phone, contactId: uuid(5) as ContactId } });
  const result = await getOrderCheckout(access, f.deps);
  expect(result).toEqual({ success: true, data: { companyName: "Store", number: 1001, buyer: { name: null, phone: buyer.phone },
    items: [{ productName: "Product", variantAttributes: {}, sku: null, quantity: 2, unitPrice: { amount: 50, currency: "PEN" }, subtotal: base.itemsTotal }],
    itemsTotal: base.itemsTotal, total, delivery: null, deliveryQuotePending: false, deliveryCharge: base.deliveryCharge, state: { kind: "pending" } } });
  expect(f.writes).toEqual([]);
});

test("confirms with new or prefilled buyer and preserves the server-owned contact reference", async () => {
  for (const prefill of [null, { contactId: null, name: null, phone: "+14155552671" }, { contactId: uuid(5) as ContactId, name: "Old", phone: "+14155552671" }]) {
    const f = fixture({ ...base, buyer: prefill });
    expect(await confirmOrderCheckout({ buyer, expectedTotal: total }, access, now, f.deps)).toMatchObject({ data: { changed: true, checkout: { state: { kind: "confirmed", confirmedAt: now }, buyer } } });
    expect(f.stored()).toEqual({ ...base, checkoutConfirmedAt: now, buyer: { ...buyer, contactId: prefill?.contactId ?? null } });
  }
});

test("repeated confirmations return the existing summary even with stale total and different buyer", async () => {
  const f = fixture();
  await confirmOrderCheckout({ buyer, expectedTotal: total }, access, now, f.deps);
  const first = f.stored();
  expect(await confirmOrderCheckout({ buyer: { ...buyer, name: "Other" as BuyerData["name"] }, expectedTotal: { ...total, amount: 1 } }, access, new Date("2027-01-01"), f.deps))
    .toMatchObject({ data: { changed: false, checkout: { buyer, state: { kind: "confirmed", confirmedAt: now } } } });
  expect(f.stored()).toEqual(first);
  expect(f.writes).toEqual(["buyer", "confirmed"]);
  expect(await enableOrderCheckout(access.orderId, seller, now, f.deps)).toMatchObject({ data: { changed: false } });
});

test("unavailable links do not disclose or mutate absent, disabled or mismatched orders", async () => {
  for (const order of [null, { ...base, companyId: uuid(9) as CompanyId }, { ...base, id: uuid(9) as OrderId }, { ...base, checkoutEnabledAt: null }]) {
    const f = fixture(order);
    expect(await getOrderCheckout(access, f.deps)).toMatchObject({ error: { code: "CHECKOUT_UNAVAILABLE" } });
    expect(await confirmOrderCheckout({ buyer, expectedTotal: total }, access, now, f.deps)).toMatchObject({ error: { code: "CHECKOUT_UNAVAILABLE" } });
    expect(f.writes).toEqual([]);
    if (order?.checkoutEnabledAt !== null) expect(await enableOrderCheckout(access.orderId, seller, now, f.deps)).toMatchObject({ success: false });
  }
});

test("cancellation blocks enable and confirm and takes precedence over existing confirmation", async () => {
  for (const checkoutConfirmedAt of [null, now]) {
    const f = fixture({ ...base, cancelled: true, checkoutConfirmedAt, buyer: { ...buyer, contactId: null } });
    expect(await getOrderCheckout(access, f.deps)).toMatchObject({ data: { state: { kind: "cancelled" } } });
    expect(await enableOrderCheckout(access.orderId, seller, now, f.deps)).toMatchObject({ error: { code: "ORDER_CANCELLED" } });
    expect(await confirmOrderCheckout({ buyer, expectedTotal: total }, access, now, f.deps)).toMatchObject({ error: { code: "ORDER_CANCELLED" } });
    expect(f.writes).toEqual([]);
  }
});

test("invalid buyer or total rejects the first confirmation without writes", async () => {
  for (const input of [
    { buyer: { ...buyer, name: " " as BuyerData["name"] }, expectedTotal: total },
    { buyer, expectedTotal: { ...total, amount: 100 } },
    { buyer, expectedTotal: { ...total, currency: "USD" as const } },
  ]) {
    const f = fixture();
    expect((await confirmOrderCheckout(input, access, now, f.deps)).success).toBe(false);
    expect(f.writes).toEqual([]);
  }
});

test("technical failures propagate without a false success or subsequent writes", async () => {
  const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unavailable" });
  const f = fixture();
  expect(await getOrderCheckout(access, { findOrder: async () => failure })).toEqual(failure);
  expect(await confirmOrderCheckout({ buyer, expectedTotal: total }, access, now, { ...f.deps, saveBuyer: async () => failure })).toEqual(failure);
  expect(f.writes).toEqual([]);
  expect(await confirmOrderCheckout({ buyer, expectedTotal: total }, access, now, { ...f.deps, transaction: async () => failure })).toEqual(failure);
});

test("delivery selection requests a quote without changing amounts and validates enabled methods", async () => {
  const f = fixture();
  const deps = { ...f.deps, getDeliverySettings: async () => ok({ ...initialDeliverySettings(), home: { enabled: true } }) };
  const delivery = { method: "home" as const, recipient: { name: "Ana", phone: "+51987654321", identity: { kind: "absent" as const } },
    destination: { address: "Av. Lima 123", district: "Miraflores", instructions: null } };
  expect(await confirmOrderCheckout({ buyer, expectedTotal: total }, access, now, deps)).toMatchObject({ error: { code: "INVALID_DELIVERY" } });
  expect(await confirmOrderCheckout({ buyer, expectedTotal: total, delivery: { method: "store", recipient: delivery.recipient } }, access, now, deps))
    .toMatchObject({ error: { code: "DELIVERY_METHOD_DISABLED" } });
  expect(f.writes).toEqual([]);
  expect(await confirmOrderCheckout({ buyer, expectedTotal: total, delivery }, access, now, deps))
    .toMatchObject({ data: { checkout: { deliveryQuotePending: true, delivery, total } } });
  expect(f.stored()).toMatchObject({ total, delivery: null, deliveryCharge: base.deliveryCharge,
    checkoutDeliveryRequest: { ...delivery, recordedBy: { kind: "buyer" } } });
  const unchanged = fixture({ ...base, delivery: { ...delivery, recordedBy: { kind: "buyer" } } });
  expect(await confirmOrderCheckout({ buyer, expectedTotal: total, delivery }, access, now, { ...unchanged.deps, getDeliverySettings: deps.getDeliverySettings }))
    .toMatchObject({ data: { checkout: { deliveryQuotePending: false } } });
});
