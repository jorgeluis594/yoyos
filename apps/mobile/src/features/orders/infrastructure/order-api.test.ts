import { err, ok } from "@shared/functional";
import { createOrderApi } from "@mobile/features/orders/infrastructure/order-api";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("order API sends only validated creation fields and validates the reply", async () => {
  const calls: [string, RequestInit | undefined][] = [];
  const api = createOrderApi(async (path, init) => { calls.push([path, init]); return ok({ unexpected: true }); });
  const input = { id: id(1), contactId: null, items: [{ variantId: id(2), quantity: 2 }] };
  expect(await api.create(input)).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe("/api/orders/immediate-sale");
  expect(JSON.parse(String(calls[0][1]?.body))).toEqual(input);
  expect(await api.create({ ...input, items: [] })).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(calls).toHaveLength(1);
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
  const summary = { id: id(1), customer: { kind: "general_public" }, sellerId: "seller",
    createdAt: "2026-09-29T12:00:00.000Z", completedAt: null, status: "active", paymentStatus: "pending",
    deliveryStatus: "pending", stockDeducted: false, total };
  const order = { ...summary, companyId: id(2), paidAmount: zero, balanceDue: total, overpaidAmount: zero,
    cancelled: false, delivery: null, payments: [], itemsTotal: total, deliveryCost: zero, deliveryCharge: zero,
    items: [{ id: id(3), variantId: id(4), productName: "Item", variantAttributes: {}, sku: null,
      quantity: 1, unitPrice: total, subtotal: total }] };
  const paths: string[] = [];
  const api = createOrderApi(async (path) => { paths.push(path); return ok(path.includes("/mixed?")
    ? { items: [summary], page: 1, pageSize: 20, total: 1 }
    : path.endsWith("/payments") ? { order, stock: { kind: "pending", reason: "INSUFFICIENT_STOCK" } } : order); });
  expect(await api.listAggregates({ page: 1, customer: "all" })).toMatchObject({ success: true,
    data: { items: [{ id: id(1), status: "active" }] } });
  expect(await api.getAggregate(id(1))).toMatchObject({ success: true, data: { id: id(1), payments: [] } });
  expect(await api.createPending({ id: id(1), contactId: null, items: [{ variantId: id(4), quantity: 1 }] }))
    .toMatchObject({ success: true, data: { status: "active" } });
  expect(await api.registerPayment(id(1), { paymentId: id(5), amount: total, method: "digital_wallet", deductStockIfPartial: false }))
    .toMatchObject({ success: true, data: { stock: { kind: "pending", reason: "INSUFFICIENT_STOCK" } } });
  expect(await api.deductStock(id(1))).toMatchObject({ success: true, data: { id: id(1) } });
  expect(paths).toEqual(["/api/orders/mixed?page=1&customer=all", `/api/orders/${id(1)}/aggregate`,
    "/api/orders/pending", `/api/orders/${id(1)}/payments`, `/api/orders/${id(1)}/deduct-stock`]);
  expect(await api.registerPayment(id(1), { paymentId: "bad", amount: total, method: "digital_wallet", deductStockIfPartial: false }))
    .toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(paths).toHaveLength(5);
  const bad = createOrderApi(async () => ok({ ...order, stockDeducted: "yes" }));
  expect(await bad.getAggregate(id(1))).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
});
