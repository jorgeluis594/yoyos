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

test("dispatch filters map to the mixed query and reject unscheduled with a range", async () => {
  const paths: string[] = [];
  const operations = createOrderOperations(createOrderApi(async (path) => { paths.push(path); return ok({ items: [], page: 1, pageSize: 20, total: 0 }); }), storage());
  const courierId = id(9);
  await operations.loadMixedOrders({ page: 1, customer: { kind: "all" }, deliveryStatus: "shipped", courierId, scheduledFrom: "2026-10-01", scheduledThrough: "2026-10-05",
    shippedFromDay: "1989-12-31", shippedThroughDay: "1989-12-31" });
  const query = new URL(`http://localhost${paths[0]}`).searchParams;
  expect(Object.fromEntries(query)).toMatchObject({ deliveryStatus: "shipped", courierId, scheduledFrom: "2026-10-01", scheduledThrough: "2026-10-05",
    shippedFrom: "1989-12-31T05:00:00.000Z", shippedBefore: "1990-01-01T04:00:00.000Z" });
  await operations.loadMixedOrders({ page: 1, customer: { kind: "all" }, unscheduled: true });
  expect(new URL(`http://localhost${paths[1]}`).searchParams.get("unscheduled")).toBe("true");
  for (const bad of [{ unscheduled: true as const, scheduledFrom: "2026-10-01" }, { scheduledFrom: "2026-10-05", scheduledThrough: "2026-10-01" },
    { shippedFromDay: "2026-10-05", shippedThroughDay: "2026-10-01" }])
    expect(await operations.loadMixedOrders({ page: 1, customer: { kind: "all" }, ...bad })).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(paths).toHaveLength(2);
});

const missing = () => err({ code: "API_ERROR" as const, message: "Absent", http: { status: 404, body: { code: "ORDER_NOT_FOUND", error: "Absent" } } });

test("save failure prevents POST; a lost response queues the sale once and never blocks the next one", async () => {
  let sends = 0;
  const bodies: unknown[] = [];
  const api = createOrderApi(async (path, init) => path === "/api/orders" ? (sends++, bodies.push(JSON.parse(String(init?.body))),
    err({ code: "NETWORK_ERROR", message: "Offline" })) : missing());
  const broken = createPendingOrderConfirmationStore({ getItemAsync: async () => null,
    setItemAsync: async () => { throw new Error("Cannot save"); }, deleteItemAsync: async () => {} });
  expect(await createOrderOperations(api, broken).completeOrder(draft(), companyId))
    .toMatchObject({ success: false, error: { code: "PENDING_STORAGE_UNAVAILABLE" } });
  expect(sends).toBe(0);
  const store = storage();
  const operations = createOrderOperations(api, store);
  const selected = draft();
  const [first, second] = await Promise.all([operations.completeOrder(selected, companyId), operations.completeOrder(selected, companyId)]);
  expect(first).toEqual(second);
  expect(first).toMatchObject({ success: true, data: { kind: "queued", pending: { id: id(3) } } });
  expect(sends).toBe(1);
  expect(bodies).toEqual([{ id: id(3), items: [{ variantId: id(2), quantity: 1 }] }]);
  const other = addDraftItem(emptyOrderDraft(), item, () => id(4));
  if (!other.success) throw new Error("Invalid second cart");
  expect(await operations.completeOrder(other.data, companyId)).toMatchObject({ success: true, data: { kind: "queued", pending: { id: id(4) } } });
  expect(await store.list(companyId)).toMatchObject({ success: true, data: [{ id: id(3) }, { id: id(4) }] });
});

test("a refused first save clears the queued sale and leaves the cart available", async () => {
  const api = createOrderApi(async () => err({ code: "API_ERROR", message: "No stock", http: { status: 409,
    body: { code: "INSUFFICIENT_STOCK", error: "No stock", issues: [{ field: "items", reason: "STOCK", variantId: id(2) }] } } }));
  const store = storage();
  const selected = draft();
  expect(await createOrderOperations(api, store).completeOrder(selected, companyId)).toMatchObject({ success: false,
    error: { code: "INSUFFICIENT_STOCK", issues: [{ variantId: id(2) }] } });
  expect(await store.list(companyId)).toEqual(ok([]));
  expect(selected.kind).toBe("items");
});

test("sync resends the exact stored request after checking core, keeps waiting while it fails and clears it once saved", async () => {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  let online = false;
  const amount = { amount: 4.5, currency: "PEN" as const };
  const api = createOrderApi(async (path, init) => {
    calls.push(init?.method === "POST" ? "post" : "get");
    if (path === "/api/orders") { bodies.push(JSON.parse(String(init?.body))); return online ? ok(completed()) : err({ code: "NETWORK_ERROR", message: "Lost response" }); }
    return online ? missing() : err({ code: "NETWORK_ERROR", message: "Offline" });
  });
  const store = storage();
  const selected = { ...draft(), payments: [{ paymentId: id(8), amount: "4.50", method: "bank_transfer" as const, deductStockIfPartial: false }],
    ratedDelivery: { expectedPrice: { amount: 8, currency: "PEN" as const }, delivery: {
      method: "home" as const, rateId: id(6), recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } },
      destination: { districtCode: "150122", address: "Original address", instructions: "Door 2" },
    } }, deliverImmediately: false };
  expect(await createOrderOperations(api, store).completeOrder(selected, companyId)).toMatchObject({ success: true, data: { kind: "queued" } });
  const restarted = createOrderOperations(api, store);
  expect(await restarted.syncPendingOrders(companyId)).toEqual({ waiting: 1 });
  expect(calls).toEqual(["post", "get", "get"]);
  online = true;
  expect(await restarted.syncPendingOrders(companyId)).toEqual({ waiting: 0 });
  expect(calls).toEqual(["post", "get", "get", "get", "post"]);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[1]).toMatchObject({ payments: [{ paymentId: id(8), amount }],
    delivery: { delivery: { rateId: id(6), destination: { address: "Original address" } } }, deliverImmediately: false });
  expect(await store.list(companyId)).toEqual(ok([]));
  expect(await restarted.syncPendingOrders(companyId)).toEqual({ waiting: 0 });
  expect(calls).toHaveLength(5);
});

test.each([
  ["INSUFFICIENT_STOCK", 409], ["VARIANT_NOT_FOUND", 404],
  ["INVALID_INPUT", 400],
  ["INVALID_PAYMENT", 422], ["PAYMENT_CONFLICT", 409], ["PAYMENT_REQUIRED", 409],
  ["INVALID_TRANSITION", 409], ["STOCK_NOT_DEDUCTED", 409],
  ["DELIVERY_UNAVAILABLE", 422], ["DELIVERY_METHOD_DISABLED", 422],
  ["RATE_UNAVAILABLE", 422], ["TOTAL_CHANGED", 409], ["INVALID_DISTRICT", 422], ["INVALID_DELIVERY_RATE", 422],
] as const)("sync keeps a sale core refuses (%s) for review and stops retrying it", async (code, status) => {
  const store = storage();
  let posts = 0;
  let refuse = false;
  const api = createOrderApi(async (path) => {
    if (path !== "/api/orders") return missing();
    posts++;
    return refuse
      ? err({ code: "API_ERROR", message: "Rejected", http: { status, body: { code, error: "Rejected", ...(code === "TOTAL_CHANGED" ? { currentPrice: { amount: 8, currency: "PEN" } } : {}) } } })
      : err({ code: "NETWORK_ERROR", message: "Lost response" });
  });
  expect(await createOrderOperations(api, store).completeOrder({ ...draft(), deliverImmediately: true }, companyId))
    .toMatchObject({ success: true, data: { kind: "queued" } });
  const original = await store.read(companyId, id(3));
  if (!original.success || !original.data) throw new Error("Expected queued sale");
  refuse = true;
  const restarted = createOrderOperations(api, store);
  expect(await restarted.syncPendingOrders(companyId)).toEqual({ waiting: 0 });
  expect(await store.read(companyId, id(3))).toEqual(ok({ ...original.data, rejection: { code, message: "Rejected" } }));
  expect(await restarted.syncPendingOrders(companyId)).toEqual({ waiting: 0 });
  expect(posts).toBe(2);
});

const zero = { amount: 0, currency: "PEN" as const };
const total = { amount: 12, currency: "PEN" as const };
const completed = (): OrderAggregateResponse => ({ number: 1001, id: id(3), companyId, sellerId: "seller", buyer: null, source: "manual", checkoutEnabledAt: null, checkoutConfirmedAt: null, scheduledDispatchDate: null, shippedAt: null,
  createdAt: "2026-09-29T12:00:00.000Z", deliveredAt: "2026-09-29T12:00:00.000Z", completedAt: "2026-09-29T12:00:00.000Z",
  status: "completed", paymentStatus: "paid", paidAmount: total, balanceDue: zero, overpaidAmount: zero,
  cancelled: false, delivery: null, deliveryStatus: "delivered", stockDeducted: true,
  itemsTotal: total, deliveryCost: zero, deliveryCharge: zero, total,
  payments: [{ id: id(6), orderId: id(3), amount: total, method: "digital_wallet", status: "confirmed", data: { confirmedAt: "2026-09-29T12:00:00.000Z", confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } }],
  items: [{ id: id(5), variantId: id(2), productName: "Sample", variantAttributes: {}, sku: null, quantity: 1, unitPrice: total, subtotal: total }] });

test("a sale core already has completes with the amount first shown and leaves the queue", async () => {
  const order = completed();
  let lookups = 0;
  const api = createOrderApi(async (path) => path === "/api/orders"
    ? err({ code: "NETWORK_ERROR", message: "Lost response" }) : ++lookups === 1 ? missing() : ok(order));
  const store = storage();
  const operations = createOrderOperations(api, store);
  expect(await operations.completeOrder(draft(), companyId)).toMatchObject({ success: true, data: { kind: "queued" } });
  expect(await operations.syncPendingOrders(companyId)).toEqual({ waiting: 0 });
  expect(await store.list(companyId)).toEqual(ok([]));

  const pending = { ...order, status: "active" as const, paymentStatus: "pending" as const,
    completedAt: null, deliveredAt: null, deliveryStatus: "pending" as const, stockDeducted: false, payments: [], paidAmount: zero, balanceDue: total };
  const incomplete = { ...order, paidAmount: zero, balanceDue: total };
  expect(await createOrderOperations(createOrderApi(async () => ok(incomplete)), storage()).completeOrder(draft(), companyId))
    .toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  for (const [response, found] of [[{ code: "ORDER_ALREADY_EXISTS", status: 409 }, order], [{ code: "ORDER_ALREADY_EXISTS", status: 409 }, pending], [null, order]] as const) {
    const conflictStore = storage();
    const conflictApi = createOrderApi(async (path) => path !== "/api/orders" ? ok(found) : response
      ? err({ code: "API_ERROR", message: "Exists", http: { status: response.status, body: { code: response.code, error: "Exists" } } })
      : err({ code: "NETWORK_ERROR", message: "Lost response" }));
    expect(await createOrderOperations(conflictApi, conflictStore).completeOrder(draft(), companyId))
      .toMatchObject({ success: true, data: { kind: "completed", shownTotal: { amount: 10, currency: "PEN" }, order: { id: id(3), status: found.status } } });
    expect(await conflictStore.list(companyId)).toEqual(ok([]));
  }
});

test("an attempt saved in an older format is never sent and can be discarded", async () => {
  const values = new Map([[`yoyos_pending_order_${companyId}`, JSON.stringify({ companyId, id: id(3), shownTotal: { amount: 10, currency: "PEN" } })]]);
  const store = createPendingOrderConfirmationStore({ getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); }, deleteItemAsync: async (key) => { values.delete(key); } });
  let sends = 0;
  const api = createOrderApi(async (_path, init) => { if (init?.method === "POST") sends++; return missing(); });
  const operations = createOrderOperations(api, store);
  expect(await operations.syncPendingOrders(companyId)).toEqual({ waiting: 0 });
  expect(await operations.listPendingOrders(companyId)).toMatchObject({ success: false, error: { code: "INVALID_PENDING_DATA" } });
  expect(sends).toBe(0);
  expect(await operations.discardPendingOrderConfirmation(companyId)).toEqual(ok(undefined));
  expect(await operations.listPendingOrders(companyId)).toEqual(ok([]));
});

test("in-flight outcomes never cross company boundaries", async () => {
  const api = createOrderApi(async () => err({ code: "NETWORK_ERROR", message: "Offline" }));
  const operations = createOrderOperations(api, storage());
  const [first, second] = await Promise.all([operations.completeOrder(draft(), companyId), operations.completeOrder(draft(), id(9))]);
  expect(first).toMatchObject({ success: true, data: { kind: "queued", pending: { companyId } } });
  expect(second).toMatchObject({ success: true, data: { kind: "queued", pending: { companyId: id(9) } } });
});

test("reviewing a refused sale checks its identity, saves corrections atomically and sends them under the same IDs", async () => {
  const store = storage();
  const original = { version: 2 as const, companyId, id: id(3), shownTotal: { amount: 10, currency: "PEN" as const },
    request: { id: id(3), items: [{ variantId: id(2), quantity: 1 }],
      payments: [{ paymentId: id(8), amount: { amount: 4.5, currency: "PEN" as const }, method: "bank_transfer" as const, deductStockIfPartial: false }] },
    rejection: { code: "INSUFFICIENT_STOCK", message: "No stock" } };
  await store.save(original);
  const paths: string[] = [];
  const bodies: unknown[] = [];
  let refuse = true;
  const api = createOrderApi(async (path, init) => {
    paths.push(path);
    if (path !== "/api/orders") return missing();
    bodies.push(JSON.parse(String(init?.body)));
    return refuse ? err({ code: "API_ERROR", message: "Still no stock", http: { status: 409, body: { code: "INSUFFICIENT_STOCK", error: "Still no stock" } } })
      : err({ code: "NETWORK_ERROR", message: "Lost response" });
  });
  const selected = draft();
  if (selected.kind !== "items") throw new Error("Expected cart");
  const corrected = { ...selected, items: [{ ...selected.items[0], quantity: 2 }] as const,
    payments: [{ paymentId: id(8), amount: "4.50", method: "bank_transfer" as const, deductStockIfPartial: false }] };
  const operations = createOrderOperations(api, store);
  expect(await operations.completeOrder(selected, companyId)).toMatchObject({ success: false, error: { code: "PENDING_CONFIRMATION" } });
  expect(await operations.reviewPendingOrder(companyId, { ...corrected, id: id(9) })).toMatchObject({ success: false, error: { code: "PENDING_CONFIRMATION" } });
  expect(paths).toEqual([]);
  expect(await operations.reviewPendingOrder(companyId, { ...corrected, items: [{ ...corrected.items[0], quantity: 0 }] }))
    .toMatchObject({ success: false, error: { code: "INVALID_CART" } });
  const broken = createOrderOperations(api, { ...store, replace: async () => err({ code: "PENDING_STORAGE_UNAVAILABLE", message: "Cannot save" }) });
  expect(await broken.reviewPendingOrder(companyId, corrected)).toMatchObject({ success: false, error: { code: "PENDING_STORAGE_UNAVAILABLE" } });
  expect(await store.read(companyId, id(3))).toEqual(ok(original));
  const { rejection: _rejection, ...current } = original;
  const next = { ...current, shownTotal: { amount: 20, currency: "PEN" }, request: { ...original.request, items: [{ variantId: id(2), quantity: 2 }] } };
  expect(await operations.reviewPendingOrder(companyId, corrected)).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK" } });
  expect(await store.read(companyId, id(3))).toEqual(ok({ ...next, rejection: { code: "INSUFFICIENT_STOCK", message: "Still no stock" } }));
  refuse = false;
  expect(await operations.reviewPendingOrder(companyId, corrected)).toEqual(ok({ kind: "queued", pending: next }));
  expect(await store.read(companyId, id(3))).toEqual(ok(next));
  expect(bodies).toEqual([next.request, next.request]);
});

test("saved review reconstructs current products while preserving missing references and original payments", async () => {
  const store = storage();
  const original = { version: 2 as const, companyId, id: id(3), shownTotal: { amount: 40, currency: "PEN" as const },
    request: { id: id(3), items: [{ variantId: id(2), quantity: 2 }, { variantId: id(4), quantity: 1 }],
      payments: [{ paymentId: id(8), amount: { amount: 4.5, currency: "PEN" as const }, method: "bank_transfer" as const, deductStockIfPartial: false }] } };
  await store.save(original);
  let unavailable = false;
  let failed = false;
  const paths: string[] = [];
  const api = createOrderApi(async path => {
    paths.push(path);
    if (path.startsWith("/api/orders/catalog?")) return failed ? err({ code: "NETWORK_ERROR", message: "Offline" }) : ok(unavailable ? [] : [{ id: id(9), name: "Current product", currency: "PEN",
      variants: [{ id: id(2), attributes: {}, sku: null, price: 12, stock: 0 }] }]);
    return missing();
  });
  const operations = createOrderOperations(api, store);
  const review = await operations.loadPendingOrderReview(companyId, id(3));
  expect(review).toMatchObject({ success: true, data: { kind: "review", pending: original, unavailableVariantIds: [id(4)],
    draft: { id: id(3),
      payments: [{ paymentId: id(8), amount: "4.5", method: "bank_transfer" }],
      items: [{ variantId: id(2), quantity: 2, productName: "Current product", shownUnitPrice: { amount: 12, currency: "PEN" }, shownStock: 0 }] } } });
  expect(await store.read(companyId, id(3))).toEqual(ok(original));
  expect(paths[0]).toBe(`/api/orders/${id(3)}/aggregate`);
  expect(paths).toHaveLength(2);
  unavailable = true;
  expect(await operations.loadPendingOrderReview(companyId, id(3))).toMatchObject({ success: true, data: { kind: "review",
    unavailableVariantIds: [id(2), id(4)], draft: { kind: "empty", id: id(3), items: [], payments: [{ paymentId: id(8) }] } } });
  failed = true;
  expect(await operations.loadPendingOrderReview(companyId, id(3))).toMatchObject({ success: false, error: { code: "NETWORK_ERROR" } });
  expect(await operations.loadPendingOrderReview(companyId, id(7))).toMatchObject({ success: false, error: { code: "PENDING_CONFIRMATION" } });
  expect(await store.read(companyId, id(3))).toEqual(ok(original));
});
