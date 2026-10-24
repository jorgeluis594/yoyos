import { parseDeliverySnapshot } from "@core/src/features/orders/domain/order-state-machine";
import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { confirmCheckoutDelivery, type ConfirmCheckoutDeliveryDependencies, confirmOrderCheckout, enableOrderCheckout, getOrderCheckout, type CheckoutDependencies, type GetOrderCheckoutDependencies } from "@core/src/features/orders/application/checkout";
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
const base: CheckoutOrder = {
  ...access, id: access.orderId, companyName: "Store", number: number.data, buyer: null,
  items: [{ id: uuid(3) as OrderItemId, variantId: uuid(4) as VariantId, productName: "Product", variantAttributes: {}, sku: null,
    quantity: 2 as PositiveInteger, unitPrice: { amount: 50, currency: "PEN" }, subtotal: { amount: 100, currency: "PEN" } }],
  delivery: null, deliveryCharge: { amount: 20, currency: "PEN" }, itemsTotal: { amount: 100, currency: "PEN" }, total, cancelled: false,
  checkoutEnabledAt: new Date("2020-01-01T00:00:00Z"), checkoutConfirmedAt: null, fromCatalog: false,
};

function fixture(initial: CheckoutOrder | null = base) {
  let order = initial ? { ...initial } : null;
  const writes: string[] = [];
  const deps: CheckoutDependencies = {
    transaction: async (_companyId, work) => work(),
    findOrder: async () => ok(order),
    findOrderForUpdate: async () => ok(order),
    saveBuyer: async (_access, data) => { writes.push("buyer"); order = { ...order!, buyer: data }; return ok(null); },
    saveConfirmed: async (_access, at) => { writes.push("confirmed"); order = { ...order!, checkoutConfirmedAt: at }; return ok(null); },
  };
  const findItemPhotos = vi.fn<GetOrderCheckoutDependencies["findItemPhotos"]>(async () => ok(new Map()));
  return { deps: { ...deps, findItemPhotos } satisfies CheckoutDependencies & GetOrderCheckoutDependencies, writes, stored: () => order, findItemPhotos };
}

test("enabling is an idempotent read that never writes or moves the enable timestamp", async () => {
  const f = fixture();
  for (let attempt = 0; attempt < 2; attempt += 1)
    expect(await enableOrderCheckout(access.orderId, seller, f.deps)).toMatchObject({ data: { number: 1001 } });
  expect(f.stored()?.checkoutEnabledAt).toEqual(base.checkoutEnabledAt);
  expect(f.writes).toEqual([]);
});

test("public view exposes only checkout data and uses the order total, not a recomputed subtotal", async () => {
  const f = fixture({ ...base, buyer: { name: null, phone: buyer.phone, contactId: uuid(5) as ContactId } });
  const result = await getOrderCheckout(access, f.deps);
  expect(result).toEqual({ success: true, data: { photos: new Map(), checkout: { companyName: "Store", number: 1001, buyer: { name: null, phone: buyer.phone },
    items: [{ variantId: uuid(4), productName: "Product", variantAttributes: {}, sku: null, quantity: 2, unitPrice: { amount: 50, currency: "PEN" }, subtotal: base.itemsTotal }],
    itemsTotal: base.itemsTotal, delivery: null, deliveryCharge: base.deliveryCharge, total, state: { kind: "pending" } } } });
  expect(f.writes).toEqual([]);
});

test("returns the checkout with the current photo of each item's product", async () => {
  const polo = uuid(4) as VariantId;
  const taza = uuid(6) as VariantId;
  const f = fixture({ ...base, items: [base.items[0], { ...base.items[0], id: uuid(7) as OrderItemId, variantId: taza, productName: "Taza blanca" }] });
  f.findItemPhotos.mockResolvedValue(ok(new Map([[polo, "https://cdn.example/polo-new.webp"]])));
  const result = await getOrderCheckout(access, f.deps);
  expect(result).toMatchObject({ success: true, data: { photos: new Map([[polo, "https://cdn.example/polo-new.webp"]]), checkout: { items: [{ productName: "Product" }, { productName: "Taza blanca" }] } } });
});

test("returns the checkout without photos when the photos cannot be read", async () => {
  const f = fixture();
  f.findItemPhotos.mockResolvedValue(err({ code: "PHOTOS_UNAVAILABLE" as const, message: "down" }));
  expect(await getOrderCheckout(access, f.deps)).toMatchObject({ success: true, data: { photos: new Map(), checkout: { number: 1001 } } });
});

test("asks for the photos of each variant once", async () => {
  const f = fixture({ ...base, items: [base.items[0], { ...base.items[0], id: uuid(7) as OrderItemId }] });
  await getOrderCheckout(access, f.deps);
  expect(f.findItemPhotos).toHaveBeenCalledOnce();
  expect(f.findItemPhotos).toHaveBeenCalledWith([uuid(4)]);
});

test("does not look for photos when the checkout is unavailable", async () => {
  const f = fixture(null);
  expect(await getOrderCheckout(access, f.deps)).toMatchObject({ error: { code: "CHECKOUT_UNAVAILABLE" } });
  expect(f.findItemPhotos).not.toHaveBeenCalled();
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
  expect(await enableOrderCheckout(access.orderId, seller, f.deps)).toMatchObject({ data: { number: 1001 } });
});

test("unavailable links do not disclose or mutate absent, disabled or mismatched orders", async () => {
  for (const order of [null, { ...base, companyId: uuid(9) as CompanyId }, { ...base, id: uuid(9) as OrderId }, { ...base, checkoutEnabledAt: null }]) {
    const f = fixture(order);
    expect(await getOrderCheckout(access, f.deps)).toMatchObject({ error: { code: "CHECKOUT_UNAVAILABLE" } });
    expect(await confirmOrderCheckout({ buyer, expectedTotal: total }, access, now, f.deps)).toMatchObject({ error: { code: "CHECKOUT_UNAVAILABLE" } });
    expect(f.writes).toEqual([]);
    expect(await enableOrderCheckout(access.orderId, seller, f.deps)).toMatchObject({ success: false });
  }
});

test("cancellation blocks enable and confirm and takes precedence over existing confirmation", async () => {
  for (const checkoutConfirmedAt of [null, now]) {
    const f = fixture({ ...base, cancelled: true, checkoutConfirmedAt, buyer: { ...buyer, contactId: null } });
    expect(await getOrderCheckout(access, f.deps)).toMatchObject({ data: { checkout: { state: { kind: "cancelled" } } } });
    expect(await enableOrderCheckout(access.orderId, seller, f.deps)).toMatchObject({ error: { code: "ORDER_CANCELLED" } });
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
  expect(await getOrderCheckout(access, { findOrder: async () => failure, findItemPhotos: f.findItemPhotos })).toEqual(failure);
  expect(await confirmOrderCheckout({ buyer, expectedTotal: total }, access, now, { ...f.deps, saveBuyer: async () => failure })).toEqual(failure);
  expect(f.writes).toEqual([]);
  expect(await confirmOrderCheckout({ buyer, expectedTotal: total }, access, now, { ...f.deps, transaction: async () => failure })).toEqual(failure);
});


function deliveryFixture() {
  const order = { ...base, items: [base.items[0]] as const, sellerId: seller.userId, fromCatalog: false, createdAt: now, scheduledDispatchDate: null, shippedAt: null,
    completedAt: null, deliveredAt: null, deliveryStatus: "pending" as const, stockDeducted: false, payments: [],
    delivery: null, deliveryCost: { amount: 0, currency: "PEN" as const }, deliveryCharge: { amount: 0, currency: "PEN" as const }, total: base.itemsTotal };
  const deps: ConfirmCheckoutDeliveryDependencies = {
    transaction: async (_company, work) => work(), findOrderForUpdate: async () => ok(order),
    getStoreSettings: vi.fn(async () => ok({ version: 2, home: { enabled: false }, agency: { enabled: false }, couriers: [],
      store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } })),
    resolveSelectedDeliveryRate: vi.fn(async () => err({ code: "RATE_UNAVAILABLE" as const, message: "Unavailable" })),
    saveDelivery: vi.fn(async () => ok(null)), deductProductStock: vi.fn(async () => ok(null)),
    saveStockDeduction: vi.fn(async () => ok(null)), saveBuyer: vi.fn(async () => ok(null)), saveConfirmed: vi.fn(async () => ok(null)),
  };
  const input = { buyer, expectedTotal: order.total, delivery: { kind: "replace" as const,
    selection: { method: "store" as const, recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } } },
    expectedPrice: { amount: 0, currency: "PEN" as const } } };
  return { order, deps, input };
}

test("checkout pickup uses buyer authority and validates price separately from total before any write", async () => {
  const f = deliveryFixture();
  expect(await confirmCheckoutDelivery({ ...f.input, delivery: { ...f.input.delivery, expectedPrice: { amount: 2, currency: "PEN" } } }, access, now, f.deps))
    .toMatchObject({ error: { code: "TOTAL_CHANGED", currentPrice: { amount: 0 } } });
  expect(f.deps.saveDelivery).not.toHaveBeenCalled();
  expect(await confirmCheckoutDelivery({ ...f.input, expectedTotal: { amount: 99, currency: "PEN" } }, access, now, f.deps))
    .toMatchObject({ error: { code: "TOTAL_CHANGED" } });
  expect(f.deps.saveBuyer).not.toHaveBeenCalled();
  expect(f.deps.saveConfirmed).not.toHaveBeenCalled();
  expect(f.deps.deductProductStock).not.toHaveBeenCalled();
  expect(await confirmCheckoutDelivery(f.input, access, now, f.deps)).toMatchObject({ data: { changed: true, checkout: { total: { amount: 100 } } } });
  expect(f.deps.saveDelivery).toHaveBeenCalledWith(access.orderId, access.companyId,
    expect.objectContaining({ delivery: expect.objectContaining({ recordedBy: { kind: "buyer" }, settingsVersion: 2 }), deliveryCharge: { amount: 0, currency: "PEN" } }));
  expect(f.deps.resolveSelectedDeliveryRate).not.toHaveBeenCalled();
});

test("checkout keep requires an existing delivery and preserves historical prices and author without reading settings", async () => {
  const f = deliveryFixture();
  const input = { ...f.input, delivery: { kind: "keep" as const } };
  expect(await confirmCheckoutDelivery(input, access, now, f.deps)).toMatchObject({ error: { code: "INVALID_CHECKOUT" } });
  const historical = { ...f.order, deliveryCost: { amount: 30, currency: "PEN" as const },
    deliveryCharge: { amount: 0, currency: "PEN" as const }, delivery: { method: "home" as const,
      recipient: f.input.delivery.selection.recipient, destination: { address: "Old street", country: "PE" as const, districtCode: "150101", district: "Old district", province: "Lima", department: "Lima", instructions: null },
      pricing: { quotationId: "00000000-0000-4000-8000-000000000020", rateId: "00000000-0000-4000-8000-000000000021", optionId: "00000000-0000-4000-8000-000000000022", settingsVersion: 1 },
      recordedBy: { kind: "seller" as const, userId: seller.userId } } };
  f.deps = { ...f.deps, findOrderForUpdate: async () => ok(historical as unknown as typeof f.order) };
  expect(await confirmCheckoutDelivery({ ...input, expectedTotal: historical.total }, access, now, f.deps))
    .toMatchObject({ data: { changed: true, checkout: { total: historical.total } } });
  expect(f.deps.saveDelivery).not.toHaveBeenCalled();
  expect(f.deps.getStoreSettings).not.toHaveBeenCalled();
  expect(f.deps.resolveSelectedDeliveryRate).not.toHaveBeenCalled();
});

test("checkout keep sets only the recipient name and phone of the kept delivery when told who receives", async () => {
  const f = deliveryFixture();
  const kept = { ...f.order, deliveryCost: { amount: 30, currency: "PEN" as const }, deliveryCharge: { amount: 0, currency: "PEN" as const }, delivery: { method: "home" as const, recipient: { name: "Seller typed", phone: "999", identity: { kind: "absent" as const } },
    destination: { address: "Home street", country: "PE" as const, districtCode: "150101", district: "Old district", province: "Lima", department: "Lima", instructions: null },
    pricing: { quotationId: "00000000-0000-4000-8000-000000000020", rateId: "00000000-0000-4000-8000-000000000021", optionId: "00000000-0000-4000-8000-000000000022", settingsVersion: 1 },
    recordedBy: { kind: "seller" as const, userId: seller.userId } } } as unknown as typeof f.order;
  f.deps = { ...f.deps, findOrderForUpdate: async () => ok(kept) };
  const input = { ...f.input, expectedTotal: kept.total, delivery: { kind: "keep" as const, recipient: { name: "Ana", phone: "+51977909427" } } };
  expect(await confirmCheckoutDelivery(input, access, now, f.deps)).toMatchObject({ data: { changed: true } });
  expect(f.deps.saveDelivery).toHaveBeenCalledWith(access.orderId, access.companyId, expect.objectContaining({ delivery: expect.objectContaining({
    method: "home", recipient: { name: "Ana", phone: "+51977909427", identity: { kind: "absent" } },
    destination: expect.objectContaining({ address: "Home street" }) }) }));
  vi.mocked(f.deps.saveDelivery).mockClear();
  const same = { ...input, delivery: { kind: "keep" as const, recipient: { name: "Seller typed", phone: "999" } } };
  await confirmCheckoutDelivery(same, access, now, f.deps);
  expect(f.deps.saveDelivery).not.toHaveBeenCalled();
});

test("checkout keep leaves the recipient of a delivery that already progressed untouched and still confirms", async () => {
  const f = deliveryFixture();
  const kept = { ...f.order, deliveryCost: { amount: 30, currency: "PEN" as const }, deliveryCharge: { amount: 0, currency: "PEN" as const }, deliveryStatus: "shipped" as const, shippedAt: now,
    delivery: { method: "home" as const, recipient: { name: "Seller typed", phone: "999", identity: { kind: "absent" as const } },
    destination: { address: "Home street", country: "PE" as const, districtCode: "150101", district: "Old district", province: "Lima", department: "Lima", instructions: null },
    pricing: { quotationId: "00000000-0000-4000-8000-000000000020", rateId: "00000000-0000-4000-8000-000000000021", optionId: "00000000-0000-4000-8000-000000000022", settingsVersion: 1 },
    recordedBy: { kind: "seller" as const, userId: seller.userId } } } as unknown as typeof f.order;
  f.deps = { ...f.deps, findOrderForUpdate: async () => ok(kept) };
  const input = { ...f.input, expectedTotal: kept.total, delivery: { kind: "keep" as const, recipient: { name: "Ana", phone: "+51977909427" } } };
  expect(await confirmCheckoutDelivery(input, access, now, f.deps)).toMatchObject({ data: { changed: true } });
  expect(f.deps.saveDelivery).not.toHaveBeenCalled();
  expect(f.deps.saveBuyer).toHaveBeenCalled();
  expect(f.deps.saveConfirmed).toHaveBeenCalled();
});

test("checkout confirmation replay preserves buyer and delivery without resolving or writing again", async () => {
  const f = deliveryFixture();
  const confirmed = { ...f.order, buyer: { ...buyer, contactId: null }, checkoutConfirmedAt: now };
  f.deps = { ...f.deps, findOrderForUpdate: async () => ok(confirmed) };
  expect(await confirmCheckoutDelivery({ ...f.input, expectedTotal: { amount: 1, currency: "PEN" } }, access, now, f.deps))
    .toMatchObject({ data: { changed: false, checkout: { buyer, total: confirmed.total } } });
  expect(f.deps.getStoreSettings).not.toHaveBeenCalled();
  expect(f.deps.saveDelivery).not.toHaveBeenCalled();
  expect(f.deps.saveBuyer).not.toHaveBeenCalled();
  expect(f.deps.saveConfirmed).not.toHaveBeenCalled();
});


test("checkout exposes the saved delivery and customer charge without seller identity or repricing", async () => {
  const parsed = parseDeliverySnapshot({ method: "home", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
    destination: { address: "Historical street", country: "PE", districtCode: "150101", district: "Historical district", province: "Lima", department: "Lima", instructions: null },
    pricing: { quotationId: "00000000-0000-4000-8000-000000000020", rateId: "00000000-0000-4000-8000-000000000021", optionId: "00000000-0000-4000-8000-000000000022", settingsVersion: 1 }, recordedBy: { kind: "seller", userId: seller.userId } });
  if (!parsed.success) throw new Error("Invalid delivery fixture");
  const f = fixture({ ...base, delivery: parsed.data });
  const result = await getOrderCheckout(access, f.deps);
  expect(result).toMatchObject({ success: true, data: { checkout: { deliveryCharge: base.deliveryCharge, total: base.total,
    delivery: { method: "home", destination: { address: "Historical street", district: "Historical district" } } } } });
  if (!result.success) throw new Error("Expected checkout");
  expect(result.data.checkout.delivery).not.toHaveProperty("recordedBy");
  expect(result.data.checkout).not.toHaveProperty("deliveryCost");
  expect(f.writes).toEqual([]);
});
