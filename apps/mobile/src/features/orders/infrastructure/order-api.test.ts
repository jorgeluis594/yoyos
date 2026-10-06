import { err, ok } from "@shared/functional";
import { createOrderApi } from "@mobile/features/orders/infrastructure/order-api";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("order API sends only validated creation fields and validates the reply", async () => {
  const calls: [string, RequestInit | undefined][] = [];
  const api = createOrderApi(async (path, init) => { calls.push([path, init]); return ok({ unexpected: true }); });
  const input = { id: id(1), contactId: null, items: [{ variantId: id(2), quantity: 2 }] };
  expect(await api.create(input)).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe("/api/orders");
  expect(JSON.parse(String(calls[0][1]?.body))).toEqual(input);
  expect(await api.create({ ...input, items: [] })).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(calls).toHaveLength(1);
  const complete = { ...input, payment: { method: "digital_wallet" }, delivery: { method: "handover" } } as const;
  await api.create(complete);
  expect(calls[1][0]).toBe("/api/orders");
  expect(JSON.parse(String(calls[1][1]?.body))).toEqual(complete);
});

test("order API preserves matching business errors and rejects mismatched status or operation", async () => {
  const stock = { code: "INSUFFICIENT_STOCK", error: "No stock", issues: [{ field: "items", reason: "STOCK", variantId: id(2) }] };
  const api = createOrderApi(async () => err({ code: "API_ERROR", message: "API error", http: { status: 409, body: stock } }));
  expect(await api.create({ id: id(1), contactId: null, items: [{ variantId: id(2), quantity: 1 }] }))
    .toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK", issues: stock.issues } });
  expect(await api.get(id(1))).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  const wrongStatus = createOrderApi(async () => err({ code: "API_ERROR", message: "API error", http: { status: 404, body: stock } }));
  expect(await wrongStatus.create({ id: id(1), contactId: null, items: [{ variantId: id(2), quantity: 1 }] }))
    .toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
});

test("order API reads mixed summaries and validates complete aggregate states", async () => {
  const total = { amount: 10, currency: "PEN" as const };
  const zero = { amount: 0, currency: "PEN" as const };
  const summary = { number: 1001, id: id(1), buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null, sellerId: "seller",
    createdAt: "2026-09-29T12:00:00.000Z", deliveredAt: null, completedAt: null, status: "active", paymentStatus: "pending",
    deliveryStatus: "pending", stockDeducted: false, total };
  const order = { ...summary, companyId: id(2), paidAmount: zero, balanceDue: total, overpaidAmount: zero,
    cancelled: false, delivery: null, payments: [], itemsTotal: total, deliveryCost: zero, deliveryCharge: zero,
    items: [{ id: id(3), variantId: id(4), productName: "Item", variantAttributes: {}, sku: null,
      quantity: 1, unitPrice: total, subtotal: total }] };
  const paths: string[] = [];
  const api = createOrderApi(async (path) => { paths.push(path); return ok(path.includes("/mixed?")
    ? { items: [summary], page: 1, pageSize: 20, total: 1 }
    : path.endsWith("/payments") ? { order, stock: { kind: "not_requested" } } : order); });
  expect(await api.listAggregates({ page: 1, customer: "all" })).toMatchObject({ success: true,
    data: { items: [{ id: id(1), status: "active" }] } });
  expect(await api.getAggregate(id(1))).toMatchObject({ success: true, data: { id: id(1), payments: [] } });
  expect(await api.create({ id: id(1), contactId: null, items: [{ variantId: id(4), quantity: 1 }] }))
    .toMatchObject({ success: true, data: { status: "active" } });
  expect(await api.registerPayment(id(1), { paymentId: id(5), amount: total, method: "digital_wallet", deductStockIfPartial: false }))
    .toMatchObject({ success: true, data: { stock: { kind: "not_requested" } } });
  expect(await api.deductStock(id(1))).toMatchObject({ success: true, data: { id: id(1) } });
  expect(paths).toEqual(["/api/orders/mixed?page=1&customer=all", `/api/orders/${id(1)}/aggregate`,
    "/api/orders", `/api/orders/${id(1)}/payments`, `/api/orders/${id(1)}/deduct-stock`]);
  expect(await api.registerPayment(id(1), { paymentId: "bad", amount: total, method: "digital_wallet", deductStockIfPartial: false }))
    .toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(paths).toHaveLength(5);
  const bad = createOrderApi(async () => ok({ ...order, stockDeducted: "yes" }));
  expect(await bad.getAggregate(id(1))).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
});

test("delivery API rejects forged snapshots and preserves applicable errors with no retries", async () => {
  const input = { delivery: { method: "store" as const, recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } } }, chargeDeliveryToCustomer: false };
  const request = jest.fn(async () => err({ code: "API_ERROR" as const, message: "Failed", http: { status: 422, body: { code: "DELIVERY_METHOD_DISABLED", error: "Disabled" } } }));
  const api = createOrderApi(request);
  expect(await api.setDelivery(id(1), { ...input, delivery: { ...input.delivery, recordedBy: { kind: "buyer" } } } as typeof input))
    .toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(request).not.toHaveBeenCalled();
  expect(await api.setDelivery(id(1), input)).toMatchObject({ success: false, error: { code: "DELIVERY_METHOD_DISABLED" } });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(`/api/orders/${id(1)}/delivery`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const mismatch = createOrderApi(async () => err({ code: "API_ERROR", message: "Failed", http: { status: 409, body: { code: "DELIVERY_METHOD_DISABLED", error: "Disabled" } } }));
  expect(await mismatch.setDelivery(id(1), input)).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
});

test("delivery API validates the complete authored snapshot and updated aggregate identity", async () => {
  const total = { amount: 10, currency: "PEN" as const };
  const zero = { amount: 0, currency: "PEN" as const };
  const delivery = { method: "store" as const, recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } },
    pickupPoint: { name: "Store", address: "Lima", instructions: null }, recordedBy: { kind: "seller" as const, userId: "current-editor" } };
  const input = { delivery: { method: "store" as const, recipient: delivery.recipient }, chargeDeliveryToCustomer: false };
  const order = { id: id(1), companyId: id(2), sellerId: "original-seller", number: 1001, buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null, deliveredAt: null, createdAt: "2026-10-05T12:00:00.000Z", completedAt: null,
    status: "active", paymentStatus: "pending", deliveryStatus: "pending", stockDeducted: false, total, paidAmount: zero, balanceDue: total, overpaidAmount: zero,
    cancelled: false, delivery, payments: [], itemsTotal: total, deliveryCost: { amount: 3, currency: "PEN" }, deliveryCharge: zero,
    items: [{ id: id(3), variantId: id(4), productName: "Item", variantAttributes: {}, sku: null, quantity: 1, unitPrice: total, subtotal: total }] };
  expect(await createOrderApi(async () => ok(order)).setDelivery(id(1), input)).toMatchObject({ success: true, data: { delivery, total } });
  for (const operation of ["ship", "deliver"] as const) {
    const fulfilled = { ...order, paymentStatus: "paid", paidAmount: total, balanceDue: zero, stockDeducted: true,
      deliveryStatus: operation === "ship" ? "shipped" : "delivered",
      deliveredAt: operation === "ship" ? null : order.createdAt, completedAt: operation === "ship" ? null : order.createdAt,
      status: operation === "ship" ? "active" : "completed" };
    expect(await createOrderApi(async () => ok(fulfilled))[operation](id(1))).toEqual(ok(fulfilled));
    for (const invalid of [{ ...fulfilled, id: id(5) }, { ...fulfilled, deliveryStatus: "pending" }]) {
      expect(await createOrderApi(async () => ok(invalid))[operation](id(1))).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
    }
  }
  for (const invalid of [{ ...order, id: id(5) }, { ...order, delivery: null }, { ...order, delivery: { ...delivery, recordedBy: undefined } }, { ...order, delivery: { ...delivery, pickupPoint: undefined } }]) {
    expect(await createOrderApi(async () => ok(invalid)).setDelivery(id(1), input)).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  }
});

test("checkout link adapter validates IDs, responses and operation-specific failures", async () => {
  const calls: string[] = [];
  const url = `https://shop.example/checkout/${id(2)}/${id(1)}`;
  const api = createOrderApi(async (path) => { calls.push(path); return ok({ url }); });
  expect(await api.enableCheckout("1001")).toMatchObject({ error: { code: "INVALID_INPUT" } });
  expect(calls).toEqual([]);
  expect(await api.enableCheckout(id(1))).toEqual(ok({ url }));
  expect(calls).toEqual([`/api/orders/${id(1)}/checkout-link`]);
  expect(await createOrderApi(async () => ok({ url: "bad" })).enableCheckout(id(1))).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  for (const [code, status] of [["ORDER_CANCELLED", 409], ["ORDER_NOT_FOUND", 404], ["INVALID_INPUT", 422]] as const) {
    const failed = createOrderApi(async () => err({ code: "API_ERROR", message: "failure", http: { status, body: { code, error: "Rejected" } } }));
    expect(await failed.enableCheckout(id(1))).toMatchObject({ error: { code } });
  }
});

test.each(["ship", "deliver"] as const)("%s validates IDs, sends no payment data and preserves fulfillment failures", async operation => {
  const request = jest.fn(async () => ok({ unexpected: true }));
  const api = createOrderApi(request);
  expect(await api[operation]("bad")).toMatchObject({ error: { code: "INVALID_INPUT" } });
  expect(request).not.toHaveBeenCalled();
  expect(await api[operation](id(1))).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  expect(request).toHaveBeenCalledWith(`/api/orders/${id(1)}/${operation}`, { method: "POST" });
  for (const code of ["PAYMENT_REQUIRED", "STOCK_NOT_DEDUCTED", "ORDER_CANCELLED", "INVALID_TRANSITION"] as const) {
    const failed = createOrderApi(async () => err({ code: "API_ERROR", message: "Failed", http: { status: 409, body: { code, error: "Rejected" } } }));
    expect(await failed[operation](id(1))).toMatchObject({ error: { code } });
    const wrongStatus = createOrderApi(async () => err({ code: "API_ERROR", message: "Failed", http: { status: 422, body: { code, error: "Rejected" } } }));
    expect(await wrongStatus[operation](id(1))).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  }
});
