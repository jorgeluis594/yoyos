import { requestDeliveryQuotation } from "@core/src/features/delivery-settings/infrastructure/quotation-api";
import { loader as checkoutLoader, action as confirmCheckoutAction } from "@core/app/routes/checkout";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { createOrderOperations } from "@mobile/features/orders/application/order-operations";
import { addDraftItem, emptyOrderDraft } from "@mobile/features/orders/domain/order-draft";
import { createPendingOrderConfirmationStore } from "@mobile/features/orders/infrastructure/pending-order-confirmation";
import { log } from "@core/src/shared/infrastructure/logger";
import { createDeliverySettingsApi } from "@mobile/features/delivery-settings/infrastructure/delivery-settings-api";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { createOrderApi } from "@mobile/features/orders/infrastructure/order-api";
import { quotationResponseSchema } from "@shared/contracts/quotations";
import { orderAggregateSchema } from "@shared/contracts/orders";
import { app } from "@core/src/app";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Orders test server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

const fixtures: { cleanup: () => Promise<void> }[] = [];

async function call(path: string, cookie?: string, input?: unknown, method?: string) {
  return fetch(`${base}${path}`, { method: method ?? (input === undefined ? "GET" : "POST"), headers: { origin, ...(cookie ? { cookie } : {}),
    ...(input === undefined ? {} : { "content-type": "application/json" }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}

async function fixture(country: "PE" | "CL") {
  const companyId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const contactId = randomUUID();
  const email = `orders-api-${randomUUID()}@example.test`;
  const password = "test-password-123";
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "API Orders", country } });
  });
  const signup = await call("/api/auth/sign-up/email", undefined, { name: "Seller", email, password });
  expect(signup.status).toBe(200);
  const userId = (await signup.json()).user.id as string;
  await systemPrisma.user.update({ where: { id: userId }, data: { emailVerified: true, companyId } });
  const login = await call("/api/auth/sign-in/email", undefined, { email, password });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Orders test session missing");
  await withTenantIsolation(companyId, async () => {
    await prisma.product.create({ data: { id: productId, name: "Camisa", currency: "PEN", qrCode: productId,
      status: "active", createdAt: new Date(), updatedAt: new Date() } });
    await prisma.productVariant.create({ data: { id: variantId, productId, attributes: { Talla: "M" }, sku: `SKU-${variantId}`,
      salePrice: 10, qrCode: variantId, status: "active" } });
    await prisma.productStock.create({ data: { variantId, quantity: 3n } });
    await prisma.contact.create({ data: { id: contactId, name: "Ana", phone: "+51999999999" } });
  });
  const result = { companyId, userId, cookie, productId, variantId, contactId, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany();
      await prisma.orderItem.deleteMany();
      await prisma.order.deleteMany();
      await prisma.contact.deleteMany();
      await prisma.productStock.deleteMany();
      await prisma.productVariant.deleteMany();
      await prisma.product.deleteMany();
      await prisma.deliveryRate.deleteMany();
      await prisma.quotation.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany();
      await prisma.deliveryZone.deleteMany();
      await prisma.companyCourier.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await prisma.image.deleteMany();
      await systemPrisma.user.delete({ where: { id: userId } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
  fixtures.push(result);
  return result;
}

afterAll(async () => {
  for (const entry of fixtures.reverse()) await entry.cleanup();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await systemPrisma.$disconnect();
});

afterEach(() => vi.restoreAllMocks());

test("delivery HTTP resolves real configuration, preserves snapshots, replaces author and updates covered stock atomically", async () => {
  const seller = await fixture("PE");
  const second = await fixture("PE");
  const orderId = randomUUID();
  const store = { enabled: true, pickupPoint: { name: "Tienda", address: "Dirección original", instructions: null } };
  expect((await call("/api/delivery-settings", seller.cookie, { expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }, "PUT")).status).toBe(200);
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, contactId: seller.contactId,
    items: [{ variantId: seller.variantId, quantity: 2 }] })).status).toBe(201);
  const input = { delivery: { method: "store", recipient: { name: "Destinatario distinto", phone: "987", identity: { kind: "absent" } } }, expectedPrice: { amount: 0, currency: "PEN" } } as const;
  const mobile = createOrderApi(async (path, init) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin, cookie: seller.cookie } });
    const body: unknown = await response.json();
    return response.ok ? ok(body) : err({ code: "API_ERROR", message: "HTTP failure", http: { status: response.status, body } });
  });

  for (const chargeDeliveryToCustomer of [true, false]) {
    const rejected = await call(`/api/orders/${orderId}/delivery`, seller.cookie, { delivery: input.delivery, chargeDeliveryToCustomer }, "PUT");
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ code: "INVALID_INPUT" });
  }
  expect(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json()).toMatchObject({ delivery: null, total: { amount: 20 }, stockDeducted: false });
  expect((await call(`/api/orders/${orderId}/delivery`, second.cookie, input, "PUT")).status).toBe(404);
  const assigned = await mobile.setDelivery(orderId, input);
  expect(assigned.success).toBe(true);
  if (!assigned.success) throw new Error("Expected mobile assignment");
  const first = assigned.data;
  expect(first).toMatchObject({ delivery: { method: "store", pickupPoint: store.pickupPoint,
    recordedBy: { kind: "seller", userId: seller.userId } }, total: { amount: 20 }, deliveryCost: { amount: 0 }, deliveryCharge: { amount: 0 } });
  expect(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json()).toEqual(first);
  const nextStore = { ...store, pickupPoint: { ...store.pickupPoint, address: "Dirección nueva" } };
  expect((await call("/api/delivery-settings", seller.cookie, { expectedVersion: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: nextStore }, "PUT")).status).toBe(200);
  expect(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json()).toEqual(first);
  expect((await call(`/api/orders/${orderId}/payments`, seller.cookie, { paymentId: randomUUID(), amount: { amount: 20, currency: "PEN" },
    method: "digital_wallet", deductStockIfPartial: false })).status).toBe(200);
  await systemPrisma.user.update({ where: { id: second.userId }, data: { companyId: seller.companyId } });
  const replaced = await call(`/api/orders/${orderId}/delivery`, second.cookie, input, "PUT");
  expect(replaced.status).toBe(200);
  const updated = orderAggregateSchema.parse(await replaced.json());
  expect(updated).toMatchObject({ delivery: { pickupPoint: nextStore.pickupPoint, recordedBy: { kind: "seller", userId: second.userId } },
    total: { amount: 20 }, balanceDue: { amount: 0 }, paidAmount: { amount: 20 }, stockDeducted: true });
  expect(await withTenantIsolation(seller.companyId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } })).quantity)).toBe(1n);
  expect((await call(`/api/orders/${orderId}/delivery`, second.cookie, input, "PUT")).status).toBe(200);
  expect(await withTenantIsolation(seller.companyId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } })).quantity)).toBe(1n);
  expect((await call(`/api/orders/${orderId}/ship`, seller.cookie, {})).status).toBe(200);
  expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, input, "PUT")).status).toBe(409);
  const shipped = await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json();
  expect(shipped.delivery).toEqual(updated.delivery);
});

test("orders HTTP requires authentication", async () => {
  const anonymous = await call("/api/orders");
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get("cache-control")).toBe("no-store");
});

test("buyer payment cannot bypass pending checkout and resumes after confirmation without changing stock", async () => {
  const seller = await fixture("PE");
  const orderId = randomUUID();
  const imageId = randomUUID();
  const paymentId = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, contactId: null,
    items: [{ variantId: seller.variantId, quantity: 1 }] }, "POST")).status).toBe(201);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.order.update({ where: { id: orderId }, data: { checkoutEnabledAt: new Date() } });
    await prisma.image.create({ data: { id: imageId, storageKey: `test/${imageId}` } });
  });
  const path = `/api/buyer/orders/${orderId}`;
  const view = await call(`${path}/payment`);
  expect(view.status).toBe(409);
  expect(await view.json()).toMatchObject({ code: "CHECKOUT_UNAVAILABLE" });
  const report = await call(`${path}/reports`, undefined, { paymentId, receiptImageId: imageId }, "POST");
  expect(report.status).toBe(409);
  expect(await report.json()).toMatchObject({ code: "CHECKOUT_UNAVAILABLE" });
  await withTenantIsolation(seller.companyId, async () => {
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.productStock.findUnique({ where: { variantId: seller.variantId } })).toMatchObject({ quantity: 3n });
    await prisma.order.update({ where: { id: orderId }, data: { checkoutConfirmedAt: new Date(),
      buyer: { create: { name: "Ana", phone: "+51987654321" } } } });
  });
  expect((await call(`${path}/payment`)).status).toBe(200);
  expect((await call(`${path}/reports`, undefined, { paymentId, receiptImageId: imageId }, "POST")).status).toBe(201);
  await withTenantIsolation(seller.companyId, async () => {
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.productStock.findUnique({ where: { variantId: seller.variantId } })).toMatchObject({ quantity: 3n });
  });
});

test("buyer order link resolves one company and reports only its receipt", async () => {
  const seller = await fixture("PE");
  const other = await fixture("CL");
  const orderId = randomUUID();
  const paymentId = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, contactId: null,
    items: [{ variantId: seller.variantId, quantity: 1 }] }, "POST")).status).toBe(201);
  const path = `/api/buyer/orders/${orderId}`;
  const view = await call(`${path}/payment`);
  expect(view.status).toBe(200);
  expect(await view.json()).toMatchObject({ orderId, total: { amount: 10, currency: "PEN" }, balanceDue: { amount: 10 }, payments: [] });
  expect((await call("/api/buyer/orders/not-a-uuid/payment")).status).toBe(400);
  expect((await call(`/api/buyer/orders/${randomUUID()}/payment`)).status).toBe(404);
  expect((await call(`${path}/reports`, undefined, { paymentId, receiptImageId: randomUUID() }, "POST")).status).toBe(422);
  const foreignImageId = randomUUID();
  await withTenantIsolation(other.companyId, async () => {
    await prisma.image.create({ data: { id: foreignImageId, storageKey: `test/${foreignImageId}` } });
  });
  expect((await call(`${path}/reports`, undefined, { paymentId, receiptImageId: foreignImageId }, "POST")).status).toBe(422);
  const imageId = randomUUID();
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.image.create({ data: { id: imageId, storageKey: `test/${imageId}` } });
  });
  const info = vi.spyOn(log, "info");
  const debug = vi.spyOn(log, "debug");
  expect((await call(`${path}/reports`, undefined, { paymentId, receiptImageId: imageId }, "POST")).status).toBe(201);
  expect((await call(`${path}/reports`, undefined, { paymentId, receiptImageId: imageId }, "POST")).status).toBe(201);
  await withTenantIsolation(seller.companyId, async () => expect(await prisma.payment.count()).toBe(1));
  expect((await call(`${path}/reports`, undefined, { paymentId, receiptImageId: foreignImageId }, "POST")).status).toBe(409);
  const paymentEvents = info.mock.calls.map(([entry]) => entry).filter((entry) => typeof entry === "object" && entry !== null && "event" in entry && entry.event === "payment_reported");
  expect(paymentEvents).toEqual([{ event: "payment_reported", paymentId, imageId, actorKind: "buyer", outcome: "applied" }]);
  expect(debug.mock.calls.map(([entry]) => entry)).toEqual(expect.arrayContaining([
    { event: "payment_operation_replayed", operation: "report", paymentId },
    { event: "payment_operation_conflict", operation: "report", paymentId, errorCode: "PAYMENT_CONFLICT" },
  ]));
  info.mockRestore(); debug.mockRestore();
  expect((await call(`${path}/images/${imageId}`)).status).toBe(404);
  expect((await call(`/api/orders/${orderId}/aggregate`)).status).toBe(401);
});

test("orders HTTP lets a Chile company complete sales, returns historical data, and isolates other companies", async () => {
  const seller = await fixture("CL");
  const other = await fixture("PE");
  const id = randomUUID();
  const input = { id, contactId: seller.contactId, items: [{ variantId: seller.variantId, quantity: 2 }],
    payment: { method: "digital_wallet" }, delivery: { method: "handover" } };
  const created = await call("/api/orders", seller.cookie, input, "POST");
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({ id, companyId: seller.companyId, sellerId: seller.userId,
    status: "completed", paymentStatus: "paid", deliveryStatus: "delivered", stockDeducted: true,
    total: { amount: 20, currency: "PEN" }, buyer: { name: "Ana", phone: "+51999999999" },
    payments: [{ amount: { amount: 20, currency: "PEN" } }],
    items: [{ productName: "Camisa", variantAttributes: { Talla: "M" }, quantity: 2,
      unitPrice: { amount: 10, currency: "PEN" }, subtotal: { amount: 20, currency: "PEN" } }] });
  expect((await call("/api/orders", seller.cookie, input, "POST")).status).toBe(409);
  expect(await withTenantIsolation(seller.companyId, async () =>
    (await prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } })).quantity)).toBe(1n);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.contact.update({ where: { id: seller.contactId }, data: { name: "Changed" } });
    await prisma.product.update({ where: { id: seller.productId }, data: { name: "Changed" } });
  });
  const detail = await call(`/api/orders/${id}`, seller.cookie);
  expect(detail.status).toBe(200);
  expect(await detail.json()).toMatchObject({ buyer: { name: "Ana" }, items: [{ productName: "Camisa" }] });
  expect((await call(`/api/orders/${id}`, other.cookie)).status).toBe(404);
  const foreignVariant = await call("/api/orders", other.cookie, { id: randomUUID(), contactId: null,
    items: [{ variantId: seller.variantId, quantity: 1 }] }, "POST");
  expect(foreignVariant.status).toBe(404);
  expect(await foreignVariant.json()).toMatchObject({ code: "VARIANT_NOT_FOUND" });
  const foreignContact = await call("/api/orders", other.cookie, { id: randomUUID(), contactId: seller.contactId,
    items: [{ variantId: other.variantId, quantity: 1 }] }, "POST");
  expect(foreignContact.status).toBe(404);
  expect(await foreignContact.json()).toMatchObject({ code: "CONTACT_NOT_FOUND" });
  const list = await call(`/api/orders?customer=contact&contactId=${seller.contactId}`, seller.cookie);
  expect(await list.json()).toMatchObject({ total: 1, page: 1, pageSize: 20, items: [{ id, total: 20 }] });
  expect(await (await call("/api/orders", other.cookie)).json()).toMatchObject({ total: 0, items: [] });
  expect(await (await call("/api/orders/catalog?search=Camisa", other.cookie)).json()).toMatchObject([{ id: other.productId }]);
  expect(await (await call("/api/orders/contacts?search=Ana", other.cookie)).json()).toMatchObject([{ id: other.contactId }]);
});

test("orders HTTP rejects invalid input and stock without partial sale", async () => {
  const seller = await fixture("PE");
  const input = { id: randomUUID(), contactId: null, items: [{ variantId: seller.variantId, quantity: 4 }],
    payment: { method: "digital_wallet" }, delivery: { method: "handover" } };
  const stock = await call("/api/orders", seller.cookie, input, "POST");
  expect(stock.status).toBe(409);
  expect(await stock.json()).toMatchObject({ code: "INSUFFICIENT_STOCK", issues: [{ variantId: seller.variantId }] });
  const missingContact = await call("/api/orders", seller.cookie, { ...input, id: randomUUID(), contactId: randomUUID(),
    items: [{ variantId: seller.variantId, quantity: 1 }] }, "POST");
  expect(missingContact.status).toBe(404);
  expect(await missingContact.json()).toMatchObject({ code: "CONTACT_NOT_FOUND" });
  const missingVariant = await call("/api/orders", seller.cookie, { ...input, id: randomUUID(),
    items: [{ variantId: randomUUID(), quantity: 1 }] }, "POST");
  expect(missingVariant.status).toBe(404);
  expect(await missingVariant.json()).toMatchObject({ code: "VARIANT_NOT_FOUND" });
  const invalid = await call("/api/orders", seller.cookie, { ...input, total: 1 }, "POST");
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ code: "INVALID_INPUT" });
  expect((await call("/api/orders?customer=all&contactId=" + seller.contactId, seller.cookie)).status).toBe(400);
  expect(await withTenantIsolation(seller.companyId, async () => await prisma.order.count())).toBe(0);
  expect(await withTenantIsolation(seller.companyId, async () => await prisma.payment.count())).toBe(0);
  expect(await withTenantIsolation(seller.companyId, async () =>
    (await prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } })).quantity)).toBe(3n);
});

test("orders HTTP rejects payment without stock and allows retry with company isolation", async () => {
  const seller = await fixture("PE");
  const other = await fixture("CL");
  const id = randomUUID();
  const paymentId = randomUUID();
  const created = await call("/api/orders", seller.cookie,
    { id, contactId: null, items: [{ variantId: seller.variantId, quantity: 4 }] }, "POST");
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({ id, status: "active", paymentStatus: "pending", deliveryStatus: "pending",
    stockDeducted: false, completedAt: null, total: { amount: 40, currency: "PEN" }, payments: [] });
  expect((await call(`/api/orders/${id}`, seller.cookie)).status).toBe(404);
  expect((await call(`/api/orders/${id}/aggregate`, other.cookie)).status).toBe(404);
  const payment = { paymentId, amount: { amount: 40, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false };
  const recorded = await call(`/api/orders/${id}/payments`, seller.cookie, payment, "POST");
  expect(recorded.status).toBe(409);
  expect(await recorded.json()).toMatchObject({ code: "INSUFFICIENT_STOCK" });
  expect((await call(`/api/orders/${id}/ship`, seller.cookie, undefined, "POST")).status).toBe(409);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.productStock.update({ where: { variantId: seller.variantId }, data: { quantity: { increment: 1n } } });
  });
  const retried = await call(`/api/orders/${id}/payments`, seller.cookie, payment, "POST");
  expect(retried.status).toBe(200);
  expect(await retried.json()).toMatchObject({ stock: { kind: "deducted" }, order: { stockDeducted: true, payments: [{ id: paymentId }] } });
  expect((await call(`/api/orders/${id}/ship`, seller.cookie, undefined, "POST")).status).toBe(200);
  const delivered = await call(`/api/orders/${id}/deliver`, seller.cookie, undefined, "POST");
  expect(delivered.status).toBe(200);
  expect(await delivered.json()).toMatchObject({ status: "completed", paymentStatus: "paid",
    deliveryStatus: "delivered", deliveredAt: expect.any(String), completedAt: expect.any(String) });
  expect((await call(`/api/orders/${id}/aggregate`, seller.cookie)).status).toBe(200);
  expect((await call(`/api/orders/${id}/cancel`, seller.cookie, undefined, "POST")).status).toBe(409);
});

test("mixed orders list uses creation date and includes pending and completed orders", async () => {
  const seller = await fixture("PE");
  const pendingId = randomUUID();
  const completedId = randomUUID();
  expect((await call("/api/orders", seller.cookie,
    { id: pendingId, contactId: seller.contactId, items: [{ variantId: seller.variantId, quantity: 1 }] }, "POST")).status).toBe(201);
  expect((await call("/api/orders", seller.cookie,
    { id: completedId, contactId: null, items: [{ variantId: seller.variantId, quantity: 1 }],
      payment: { method: "digital_wallet" }, delivery: { method: "handover" } }, "POST")).status).toBe(201);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.order.update({ where: { id: pendingId }, data: { createdAt: new Date("2026-09-30T12:00:00Z") } });
    await prisma.order.update({ where: { id: completedId }, data: { createdAt: new Date("2026-09-29T12:00:00Z") } });
  });
  const list = await call("/api/orders/mixed", seller.cookie);
  expect(list.status).toBe(200);
  expect(await list.json()).toMatchObject({ total: 2, page: 1, items: [
    { id: pendingId, status: "active", paymentStatus: "pending", createdAt: "2026-09-30T12:00:00.000Z" },
    { id: completedId, status: "completed", paymentStatus: "paid", createdAt: "2026-09-29T12:00:00.000Z" },
  ] });
  expect(await (await call(`/api/orders/mixed?customer=contact&contactId=${seller.contactId}`, seller.cookie)).json())
    .toMatchObject({ total: 1, items: [{ id: pendingId }] });
  expect(await (await call("/api/orders/mixed?createdFrom=2026-09-30T00%3A00%3A00.000Z", seller.cookie)).json())
    .toMatchObject({ total: 1, items: [{ id: pendingId }] });
  expect(await (await call("/api/orders", seller.cookie)).json()).toMatchObject({ total: 1, items: [{ id: completedId }] });
});

test("orders HTTP combines contact and Lima-day UTC bounds with stable pages and capped search", async () => {
  const seller = await fixture("PE");
  const ids = Array.from({ length: 21 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.order.createMany({ data: ids.map((id, index) => ({ number: BigInt(1001 + index), id, sellerId: seller.userId, currency: "PEN", total: 10, itemsTotal: 10,
      deliveryStatus: "delivered", stockDeducted: true,
      completedAt: new Date("2026-09-28T12:00:00.000Z"), createdAt: new Date("2026-09-28T12:00:00.000Z") })) });
    await prisma.orderBuyer.createMany({ data: ids.map((orderId) => ({ orderId, contactId: seller.contactId, name: "Ana", phone: "+51999999999" })) });
    await prisma.contact.createMany({ data: Array.from({ length: 21 }, (_, index) => ({ id: randomUUID(),
      name: "Search contact", phone: `+51988${String(index).padStart(6, "0")}` })) });
  });
  const filters = new URLSearchParams({ customer: "contact", contactId: seller.contactId,
    completedFrom: "2026-09-28T05:00:00.000Z", completedBefore: "2026-09-29T05:00:00.000Z" });
  const first = await (await call(`/api/orders?${filters}`, seller.cookie)).json();
  expect(first).toMatchObject({ total: 21, page: 1, pageSize: 20 });
  expect(first.items.map((item: { id: string }) => item.id)).toEqual(ids.slice(0, 20));
  filters.set("page", "2");
  const second = await (await call(`/api/orders?${filters}`, seller.cookie)).json();
  expect(second).toMatchObject({ total: 21, page: 2, items: [{ id: ids[20] }] });
  filters.set("completedFrom", "2026-09-29T05:00:00.000Z");
  filters.set("completedBefore", "2026-09-30T05:00:00.000Z");
  expect(await (await call(`/api/orders?${filters}`, seller.cookie)).json()).toMatchObject({ total: 0, items: [] });
  filters.set("completedBefore", "2026-09-28T05:00:00.000Z");
  expect((await call(`/api/orders?${filters}`, seller.cookie)).status).toBe(400);
  const contacts = await (await call("/api/orders/contacts?search=Search", seller.cookie)).json();
  expect(contacts).toHaveLength(20);
});

test("home HTTP uses persisted enablement, requires district and replaces store without retaining its destination", async () => {
  const seller = await fixture("PE");
  const orderId = randomUUID();
  const store = { enabled: true, pickupPoint: { name: "Store", address: "Historic pickup", instructions: null } };
  const settings = { expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: true }, store };
  expect((await call("/api/delivery-settings", seller.cookie, settings, "PUT")).status).toBe(200);
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, contactId: null, items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
  const recipient = { name: "Different recipient", phone: "00123", identity: { kind: "absent" } } as const;
  const home = { delivery: { method: "home" as const, recipient, rateId: randomUUID(), destination: { address: " Street 123 ", districtCode: "040110", instructions: null } }, expectedPrice: { amount: 6, currency: "PEN" as const } };
  expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, home, "PUT")).status).toBe(422);
  expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, { ...home, delivery: { ...home.delivery, destination: { address: "Street" } } }, "PUT")).status).toBe(400);
  const before = await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json();
  expect(before).toMatchObject({ delivery: null, total: { amount: 10 } });
  expect((await call("/api/delivery-settings/zones", seller.cookie, { method: "home", expectedVersion: 1,
    zones: [{ kind: "new", name: "Home", enabled: true, districtCodes: ["040110"], price: home.expectedPrice }] }, "PUT")).status).toBe(200);
  const quotation = await (await call("/api/quotations", seller.cookie, { destination: { country: "PE", districtCode: "040110" } })).json();
  home.delivery.rateId = quotation.rates[0].id;
  expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, { delivery: { method: "store", recipient }, expectedPrice: { amount: 0, currency: "PEN" } }, "PUT")).status).toBe(200);
  const mobile = createOrderApi(async (path, init) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin, cookie: seller.cookie } });
    const body: unknown = await response.json();
    return response.ok ? ok(body) : err({ code: "API_ERROR", message: "HTTP failure", http: { status: response.status, body } });
  });
  const saved = await mobile.setDelivery(orderId, home);
  expect(saved.success).toBe(true);
  if (!saved.success) throw new Error("Expected home assignment through mobile adapter");
  const assigned = saved.data;
  expect(assigned).toMatchObject({ delivery: { method: "home", recipient, destination: { address: "Street 123", district: "MIRAFLORES", districtCode: "040110", instructions: null },
    recordedBy: { kind: "seller", userId: seller.userId } }, deliveryCost: { amount: 6 }, deliveryCharge: { amount: 6 }, total: { amount: 16 } });
  expect(assigned.delivery).not.toHaveProperty("pickupPoint");
  expect(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json()).toEqual(assigned);
  expect((await call("/api/delivery-settings", seller.cookie, { ...settings, expectedVersion: 2, agency: { enabled: false }, couriers: [], home: { enabled: false } }, "PUT")).status).toBe(200);
  const blocked = await call(`/api/orders/${orderId}/delivery`, seller.cookie, home, "PUT");
  expect(blocked.status).toBe(422); expect(await blocked.json()).toMatchObject({ code: "RATE_UNAVAILABLE" });
  expect(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json()).toEqual(assigned);
  expect(await (await call("/api/delivery-settings", seller.cookie)).json()).toEqual({ version: 3, agency: { enabled: false }, couriers: [], home: { enabled: false }, store });
});


test("rated agency adapters preserve snapshots and reject unavailable or foreign rates", async () => {
  const summary = vi.spyOn(log, "info").mockImplementation(() => {});
  const rejection = vi.spyOn(log, "debug").mockImplementation(() => {});
  const seller = await fixture("PE");
  const other = await fixture("PE");
  const orderId = randomUUID();
  const transport: Parameters<typeof createOrderApi>[0] = async (path, init) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin, cookie: seller.cookie } });
    const body: unknown = await response.json();
    return response.ok ? ok(body) : err({ code: "API_ERROR", message: "HTTP failure", http: { status: response.status, body } });
  };
  const settingsApi = createDeliverySettingsApi(transport);
  const mobile = createOrderApi(transport);
  const settingsInput = { expectedVersion: 0, home: { enabled: true }, store: { enabled: false as const, pickupPoint: null }, agency: { enabled: true }, couriers: [{ kind: "new" as const, name: "Courier", enabled: true }] };
  const configured = await settingsApi.save(settingsInput);
  if (!configured.success) throw new Error("Expected agency configuration");
  const courier = configured.data.couriers[0];
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, contactId: null, items: [{ variantId: seller.variantId, quantity: 2 }] })).status).toBe(201);
  expect((await call("/api/delivery-settings/zones", seller.cookie, { method: "agency", expectedVersion: 1,
    zones: [{ kind: "new", name: "Agency", enabled: true, districtCodes: ["040110"], price: { amount: 3, currency: "PEN" } }] }, "PUT")).status).toBe(200);
  const quotation = await (await call("/api/quotations", seller.cookie, { destination: { country: "PE", districtCode: "040110" } })).json();
  const delivery = { method: "agency" as const, rateId: quotation.rates[0].id as string, districtCode: "040110", recipient: { name: "Different recipient", phone: "00123", identity: { kind: "document" as const, documentType: "passport" as const, document: "00-A-001" } } };
  const input = { delivery, expectedPrice: { amount: 3, currency: "PEN" as const } };
  expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, { ...input, delivery: { ...delivery, recipient: { ...delivery.recipient, identity: { kind: "absent" } } } }, "PUT")).status).toBe(400);
  for (const extra of [{ courierId: courier.id }, { agency: "Office Lima" }, { recordedBy: { kind: "buyer" } }]) {
    expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, { ...input, delivery: { ...delivery, ...extra } }, "PUT")).status).toBe(400);
  }
  const saved = await mobile.setDelivery(orderId, input);
  expect(saved).toMatchObject({ success: true, data: { delivery: { method: "agency", courier: null, agency: null, recipient: delivery.recipient, recordedBy: { kind: "seller", userId: seller.userId } }, total: { amount: 23 }, deliveryCost: { amount: 3 }, deliveryCharge: { amount: 3 }, stockDeducted: false } });
  if (!saved.success) throw new Error("Expected rated agency assignment");
  expect(summary).toHaveBeenCalledWith(expect.objectContaining({ event: "order_delivery_saved", deliveryMethod: "agency", transactionOutcome: "committed" }), "Order delivery saved");
  const nextSettings = { ...settingsInput, expectedVersion: 2, agency: { enabled: false }, couriers: [{ ...courier, kind: "existing" as const, name: "Renamed", enabled: false }] };
  expect(await settingsApi.save(nextSettings)).toMatchObject({ success: true, data: { version: 3 } });
  expect(await mobile.getAggregate(orderId)).toEqual(saved);
  expect(await mobile.setDelivery(orderId, input)).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
  for (const privateText of ["Different recipient", "00-A-001"]) expect(JSON.stringify([...summary.mock.calls, ...rejection.mock.calls])).not.toContain(privateText);
  expect((await call("/api/delivery-settings", other.cookie, settingsInput, "PUT")).status).toBe(200);
  expect((await call("/api/delivery-settings/zones", other.cookie, { method: "agency", expectedVersion: 1,
    zones: [{ kind: "new", name: "Foreign", enabled: true, districtCodes: ["040110"], price: input.expectedPrice }] }, "PUT")).status).toBe(200);
  const foreign = await (await call("/api/quotations", other.cookie, { destination: { country: "PE", districtCode: "040110" } })).json();
  expect(await mobile.setDelivery(orderId, { ...input, delivery: { ...delivery, rateId: foreign.rates[0].id } })).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
  expect(await mobile.getAggregate(orderId)).toEqual(saved);
  expect(await settingsApi.save({ ...settingsInput, expectedVersion: 3, couriers: [{ ...courier, kind: "existing", name: "Renamed", enabled: true }] })).toMatchObject({ success: true });
  expect((await call(`/api/orders/${orderId}/payments`, seller.cookie, { paymentId: randomUUID(), amount: { amount: 23, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false })).status).toBe(200);
  expect(await mobile.setDelivery(orderId, input)).toMatchObject({ success: true, data: { total: { amount: 23 }, paidAmount: { amount: 23 }, stockDeducted: true } });
  expect(await withTenantIsolation(seller.companyId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } })).quantity)).toBe(1n);
  expect((await call(`/api/orders/${orderId}/ship`, seller.cookie, {})).status).toBe(200);
  expect(await mobile.setDelivery(orderId, input)).toMatchObject({ success: false, error: { code: "DELIVERY_LOCKED" } });
});

test("checkout-link HTTP requires the seller company and returns a stable UUID URL", async () => {
  const owner = await fixture("PE");
  const other = await fixture("PE");
  const id = randomUUID();
  expect((await call("/api/orders", owner.cookie, { id, contactId: owner.contactId, items: [{ variantId: owner.variantId, quantity: 1 }] })).status).toBe(201);
  const path = `/api/orders/${id}/checkout-link`;
  expect((await call(path, "", {})).status).toBe(401);
  expect((await call(path, other.cookie, {})).status).toBe(404);
  expect((await call(path, owner.cookie, { companyId: other.companyId })).status).toBe(422);
  const first = await call(path, owner.cookie, {});
  expect(first.status).toBe(200);
  expect(first.headers.get("cache-control")).toBe("no-store");
  const link = await first.json();
  expect(link).toEqual({ url: `${process.env.BETTER_AUTH_URL}/checkout/${owner.companyId}/${id}` });
  expect(await (await call(path, owner.cookie, {})).json()).toEqual(link);
  await withTenantIsolation(owner.companyId, async () => await prisma.order.update({ where: { id }, data: { cancelled: true } }));
  expect((await call(path, owner.cookie, {})).status).toBe(409);
});

test("complete creation HTTP preserves optional payment IDs and supports pending and paid orders", async () => {
  const f = await fixture("PE");
  for (const amount of [null, 5, 10]) {
    const id = randomUUID();
    const paymentId = randomUUID();
    const input = { id, contactId: f.contactId, items: [{ variantId: f.variantId, quantity: 1 }],
      payments: amount === null ? [] : [{ paymentId, amount: { amount, currency: "PEN" }, method: "bank_transfer", deductStockIfPartial: false }],
      deliverImmediately: false };
    const response = await call("/api/orders", f.cookie, input);
    expect(response.status).toBe(201);
    const order = orderAggregateSchema.parse(await response.json());
    expect(order).toMatchObject({ id, status: "active", deliveryStatus: "pending", completedAt: null,
      paymentStatus: amount === 10 ? "paid" : "pending", stockDeducted: amount === 10,
      balanceDue: { amount: 10 - (amount ?? 0), currency: "PEN" } });
    expect(order.payments).toHaveLength(amount === null ? 0 : 1);
    if (amount !== null) expect(order.payments[0].id).toBe(paymentId);
    const duplicate = await call("/api/orders", f.cookie, input);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: "ORDER_ALREADY_EXISTS" });
    expect(orderAggregateSchema.parse(await (await call(`/api/orders/${id}/aggregate`, f.cookie)).json())).toEqual(order);
  }
});


test.each([false, true])("mobile restart recovers a committed order after losing its response (paid=%s)", async (paid) => {
  const f = await fixture("PE");
  const values = new Map<string, string>();
  const storage = { getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { values.set(key, value); }, deleteItemAsync: async (key: string) => { values.delete(key); } };
  let lost = true;
  let sends = 0;
  const api = createOrderApi(async (path, init) => {
    if (lost && init?.method !== "POST") return err({ code: "NETWORK_ERROR", message: "Offline during recovery" });
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin, cookie: f.cookie } });
    const body: unknown = await response.json();
    if (init?.method === "POST") { sends++; expect(response.status).toBe(201); return err({ code: "NETWORK_ERROR", message: "Response lost after commit" }); }
    return response.ok ? ok(body) : err({ code: "API_ERROR", message: "HTTP failure", http: { status: response.status, body } });
  });
  const selected = addDraftItem(emptyOrderDraft(), { variantId: f.variantId, productName: "Camisa", variantAttributes: {}, sku: null,
    shownUnitPrice: { amount: 10, currency: "PEN" }, shownStock: 3, quantity: 1 }, randomUUID);
  if (!selected.success) throw new Error("Invalid mobile fixture");
  const paymentId = randomUUID();
  const draft = { ...selected.data, payments: paid ? [{ paymentId, amount: "10", method: "bank_transfer" as const, deductStockIfPartial: false }] : [], deliverImmediately: false };
  const first = createOrderOperations(api, createPendingOrderConfirmationStore(storage));
  expect(await first.completeOrder(draft, f.companyId)).toMatchObject({ success: true, data: { kind: "uncertain" } });
  lost = false;
  const restarted = createOrderOperations(api, createPendingOrderConfirmationStore(storage));
  expect(await restarted.readPendingOrderConfirmation(randomUUID())).toEqual(ok(null));
  const recovered = await restarted.resendPendingOrder(f.companyId);
  expect(recovered).toMatchObject({ success: true, data: { kind: "completed", order: { status: "active", deliveryStatus: "pending",
    paymentStatus: paid ? "paid" : "pending", stockDeducted: paid } } });
  expect(sends).toBe(1);
  await withTenantIsolation(f.companyId, async () => {
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.payment.count()).toBe(paid ? 1 : 0);
    if (paid) expect(await prisma.payment.findFirst()).toMatchObject({ id: paymentId });
    expect(await prisma.productStock.findUnique({ where: { variantId: f.variantId } })).toMatchObject({ quantity: paid ? 2n : 3n });
  });
});


test("quotation HTTP uses the checkout order tenant even with a foreign seller session and never mutates orders or stock", async () => {
  const seller = await fixture("PE");
  const foreign = await fixture("PE");
  const orderId = randomUUID();
  const destination = { country: "PE", districtCode: "150122", address: null, instructions: null };
  const input = { orderId, destination };
  const before = await call("/api/quotations", foreign.cookie, input);
  expect(before.status).toBe(404);
  expect(await before.json()).toMatchObject({ code: "CHECKOUT_UNAVAILABLE" });
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, contactId: null,
    items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
  expect((await call("/api/quotations", foreign.cookie, input)).status).toBe(404);
  expect((await call(`/api/orders/${orderId}/checkout-link`, seller.cookie, {})).status).toBe(200);
  expect((await call("/api/delivery-settings/zones", seller.cookie, { method: "home", expectedVersion: 0,
    zones: [0, 8, 8].map(amount => ({ kind: "new", name: "Private zone", enabled: true, districtCodes: ["150122"], price: { amount, currency: "PEN" } })) }, "PUT")).status).toBe(200);
  expect((await call("/api/delivery-settings", seller.cookie, { expectedVersion: 1, home: { enabled: true }, agency: { enabled: true },
    couriers: [{ kind: "new", name: "Courier", enabled: true }], store: { enabled: false, pickupPoint: null } }, "PUT")).status).toBe(200);
  expect((await call("/api/delivery-settings/zones", seller.cookie, { method: "agency", expectedVersion: 2,
    zones: [{ kind: "new", name: "Agency zone", enabled: true, districtCodes: ["150122"], price: { amount: 5, currency: "PEN" } }] }, "PUT")).status).toBe(200);
  const orderBefore = await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json();
  const browserFetch: typeof fetch = (url, init) => fetch(new URL(String(url), base), {
    ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin },
  });
  const a = await requestDeliveryQuotation({ orderId, districtCode: destination.districtCode }, undefined, browserFetch);
  const b = await call("/api/quotations", foreign.cookie, input);
  expect(a.success).toBe(true);
  expect(b.status).toBe(201);
  expect(b.headers.get("cache-control")).toBe("no-store");
  if (!a.success) throw new Error("Browser quotation failed");
  const first = a.data;
  const second = quotationResponseSchema.parse(await b.json());
  expect(first.id).not.toBe(second.id);
  expect(first.rates.map(rate => [rate.method, rate.price.amount])).toEqual([["home", 0], ["home", 8], ["home", 8], ["agency", 5]]);
  expect(second.rates.map(rate => [rate.method, rate.price.amount])).toEqual(first.rates.map(rate => [rate.method, rate.price.amount]));
  expect(new Set([...first.rates, ...second.rates].map(rate => rate.id)).size).toBe(8);
  await withTenantIsolation(seller.companyId, async () => {
    expect(await prisma.quotation.count()).toBe(2);
    expect(await prisma.deliveryRate.count()).toBe(8);
    expect(await prisma.productStock.findUnique({ where: { variantId: seller.variantId } })).toMatchObject({ quantity: 3n });
    expect(await prisma.companyDeliverySettings.findUnique({ where: { companyId: seller.companyId } })).toMatchObject({ version: 3 });
  });
  await withTenantIsolation(foreign.companyId, async () => {
    expect(await prisma.quotation.count()).toBe(0);
    expect(await prisma.deliveryRate.count()).toBe(0);
  });
  expect(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json()).toEqual(orderBefore);
  await withTenantIsolation(seller.companyId, async () => await prisma.order.update({ where: { id: orderId }, data: { cancelled: true } }));
  const cancelled = await call("/api/quotations", foreign.cookie, input);
  expect(cancelled.status).toBe(422);
  expect(await cancelled.json()).toMatchObject({ code: "ORDER_CANCELLED" });
  expect(await requestDeliveryQuotation({ orderId, districtCode: destination.districtCode }, undefined, browserFetch))
    .toMatchObject({ success: false, error: { code: "ORDER_CANCELLED" } });
  await withTenantIsolation(seller.companyId, async () => expect(await prisma.quotation.count()).toBe(2));
});


test("aggregate reads preserve rated and historical delivery snapshots without consulting current configuration", async () => {
  const seller = await fixture("PE");
  const orderId = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, contactId: null,
    items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
  const recipient = { name: "Ana", phone: "999", identity: { kind: "document", documentType: "national_id", document: "12345678" } };
  const pricing = { quotationId: randomUUID(), rateId: randomUUID(), zoneId: randomUUID(), settingsVersion: 3 };
  const district = { country: "PE", districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima" };
  const recordedBy = { kind: "buyer" };
  const home = { method: "home", recipient, destination: { ...district, address: "Street", instructions: null }, pricing, recordedBy };
  const agency = { method: "agency", recipient, destination: district, pricing, courier: null, agency: null, recordedBy };
  const historicalHome = { method: "home", recipient, destination: { address: "Old street", district: "Historical free text", instructions: null }, recordedBy };
  const historicalAgency = { method: "agency", recipient, courier: { id: randomUUID(), name: "Old courier" }, agency: "Old office", recordedBy };
  for (const delivery of [home, agency, historicalHome, historicalAgency]) {
    const charge = "pricing" in delivery ? 8 : 0;
    await withTenantIsolation(seller.companyId, async () => await prisma.order.update({ where: { id: orderId }, data: {
      delivery, deliveryCost: 8, deliveryCharge: charge, total: 10 + charge,
    } }));
    const response = await call(`/api/orders/${orderId}/aggregate`, seller.cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ delivery, deliveryCost: { amount: 8, currency: "PEN" }, deliveryCharge: { amount: charge }, total: { amount: 10 + charge } });
  }
  await withTenantIsolation(seller.companyId, async () => expect(await prisma.companyDeliverySettings.count()).toBe(0));
});

test("rated delivery HTTP assigns the selected option, reports price conflicts and isolates rate ownership", async () => {
  const seller = await fixture("PE");
  const foreign = await fixture("PE");
  const recipient = { name: "Ana", phone: "999", identity: { kind: "document", documentType: "national_id", document: "12345678" } };
  const destination = { country: "PE", districtCode: "150122", address: null, instructions: null };
  async function configure(owner: typeof seller, amounts: number[]) {
    expect((await call("/api/delivery-settings/zones", owner.cookie, { method: "home", expectedVersion: 0,
      zones: amounts.map(amount => ({ kind: "new", name: "Zone", enabled: true, districtCodes: ["150122"], price: { amount, currency: "PEN" } })) }, "PUT")).status).toBe(200);
    expect((await call("/api/delivery-settings", owner.cookie, { expectedVersion: 1, home: { enabled: true }, agency: { enabled: true },
      couriers: [{ kind: "new", name: "Courier", enabled: true }], store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } }, "PUT")).status).toBe(200);
  }
  await configure(seller, [0, 8]);
  await configure(foreign, [10]);
  expect((await call("/api/delivery-settings/zones", seller.cookie, { method: "agency", expectedVersion: 2,
    zones: [{ kind: "new", name: "Agency", enabled: true, districtCodes: ["150122"], price: { amount: 5, currency: "PEN" } }] }, "PUT")).status).toBe(200);
  const quoteResponse = await call("/api/quotations", seller.cookie, { destination });
  expect(quoteResponse.status).toBe(201);
  const quote = quotationResponseSchema.parse(await quoteResponse.json());
  const foreignQuote = quotationResponseSchema.parse(await (await call("/api/quotations", foreign.cookie, { destination })).json());
  const home = quote.rates.find(rate => rate.method === "home" && rate.price.amount === 8)!;
  const free = quote.rates.find(rate => rate.method === "home" && rate.price.amount === 0)!;
  const agency = quote.rates.find(rate => rate.method === "agency")!;
  const orderId = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, contactId: null, items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
  const path = `/api/orders/${orderId}/delivery`;
  const input = { delivery: { method: "home", rateId: home.id, recipient, destination: { districtCode: "150122", address: "Final street", instructions: null } }, expectedPrice: home.price };
  const saved = await call(path, seller.cookie, input, "PUT");
  expect(saved.status).toBe(200);
  const before = orderAggregateSchema.parse(await saved.json());
  expect(before).toMatchObject({ deliveryCost: home.price, deliveryCharge: home.price, total: { amount: 18 },
    delivery: { destination: { district: "MIRAFLORES", province: "LIMA METROPOLITANA", address: "Final street" },
      pricing: { rateId: home.id, quotationId: quote.id, settingsVersion: 3 }, recordedBy: { kind: "seller", userId: seller.userId } } });
  const otherRate = await call(path, seller.cookie, { ...input, delivery: { ...input.delivery, rateId: foreignQuote.rates[0].id } }, "PUT");
  expect(otherRate.status).toBe(422);
  expect(await otherRate.json()).toMatchObject({ code: "RATE_UNAVAILABLE" });
  expect((await call(path, foreign.cookie, input, "PUT")).status).toBe(404);
  for (const body of [{ ...input, chargeDeliveryToCustomer: false }, { ...input, price: home.price },
    { ...input, delivery: { ...input.delivery, quotationId: quote.id } }, { ...input, delivery: { ...input.delivery, rateId: undefined } }]) {
    expect((await call(path, seller.cookie, body, "PUT")).status).toBe(400);
  }
  const invalidDistrict = await call(path, seller.cookie, { ...input, delivery: { ...input.delivery, destination: { ...input.delivery.destination, districtCode: "999999" } } }, "PUT");
  expect(invalidDistrict.status).toBe(422);
  expect(await invalidDistrict.json()).toMatchObject({ code: "INVALID_DISTRICT" });
  const reviewedPrice = await call(path, seller.cookie, { ...input, expectedPrice: { amount: 7, currency: "PEN" } }, "PUT");
  expect(reviewedPrice.status).toBe(409);
  expect(await reviewedPrice.json()).toEqual({ code: "TOTAL_CHANGED", error: "Review delivery price", currentPrice: home.price });
  expect(orderAggregateSchema.parse(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json())).toEqual(before);
  const store = await call(path, seller.cookie, { delivery: { method: "store", recipient }, expectedPrice: { amount: 0, currency: "PEN" } }, "PUT");
  expect(store.status).toBe(200);
  expect(await store.json()).toMatchObject({ total: { amount: 10 }, deliveryCost: { amount: 0 }, deliveryCharge: { amount: 0 },
    delivery: { method: "store", settingsVersion: 3, pickupPoint: { name: "Shop" } } });
  const agencySaved = await call(path, seller.cookie, { delivery: { method: "agency", recipient, rateId: agency.id, districtCode: "150122" }, expectedPrice: agency.price }, "PUT");
  expect(agencySaved.status).toBe(200);
  expect(await agencySaved.json()).toMatchObject({ total: { amount: 15 }, delivery: { method: "agency", courier: null, agency: null, pricing: { rateId: agency.id } } });
  const paidId = randomUUID();
  const paymentId = randomUUID();
  const paidInput = { id: paidId, contactId: null, items: [{ variantId: seller.variantId, quantity: 1 }], delivery: input,
    payments: [{ paymentId, amount: { amount: 18, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }] };
  for (const chargeDeliveryToCustomer of [true, false]) {
    const rejected = await call("/api/orders", seller.cookie, { ...paidInput, delivery: { delivery: { method: "store", recipient }, chargeDeliveryToCustomer } });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ code: "INVALID_INPUT" });
  }
  const staleCreation = await call("/api/orders", seller.cookie, { ...paidInput, delivery: { ...input, expectedPrice: { amount: 7, currency: "PEN" } } });
  expect(staleCreation.status).toBe(409);
  expect(await staleCreation.json()).toMatchObject({ code: "TOTAL_CHANGED", currentPrice: home.price });
  await withTenantIsolation(seller.companyId, async () => {
    expect(await prisma.order.findUnique({ where: { id: paidId } })).toBeNull();
    expect(await prisma.payment.count({ where: { orderId: paidId } })).toBe(0);
    expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } })).quantity).toBe(3n);
  });
  const paidCreation = await call("/api/orders", seller.cookie, paidInput);
  expect(paidCreation.status).toBe(201);
  expect(await paidCreation.json()).toMatchObject({ id: paidId, total: { amount: 18 }, deliveryCharge: home.price, paidAmount: { amount: 18 }, stockDeducted: true,
    delivery: { pricing: { rateId: home.id } }, payments: [expect.objectContaining({ id: paymentId })] });
  const initialId = randomUUID();
  const created = await call("/api/orders", seller.cookie, { id: initialId, contactId: null, items: [{ variantId: seller.variantId, quantity: 1 }],
    delivery: { ...input, delivery: { ...input.delivery, rateId: free.id }, expectedPrice: free.price },
    payments: [{ paymentId: randomUUID(), amount: { amount: 10, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }] });
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({ stockDeducted: true, total: { amount: 10 }, delivery: { pricing: { rateId: free.id } } });
  await withTenantIsolation(seller.companyId, async () => expect((await prisma.productStock.findUnique({ where: { variantId: seller.variantId } }))?.quantity).toBe(1n));
});


test("public checkout delivery action persists buyer pickup and redirects to existing payment", async () => {
  const seller = await fixture("PE");
  const orderId = randomUUID();
  expect((await call("/api/delivery-settings", seller.cookie, { expectedVersion: 0, agency: { enabled: false }, home: { enabled: false }, couriers: [],
    store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } }, "PUT")).status).toBe(200);
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, contactId: null, items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.order.update({ where: { id: orderId }, data: { checkoutEnabledAt: new Date() } });
  });
  const loaded = await checkoutLoader({ params: { companyId: seller.companyId, orderId } } as unknown as LoaderFunctionArgs);
  expect(loaded.data.deliveryOptions).toEqual({ home: { enabled: false }, agency: { enabled: false },
    store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } });
  const input = { buyer: { name: "Ana", phone: "+51987654321" }, expectedTotal: { amount: 10, currency: "PEN" }, delivery: { kind: "replace",
    selection: { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } }, expectedPrice: { amount: 0, currency: "PEN" } } };
  const result = await confirmCheckoutAction({ params: { companyId: seller.companyId, orderId }, request: new Request(`${base}/checkout/${seller.companyId}/${orderId}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  }) } as unknown as ActionFunctionArgs);
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).headers.get("Location")).toBe(`/pago/${orderId}`);
  expect((await call(`/api/buyer/orders/${orderId}/payment`)).status).toBe(200);
  await withTenantIsolation(seller.companyId, async () => {
    expect(await prisma.order.findUnique({ where: { id: orderId } })).toMatchObject({ stockDeducted: false,
      delivery: { method: "store", recordedBy: { kind: "buyer" }, settingsVersion: 1 } });
    expect(await prisma.orderBuyer.findUnique({ where: { orderId } })).toMatchObject({ name: "Ana", phone: "+51987654321" });
    expect(await prisma.payment.count()).toBe(0);
    expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } })).quantity).toBe(3n);
  });
});
