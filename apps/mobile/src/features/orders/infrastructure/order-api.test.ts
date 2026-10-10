import { err, ok } from "@shared/functional";
import { createOrderApi } from "@mobile/features/orders/infrastructure/order-api";
import type { TransportError } from "@mobile/shared/application/transport-error";

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

test.each(["home", "agency", "store"] as const)("creation refuses legacy %s delivery before HTTP", async (method) => {
  const request = jest.fn(async () => ok({ unexpected: true }));
  const api = createOrderApi(request);
  const recipient = { name: "Ana", phone: "999", identity: { kind: "document" as const, documentType: "national_id" as const, document: "00123456" } };
  const delivery = method === "home" ? { method, recipient, destination: { address: "Street", district: "Lima", instructions: null } }
    : method === "agency" ? { method, recipient, courierId: id(4), agency: "Old agency" } : { method, recipient };
  for (const chargeDeliveryToCustomer of [true, false]) {
    expect(await api.create({ id: id(1), contactId: null, items: [{ variantId: id(2), quantity: 1 }],
      delivery: { delivery, chargeDeliveryToCustomer } } as unknown as Parameters<typeof api.create>[0])).toMatchObject({ error: { code: "INVALID_INPUT" } });
  }
  expect(request).not.toHaveBeenCalled();
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

test("order error schemas preserve transport failures and the checkout status exception", async () => {
  const failures: { error: TransportError; getCode: string; checkoutCode: string }[] = [
    { error: { code: "NETWORK_ERROR", message: "Offline" }, getCode: "NETWORK_ERROR", checkoutCode: "NETWORK_ERROR" },
    { error: { code: "SERVER_ERROR", message: "Unavailable", http: { status: 502, body: "Bad gateway" } },
      getCode: "SERVER_ERROR", checkoutCode: "SERVER_ERROR" },
    { error: { code: "API_ERROR", message: "Unknown", http: { status: 400, body: { code: "UNKNOWN", error: "Unknown" } } },
      getCode: "INVALID_RESPONSE", checkoutCode: "INVALID_RESPONSE" },
    { error: { code: "API_ERROR", message: "Invalid", http: { status: 400, body: { code: "INVALID_INPUT", error: "Invalid" } } },
      getCode: "INVALID_INPUT", checkoutCode: "INVALID_RESPONSE" },
    { error: { code: "API_ERROR", message: "Invalid", http: { status: 422, body: { code: "INVALID_INPUT", error: "Invalid" } } },
      getCode: "INVALID_RESPONSE", checkoutCode: "INVALID_INPUT" },
    { error: { code: "SERVER_ERROR", message: "Failed", http: { status: 502, body: { code: "INTERNAL_ERROR", error: "Failed" } } },
      getCode: "INVALID_RESPONSE", checkoutCode: "INVALID_RESPONSE" },
    { error: { code: "API_ERROR", message: "Invalid", http: { status: 404, body: { code: "ORDER_NOT_FOUND", error: "Missing", issues: "bad" } } },
      getCode: "INVALID_RESPONSE", checkoutCode: "INVALID_RESPONSE" },
  ];
  for (const { error, getCode, checkoutCode } of failures) {
    const api = createOrderApi(async () => err(error));
    expect(await api.get(id(1))).toMatchObject({ success: false, error: { code: getCode } });
    expect(await api.enableCheckout(id(1))).toMatchObject({ success: false, error: { code: checkoutCode } });
  }
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
  const input = { delivery: { method: "store" as const, recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } } }, expectedPrice: { amount: 0, currency: "PEN" as const } };
  const request = jest.fn(async () => err({ code: "API_ERROR" as const, message: "Failed", http: { status: 422, body: { code: "DELIVERY_METHOD_DISABLED", error: "Disabled" } } }));
  const api = createOrderApi(request);
  expect(await api.setDelivery(id(1), { ...input, delivery: { ...input.delivery, recordedBy: { kind: "buyer" } } } as typeof input))
    .toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(request).not.toHaveBeenCalled();
  for (const chargeDeliveryToCustomer of [true, false]) {
    expect(await api.setDelivery(id(1), { ...input, chargeDeliveryToCustomer } as typeof input)).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(await api.setDelivery(id(1), { delivery: input.delivery, chargeDeliveryToCustomer } as unknown as typeof input)).toMatchObject({ error: { code: "INVALID_INPUT" } });
  }
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
  const input = { delivery: { method: "store" as const, recipient: delivery.recipient }, expectedPrice: zero };
  const order = { id: id(1), companyId: id(2), sellerId: "original-seller", number: 1001, buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null, checkoutDeliveryRequest: null, deliveredAt: null, createdAt: "2026-10-05T12:00:00.000Z", completedAt: null,
    status: "active", paymentStatus: "pending", deliveryStatus: "pending", stockDeducted: false, total, paidAmount: zero, balanceDue: total, overpaidAmount: zero,
    cancelled: false, delivery, payments: [], itemsTotal: total, deliveryCost: { amount: 3, currency: "PEN" }, deliveryCharge: zero,
    items: [{ id: id(3), variantId: id(4), productName: "Item", variantAttributes: {}, sku: null, quantity: 1, unitPrice: total, subtotal: total }] };
  expect(await createOrderApi(async () => ok(order)).get(id(1))).toMatchObject({ success: true, data: { delivery, total } });
  const ratedPickup = { delivery: input.delivery, expectedPrice: zero };
  expect(await createOrderApi(async () => ok({ ...order, deliveryCost: zero })).setDelivery(id(1), ratedPickup)).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  expect(await createOrderApi(async () => ok({ ...order, delivery: { ...delivery, settingsVersion: 2 } })).setDelivery(id(1), ratedPickup))
    .toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  expect(await createOrderApi(async () => ok({ ...order, deliveryCost: zero, delivery: { ...delivery, settingsVersion: 2 } })).setDelivery(id(1), ratedPickup))
    .toMatchObject({ success: true });
  const ratedHome = { delivery: { method: "home" as const, recipient: delivery.recipient, rateId: id(5),
    destination: { districtCode: "150122", address: "Street", instructions: null } }, expectedPrice: { amount: 8, currency: "PEN" as const } };
  const homeSnapshot = { method: "home", recipient: delivery.recipient, recordedBy: delivery.recordedBy,
    pricing: { rateId: id(5), quotationId: id(6), zoneId: id(7), settingsVersion: 2 },
    destination: { country: "PE", districtCode: "150122", district: "MIRAFLORES", province: "LIMA METROPOLITANA", department: "LIMA", address: "Street", instructions: null } };
  const homeOrder = { ...order, delivery: homeSnapshot, deliveryCost: ratedHome.expectedPrice, deliveryCharge: ratedHome.expectedPrice,
    total: { amount: 18, currency: "PEN" }, balanceDue: { amount: 18, currency: "PEN" } };
  expect(await createOrderApi(async () => ok(homeOrder)).setDelivery(id(1), ratedHome)).toMatchObject({ success: true });
  for (const wrong of [{ ...homeOrder, deliveryCharge: zero }, { ...homeOrder, deliveryCost: zero },
    { ...homeOrder, deliveryCharge: { amount: 8, currency: "USD" } }]) {
    expect(await createOrderApi(async () => ok(wrong)).setDelivery(id(1), ratedHome)).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  }
  for (const wrong of [{ ...homeSnapshot, pricing: { ...homeSnapshot.pricing, rateId: id(8) } },
    { ...homeSnapshot, destination: { ...homeSnapshot.destination, districtCode: "040110" } }]) {
    expect(await createOrderApi(async () => ok({ ...homeOrder, delivery: wrong })).setDelivery(id(1), ratedHome))
      .toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  }
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

test("rated assignment sends the rate and reviewed price and preserves typed price conflicts", async () => {
  const input = { delivery: { method: "home", rateId: id(5), recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
    destination: { districtCode: "150122", address: "Street", instructions: null } }, expectedPrice: { amount: 8, currency: "PEN" } } as const;
  const calls: [string, RequestInit | undefined][] = [];
  const currentPrice = { amount: 10, currency: "PEN" };
  const api = createOrderApi(async (path, init) => { calls.push([path, init]); return err({ code: "API_ERROR", message: "API error",
    http: { status: 409, body: { code: "TOTAL_CHANGED", error: "Review price", currentPrice } } }); });
  expect(await api.setDelivery(id(1), input)).toEqual(err({ code: "TOTAL_CHANGED", message: "Review price", currentPrice }));
  expect(calls[0][0]).toBe(`/api/orders/${id(1)}/delivery`);
  expect(JSON.parse(String(calls[0][1]?.body))).toEqual(input);
  const wrong = createOrderApi(async () => err({ code: "API_ERROR", message: "Error", http: { status: 422,
    body: { code: "TOTAL_CHANGED", error: "Review price", currentPrice } } }));
  expect(await wrong.setDelivery(id(1), input)).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  expect(await api.get(id(1))).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  const incomplete = createOrderApi(async () => err({ code: "API_ERROR", message: "Error", http: { status: 409,
    body: { code: "TOTAL_CHANGED", error: "Review price" } } }));
  expect(await incomplete.setDelivery(id(1), input)).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  const creation = { id: id(1), contactId: null, items: [{ variantId: id(2), quantity: 1 }], delivery: input };
  expect(await api.create(creation)).toMatchObject({ success: false, error: { code: "TOTAL_CHANGED", currentPrice } });
  expect(JSON.parse(String(calls[2][1]?.body))).toEqual(creation);
});


test("catalog recovery loads explicit variant IDs and rejects malformed or duplicate IDs before HTTP", async () => {
  const paths: string[] = [];
  const api = createOrderApi(async path => { paths.push(path); return ok([]); });
  expect(await api.findCatalog([id(1), id(2)])).toEqual(ok([]));
  expect(paths).toEqual([`/api/orders/catalog?${new URLSearchParams({ variantIds: [id(1), id(2)].join(",") })}`]);
  for (const ids of [[], ["invalid"], [id(1), id(1)]])
    expect(await api.findCatalog(ids)).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(paths).toHaveLength(1);
});


test("saved contact lookup validates identity and represents a deleted contact as absence", async () => {
  const contact = { id: id(1), name: "Ana", phone: "999" };
  const request = jest.fn(async () => ok([contact]));
  const api = createOrderApi(request);
  expect(await api.findContact(id(1))).toEqual(ok(contact));
  expect(request).toHaveBeenCalledWith(`/api/orders/contacts?contactId=${id(1)}`);
  expect(await api.findContact("invalid")).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(request).toHaveBeenCalledTimes(1);
  expect(await createOrderApi(async () => ok([])).findContact(id(1))).toEqual(ok(null));
  expect(await api.findContact(id(2))).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
});

function cancellationFixture() {
  const total = { amount: 10, currency: "PEN" as const };
  const zero = { amount: 0, currency: "PEN" as const };
  return { id: id(1), companyId: id(2), sellerId: "seller", number: 1001, buyer: null,
    checkoutEnabledAt: null, checkoutConfirmedAt: null, checkoutDeliveryRequest: null, deliveredAt: null, completedAt: null,
    createdAt: "2026-10-05T12:00:00.000Z", status: "cancelled", paymentStatus: "pending",
    deliveryStatus: "pending", cancelled: true, stockDeducted: true, delivery: null, payments: [],
    total, paidAmount: zero, balanceDue: total, overpaidAmount: zero, itemsTotal: total, deliveryCost: zero, deliveryCharge: zero,
    items: [{ id: id(3), variantId: id(4), productName: "Item", variantAttributes: {}, sku: null, quantity: 1, unitPrice: total, subtotal: total }] };
}

test("cancellation validates ID and complete state then exposes only the application projection", async () => {
  const order = cancellationFixture();
  const request = jest.fn(async () => ok(order));
  const api = createOrderApi(request);
  expect(await api.cancel("bad")).toMatchObject({ error: { code: "INVALID_INPUT" } });
  expect(request).not.toHaveBeenCalled();
  const projection = { id: id(1), status: "cancelled", cancelled: true, deliveryStatus: "pending", stockDeducted: true, deliveredAt: null, completedAt: null };
  expect(await api.cancel(id(1))).toEqual(ok(projection));
  expect(request).toHaveBeenCalledWith(`/api/orders/${id(1)}/cancel`, { method: "POST" });
  expect(await api.readCancellationState(id(1))).toEqual(ok(projection));
  expect(await createOrderApi(async () => ok({ ...order, stockDeducted: false })).cancel(id(1))).toEqual(ok({ ...projection, stockDeducted: false }));
  for (const invalid of [{ ...order, id: id(5) }, { ...order, cancelled: false }, { ...order, status: "active" },
    { ...order, deliveryStatus: "shipped" }, { ...order, deliveredAt: order.createdAt }, { ...order, completedAt: order.createdAt },
    { ...order, stockDeducted: "yes" }, { ...order, payments: undefined }]) {
    expect(await createOrderApi(async () => ok(invalid)).cancel(id(1))).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  }
  for (const invalid of [{ ...order, id: id(5) }, { ...order, status: "active" }, { ...order, deliveryStatus: "shipped" }]) {
    expect(await createOrderApi(async () => ok(invalid)).readCancellationState(id(1))).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  }
});

test("cancellation errors must match both HTTP status and the operation", async () => {
  for (const [code, status] of [["INVALID_INPUT", 400], ["ORDER_NOT_FOUND", 404], ["INVALID_TRANSITION", 409],
    ["INVALID_ORDER", 422], ["INVALID_PAYMENT", 422], ["CURRENCY_MISMATCH", 422], ["INTERNAL_ERROR", 500]] as const) {
    const failure = (responseStatus: number) => createOrderApi(async () => err({ code: "API_ERROR", message: "Failed", http: { status: responseStatus, body: { code, error: "Rejected" } } }));
    expect(await failure(status).cancel(id(1))).toMatchObject({ error: { code: code === "INTERNAL_ERROR" ? "SERVER_ERROR" : code } });
    expect(await failure(status + 10).cancel(id(1))).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  }
  for (const code of ["INSUFFICIENT_STOCK", "ORDER_CANCELLED", "UNKNOWN"] as const) {
    const api = createOrderApi(async () => err({ code: "API_ERROR", message: "Failed", http: { status: 409, body: { code, error: "Rejected" } } }));
    expect(await api.cancel(id(1))).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
  }
});


test("cancellation adapter retains transport failures and session boundaries", async () => {
  for (const code of ["NETWORK_ERROR", "SERVER_ERROR", "SERVICE_UNAVAILABLE", "RATE_LIMITED", "UNAUTHENTICATED", "COMPANY_REQUIRED", "INVALID_COMPANY", "OPERATION_CANCELLED", "SECURE_STORAGE_ERROR"] as const) {
    const failure = { code, message: "Unavailable" };
    const api = createOrderApi(async () => err(failure));
    expect(await api.cancel(id(1))).toEqual(err(failure));
    expect(await api.readCancellationState(id(1))).toEqual(err(failure));
  }
});


test.each([401, 403])("cancellation treats HTTP %s as an authorization failure even with an unknown body", async status => {
  const api = createOrderApi(async () => err({ code: "API_ERROR", message: "Access rejected", http: { status, body: { code: "EMAIL_VERIFICATION_REQUIRED", error: "Access rejected" } } }));
  expect(await api.cancel(id(1))).toEqual(err({ code: "UNAUTHENTICATED", message: "Access rejected" }));
  expect(await api.readCancellationState(id(1))).toEqual(err({ code: "UNAUTHENTICATED", message: "Access rejected" }));
});
