import { log } from "@core/src/shared/infrastructure/logger";
import { createDeliverySettingsApi } from "@mobile/features/delivery-settings/infrastructure/delivery-settings-api";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { createOrderApi } from "@mobile/features/orders/infrastructure/order-api";
import { orders, setConfiguredOrderDelivery } from "@core/src/features/orders/composition";
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
      await prisma.companyCourier.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
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
  const input = { delivery: { method: "store", recipient: { name: "Destinatario distinto", phone: "987", identity: { kind: "absent" } } }, chargeDeliveryToCustomer: true } as const;
  const mobile = createOrderApi(async (path, init) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin, cookie: seller.cookie } });
    const body: unknown = await response.json();
    return response.ok ? ok(body) : err({ code: "API_ERROR", message: "HTTP failure", http: { status: response.status, body } });
  });

  const unresolved = await call(`/api/orders/${orderId}/delivery`, seller.cookie, input, "PUT");
  expect(unresolved.status).toBe(422);
  expect(await unresolved.json()).toMatchObject({ code: "DELIVERY_UNAVAILABLE" });
  expect(await mobile.setDelivery(orderId, input)).toMatchObject({ success: false, error: { code: "DELIVERY_UNAVAILABLE" } });
  expect(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json()).toMatchObject({ delivery: null, total: { amount: 20 }, stockDeducted: false });
  expect((await call(`/api/orders/${orderId}/delivery`, second.cookie, input, "PUT")).status).toBe(404);
  vi.spyOn(orders, "setDelivery").mockImplementation((value, context) => setConfiguredOrderDelivery(value, context,
    async (_snapshot, _authorized, currency) => ({ success: true, data: { amount: 3, currency } })));
  const assigned = await mobile.setDelivery(orderId, input);
  expect(assigned.success).toBe(true);
  if (!assigned.success) throw new Error("Expected mobile assignment");
  const first = assigned.data;
  expect(first).toMatchObject({ delivery: { method: "store", pickupPoint: store.pickupPoint,
    recordedBy: { kind: "seller", userId: seller.userId } }, total: { amount: 23 }, deliveryCost: { amount: 3 }, deliveryCharge: { amount: 3 } });
  expect(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json()).toEqual(first);
  const nextStore = { ...store, pickupPoint: { ...store.pickupPoint, address: "Dirección nueva" } };
  expect((await call("/api/delivery-settings", seller.cookie, { expectedVersion: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: nextStore }, "PUT")).status).toBe(200);
  expect(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json()).toEqual(first);
  expect((await call(`/api/orders/${orderId}/payments`, seller.cookie, { paymentId: randomUUID(), amount: { amount: 20, currency: "PEN" },
    method: "digital_wallet", deductStockIfPartial: false })).status).toBe(200);
  await systemPrisma.user.update({ where: { id: second.userId }, data: { companyId: seller.companyId } });
  const replaced = await call(`/api/orders/${orderId}/delivery`, second.cookie, { ...input, chargeDeliveryToCustomer: false }, "PUT");
  expect(replaced.status).toBe(200);
  const updated = orderAggregateSchema.parse(await replaced.json());
  expect(updated).toMatchObject({ delivery: { pickupPoint: nextStore.pickupPoint, recordedBy: { kind: "seller", userId: second.userId } },
    total: { amount: 20 }, balanceDue: { amount: 0 }, paidAmount: { amount: 20 }, stockDeducted: true });
  expect(await withTenantIsolation(seller.companyId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } })).quantity)).toBe(1n);
  expect((await call(`/api/orders/${orderId}/delivery`, second.cookie, { ...input, chargeDeliveryToCustomer: false }, "PUT")).status).toBe(200);
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
    total: { amount: 20, currency: "PEN" }, customer: { kind: "contact", name: "Ana", phone: "+51999999999" },
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
  expect(await detail.json()).toMatchObject({ customer: { name: "Ana" }, items: [{ productName: "Camisa" }] });
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

test("orders HTTP exposes pending payment, stock retry and completion with company isolation", async () => {
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
  expect(recorded.status).toBe(200);
  expect(await recorded.json()).toMatchObject({ stock: { kind: "pending", reason: "INSUFFICIENT_STOCK" },
    order: { paymentStatus: "paid", payments: [{ id: paymentId }] } });
  expect((await call(`/api/orders/${id}/ship`, seller.cookie, undefined, "POST")).status).toBe(409);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.productStock.update({ where: { variantId: seller.variantId }, data: { quantity: { increment: 1n } } });
  });
  const deducted = await call(`/api/orders/${id}/deduct-stock`, seller.cookie, undefined, "POST");
  expect(deducted.status).toBe(200);
  expect(await deducted.json()).toMatchObject({ stockDeducted: true, payments: [{ id: paymentId }] });
  expect((await call(`/api/orders/${id}/ship`, seller.cookie, undefined, "POST")).status).toBe(200);
  const delivered = await call(`/api/orders/${id}/deliver`, seller.cookie, undefined, "POST");
  expect(delivered.status).toBe(200);
  expect(await delivered.json()).toMatchObject({ status: "completed", paymentStatus: "paid",
    deliveryStatus: "delivered", completedAt: expect.any(String) });
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
    await prisma.order.createMany({ data: ids.map((id) => ({ id, sellerId: seller.userId, contactId: seller.contactId,
      contactName: "Ana", contactPhone: "+51999999999", currency: "PEN", total: 10, itemsTotal: 10,
      deliveryStatus: "delivered", stockDeducted: true,
      completedAt: new Date("2026-09-28T12:00:00.000Z"), createdAt: new Date("2026-09-28T12:00:00.000Z") })) });
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
  const home = { delivery: { method: "home", recipient, destination: { address: " Street 123 ", district: " District ", instructions: null } }, chargeDeliveryToCustomer: true } as const;
  expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, home, "PUT")).status).toBe(422);
  expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, { ...home, delivery: { ...home.delivery, destination: { address: "Street" } } }, "PUT")).status).toBe(400);
  const before = await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json();
  expect(before).toMatchObject({ delivery: null, total: { amount: 10 } });
  vi.spyOn(orders, "setDelivery").mockImplementation((input, context) => setConfiguredOrderDelivery(input, context,
    async (_snapshot, _authorized, currency) => ok({ amount: 6, currency })));
  expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, { delivery: { method: "store", recipient }, chargeDeliveryToCustomer: false }, "PUT")).status).toBe(200);
  const mobile = createOrderApi(async (path, init) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin, cookie: seller.cookie } });
    const body: unknown = await response.json();
    return response.ok ? ok(body) : err({ code: "API_ERROR", message: "HTTP failure", http: { status: response.status, body } });
  });
  const saved = await mobile.setDelivery(orderId, home);
  expect(saved.success).toBe(true);
  if (!saved.success) throw new Error("Expected home assignment through mobile adapter");
  const assigned = saved.data;
  expect(assigned).toMatchObject({ delivery: { method: "home", recipient, destination: { address: "Street 123", district: "District", instructions: null },
    recordedBy: { kind: "seller", userId: seller.userId } }, deliveryCost: { amount: 6 }, deliveryCharge: { amount: 6 }, total: { amount: 16 } });
  expect(assigned.delivery).not.toHaveProperty("pickupPoint");
  expect(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json()).toEqual(assigned);
  expect((await call("/api/delivery-settings", seller.cookie, { ...settings, expectedVersion: 1, agency: { enabled: false }, couriers: [], home: { enabled: false } }, "PUT")).status).toBe(200);
  const blocked = await call(`/api/orders/${orderId}/delivery`, seller.cookie, home, "PUT");
  expect(blocked.status).toBe(422); expect(await blocked.json()).toMatchObject({ code: "DELIVERY_METHOD_DISABLED" });
  expect(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json()).toEqual(assigned);
  expect(await (await call("/api/delivery-settings", seller.cookie)).json()).toEqual({ version: 2, agency: { enabled: false }, couriers: [], home: { enabled: false }, store });
});


test("agency mobile adapters use real auth, config and immutable snapshots; deactivated or foreign couriers preserve the order", async () => {
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
  const delivery = { method: "agency" as const, courierId: courier.id, agency: " Office Lima ", recipient: { name: "Different recipient", phone: "00123", identity: { kind: "document" as const, documentType: "passport" as const, document: "00-A-001" } } };
  const input = { delivery, chargeDeliveryToCustomer: true };
  expect(await mobile.setDelivery(orderId, input)).toMatchObject({ success: false, error: { code: "DELIVERY_UNAVAILABLE" } });
  expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, { ...input, delivery: { ...delivery, recipient: { ...delivery.recipient, identity: { kind: "absent" } } } }, "PUT")).status).toBe(400);
  for (const extra of [{ courier: { id: courier.id, name: "Forged" } }, { recordedBy: { kind: "buyer" } }]) {
    expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, { ...input, delivery: { ...delivery, ...extra } }, "PUT")).status).toBe(400);
  }
  vi.spyOn(orders, "setDelivery").mockImplementation((value, context) => setConfiguredOrderDelivery(value, context, async (_snapshot, _authorized, currency) => ok({ amount: 3, currency })));
  const saved = await mobile.setDelivery(orderId, input);
  expect(saved.success).toBe(true);
  if (!saved.success) throw new Error("Expected agency assignment");
  expect(saved.data).toMatchObject({ delivery: { method: "agency", courier: { id: courier.id, name: "Courier" }, agency: "Office Lima", recipient: delivery.recipient, recordedBy: { kind: "seller", userId: seller.userId } }, total: { amount: 23 }, deliveryCost: { amount: 3 }, deliveryCharge: { amount: 3 }, stockDeducted: false });
  expect(saved.data.delivery).not.toHaveProperty("courierId");
  expect(summary).toHaveBeenCalledWith(expect.objectContaining({ event: "order_delivery_saved", courierId: courier.id, deliveryMethod: "agency", transactionOutcome: "committed" }), "Order delivery saved");
  expect(summary).toHaveBeenCalledWith(expect.objectContaining({ event: "delivery_settings_saved", agencyEnabled: true, couriersCount: 1, enabledCouriersCount: 1 }), "Delivery settings saved");

  const nextSettings = { ...settingsInput, expectedVersion: 1, couriers: [{ ...courier, kind: "existing" as const, name: "Renamed", enabled: false }, { kind: "new" as const, name: "Other courier", enabled: true }] };
  expect(await settingsApi.save(nextSettings)).toMatchObject({ success: true, data: { version: 2 } });
  expect(await mobile.getAggregate(orderId)).toEqual(saved);
  expect(await mobile.setDelivery(orderId, input)).toMatchObject({ success: false, error: { code: "COURIER_UNAVAILABLE" } });
  expect(rejection).toHaveBeenCalledWith(expect.objectContaining({ event: "order_delivery_rejected", courierId: courier.id, errorCode: "COURIER_UNAVAILABLE", stage: "resolve_delivery" }), "Order delivery rejected");
  for (const privateText of ["Different recipient", "00-A-001", "Office Lima"]) {
    expect(JSON.stringify([...summary.mock.calls, ...rejection.mock.calls])).not.toContain(privateText);
  }

  const foreignConfig = await call("/api/delivery-settings", other.cookie, settingsInput, "PUT");
  const foreignCourier = (await foreignConfig.json()).couriers[0];
  expect(await mobile.setDelivery(orderId, { ...input, delivery: { ...delivery, courierId: foreignCourier.id } })).toMatchObject({ success: false, error: { code: "COURIER_UNAVAILABLE" } });
  expect(await mobile.getAggregate(orderId)).toEqual(saved);
  const read = await settingsApi.get();
  if (!read.success) throw new Error("Expected configuration read");
  const active = read.data.couriers.find(courier => courier.enabled);
  if (!active) throw new Error("Expected active courier");
  expect((await call(`/api/orders/${orderId}/payments`, seller.cookie, { paymentId: randomUUID(), amount: { amount: 20, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false })).status).toBe(200);
  const replaced = await mobile.setDelivery(orderId, { delivery: { ...delivery, courierId: active.id }, chargeDeliveryToCustomer: false });
  expect(replaced).toMatchObject({ success: true, data: { delivery: { courier: { id: active.id, name: "Other courier" } }, total: { amount: 20 }, paidAmount: { amount: 20 }, stockDeducted: true } });
  expect(await withTenantIsolation(seller.companyId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } })).quantity)).toBe(1n);
  expect((await call(`/api/orders/${orderId}/ship`, seller.cookie, {})).status).toBe(200);
  expect(await mobile.setDelivery(orderId, input)).toMatchObject({ success: false, error: { code: "DELIVERY_LOCKED" } });
});
