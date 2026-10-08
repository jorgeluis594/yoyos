import { err, ok } from "@shared/functional";
import { createOrderOperations } from "@mobile/features/orders/application/order-operations";
import { addDraftItem, emptyOrderDraft } from "@mobile/features/orders/domain/order-draft";
import { createOrderApi } from "@mobile/features/orders/infrastructure/order-api";
import { createPendingOrderConfirmationStore } from "@mobile/features/orders/infrastructure/pending-order-confirmation";
import type { OrderAggregateResponse } from "@shared/contracts/orders";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1);
const item = { variantId: id(2), productName: "Sample", variantAttributes: {}, sku: null,
  shownUnitPrice: { amount: 10, currency: "PEN" as const }, shownStock: 3, quantity: 1 };
const draft = () => {
  const result = addDraftItem(emptyOrderDraft(), item, () => id(3));
  if (!result.success) throw new Error("Invalid test cart");
  return result.data;
};
const storage = () => {
  const values = new Map<string, string>();
  return createPendingOrderConfirmationStore({ getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { values.delete(key); } });
};

test("Lima day filters include the whole through day and reject inverted days", async () => {
  const paths: string[] = [];
  const api = createOrderApi(async (path) => { paths.push(path); return ok({ items: [], page: 1, pageSize: 20, total: 0 }); });
  const operations = createOrderOperations(api, storage());
  expect(await operations.loadOrders({ page: 1, customer: { kind: "all" }, fromDay: "1989-12-31", throughDay: "1989-12-31" }))
    .toMatchObject({ success: true, data: { total: 0 } });
  const query = new URL(`http://localhost${paths[0]}`).searchParams;
  expect(query.get("completedFrom")).toBe("1989-12-31T05:00:00.000Z");
  expect(query.get("completedBefore")).toBe("1990-01-01T04:00:00.000Z");
  expect(await operations.loadMixedOrders({ page: 1, search: " #1005 ", view: "unpaid", customer: { kind: "all" }, fromDay: "1989-12-31", throughDay: "1989-12-31" }))
    .toMatchObject({ success: true, data: { total: 0 } });
  const mixed = new URL(`http://localhost${paths[1]}`).searchParams;
  expect(mixed.get("search")).toBe("#1005");
  expect(mixed.get("view")).toBe("unpaid");
  expect(mixed.get("createdFrom")).toBe("1989-12-31T05:00:00.000Z");
  expect(mixed.get("createdBefore")).toBe("1990-01-01T04:00:00.000Z");
  expect(await operations.loadOrders({ page: 1, customer: { kind: "all" }, fromDay: "2026-09-29", throughDay: "2026-09-28" }))
    .toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(paths).toHaveLength(2);
});

test("save failure prevents POST; uncertain POST coalesces taps and blocks another order", async () => {
  let sends = 0;
  const bodies: unknown[] = [];
  const api = createOrderApi(async (path, init) => path === "/api/orders" ? (sends++, bodies.push(JSON.parse(String(init?.body))),
    err({ code: "NETWORK_ERROR", message: "Offline" }))
    : err({ code: "API_ERROR", message: "Absent", http: { status: 404, body: { code: "ORDER_NOT_FOUND", error: "Absent" } } }));
  const broken = createPendingOrderConfirmationStore({ getItemAsync: async () => null,
    setItemAsync: async () => { throw new Error("Cannot save"); }, deleteItemAsync: async () => {} });
  expect(await createOrderOperations(api, broken).completeOrder(draft(), companyId))
    .toMatchObject({ success: false, error: { code: "PENDING_STORAGE_UNAVAILABLE" } });
  expect(sends).toBe(0);
  const operations = createOrderOperations(api, storage());
  const selected = draft();
  const [first, second] = await Promise.all([operations.completeOrder(selected, companyId), operations.completeOrder(selected, companyId)]);
  expect(first).toEqual(second);
  expect(first).toMatchObject({ success: true, data: { kind: "uncertain", pending: { id: id(3) } } });
  expect(sends).toBe(1);
  expect(bodies).toEqual([{ id: id(3), contactId: null, items: [{ variantId: id(2), quantity: 1 }] }]);
  expect(await operations.resolvePendingOrderConfirmation(companyId))
    .toMatchObject({ success: true, data: { kind: "uncertain", pending: { id: id(3) } } });
  const other = addDraftItem(emptyOrderDraft(), item, () => id(4));
  if (!other.success) throw new Error("Invalid second cart");
  expect(await operations.completeOrder(other.data, companyId))
    .toMatchObject({ success: false, error: { code: "PENDING_CONFIRMATION" } });
  expect(sends).toBe(1);
});

test("known stock rejection clears the marker and leaves the cart available", async () => {
  const api = createOrderApi(async () => err({ code: "API_ERROR", message: "No stock", http: { status: 409,
    body: { code: "INSUFFICIENT_STOCK", error: "No stock", issues: [{ field: "items", reason: "STOCK", variantId: id(2) }] } } }));
  const store = storage();
  const operations = createOrderOperations(api, store);
  const selected = draft();
  expect(await operations.completeOrder(selected, companyId)).toMatchObject({ success: false,
    error: { code: "INSUFFICIENT_STOCK", issues: [{ variantId: id(2) }] } });
  expect(await store.read(companyId)).toEqual(ok(null));
  expect(selected.kind).toBe("items");
});

test.each([
  ["INVALID_INPUT", 400],
  ["INVALID_PAYMENT", 422], ["PAYMENT_CONFLICT", 409], ["PAYMENT_REQUIRED", 409],
  ["INVALID_TRANSITION", 409], ["STOCK_NOT_DEDUCTED", 409],
  ["DELIVERY_UNAVAILABLE", 422], ["DELIVERY_METHOD_DISABLED", 422], ["COURIER_UNAVAILABLE", 422],
  ["RATE_UNAVAILABLE", 422], ["TOTAL_CHANGED", 409], ["INVALID_DISTRICT", 422], ["INVALID_DELIVERY_RATE", 422],
] as const)("recovery clears a definitively rejected creation (%s)", async (code, status) => {
  const store = storage();
  let posts = 0;
  let rejectCreation = false;
  const api = createOrderApi(async (path) => {
    if (path === "/api/orders") {
      posts++;
      return rejectCreation
        ? err({ code: "API_ERROR", message: "Rejected", http: { status, body: { code, error: "Rejected", ...(code === "TOTAL_CHANGED" ? { currentPrice: { amount: 8, currency: "PEN" } } : {}) } } })
        : err({ code: "NETWORK_ERROR", message: "Lost response" });
    }
    return err({ code: "API_ERROR", message: "Missing", http: { status: 404,
      body: { code: "ORDER_NOT_FOUND", error: "Missing" } } });
  });
  const selected = { ...draft(), deliverImmediately: true };
  expect(await createOrderOperations(api, store).completeOrder(selected, companyId))
    .toMatchObject({ success: true, data: { kind: "uncertain" } });
  rejectCreation = true;
  const restarted = createOrderOperations(api, store);
  expect(await restarted.resendPendingOrder(companyId)).toMatchObject({ success: false, error: { code } });
  expect(await store.read(companyId)).toEqual(ok(null));
  expect(posts).toBe(2);
});

test("recovery keeps the amount first shown and returns the core total", async () => {
  const amount = { amount: 12, currency: "PEN" as const };
  const zero = { amount: 0, currency: "PEN" as const };
  const order: OrderAggregateResponse = { number: 1001, id: id(3), companyId, sellerId: "seller", buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null,
    createdAt: "2026-09-29T12:00:00.000Z", deliveredAt: "2026-09-29T12:00:00.000Z", completedAt: "2026-09-29T12:00:00.000Z",
    status: "completed", paymentStatus: "paid", paidAmount: amount, balanceDue: zero, overpaidAmount: zero,
    cancelled: false, delivery: null, deliveryStatus: "delivered", stockDeducted: true,
    itemsTotal: amount, deliveryCost: zero, deliveryCharge: zero, total: amount,
    payments: [{ id: id(6), orderId: id(3), amount, method: "digital_wallet", status: "confirmed", data: { confirmedAt: "2026-09-29T12:00:00.000Z", confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } }],
    items: [{ id: id(5), variantId: id(2), productName: "Sample", variantAttributes: {}, sku: null,
      quantity: 1, unitPrice: amount, subtotal: amount }] };
  let lookups = 0;
  const api = createOrderApi(async (path) => path === "/api/orders"
    ? err({ code: "NETWORK_ERROR", message: "Lost response" }) : ++lookups === 1
      ? err({ code: "API_ERROR", message: "Absent", http: { status: 404,
        body: { code: "ORDER_NOT_FOUND", error: "Absent" } } }) : ok(order));
  const store = storage();
  const operations = createOrderOperations(api, store);
  expect(await operations.completeOrder(draft(), companyId)).toMatchObject({ success: true, data: { kind: "uncertain" } });
  expect(lookups).toBe(1);
  expect(await operations.resolvePendingOrderConfirmation(companyId)).toMatchObject({ success: true,
    data: { kind: "completed", shownTotal: { amount: 10, currency: "PEN" }, order: { total: amount } } });
  expect(await operations.loadOrder(id(3))).toMatchObject({ success: true, data: { total: amount } });
  expect(await store.read(companyId)).toMatchObject({ success: true, data: { id: id(3) } });
  expect(await operations.clearPendingOrderConfirmation(companyId, id(3))).toEqual(ok(undefined));

  const pending = { ...order, status: "active" as const, paymentStatus: "pending" as const,
    completedAt: null, deliveredAt: null, deliveryStatus: "pending" as const, stockDeducted: false, payments: [], paidAmount: zero, balanceDue: amount };
  const pendingStore = storage();
  await pendingStore.save({ companyId, id: id(3), shownTotal: { amount: 10, currency: "PEN" } });
  const pendingOperations = createOrderOperations(createOrderApi(async () => ok(pending)), pendingStore);
  expect(await pendingOperations.resolvePendingOrderConfirmation(companyId)).toMatchObject({ success: true,
    data: { kind: "completed", order: { status: "active", paymentStatus: "pending" } } });
  expect(await pendingStore.read(companyId)).toMatchObject({ success: true, data: { id: id(3) } });
  const incomplete = { ...order, paidAmount: zero, balanceDue: amount };
  expect(await createOrderOperations(createOrderApi(async () => ok(incomplete)), storage()).completeOrder(draft(), companyId))
    .toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  const conflictApi = createOrderApi(async (path) => path === "/api/orders"
    ? err({ code: "API_ERROR", message: "Exists", http: { status: 409,
      body: { code: "ORDER_ALREADY_EXISTS", error: "Exists" } } }) : ok(order));
  expect(await createOrderOperations(conflictApi, storage()).completeOrder(draft(), companyId))
    .toMatchObject({ success: true, data: { kind: "completed", order: { id: id(3) } } });
  const lostResponseApi = createOrderApi(async (path) => path === "/api/orders"
    ? err({ code: "NETWORK_ERROR", message: "Lost response" }) : ok(order));
  expect(await createOrderOperations(lostResponseApi, storage()).completeOrder(draft(), companyId))
    .toMatchObject({ success: true, data: { kind: "completed", order: { id: id(3) } } });
  const pendingConflictApi = createOrderApi(async (path) => path === "/api/orders"
    ? err({ code: "API_ERROR", message: "Exists", http: { status: 409,
      body: { code: "ORDER_ALREADY_EXISTS", error: "Exists" } } }) : ok(pending));
  expect(await createOrderOperations(pendingConflictApi, storage()).completeOrder(draft(), companyId))
    .toMatchObject({ success: true, data: { kind: "completed" } });
});

test("a restarted session reads the same company attempt and explicitly resends its original ID", async () => {
  const values = new Map<string, string>();
  const secureStorage = { getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { values.set(key, value); },
    deleteItemAsync: async (key: string) => { values.delete(key); } };
  let sends = 0;
  const api = createOrderApi(async (path) => path === "/api/orders" ? (sends++, err({ code: "NETWORK_ERROR", message: "Lost response" }))
    : err({ code: "API_ERROR", message: "Absent", http: { status: 404, body: { code: "ORDER_NOT_FOUND", error: "Absent" } } }));
  const first = createOrderOperations(api, createPendingOrderConfirmationStore(secureStorage));
  expect(await first.completeOrder(draft(), companyId)).toMatchObject({ success: true, data: { kind: "uncertain" } });
  const restarted = createOrderOperations(api, createPendingOrderConfirmationStore(secureStorage));
  expect(await restarted.readPendingOrderConfirmation(id(4))).toEqual(ok(null));
  expect(await restarted.resolvePendingOrderConfirmation(companyId)).toMatchObject({ success: true,
    data: { kind: "uncertain", pending: { id: id(3), shownTotal: { amount: 10 } } } });
  expect(sends).toBe(1);
  expect(await restarted.completeOrder(draft(), companyId)).toMatchObject({ success: true,
    data: { kind: "uncertain", pending: { id: id(3), shownTotal: { amount: 10 } } } });
  expect(sends).toBe(2);
});

test("restart resends the exact stored payments and delivery only after querying the same attempt", async () => {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const api = createOrderApi(async (path, init) => {
    calls.push(init?.method === "POST" ? "post" : "get");
    if (path === "/api/orders") { bodies.push(JSON.parse(String(init?.body))); return err({ code: "NETWORK_ERROR", message: "Lost response" }); }
    return err({ code: "API_ERROR", message: "Absent", http: { status: 404, body: { code: "ORDER_NOT_FOUND", error: "Absent" } } });
  });
  const store = storage();
  const selected = { ...draft(), payments: [{ paymentId: id(8), amount: "4.50", method: "bank_transfer" as const, deductStockIfPartial: false }],
    ratedDelivery: { expectedPrice: { amount: 8, currency: "PEN" as const }, delivery: {
      method: "home" as const, rateId: id(6), recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } },
      destination: { districtCode: "150122", address: "Original address", instructions: "Door 2" },
    } }, deliverImmediately: false };
  await createOrderOperations(api, store).completeOrder(selected, companyId);
  expect(calls).toEqual(["post", "get"]);
  const restarted = createOrderOperations(api, store);
  await restarted.completeOrder({ ...selected, payments: [{ ...selected.payments[0], amount: "99" }],
    ratedDelivery: { ...selected.ratedDelivery, delivery: { ...selected.ratedDelivery.delivery,
      destination: { ...selected.ratedDelivery.delivery.destination, address: "Changed address" } } } }, companyId);
  expect(calls).toEqual(["post", "get", "get", "post", "get"]);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[1]).toMatchObject({ payments: [{ paymentId: id(8), amount: { amount: 4.5, currency: "PEN" } }],
    delivery: { expectedPrice: { amount: 8, currency: "PEN" }, delivery: { rateId: id(6), destination: { districtCode: "150122", address: "Original address", instructions: "Door 2" } } }, deliverImmediately: false });
  await restarted.resendPendingOrder(companyId);
  expect(bodies[2]).toEqual(bodies[0]);
  const offlineLookup = createOrderOperations(createOrderApi(async () => err({ code: "NETWORK_ERROR", message: "Offline" })), store);
  expect(await offlineLookup.resendPendingOrder(companyId)).toMatchObject({ success: false, error: { code: "NETWORK_ERROR" } });
  expect(bodies).toHaveLength(3);
});

test("legacy attempt without a saved request remains blocked instead of reconstructing a different order", async () => {
  const store = storage();
  await store.save({ companyId, id: id(3), shownTotal: { amount: 10, currency: "PEN" } });
  let sends = 0;
  const api = createOrderApi(async (_path, init) => {
    if (init?.method === "POST") sends++;
    return err({ code: "API_ERROR", message: "Absent", http: { status: 404, body: { code: "ORDER_NOT_FOUND", error: "Absent" } } });
  });
  const operations = createOrderOperations(api, store);
  expect(await operations.resendPendingOrder(companyId)).toMatchObject({ success: false, error: { code: "PENDING_CONFIRMATION" } });
  expect(await operations.completeOrder(draft(), companyId)).toMatchObject({ success: false, error: { code: "PENDING_CONFIRMATION" } });
  expect(sends).toBe(0);
  expect(await store.read(companyId)).toMatchObject({ success: true, data: { id: id(3) } });
});

test.each([true, false])("rejected legacy delivery retains the original recovery request (customer charge: %s)", async (chargeDeliveryToCustomer) => {
  const store = storage();
  const pending = { version: 2 as const, companyId, id: id(3), shownTotal: { amount: 10, currency: "PEN" as const },
    request: { id: id(3), contactId: id(7), items: [{ variantId: id(2), quantity: 1 }],
      payments: [{ paymentId: id(8), amount: { amount: 4.5, currency: "PEN" as const }, method: "bank_transfer" as const, deductStockIfPartial: false }],
      delivery: { chargeDeliveryToCustomer, delivery: { method: "home" as const,
        recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } },
        destination: { address: "Original address", district: "Lima", instructions: "Door 2" } } } } };
  expect(await store.save(pending)).toEqual(ok(pending));
  const paths: string[] = [];
  const api = createOrderApi(async (path, init) => {
    paths.push(path);
    if (init?.method === "POST") throw new Error("Legacy request must not reach HTTP");
    return err({ code: "API_ERROR", message: "Missing", http: { status: 404, body: { code: "ORDER_NOT_FOUND", error: "Missing" } } });
  });
  const restarted = createOrderOperations(api, store);
  expect(await restarted.resendPendingOrder(companyId)).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(paths).toEqual([`/api/orders/${id(3)}/aggregate`]);
  expect(await store.read(companyId)).toEqual(ok(pending));
  expect(await restarted.resolvePendingOrderConfirmation(companyId)).toEqual(ok({ kind: "uncertain", pending }));
  const other = addDraftItem(emptyOrderDraft(), item, () => id(9));
  if (!other.success) throw new Error("Invalid second cart");
  expect(await restarted.completeOrder(other.data, companyId)).toMatchObject({ success: false, error: { code: "PENDING_CONFIRMATION" } });
  expect(paths).toHaveLength(2);
});

test("in-flight outcomes never cross company boundaries", async () => {
  const api = createOrderApi(async () => err({ code: "NETWORK_ERROR", message: "Offline" }));
  const operations = createOrderOperations(api, storage());
  const [first, second] = await Promise.all([operations.completeOrder(draft(), companyId), operations.completeOrder(draft(), id(9))]);
  expect(first).toMatchObject({ success: true, data: { kind: "uncertain", pending: { companyId } } });
  expect(second).toMatchObject({ success: true, data: { kind: "uncertain", pending: { companyId: id(9) } } });
});

test("reviewing a legacy delivery keeps order and payment identities and saves before any resend", async () => {
  const store = storage();
  const pending = { version: 2 as const, companyId, id: id(3), shownTotal: { amount: 10, currency: "PEN" as const },
    request: { id: id(3), contactId: id(7), items: [{ variantId: id(2), quantity: 1 }],
      payments: [{ paymentId: id(8), amount: { amount: 4.5, currency: "PEN" as const }, method: "bank_transfer" as const, deductStockIfPartial: false }],
      delivery: { chargeDeliveryToCustomer: false, delivery: { method: "store" as const,
        recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } } } }, deliverImmediately: false } };
  await store.save(pending);
  const delivery = { expectedPrice: { amount: 8, currency: "PEN" as const }, delivery: {
    method: "home" as const, rateId: id(6), recipient: pending.request.delivery.delivery.recipient,
    destination: { districtCode: "150122", address: "Reviewed street", instructions: null },
  } };
  const calls: string[] = [];
  let offline = true;
  const api = createOrderApi(async (path) => {
    calls.push(path);
    return offline ? err({ code: "NETWORK_ERROR", message: "Offline" })
      : err({ code: "API_ERROR", message: "Missing", http: { status: 404, body: { code: "ORDER_NOT_FOUND", error: "Missing" } } });
  });
  const operations = createOrderOperations(api, store);
  expect(await operations.reviewLegacyPendingDelivery(companyId, delivery)).toMatchObject({ success: false, error: { code: "NETWORK_ERROR" } });
  expect(await store.read(companyId)).toEqual(ok(pending));
  offline = false;
  const next = { ...pending, shownTotal: { amount: 18, currency: "PEN" }, request: { ...pending.request, delivery } };
  expect(await operations.reviewLegacyPendingDelivery(companyId, delivery)).toEqual(ok({ kind: "uncertain", pending: next }));
  expect(await store.read(companyId)).toEqual(ok(next));
  expect(calls).toEqual([`/api/orders/${id(3)}/aggregate`, `/api/orders/${id(3)}/aggregate`]);
  const replacement = { ...delivery, expectedPrice: { amount: 12, currency: "PEN" as const }, delivery: { ...delivery.delivery, rateId: id(9) } };
  const reviewed = { ...next, shownTotal: { amount: 22, currency: "PEN" }, request: { ...next.request, delivery: replacement } };
  expect(await operations.reviewLegacyPendingDelivery(companyId, replacement)).toEqual(ok({ kind: "uncertain", pending: reviewed }));
  expect(await store.read(companyId)).toEqual(ok(reviewed));
  expect(reviewed.request.payments).toEqual(pending.request.payments);
  expect(reviewed.request.items).toEqual(pending.request.items);
  expect(calls).toHaveLength(3);
});

test("rated creation resends its exact reviewed selection after restart and clears a price rejection", async () => {
  const bodies: unknown[] = [];
  let reject = false;
  const api = createOrderApi(async (path, init) => {
    if (path === "/api/orders") {
      bodies.push(JSON.parse(String(init?.body)));
      return reject ? err({ code: "API_ERROR", message: "Price changed", http: { status: 409,
        body: { code: "TOTAL_CHANGED", error: "Price changed", currentPrice: { amount: 10, currency: "PEN" } } } })
        : err({ code: "NETWORK_ERROR", message: "Lost response" });
    }
    return err({ code: "API_ERROR", message: "Missing", http: { status: 404, body: { code: "ORDER_NOT_FOUND", error: "Missing" } } });
  });
  const selected = { ...draft(), ratedDelivery: { expectedPrice: { amount: 8, currency: "PEN" as const }, delivery: {
    method: "home" as const, rateId: id(6), recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } },
    destination: { districtCode: "150122", address: "Calle 123", instructions: null },
  } } };
  const store = storage();
  expect(await createOrderOperations(api, store).completeOrder(selected, companyId)).toMatchObject({ success: true,
    data: { kind: "uncertain", pending: { shownTotal: { amount: 18, currency: "PEN" }, request: { delivery: selected.ratedDelivery } } } });
  reject = true;
  expect(await createOrderOperations(api, store).resendPendingOrder(companyId)).toMatchObject({ success: false,
    error: { code: "TOTAL_CHANGED", currentPrice: { amount: 10, currency: "PEN" } } });
  expect(bodies).toEqual([expect.objectContaining({ delivery: selected.ratedDelivery }), bodies[0]]);
  expect(await store.read(companyId)).toEqual(ok(null));
  expect(selected.ratedDelivery.expectedPrice.amount).toBe(8);
});
