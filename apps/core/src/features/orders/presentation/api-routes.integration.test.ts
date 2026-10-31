import { requestDeliveryQuotation } from "@core/src/features/delivery-settings/infrastructure/quotation-api";
import { applicationEventBus } from "@core/src/composition/event-bus";
import { createCancellationOperations } from "@mobile/features/orders/application/cancel-order";
import { loader as checkoutLoader, action as confirmCheckoutAction } from "@core/app/routes/checkout";
import { RouterContextProvider, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { brandHostCompanyContext } from "@core/app/brand-host-context";
import { createOrderOperations } from "@mobile/features/orders/application/order-operations";
import { addDraftItem, emptyOrderDraft } from "@mobile/features/orders/domain/order-draft";
import { createPendingOrderConfirmationStore } from "@mobile/features/orders/infrastructure/pending-order-confirmation";
import { log } from "@core/src/shared/infrastructure/logger";
import { createDeliverySettingsApi } from "@mobile/features/delivery-settings/infrastructure/delivery-settings-api";
import { storefrontConfig } from "@core/src/features/catalog/infrastructure/storefront-config";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { createOrderApi } from "@mobile/features/orders/infrastructure/order-api";
import { quotationResponseSchema } from "@shared/contracts/quotations";
import { deliverySettingsSchema } from "@shared/contracts/delivery-settings";
import { buyerPaymentViewSchema, cancelOrderResponseSchema, cancelOrderErrorSchema, orderAggregateSchema } from "@shared/contracts/orders";
import { app } from "@core/src/app";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";
import { deleteAgencies, insertAgency, seededCourier, withCatalogAdmin } from "@core/src/features/delivery-settings/infrastructure/courier-catalog-fixture";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct, deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";

const shalomId = (await seededCourier("shalom")).id;

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Orders test server did not bind");
const port = address.port;
const base = `http://127.0.0.1:${port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

const fixtures: { cleanup: () => Promise<void> }[] = [];
const catalogAgencies: string[] = [];

async function call(path: string, cookie?: string, input?: unknown, method?: string) {
  return fetch(`${base}${path}`, { method: method ?? (input === undefined ? "GET" : "POST"), headers: { origin, ...(cookie ? { cookie } : {}),
    ...(input === undefined ? {} : { "content-type": "application/json" }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}

function hostContext(companyId: string) {
  const context = new RouterContextProvider();
  context.set(brandHostCompanyContext, companyId as never);
  return context;
}
const subdomains = new Map<string, string>();

/** The brand host of `companyId`, created on first use: the buyer APIs answer on the store's own origin only. */
async function brandHost(companyId: string) {
  let subdomain = subdomains.get(companyId);
  if (!subdomain) {
    subdomain = `t4-${randomUUID().slice(0, 8)}`;
    await withTenantIsolation(companyId, async () => { await prisma.company.update({ where: { id: companyId }, data: { catalogSubdomain: subdomain } }); });
    subdomains.set(companyId, subdomain);
  }
  return `${subdomain}.localhost:${port}`;
}

/** Plain `http` so the test chooses the `Host` header, which `fetch` may override. Same shape as `call`, for `/api/buyer/orders/...` on a brand host. */
async function callOnHost(host: string, path: string, _cookie?: string, input?: unknown, method?: string) {
  const payload = input === undefined ? undefined : JSON.stringify(input);
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; json: () => Promise<unknown> }>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: method ?? (input === undefined ? "GET" : "POST"),
      headers: { host, ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }) } }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, json: async () => JSON.parse(text) }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}
/** A `fetch` that reaches the test server with the brand host in `Host`, as the checkout page does from its own origin. */
function fetchOnHost(host: string): typeof fetch {
  return (url, init) => new Promise<Response>((resolve, reject) => {
    const target = new URL(String(url), `http://${host}`);
    const body = typeof init?.body === "string" ? init.body : undefined;
    const headers = { ...Object.fromEntries(new Headers(init?.headers)), host, ...(body === undefined ? {} : { "content-length": String(Buffer.byteLength(body)) }) };
    const req = httpRequest({ host: "127.0.0.1", port, path: target.pathname + target.search, method: init?.method ?? "GET", headers }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve(new Response(text, { status: res.statusCode ?? 0, headers: Object.fromEntries(Object.entries(res.headers).flatMap(([name, value]) => typeof value === "string" ? [[name, value]] : [])) })));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const buyerCallFor = (companyId: string) => async (path: string, cookie?: string, input?: unknown, method?: string) => callOnHost(await brandHost(companyId), path, cookie, input, method);

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
    await seedProduct({ id: productId, name: "Camisa", qrCode: productId, variants: [{ id: variantId, attributes: { Talla: "M" }, sku: `SKU-${variantId}`, salePrice: 10, qrCode: variantId, stock: 3n }] });
    await prisma.contact.create({ data: { id: contactId, whatsappAccountId: "1@lid", whatsappLid: "2@lid" } });
  });
  const result = { companyId, userId, cookie, productId, variantId, contactId, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany();
      await prisma.orderItem.deleteMany();
      await prisma.order.deleteMany();
      await prisma.contact.deleteMany();
      await deleteSeededProducts();
      await prisma.deliveryRate.deleteMany();
      await prisma.quotation.deleteMany();
      await prisma.deliveryOptionAgency.deleteMany();
      await prisma.deliveryOption.deleteMany();
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
  await deleteAgencies(catalogAgencies);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await systemPrisma.$disconnect();
});

afterEach(() => vi.restoreAllMocks());

test("delivery HTTP resolves real configuration, preserves snapshots, replaces author and updates covered stock atomically", async () => {
  const seller = await fixture("PE");
  const second = await fixture("PE");
  const orderId = randomUUID();
  const store = { enabled: true, pickupPoint: { name: "Tienda", address: "Dirección original", instructions: null } };
  expect((await call("/api/delivery-settings", seller.cookie, { expectedVersion: 0, agency: { enabled: false }, home: { enabled: false }, store }, "PUT")).status).toBe(200);
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, 
    items: [{ variantId: seller.variantId, quantity: 2 }] })).status).toBe(201);
  const input = { delivery: { method: "store", recipient: { name: "Destinatario distinto", phone: "987", identity: { kind: "absent" } } }, expectedPrice: { amount: 0, currency: "PEN" } } as const;
  const mobile = createOrderApi(async (path, init) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin, cookie: seller.cookie } });
    const body: unknown = await response.json();
    return response.ok ? ok(body) : err({ code: "API_ERROR", message: "HTTP failure", http: { status: response.status, body } });
  });

  for (const obsoleteCharge of [true, false]) {
    const rejected = await call(`/api/orders/${orderId}/delivery`, seller.cookie, { delivery: input.delivery, obsoleteCharge }, "PUT");
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
  expect((await call("/api/delivery-settings", seller.cookie, { expectedVersion: 1, agency: { enabled: false }, home: { enabled: false }, store: nextStore }, "PUT")).status).toBe(200);
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
  const callBuyer = buyerCallFor(seller.companyId);
  const orderId = randomUUID();
  const imageId = randomUUID();
  const paymentId = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, 
    items: [{ variantId: seller.variantId, quantity: 1 }] }, "POST")).status).toBe(201);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.order.update({ where: { id: orderId }, data: { checkoutEnabledAt: new Date() } });
    await prisma.image.create({ data: { id: imageId, storageKey: `test/${imageId}` } });
  });
  const path = `/api/buyer/orders/${orderId}`;
  const view = await callBuyer(`${path}/payment`);
  expect(view.status).toBe(409);
  expect(await view.json()).toMatchObject({ code: "CHECKOUT_UNAVAILABLE" });
  const report = await callBuyer(`${path}/reports`, undefined, { paymentId, receiptImageId: imageId }, "POST");
  expect(report.status).toBe(409);
  expect(await report.json()).toMatchObject({ code: "CHECKOUT_UNAVAILABLE" });
  await withTenantIsolation(seller.companyId, async () => {
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.productStock.findUnique({ where: { variantId: seller.variantId } })).toMatchObject({ quantity: 3n });
    await prisma.order.update({ where: { id: orderId }, data: { checkoutConfirmedAt: new Date(),
      buyer: { create: { name: "Ana", phone: "+51987654321" } } } });
  });
  expect((await callBuyer(`${path}/payment`)).status).toBe(200);
  expect((await callBuyer(`${path}/reports`, undefined, { paymentId, receiptImageId: imageId }, "POST")).status).toBe(201);
  await withTenantIsolation(seller.companyId, async () => {
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.productStock.findUnique({ where: { variantId: seller.variantId } })).toMatchObject({ quantity: 3n });
  });
});

test("buyer order link resolves one company and reports only its receipt", async () => {
  const seller = await fixture("PE");
  const callBuyer = buyerCallFor(seller.companyId);
  const other = await fixture("CL");
  const orderId = randomUUID();
  const paymentId = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, 
    items: [{ variantId: seller.variantId, quantity: 1 }] }, "POST")).status).toBe(201);
  const path = `/api/buyer/orders/${orderId}`;
  const unavailable = await callBuyer(`${path}/payment`);
  expect(unavailable.status).toBe(409);
  expect(await unavailable.json()).toMatchObject({ code: "CHECKOUT_UNAVAILABLE" });
  expect((await callBuyer(`${path}/reports`, undefined, { paymentId, receiptImageId: randomUUID() }, "POST")).status).toBe(409);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.order.update({ where: { id: orderId }, data: { checkoutEnabledAt: new Date(), checkoutConfirmedAt: new Date(),
      buyer: { create: { name: "Ana", phone: "+51987654321" } } } });
  });
  const view = await callBuyer(`${path}/payment`);
  expect(view.status).toBe(200);
  expect(await view.json()).toMatchObject({ orderId, total: { amount: 10, currency: "PEN" }, balanceDue: { amount: 10 }, payments: [] });
  expect((await callBuyer("/api/buyer/orders/not-a-uuid/payment")).status).toBe(404);
  expect((await callBuyer(`/api/buyer/orders/${randomUUID()}/payment`)).status).toBe(404);
  expect((await callBuyer(`${path}/reports`, undefined, { paymentId, receiptImageId: randomUUID() }, "POST")).status).toBe(422);
  const foreignImageId = randomUUID();
  await withTenantIsolation(other.companyId, async () => {
    await prisma.image.create({ data: { id: foreignImageId, storageKey: `test/${foreignImageId}` } });
  });
  expect((await callBuyer(`${path}/reports`, undefined, { paymentId, receiptImageId: foreignImageId }, "POST")).status).toBe(422);
  const imageId = randomUUID();
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.image.create({ data: { id: imageId, storageKey: `test/${imageId}` } });
  });
  const info = vi.spyOn(log, "info");
  const debug = vi.spyOn(log, "debug");
  expect((await callBuyer(`${path}/reports`, undefined, { paymentId, receiptImageId: imageId }, "POST")).status).toBe(201);
  expect((await callBuyer(`${path}/reports`, undefined, { paymentId, receiptImageId: imageId }, "POST")).status).toBe(201);
  await withTenantIsolation(seller.companyId, async () => expect(await prisma.payment.count()).toBe(1));
  expect((await callBuyer(`${path}/reports`, undefined, { paymentId, receiptImageId: foreignImageId }, "POST")).status).toBe(409);
  const paymentEvents = info.mock.calls.map(([entry]) => entry).filter((entry) => typeof entry === "object" && entry !== null && "event" in entry && entry.event === "payment_reported");
  expect(paymentEvents).toEqual([{ event: "payment_reported", paymentId, imageId, actorKind: "buyer", outcome: "applied" }]);
  expect(debug.mock.calls.map(([entry]) => entry)).toEqual(expect.arrayContaining([
    { event: "payment_operation_replayed", operation: "report", paymentId },
    { event: "payment_operation_conflict", operation: "report", paymentId, errorCode: "PAYMENT_CONFLICT" },
  ]));
  info.mockRestore(); debug.mockRestore();
  expect((await callBuyer(`${path}/images/${imageId}`)).status).toBe(404);
  expect((await call(`/api/orders/${orderId}/aggregate`)).status).toBe(401);
});

test("orders HTTP answers VARIANT_NOT_FOUND for a deactivated variant and keeps the combination of a sale in option order", async () => {
  const seller = await fixture("PE");
  const { inactive, active } = await withTenantIsolation(seller.companyId, async () => {
    const seeded = await seedProduct({ name: "Polo", variants: [
      { attributes: { Talla: "M", Color: "Negro" }, salePrice: 45, stock: 2, status: "inactive" },
      { attributes: { Talla: "L", Color: "Negro" }, salePrice: 45, stock: 2 },
    ] });
    return { inactive: seeded.variantIds[0], active: seeded.variantIds[1] };
  });
  const sale = (variantId: string) => ({ id: randomUUID(), items: [{ variantId, quantity: 1 }], payment: { method: "digital_wallet" }, delivery: { method: "handover" } });
  const refused = await call("/api/orders", seller.cookie, sale(inactive), "POST");
  expect(refused.status).toBe(404);
  expect(await refused.json()).toMatchObject({ code: "VARIANT_NOT_FOUND", issues: [{ variantId: inactive }] });
  const created = await call("/api/orders", seller.cookie, sale(active), "POST");
  expect(created.status).toBe(201);
  const { id } = await created.json() as { id: string };
  const detail = await (await call(`/api/orders/${id}`, seller.cookie)).json() as { items: { variantAttributes: Record<string, string> }[] };
  expect(detail.items.map((item) => Object.entries(item.variantAttributes))).toEqual([[["Talla", "L"], ["Color", "Negro"]]]);
  const [stored] = await withTenantIsolation(seller.companyId, async () => await prisma.$queryRaw<{ attributes: string }[]>`SELECT "variantAttributes"::text AS attributes FROM "OrderItem" WHERE "orderId" = ${id}::uuid`);
  expect(Object.entries(JSON.parse(stored.attributes))).toEqual([["Talla", "L"], ["Color", "Negro"]]);
});

test("orders HTTP lets a Chile company complete sales, returns historical data, and isolates other companies", async () => {
  const seller = await fixture("CL");
  const other = await fixture("PE");
  const id = randomUUID();
  const input = { id, items: [{ variantId: seller.variantId, quantity: 2 }],
    payment: { method: "digital_wallet" }, delivery: { method: "handover" } };
  const created = await call("/api/orders", seller.cookie, input, "POST");
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({ id, companyId: seller.companyId, sellerId: seller.userId,
    status: "completed", paymentStatus: "paid", deliveryStatus: "delivered", stockDeducted: true,
    total: { amount: 20, currency: "PEN" }, buyer: null,
    payments: [{ amount: { amount: 20, currency: "PEN" } }],
    items: [{ productName: "Camisa", variantAttributes: { Talla: "M" }, quantity: 2,
      unitPrice: { amount: 10, currency: "PEN" }, subtotal: { amount: 20, currency: "PEN" } }] });
  expect((await call("/api/orders", seller.cookie, input, "POST")).status).toBe(409);
  expect(await withTenantIsolation(seller.companyId, async () =>
    (await prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } })).quantity)).toBe(1n);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.product.update({ where: { id: seller.productId }, data: { name: "Changed" } });
  });
  const detail = await call(`/api/orders/${id}`, seller.cookie);
  expect(detail.status).toBe(200);
  expect(await detail.json()).toMatchObject({ buyer: null, items: [{ productName: "Camisa" }] });
  expect((await call(`/api/orders/${id}`, other.cookie)).status).toBe(404);
  const foreignVariant = await call("/api/orders", other.cookie, { id: randomUUID(), 
    items: [{ variantId: seller.variantId, quantity: 1 }] }, "POST");
  expect(foreignVariant.status).toBe(404);
  expect(await foreignVariant.json()).toMatchObject({ code: "VARIANT_NOT_FOUND" });
  const list = await call("/api/orders?customer=general_public", seller.cookie);
  expect(await list.json()).toMatchObject({ total: 1, page: 1, pageSize: 20, items: [{ id, total: 20 }] });
  expect(await (await call("/api/orders", other.cookie)).json()).toMatchObject({ total: 0, items: [] });
  expect(await (await call("/api/orders/catalog?search=Camisa", other.cookie)).json()).toMatchObject([{ id: other.productId }]);
});

test("orders HTTP rejects invalid input and stock without partial sale", async () => {
  const seller = await fixture("PE");
  const input = { id: randomUUID(), items: [{ variantId: seller.variantId, quantity: 4 }],
    payment: { method: "digital_wallet" }, delivery: { method: "handover" } };
  const stock = await call("/api/orders", seller.cookie, input, "POST");
  expect(stock.status).toBe(409);
  expect(await stock.json()).toMatchObject({ code: "INSUFFICIENT_STOCK", issues: [{ variantId: seller.variantId }] });
  expect((await call("/api/orders", seller.cookie, { ...input, id: randomUUID(), contactId: randomUUID(),
    items: [{ variantId: seller.variantId, quantity: 1 }] }, "POST")).status).toBe(400);
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

test("orders HTTP records payment with short stock as waiting, ship still refuses it, and the order ships once stock arrives with company isolation", async () => {
  const seller = await fixture("PE");
  const other = await fixture("CL");
  const id = randomUUID();
  const paymentId = randomUUID();
  const created = await call("/api/orders", seller.cookie,
    { id, items: [{ variantId: seller.variantId, quantity: 4 }] }, "POST");
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({ id, status: "active", paymentStatus: "pending", deliveryStatus: "pending",
    stockDeducted: false, completedAt: null, total: { amount: 40, currency: "PEN" }, payments: [] });
  expect((await call(`/api/orders/${id}`, seller.cookie)).status).toBe(404);
  expect((await call(`/api/orders/${id}/aggregate`, other.cookie)).status).toBe(404);
  const payment = { paymentId, amount: { amount: 40, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false };
  const recorded = await call(`/api/orders/${id}/payments`, seller.cookie, payment, "POST");
  expect(recorded.status).toBe(200);
  expect(await recorded.json()).toMatchObject({ order: { paymentStatus: "paid", stockDeducted: false, payments: [{ id: paymentId }],
    stockDue: { kind: "waiting", shortItems: [{ variantId: seller.variantId, available: 3 }] } } });
  const refused = await call(`/api/orders/${id}/ship`, seller.cookie, undefined, "POST");
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "INSUFFICIENT_STOCK" });
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.productStock.update({ where: { variantId: seller.variantId }, data: { quantity: { increment: 1n } } });
  });
  const retried = await call(`/api/orders/${id}/payments`, seller.cookie, payment, "POST");
  expect(retried.status).toBe(200);
  // A replay publishes nothing: the stock now fits and the order waits for the recovery job, so it reads as being deducted.
  expect(await retried.json()).toMatchObject({ order: { stockDeducted: false, stockDue: { kind: "deducting" }, payments: [{ id: paymentId }] } });
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
    { id: pendingId, items: [{ variantId: seller.variantId, quantity: 1 }] }, "POST")).status).toBe(201);
  expect((await call("/api/orders", seller.cookie,
    { id: completedId, items: [{ variantId: seller.variantId, quantity: 1 }],
      payment: { method: "digital_wallet" }, delivery: { method: "handover" } }, "POST")).status).toBe(201);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.order.update({ where: { id: pendingId }, data: { createdAt: new Date("2026-09-30T12:00:00Z") } });
    await prisma.order.update({ where: { id: completedId }, data: { createdAt: new Date("2026-09-29T12:00:00Z") } });
  });
  const list = await call("/api/orders/mixed", seller.cookie);
  expect(list.status).toBe(200);
  const body = await list.json();
  expect(body).toMatchObject({ total: 2, page: 1, items: [
    { id: pendingId, status: "active", paymentStatus: "pending", createdAt: "2026-09-30T12:00:00.000Z" },
    { id: completedId, status: "completed", paymentStatus: "paid", createdAt: "2026-09-29T12:00:00.000Z" },
  ] });
  const mixedKeys = body.items.flatMap((item: object) => Object.keys(item));
  expect(mixedKeys).not.toContain("deliveryMethod");
  expect(mixedKeys).not.toContain("district");
  expect(await (await call("/api/orders/mixed?createdFrom=2026-09-30T00%3A00%3A00.000Z", seller.cookie)).json())
    .toMatchObject({ total: 1, items: [{ id: pendingId }] });
  expect(await (await call("/api/orders", seller.cookie)).json()).toMatchObject({ total: 1, items: [{ id: completedId }] });
});

test("orders HTTP combines Lima-day UTC bounds with stable pages", async () => {
  const seller = await fixture("PE");
  const ids = Array.from({ length: 21 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.order.createMany({ data: ids.map((id, index) => ({ number: BigInt(1001 + index), id, sellerId: seller.userId, currency: "PEN", total: 10, itemsTotal: 10,
      deliveryStatus: "delivered", stockDeducted: true, stockDeductedAt: new Date("2026-09-28T12:00:00.000Z"),
      completedAt: new Date("2026-09-28T12:00:00.000Z"), createdAt: new Date("2026-09-28T12:00:00.000Z") })) });
    await prisma.orderBuyer.createMany({ data: ids.map((orderId) => ({ orderId, contactId: seller.contactId, name: "Ana", phone: "+51999999999" })) });
  });
  const filters = new URLSearchParams({
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
});

test("orders HTTP filters by dispatch status, courier, scheduled and shipped dates within the tenant", async () => {
  const seller = await fixture("PE");
  const other = await fixture("PE");
  const courierId = randomUUID();
  const location = { country: "PE", districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima" };
  const delivery = { method: "agency", recipient: { name: "Ana", phone: "999", identity: { kind: "document", documentType: "national_id", document: "12345678" } },
    destination: location, pricing: { quotationId: randomUUID(), rateId: randomUUID(), optionId: randomUUID(), settingsVersion: 1 },
    courier: { id: courierId, name: "Shalom" }, agency: { id: randomUUID(), name: "Agencia", address: "Av. 1", location },
    recordedBy: { kind: "seller", userId: seller.userId } };
  const base = { currency: "PEN", total: 10, itemsTotal: 10, stockDeducted: true, stockDeductedAt: new Date("2026-09-28T12:00:00.000Z"), createdAt: new Date("2026-09-28T12:00:00.000Z") };
  const ids = Array.from({ length: 5 }, () => randomUUID());
  const [pendingScheduled, pendingUnscheduled, cancelledPending, shipped, otherTenant] = ids;
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.order.createMany({ data: [
      { ...base, number: 1001n, id: pendingScheduled, sellerId: seller.userId, scheduledDispatchDate: new Date("2026-10-05"), delivery },
      { ...base, number: 1002n, id: pendingUnscheduled, sellerId: seller.userId },
      { ...base, number: 1003n, id: cancelledPending, sellerId: seller.userId, cancelled: true, cancelledAt: new Date("2026-09-28T12:00:00.000Z"), scheduledDispatchDate: new Date("2026-10-05") },
      { ...base, number: 1004n, id: shipped, sellerId: seller.userId, deliveryStatus: "shipped", shippedAt: new Date("2026-10-06T15:00:00.000Z"), scheduledDispatchDate: new Date("2026-10-06") },
    ] });
    await prisma.orderItem.createMany({ data: [pendingScheduled, pendingUnscheduled, cancelledPending, shipped].map((orderId) => ({ orderId, variantId: seller.variantId,
      productName: "Sample product", variantAttributes: {}, quantity: 1n, unitPrice: 10, subtotal: 10 })) });
  });
  await withTenantIsolation(other.companyId, async () => {
    await prisma.order.create({ data: { ...base, number: 1001n, id: otherTenant, sellerId: other.userId, scheduledDispatchDate: new Date("2026-10-05") } });
  });
  const list = async (query: string) => {
    const response = await call(`/api/orders/mixed?${query}`, seller.cookie);
    return response.status === 200 ? (await response.json()).items.map((item: { id: string }) => item.id).sort() : response.status;
  };
  expect(await list("deliveryStatus=pending")).toEqual([pendingScheduled, pendingUnscheduled].sort());
  expect(await list("deliveryStatus=shipped")).toEqual([shipped]);
  expect((await (await call(`/api/orders/mixed?courierId=${courierId}`, seller.cookie)).json()).items[0].courier).toEqual({ id: courierId, name: "Shalom" });
  expect(await list(`courierId=${courierId}`)).toEqual([pendingScheduled]);
  expect(await list("unscheduled=true")).toEqual([pendingUnscheduled]);
  expect(await list("scheduledFrom=2026-10-06")).toEqual([shipped]);
  expect(await list("scheduledThrough=2026-10-05&deliveryStatus=pending")).toEqual([pendingScheduled]);
  expect(await list("scheduledFrom=2026-10-05&scheduledThrough=2026-10-06")).toEqual([pendingScheduled, cancelledPending, shipped].sort());
  expect(await list("shippedFrom=2026-10-06T00%3A00%3A00.000Z&shippedBefore=2026-10-06T15%3A00%3A00.000Z")).toEqual([]);
  expect(await list("shippedFrom=2026-10-06T15%3A00%3A00.000Z&shippedBefore=2026-10-07T00%3A00%3A00.000Z")).toEqual([shipped]);
  expect(await list("unscheduled=true&scheduledFrom=2026-10-05")).toBe(400);
  expect(await list("scheduledFrom=2026-10-06&scheduledThrough=2026-10-05")).toBe(400);
  expect(await list("shippedFrom=2026-10-07T00%3A00%3A00.000Z&shippedBefore=2026-10-06T00%3A00%3A00.000Z")).toBe(400);
});

test("home HTTP uses persisted enablement, requires district and replaces store without retaining its destination", async () => {
  const seller = await fixture("PE");
  const orderId = randomUUID();
  const store = { enabled: true, pickupPoint: { name: "Store", address: "Historic pickup", instructions: null } };
  const settings = { expectedVersion: 0, agency: { enabled: false }, home: { enabled: true }, store };
  expect((await call("/api/delivery-settings", seller.cookie, settings, "PUT")).status).toBe(200);
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
  const recipient = { name: "Different recipient", phone: "00123", identity: { kind: "absent" } } as const;
  const home = { delivery: { method: "home" as const, recipient, rateId: randomUUID(), destination: { address: " Street 123 ", districtCode: "040110", instructions: null } }, expectedPrice: { amount: 6, currency: "PEN" as const } };
  expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, home, "PUT")).status).toBe(422);
  expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, { ...home, delivery: { ...home.delivery, destination: { address: "Street" } } }, "PUT")).status).toBe(400);
  const before = await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json();
  expect(before).toMatchObject({ delivery: null, total: { amount: 10 } });
  expect((await call("/api/delivery-settings/zones", seller.cookie, { expectedVersion: 1,
    zones: [{ kind: "new", name: "Home", enabled: true, districtCodes: ["040110"], options: [{ kind: "new", method: "home", name: "Home", enabled: true, price: home.expectedPrice }] }] }, "PUT")).status).toBe(200);
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
  expect((await call("/api/delivery-settings", seller.cookie, { ...settings, expectedVersion: 2, agency: { enabled: false }, home: { enabled: false } }, "PUT")).status).toBe(200);
  const blocked = await call(`/api/orders/${orderId}/delivery`, seller.cookie, home, "PUT");
  expect(blocked.status).toBe(422); expect(await blocked.json()).toMatchObject({ code: "RATE_UNAVAILABLE" });
  expect(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json()).toEqual(assigned);
  expect(await (await call("/api/delivery-settings", seller.cookie)).json()).toEqual({ version: 3, agency: { enabled: false }, couriers: [], home: { enabled: false }, store });
});


test("rated agency adapters preserve snapshots and reject unavailable, unassociated or foreign agencies", async () => {
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
  const [associated, unassociated] = await Promise.all([insertAgency({ courierId: shalomId, name: "Associated branch", districtCode: "150122" }),
    insertAgency({ courierId: shalomId, name: "Other branch", districtCode: "150122" })]);
  catalogAgencies.push(associated, unassociated);
  const settingsInput = { expectedVersion: 0, home: { enabled: true }, store: { enabled: false as const, pickupPoint: null }, agency: { enabled: true } };
  expect(await settingsApi.save(settingsInput)).toMatchObject({ success: true });
  const agencyZone = (agencyId: string, name = "Agency") => ({ kind: "new" as const, name, enabled: true, districtCodes: ["040110"],
    options: [{ kind: "new" as const, method: "agency" as const, name, enabled: true, price: { amount: 3, currency: "PEN" as const }, agencyIds: [agencyId] }] });
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, items: [{ variantId: seller.variantId, quantity: 2 }] })).status).toBe(201);
  expect((await call("/api/delivery-settings/zones", seller.cookie, { expectedVersion: 1, zones: [agencyZone(associated)] }, "PUT")).status).toBe(200);
  // Choosing the agency in a zone is what creates the company courier.
  const courier = deliverySettingsSchema.parse(await (await call("/api/delivery-settings", seller.cookie)).json()).couriers[0];
  const quotation = quotationResponseSchema.parse(await (await call("/api/quotations", seller.cookie, { destination: { country: "PE", districtCode: "040110" } })).json());
  const rate = quotation.rates[0];
  if (rate.method !== "agency") throw new Error("Expected an agency rate");
  expect(rate.agencies).toEqual([{ id: associated, name: "Associated branch", address: "Av. Test 123", courier: { id: courier.id, name: "Shalom" },
    location: expect.objectContaining({ districtCode: "150122", district: "MIRAFLORES" }) }]);
  const delivery = { method: "agency" as const, rateId: rate.id, districtCode: "040110", agencyId: associated,
    recipient: { name: "Different recipient", phone: "00123", identity: { kind: "document" as const, documentType: "passport" as const, document: "00-A-001" } } };
  const input = { delivery, expectedPrice: { amount: 3, currency: "PEN" as const } };
  expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, { ...input, delivery: { ...delivery, recipient: { ...delivery.recipient, identity: { kind: "absent" } } } }, "PUT")).status).toBe(400);
  for (const extra of [{ courierId: courier.id }, { agency: "Office Lima" }, { recordedBy: { kind: "buyer" } }]) {
    expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, { ...input, delivery: { ...delivery, ...extra } }, "PUT")).status).toBe(400);
  }
  expect((await call(`/api/orders/${orderId}/delivery`, seller.cookie, { ...input, delivery: { ...delivery, agencyId: undefined } }, "PUT")).status).toBe(400);
  // A catalog agency the option does not reference is unavailable, even in the same courier.
  expect(await mobile.setDelivery(orderId, { ...input, delivery: { ...delivery, agencyId: unassociated } })).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
  const saved = await mobile.setDelivery(orderId, input);
  expect(saved).toMatchObject({ success: true, data: { delivery: { method: "agency", recipient: delivery.recipient, recordedBy: { kind: "seller", userId: seller.userId },
    destination: { districtCode: "040110" }, courier: { id: courier.id, name: "Shalom" },
    agency: { id: associated, name: "Associated branch", address: "Av. Test 123", location: { districtCode: "150122", district: "MIRAFLORES" } } },
    total: { amount: 23 }, deliveryCost: { amount: 3 }, deliveryCharge: { amount: 3 }, stockDeducted: false } });
  if (!saved.success) throw new Error("Expected rated agency assignment");
  expect(summary).toHaveBeenCalledWith(expect.objectContaining({ event: "order_delivery_saved", deliveryMethod: "agency", courierId: courier.id, transactionOutcome: "committed" }), "Order delivery saved");
  // The snapshot does not depend on later catalog or configuration changes.
  await withCatalogAdmin(query => query('UPDATE "DeliveryAgency" SET enabled = false WHERE id = $1', [associated]));
  expect(await mobile.getAggregate(orderId)).toEqual(saved);
  expect(await mobile.setDelivery(orderId, input)).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
  expect(rejection).toHaveBeenCalledWith(expect.objectContaining({ event: "order_delivery_rejected", errorCode: "RATE_UNAVAILABLE", agencyId: associated }), "Order delivery rejected");
  await withCatalogAdmin(query => query('UPDATE "DeliveryAgency" SET enabled = true WHERE id = $1', [associated]));
  expect(await mobile.setDelivery(orderId, input)).toMatchObject({ success: true });
  const nextSettings = { ...settingsInput, expectedVersion: 2, agency: { enabled: false } };
  expect(await settingsApi.save(nextSettings)).toMatchObject({ success: true, data: { version: 3 } });
  expect(await mobile.setDelivery(orderId, input)).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
  for (const privateText of ["Different recipient", "00-A-001"]) expect(JSON.stringify([...summary.mock.calls, ...rejection.mock.calls])).not.toContain(privateText);
  // Another company cannot use this company's rate, even for an agency of the shared catalog.
  expect((await call("/api/delivery-settings", other.cookie, settingsInput, "PUT")).status).toBe(200);
  expect((await call("/api/delivery-settings/zones", other.cookie, { expectedVersion: 1, zones: [agencyZone(associated, "Foreign")] }, "PUT")).status).toBe(200);
  const foreign = quotationResponseSchema.parse(await (await call("/api/quotations", other.cookie, { destination: { country: "PE", districtCode: "040110" } })).json());
  expect(await mobile.setDelivery(orderId, { ...input, delivery: { ...delivery, rateId: foreign.rates[0].id } })).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
  expect(await settingsApi.save({ ...settingsInput, expectedVersion: 3 })).toMatchObject({ success: true });
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
  expect((await call("/api/orders", owner.cookie, { id, items: [{ variantId: owner.variantId, quantity: 1 }] })).status).toBe(201);
  const path = `/api/orders/${id}/checkout-link`;
  expect((await call(path, "", {})).status).toBe(401);
  expect((await call(path, other.cookie, {})).status).toBe(404);
  expect((await call(path, owner.cookie, { companyId: other.companyId })).status).toBe(422);
  const withoutSubdomain = await call(path, owner.cookie, {});
  expect(withoutSubdomain.status).toBe(409);
  expect(await withoutSubdomain.json()).toMatchObject({ code: "SUBDOMAIN_REQUIRED" });
  const subdomain = (await brandHost(owner.companyId)).split(".")[0];
  const first = await call(path, owner.cookie, {});
  expect(first.status).toBe(200);
  expect(first.headers.get("cache-control")).toBe("no-store");
  const link = await first.json();
  expect(link).toEqual({ url: `${storefrontConfig.baseUrl.protocol}//${subdomain}.${storefrontConfig.baseUrl.host}/checkout/${id}` });
  const stored = () => withTenantIsolation(owner.companyId, async () => await prisma.order.findUniqueOrThrow({ where: { id } }));
  const created = await stored();
  expect(created.checkoutEnabledAt).toEqual(created.createdAt);
  expect(await (await call(path, owner.cookie, {})).json()).toEqual(link);
  expect(await stored()).toEqual(created);
  await withTenantIsolation(owner.companyId, async () => await prisma.order.update({ where: { id }, data: { cancelled: true, cancelledAt: new Date() } }));
  expect((await call(path, owner.cookie, {})).status).toBe(409);
});

test("complete creation HTTP preserves optional payment IDs and supports pending and paid orders", async () => {
  const f = await fixture("PE");
  for (const amount of [null, 5, 10]) {
    const id = randomUUID();
    const paymentId = randomUUID();
    const input = { id, items: [{ variantId: f.variantId, quantity: 1 }],
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
  const orderId = randomUUID();
  const selected = addDraftItem(emptyOrderDraft(), { variantId: f.variantId, productName: "Camisa", variantAttributes: {}, sku: null,
    shownUnitPrice: { amount: 10, currency: "PEN" }, shownStock: 3, quantity: 1 }, () => orderId);
  if (!selected.success) throw new Error("Invalid mobile fixture");
  const paymentId = randomUUID();
  const draft = { ...selected.data, payments: paid ? [{ paymentId, amount: "10", method: "bank_transfer" as const, deductStockIfPartial: false }] : [], deliverImmediately: false };
  const first = createOrderOperations(api, createPendingOrderConfirmationStore(storage));
  expect(await first.completeOrder(draft, f.companyId)).toMatchObject({ success: true, data: { kind: "queued" } });
  lost = false;
  const restarted = createOrderOperations(api, createPendingOrderConfirmationStore(storage));
  expect(await restarted.syncPendingOrders(f.companyId)).toEqual({ waiting: 0 });
  expect(await restarted.listPendingOrders(f.companyId)).toEqual(ok([]));
  expect(await restarted.loadOrder(orderId)).toMatchObject({ success: true, data: { status: "active", deliveryStatus: "pending",
    paymentStatus: paid ? "paid" : "pending", stockDeducted: paid } });
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
  const sellerHost = await brandHost(seller.companyId);
  const foreignHost = await brandHost(foreign.companyId);
  const buyer = (host: string) => callOnHost(host, "/api/quotations", undefined, input);
  expect((await call("/api/quotations", foreign.cookie, input)).status).toBe(404);
  const before = await buyer(sellerHost);
  expect(before.status).toBe(404);
  expect(await before.json()).toMatchObject({ code: "CHECKOUT_UNAVAILABLE" });
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, 
    items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
  expect((await call("/api/quotations", foreign.cookie, input)).status).toBe(404);
  expect((await buyer(foreignHost)).status).toBe(404);
  expect((await callOnHost(sellerHost, "/api/quotations", undefined, { destination })).status).toBe(404);
  expect((await call(`/api/orders/${orderId}/checkout-link`, seller.cookie, {})).status).toBe(200);
  expect((await call("/api/delivery-settings/zones", seller.cookie, { expectedVersion: 0,
    zones: [0, 8, 8].map(amount => ({ kind: "new", name: "Private zone", enabled: true, districtCodes: ["150122"], options: [{ kind: "new", method: "home", name: "Home", enabled: true, price: { amount, currency: "PEN" } }] })) }, "PUT")).status).toBe(200);
  expect((await call("/api/delivery-settings", seller.cookie, { expectedVersion: 1, home: { enabled: true }, agency: { enabled: true },
    store: { enabled: false, pickupPoint: null } }, "PUT")).status).toBe(200);
  const orderBefore = await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json();
  const browserFetch = fetchOnHost(sellerHost);
  const a = await requestDeliveryQuotation({ orderId, districtCode: destination.districtCode }, undefined, browserFetch);
  const b = await buyer(sellerHost);
  expect(a.success).toBe(true);
  expect(b.status).toBe(201);
  expect(b.headers["cache-control"]).toBe("no-store");
  if (!a.success) throw new Error("Browser quotation failed");
  const first = a.data;
  const second = quotationResponseSchema.parse(await b.json());
  expect(first.id).not.toBe(second.id);
  expect(first.rates.map(rate => [rate.method, rate.price.amount])).toEqual([["home", 0], ["home", 8], ["home", 8]]);
  expect(second.rates.map(rate => [rate.method, rate.price.amount])).toEqual(first.rates.map(rate => [rate.method, rate.price.amount]));
  expect(new Set([...first.rates, ...second.rates].map(rate => rate.id)).size).toBe(6);
  await withTenantIsolation(seller.companyId, async () => {
    expect(await prisma.quotation.count()).toBe(2);
    expect(await prisma.deliveryRate.count()).toBe(6);
    expect(await prisma.productStock.findUnique({ where: { variantId: seller.variantId } })).toMatchObject({ quantity: 3n });
    expect(await prisma.companyDeliverySettings.findUnique({ where: { companyId: seller.companyId } })).toMatchObject({ version: 2 });
  });
  await withTenantIsolation(foreign.companyId, async () => {
    expect(await prisma.quotation.count()).toBe(0);
    expect(await prisma.deliveryRate.count()).toBe(0);
  });
  expect(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json()).toEqual(orderBefore);
  await withTenantIsolation(seller.companyId, async () => await prisma.order.update({ where: { id: orderId }, data: { cancelled: true, cancelledAt: new Date() } }));
  const cancelled = await buyer(sellerHost);
  expect(cancelled.status).toBe(422);
  expect(await cancelled.json()).toMatchObject({ code: "ORDER_CANCELLED" });
  expect(await requestDeliveryQuotation({ orderId, districtCode: destination.districtCode }, undefined, browserFetch))
    .toMatchObject({ success: false, error: { code: "ORDER_CANCELLED" } });
  await withTenantIsolation(seller.companyId, async () => expect(await prisma.quotation.count()).toBe(2));
});


test("aggregate reads preserve rated delivery snapshots without consulting current configuration", async () => {
  const seller = await fixture("PE");
  const orderId = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, 
    items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
  const recipient = { name: "Ana", phone: "999", identity: { kind: "document", documentType: "national_id", document: "12345678" } };
  const pricing = { quotationId: randomUUID(), rateId: randomUUID(), optionId: randomUUID(), settingsVersion: 3 };
  const district = { country: "PE", districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima" };
  const recordedBy = { kind: "buyer" };
  const home = { method: "home", recipient, destination: { ...district, address: "Street", instructions: null }, pricing, recordedBy };
  const agency = { method: "agency", recipient, destination: district, pricing, recordedBy, courier: { id: randomUUID(), name: "Courier" },
    agency: { id: randomUUID(), name: "Branch", address: "Av. Test 123", location: district } };
  const pickup = { method: "store", recipient, pickupPoint: { name: "Shop", address: "Street", instructions: null }, settingsVersion: 3, recordedBy };
  for (const delivery of [home, agency, pickup]) {
    const charge = "pricing" in delivery ? 8 : 0;
    await withTenantIsolation(seller.companyId, async () => await prisma.order.update({ where: { id: orderId }, data: {
      delivery, deliveryCost: 8, deliveryCharge: charge, total: 10 + charge,
    } }));
    const response = await call(`/api/orders/${orderId}/aggregate`, seller.cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ delivery, deliveryCost: { amount: 8, currency: "PEN" }, deliveryCharge: { amount: charge }, total: { amount: 10 + charge } });
  }
  const freeTextAgency = { method: "agency", recipient, destination: district, pricing, courier: { id: randomUUID(), name: "Old courier" }, agency: "Old office", recordedBy };
  for (const delivery of [freeTextAgency, { ...agency, courier: null, agency: null }, { ...home, pricing: undefined }]) {
    await withTenantIsolation(seller.companyId, async () => await prisma.order.update({ where: { id: orderId }, data: { delivery } }));
    expect((await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).status).toBe(422);
  }
  await withTenantIsolation(seller.companyId, async () => expect(await prisma.companyDeliverySettings.count()).toBe(0));
});

test("rated delivery HTTP assigns the selected option, reports price conflicts and isolates rate ownership", async () => {
  const seller = await fixture("PE");
  const foreign = await fixture("PE");
  const recipient = { name: "Ana", phone: "999", identity: { kind: "document", documentType: "national_id", document: "12345678" } };
  const destination = { country: "PE", districtCode: "150122", address: null, instructions: null };
  async function configure(owner: typeof seller, amounts: number[]) {
    expect((await call("/api/delivery-settings/zones", owner.cookie, { expectedVersion: 0,
      zones: amounts.map(amount => ({ kind: "new", name: "Zone", enabled: true, districtCodes: ["150122"], options: [{ kind: "new", method: "home", name: "Home", enabled: true, price: { amount, currency: "PEN" } }] })) }, "PUT")).status).toBe(200);
    expect((await call("/api/delivery-settings", owner.cookie, { expectedVersion: 1, home: { enabled: true }, agency: { enabled: true },
      store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } }, "PUT")).status).toBe(200);
  }
  await configure(seller, [0, 8]);
  await configure(foreign, [10]);
  const quoteResponse = await call("/api/quotations", seller.cookie, { destination });
  expect(quoteResponse.status).toBe(201);
  const quote = quotationResponseSchema.parse(await quoteResponse.json());
  const foreignQuote = quotationResponseSchema.parse(await (await call("/api/quotations", foreign.cookie, { destination })).json());
  const home = quote.rates.find(rate => rate.method === "home" && rate.price.amount === 8)!;
  const free = quote.rates.find(rate => rate.method === "home" && rate.price.amount === 0)!;
  const orderId = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
  const path = `/api/orders/${orderId}/delivery`;
  const input = { delivery: { method: "home", rateId: home.id, recipient, destination: { districtCode: "150122", address: "Final street", instructions: null } }, expectedPrice: home.price };
  const saved = await call(path, seller.cookie, input, "PUT");
  expect(saved.status).toBe(200);
  const before = orderAggregateSchema.parse(await saved.json());
  expect(before).toMatchObject({ deliveryCost: home.price, deliveryCharge: home.price, total: { amount: 18 },
    delivery: { destination: { district: "MIRAFLORES", province: "LIMA METROPOLITANA", address: "Final street" },
      pricing: { rateId: home.id, quotationId: quote.id, optionId: home.optionId, settingsVersion: 2 }, recordedBy: { kind: "seller", userId: seller.userId } } });
  const otherRate = await call(path, seller.cookie, { ...input, delivery: { ...input.delivery, rateId: foreignQuote.rates[0].id } }, "PUT");
  expect(otherRate.status).toBe(422);
  expect(await otherRate.json()).toMatchObject({ code: "RATE_UNAVAILABLE" });
  expect((await call(path, foreign.cookie, input, "PUT")).status).toBe(404);
  for (const body of [{ ...input, obsoleteCharge: false }, { ...input, price: home.price },
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
    delivery: { method: "store", settingsVersion: 2, pickupPoint: { name: "Shop" } } });
  const paidId = randomUUID();
  const paymentId = randomUUID();
  const paidInput = { id: paidId, items: [{ variantId: seller.variantId, quantity: 1 }], delivery: input,
    payments: [{ paymentId, amount: { amount: 18, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }] };
  for (const obsoleteCharge of [true, false]) {
    const rejected = await call("/api/orders", seller.cookie, { ...paidInput, delivery: { delivery: { method: "store", recipient }, obsoleteCharge } });
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
  const created = await call("/api/orders", seller.cookie, { id: initialId, items: [{ variantId: seller.variantId, quantity: 1 }],
    delivery: { ...input, delivery: { ...input.delivery, rateId: free.id }, expectedPrice: free.price },
    payments: [{ paymentId: randomUUID(), amount: { amount: 10, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }] });
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({ stockDeducted: true, total: { amount: 10 }, delivery: { pricing: { rateId: free.id } } });
  await withTenantIsolation(seller.companyId, async () => expect((await prisma.productStock.findUnique({ where: { variantId: seller.variantId } }))?.quantity).toBe(1n));
});


test("buyer APIs answer on the company's brand host only: not on the app host, not on another company's host, not on an unheld one", async () => {
  const seller = await fixture("PE");
  const other = await fixture("CL");
  const orderId = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, items: [{ variantId: seller.variantId, quantity: 1 }] }, "POST")).status).toBe(201);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.order.update({ where: { id: orderId }, data: { checkoutEnabledAt: new Date(), checkoutConfirmedAt: new Date(),
      buyer: { create: { name: "Ana", phone: "+51987654321" } } } });
  });
  const path = `/api/buyer/orders/${orderId}/payment`;
  const own = await brandHost(seller.companyId);
  // The catalog is hidden (never published): the checkout and its APIs keep working.
  expect((await callOnHost(own, path)).status).toBe(200);
  const foreign = await callOnHost(await brandHost(other.companyId), path);
  const missing = await callOnHost(own, `/api/buyer/orders/${randomUUID()}/payment`);
  expect(foreign.status).toBe(404);
  const missingBody = await missing.json();
  expect(await foreign.json()).toEqual(missingBody);
  // An id that is not a UUID answers exactly like an unknown one.
  const malformed = await callOnHost(own, "/api/buyer/orders/not-a-uuid/payment");
  expect(malformed.status).toBe(missing.status);
  expect(await malformed.json()).toEqual(missingBody);
  const unheld = await callOnHost(`no-existe-${randomUUID().slice(0, 8)}.localhost:${port}`, path);
  expect(unheld.status).toBe(404);
  expect(await unheld.json()).toEqual({ code: "NOT_FOUND", error: "Not found" });
  expect((await call(path)).status).toBe(404);
  expect((await callOnHost(`localhost:${port}`, path)).status).toBe(404);
  expect((await callOnHost(own, "/api/orders")).status).toBe(404);
  expect((await callOnHost(own, `/api/buyer/orders/${orderId}/images/${randomUUID()}`)).status).toBe(404);
  expect((await callOnHost(await brandHost(other.companyId), `/api/buyer/orders/${orderId}/reports`, undefined, { paymentId: randomUUID(), receiptImageId: randomUUID() }, "POST")).status).toBe(404);
});

test("checkout loader sends only the covered places per method and no zone, option, price or agency", async () => {
  const stores = [{ seller: await fixture("PE"), district: "150122" }, { seller: await fixture("PE"), district: "040101" }];
  const loaded = await Promise.all(stores.map(async ({ seller, district }) => {
    const orderId = randomUUID();
    const store = { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } };
    expect((await call("/api/delivery-settings", seller.cookie, { expectedVersion: 0, agency: { enabled: false }, home: { enabled: true }, store }, "PUT")).status).toBe(200);
    expect((await call("/api/delivery-settings/zones", seller.cookie, { expectedVersion: 1, zones: [{ kind: "new", name: "Secret zone", enabled: true, districtCodes: [district],
      options: [{ kind: "new", method: "home", name: "Secret option", enabled: true, price: { amount: 7, currency: "PEN" } }] }] }, "PUT")).status).toBe(200);
    expect((await call("/api/orders/pending", seller.cookie, { id: orderId, items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
    await withTenantIsolation(seller.companyId, async () => { await prisma.order.update({ where: { id: orderId }, data: { checkoutEnabledAt: new Date() } }); });
    return (await checkoutLoader({ params: { orderId }, context: hostContext(seller.companyId) } as unknown as LoaderFunctionArgs)).data.deliveryOptions;
  }));
  expect(loaded.map(options => options?.home)).toEqual([
    { offered: true, places: { departmentCodes: [], provinceCodes: [], districtCodes: ["150122"] } },
    { offered: true, places: { departmentCodes: [], provinceCodes: [], districtCodes: ["040101"] } }]);
  for (const options of loaded) {
    expect(options?.agency).toEqual({ offered: false });
    expect(JSON.stringify(options)).not.toMatch(/Secret|price|agencyIds|"name":"Secret/);
  }
});

test("public checkout delivery action persists buyer pickup and redirects to existing payment", async () => {
  const seller = await fixture("PE");
  const callBuyer = buyerCallFor(seller.companyId);
  const orderId = randomUUID();
  expect((await call("/api/delivery-settings", seller.cookie, { expectedVersion: 0, agency: { enabled: false }, home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } }, "PUT")).status).toBe(200);
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.order.update({ where: { id: orderId }, data: { checkoutEnabledAt: new Date() } });
  });
  const loaded = await checkoutLoader({ params: { orderId }, context: hostContext(seller.companyId) } as unknown as LoaderFunctionArgs);
  expect(loaded.data.deliveryOptions).toEqual({ home: { offered: false }, agency: { offered: false },
    store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } });
  const input = { buyer: { name: "Ana", phone: "+51987654321" }, expectedTotal: { amount: 10, currency: "PEN" }, delivery: { kind: "replace",
    selection: { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } }, expectedPrice: { amount: 0, currency: "PEN" } } };
  const result = await confirmCheckoutAction({ params: { orderId }, context: hostContext(seller.companyId), request: new Request(`${base}/checkout/${orderId}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  }) } as unknown as ActionFunctionArgs);
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).headers.get("Location")).toBe(`/checkout/${orderId}`);
  expect((await callBuyer(`/api/buyer/orders/${orderId}/payment`)).status).toBe(200);
  await withTenantIsolation(seller.companyId, async () => {
    expect(await prisma.order.findUnique({ where: { id: orderId } })).toMatchObject({ stockDeducted: false,
      delivery: { method: "store", recordedBy: { kind: "buyer" }, settingsVersion: 1 } });
    expect(await prisma.orderBuyer.findUnique({ where: { orderId } })).toMatchObject({ name: "Ana", phone: "+51987654321" });
    expect(await prisma.payment.count()).toBe(0);
    expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } })).quantity).toBe(3n);
  });
});


test("catalog lookup by variant IDs bypasses search pagination and excludes unavailable or foreign variants", async () => {
  const seller = await fixture("PE");
  const other = await fixture("PE");
  const extra = Array.from({ length: 21 }, () => ({ productId: randomUUID(), variantId: randomUUID() }));
  await withTenantIsolation(seller.companyId, async () => {
    for (const value of extra) {
      await seedProduct({ id: value.productId, name: "A catalog product", qrCode: value.productId, variants: [{ id: value.variantId, salePrice: 12, qrCode: value.variantId, stock: 2n }] });
    }
    await prisma.productStock.delete({ where: { variantId: extra[0].variantId } });
    await prisma.productVariant.delete({ where: { id: extra[0].variantId } });
  });
  const search = await (await call("/api/orders/catalog?search=", seller.cookie)).json();
  expect(search).toHaveLength(20);
  expect(search.some((product: { id: string }) => product.id === seller.productId)).toBe(false);
  const ids = [seller.variantId, ...extra.map(value => value.variantId), other.variantId];
  const selected = await call(`/api/orders/catalog?${new URLSearchParams({ variantIds: ids.join(",") })}`, seller.cookie);
  expect(selected.status).toBe(200);
  const rows = await selected.json();
  expect(rows.flatMap((product: { variants: { id: string }[] }) => product.variants.map(value => value.id)).sort())
    .toEqual([seller.variantId, ...extra.slice(1).map(value => value.variantId)].sort());
  expect(rows.find((product: { id: string }) => product.id === seller.productId)).toMatchObject({ variants: [{ id: seller.variantId, price: 10, stock: 3 }] });
  for (const query of ["variantIds=bad", `variantIds=${seller.variantId},${seller.variantId}`, `variantIds=${seller.variantId}&search=Camisa`])
    expect((await call(`/api/orders/catalog?${query}`, seller.cookie)).status).toBe(400);
});


test("cancellation HTTP validates identity, isolation, repeated results and preserves payments", async () => {
  const seller = await fixture("PE");
  const other = await fixture("PE");
  const id = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id, items: [{ variantId: seller.variantId, quantity: 2 }] })).status).toBe(201);
  const paymentId = randomUUID();
  expect((await call(`/api/orders/${id}/payments`, seller.cookie, { paymentId, amount: { amount: 20, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false })).status).toBe(200);
  expect((await call(`/api/orders/${id}/cancel`, undefined, undefined, "POST")).status).toBe(401);
  const foreign = await call(`/api/orders/${id}/cancel`, other.cookie, undefined, "POST");
  expect(foreign.status).toBe(404);
  expect(cancelOrderErrorSchema.parse(await foreign.json()).code).toBe("ORDER_NOT_FOUND");
  expect((await call("/api/orders/invalid/cancel", seller.cookie, undefined, "POST")).status).toBe(400);
  expect((await call(`/api/orders/${randomUUID()}/cancel`, seller.cookie, undefined, "POST")).status).toBe(404);
  const payments = await withTenantIsolation(seller.companyId, async () => await prisma.payment.findMany({ where: { orderId: id } }));
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await call(`/api/orders/${id}/cancel`, seller.cookie, { companyId: other.companyId, sellerId: other.userId }, "POST");
    expect(response.status).toBe(200);
    expect(cancelOrderResponseSchema.parse(await response.json())).toMatchObject({ id, companyId: seller.companyId, cancelled: true, stockDeducted: true, paymentStatus: "paid" });
  }
  await withTenantIsolation(seller.companyId, async () => {
    expect(await prisma.payment.findMany({ where: { orderId: id } })).toEqual(payments);
    expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } })).quantity).toBe(1n);
  });
  expect((await call(`/api/orders/${id}/ship`, seller.cookie, undefined, "POST")).status).toBe(409);
  expect((await call(`/api/orders/${id}/payments`, seller.cookie, { paymentId: randomUUID(), amount: { amount: 1, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false })).status).toBe(409);
});


test("mobile cancellation adapter recovers the real committed result with one write and read", async () => {
  const seller = await fixture("PE");
  const id = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id, items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
  const paths: string[] = [];
  let offline = true;
  const api = createOrderApi(async (path, init) => {
    paths.push(path);
    if (offline && init?.method !== "POST") return err({ code: "NETWORK_ERROR", message: "Offline" });
    const response = await call(path, seller.cookie, undefined, init?.method);
    const body: unknown = await response.json();
    if (init?.method === "POST") {
      expect(response.status).toBe(200);
      expect(cancelOrderResponseSchema.parse(body).cancelled).toBe(true);
      return err({ code: "NETWORK_ERROR", message: "Lost after commit" });
    }
    return response.ok ? ok(body) : err({ code: "API_ERROR", message: "Rejected", http: { status: response.status, body } });
  });
  const operations = createCancellationOperations({ cancel: api.cancel, readState: api.readCancellationState });
  expect(await operations.cancelOrder(id)).toMatchObject({ success: true, data: { kind: "uncertain", orderId: id } });
  expect(paths).toEqual([`/api/orders/${id}/cancel`, `/api/orders/${id}/aggregate`]);
  offline = false;
  expect(await operations.checkCancellation(id)).toMatchObject({ success: true, data: { kind: "cancelled", order: { id, cancelled: true, stockDeducted: false } } });
  expect(paths).toEqual([`/api/orders/${id}/cancel`, `/api/orders/${id}/aggregate`, `/api/orders/${id}/aggregate`]);
  const foreign = await fixture("PE");
  const foreignApi = createOrderApi(async (path, init) => {
    const response = await call(path, foreign.cookie, undefined, init?.method);
    const body: unknown = await response.json();
    return response.ok ? ok(body) : err({ code: "API_ERROR", message: "Rejected", http: { status: response.status, body } });
  });
  expect(await foreignApi.cancel(id)).toMatchObject({ error: { code: "ORDER_NOT_FOUND" } });
});


test("mobile adapter accepts real cancellation and rejects dispatched orders without changing payments", async () => {
  const seller = await fixture("PE");
  const api = createOrderApi(async (path, init) => {
    const response = await call(path, seller.cookie, undefined, init?.method);
    const body: unknown = await response.json();
    return response.ok ? ok(body) : err({ code: "API_ERROR", message: "Rejected", http: { status: response.status, body } });
  });
  const pending = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id: pending, items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
  expect(await api.cancel(pending)).toEqual(ok({ id: pending, status: "cancelled", cancelled: true, deliveryStatus: "pending", stockDeducted: false, deliveredAt: null, completedAt: null }));
  const dispatched = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id: dispatched, items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
  expect((await call(`/api/orders/${dispatched}/payments`, seller.cookie, { paymentId: randomUUID(), amount: { amount: 10, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false })).status).toBe(200);
  for (const operation of ["ship", "deliver"] as const) {
    expect((await call(`/api/orders/${dispatched}/${operation}`, seller.cookie, undefined, "POST")).status).toBe(200);
    const before = await api.getAggregate(dispatched);
    const beforeStock = await withTenantIsolation(seller.companyId, async () => prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } }));
    expect(await api.cancel(dispatched)).toMatchObject({ error: { code: "INVALID_TRANSITION" } });
    expect(await api.getAggregate(dispatched)).toEqual(before);
    expect(await withTenantIsolation(seller.companyId, async () => prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } }))).toEqual(beforeStock);
  }
});

test("HTTP cancellation commits and logs a failed publication without restoring or republishing", async () => {
  const seller = await fixture("PE");
  const id = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id, items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
  expect((await call(`/api/orders/${id}/payments`, seller.cookie, { paymentId: randomUUID(), amount: { amount: 10, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false })).status).toBe(200);
  const publish = vi.spyOn(applicationEventBus().provider, "publish").mockResolvedValue(err({ code: "EVENT_BUS_UNAVAILABLE", message: "Test publication failure" }));
  const logging = vi.spyOn(log, "error").mockImplementation(() => {});
  const before = await withTenantIsolation(seller.companyId, async () => prisma.payment.findMany({ where: { orderId: id } }));
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await call(`/api/orders/${id}/cancel`, seller.cookie, undefined, "POST");
    expect(response.status).toBe(200);
    expect(cancelOrderResponseSchema.parse(await response.json())).toMatchObject({ id, cancelled: true, stockDeducted: true });
  }
  expect(publish).toHaveBeenCalledTimes(1);
  expect(logging).toHaveBeenCalledWith(expect.objectContaining({ event: "event_publication_failed", name: "order_cancelled", companyId: seller.companyId, eventId: expect.any(String), errorCode: "EVENT_BUS_UNAVAILABLE" }), "Event publication failed");
  expect(logging.mock.calls.find(([fields]) => (fields as { event: string }).event === "event_publication_failed")?.[0]).not.toHaveProperty("orderId");
  expect(logging).toHaveBeenCalledWith(expect.objectContaining({ event: "order_cancelled_publish_failed", companyId: seller.companyId, orderId: id, orderNumber: expect.any(Number), errorCode: "EVENT_BUS_UNAVAILABLE" }), "order_cancelled_publish_failed");
  await withTenantIsolation(seller.companyId, async () => {
    expect(await prisma.order.findUniqueOrThrow({ where: { id } })).toMatchObject({ cancelled: true, stockDeducted: true });
    expect(await prisma.payment.findMany({ where: { orderId: id } })).toEqual(before);
    expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } })).quantity).toBe(2n);
  });
});


test("cancellation rejects a session without a company or without verification before loading the order", async () => {
  const seller = await fixture("PE");
  const session = await fixture("PE");
  const id = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id, items: [{ variantId: seller.variantId, quantity: 1 }] })).status).toBe(201);
  const before = await (await call(`/api/orders/${id}/aggregate`, seller.cookie)).json();
  await systemPrisma.user.update({ where: { id: session.userId }, data: { companyId: null } });
  const noCompany = await call(`/api/orders/${id}/cancel`, session.cookie, undefined, "POST");
  expect(noCompany.status).toBe(409); expect(await noCompany.json()).toMatchObject({ code: "COMPANY_REQUIRED" });
  await systemPrisma.user.update({ where: { id: session.userId }, data: { companyId: session.companyId, emailVerified: false } });
  const unverified = await call(`/api/orders/${id}/cancel`, session.cookie, undefined, "POST");
  expect(unverified.status).toBe(403); expect(await unverified.json()).toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
  await systemPrisma.user.update({ where: { id: session.userId }, data: { emailVerified: true } });
  expect(await (await call(`/api/orders/${id}/aggregate`, seller.cookie)).json()).toEqual(before);
});

test("shipping HTTP schedules, dispatches once, rolls back failed transitions and isolates companies", async () => {
  const seller = await fixture("PE");
  const other = await fixture("CL");
  const patch = (orderId: string, body: unknown, cookie = seller.cookie) => call(`/api/orders/${orderId}/shipping`, cookie, body, "PATCH");
  const create = async () => {
    const id = randomUUID();
    const created = await call("/api/orders", seller.cookie, { id, scheduledDispatchDate: "2026-10-15", items: [{ variantId: seller.variantId, quantity: 1 }] }, "POST");
    expect(await created.json()).toMatchObject({ id, scheduledDispatchDate: "2026-10-15", shippedAt: null });
    return id;
  };
  const pay = async (id: string) => expect((await call(`/api/orders/${id}/payments`, seller.cookie,
    { paymentId: randomUUID(), amount: { amount: 10, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false })).status).toBe(200);

  const unpaid = await create();
  expect(await (await patch(unpaid, { scheduledDispatchDate: "2020-01-01" })).json()).toMatchObject({ scheduledDispatchDate: "2020-01-01" });
  expect((await patch(unpaid, { scheduledDispatchDate: "2026-02-30" })).status).toBe(400);
  expect((await patch(unpaid, {})).status).toBe(400);
  expect((await patch(unpaid, { scheduledDispatchDate: "2026-10-20" }, other.cookie)).status).toBe(404);
  expect((await patch(unpaid, { scheduledDispatchDate: "2026-10-20", status: "shipped" })).status).toBe(409);
  expect(await (await call(`/api/orders/${unpaid}/aggregate`, seller.cookie)).json()).toMatchObject({ scheduledDispatchDate: "2020-01-01", deliveryStatus: "pending" });
  expect(await (await patch(unpaid, { scheduledDispatchDate: null })).json()).toMatchObject({ scheduledDispatchDate: null });
  expect((await call(`/api/orders/${unpaid}/cancel`, seller.cookie, undefined, "POST")).status).toBe(200);
  expect((await patch(unpaid, { scheduledDispatchDate: "2026-10-20" })).status).toBe(409);

  const paid = await create();
  await pay(paid);
  const [first, second] = await Promise.all([patch(paid, { status: "shipped" }), patch(paid, { status: "shipped" })]);
  expect([first.status, second.status]).toEqual([200, 200]);
  const shippedAt = (await (await call(`/api/orders/${paid}/aggregate`, seller.cookie)).json()).shippedAt;
  expect(shippedAt).toEqual(expect.any(String));
  expect((await first.json()).shippedAt).toBe(shippedAt);
  expect((await second.json()).shippedAt).toBe(shippedAt);
  expect((await patch(paid, { scheduledDispatchDate: "2026-10-21" })).status).toBe(409);
  expect(await (await patch(paid, { status: "delivered" })).json()).toMatchObject({ shippedAt, deliveryStatus: "delivered" });

  const direct = await create();
  await pay(direct);
  expect(await (await patch(direct, { status: "delivered" })).json()).toMatchObject({ shippedAt: null, deliveryStatus: "delivered" });
});

test("reading mixed orders for label preparation never changes states, payments or dates", async () => {
  const seller = await fixture("PE");
  const location = { country: "PE", districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima" };
  const agency = { method: "agency", recipient: { name: "Ana", phone: "999", identity: { kind: "document", documentType: "national_id", document: "12345678" } },
    destination: location, pricing: { quotationId: randomUUID(), rateId: randomUUID(), optionId: randomUUID(), settingsVersion: 1 },
    courier: { id: shalomId, name: "Shalom" }, agency: { id: randomUUID(), name: "Agencia", address: "Av. 1", location },
    recordedBy: { kind: "seller", userId: seller.userId } };
  const base = { currency: "PEN", total: 10, itemsTotal: 10, stockDeducted: true, stockDeductedAt: new Date("2026-09-28T12:00:00.000Z"), sellerId: seller.userId, createdAt: new Date("2026-09-28T12:00:00.000Z") };
  const [complete, incomplete, shipped, cancelled] = [1, 2, 3, 4].map(() => randomUUID());
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.order.createMany({ data: [
      { ...base, id: complete, number: 2001n, scheduledDispatchDate: new Date("2026-10-05"), delivery: agency },
      { ...base, id: incomplete, number: 2002n },
      { ...base, id: shipped, number: 2003n, deliveryStatus: "shipped", shippedAt: new Date("2026-10-06T15:00:00.000Z"), delivery: agency },
      { ...base, id: cancelled, number: 2004n, cancelled: true, cancelledAt: new Date("2026-09-28T12:00:00.000Z"), delivery: agency },
    ] });
    await prisma.orderItem.createMany({ data: [complete, incomplete, shipped, cancelled].map((orderId) => ({ orderId, variantId: seller.variantId,
      productName: "Sample product", variantAttributes: {}, quantity: 1n, unitPrice: 10, subtotal: 10 })) });
  });
  const snapshot = () => withTenantIsolation(seller.companyId, async () => await prisma.order.findMany({ orderBy: { number: "asc" } }));
  const before = await snapshot();
  for (const id of [complete, incomplete, shipped, cancelled]) expect((await call(`/api/orders/${id}/aggregate`, seller.cookie)).status).toBe(200);
  for (const query of ["view=unpaid", "deliveryStatus=pending", `courierId=${shalomId}`, "unscheduled=true"]) expect((await call(`/api/orders/mixed?${query}`, seller.cookie)).status).toBe(200);
  expect(await snapshot()).toEqual(before);
});

test("seller list and detail do not include unconfirmed catalog orders, and include them after confirmation", async () => {
  const seller = await fixture("PE");
  const [open, completed] = [randomUUID(), randomUUID()];
  const enabledAt = new Date("2026-10-17T12:00:00.000Z");
  const base = { currency: "PEN", total: 10, itemsTotal: 10, sellerId: null, fromCatalog: true, checkoutEnabledAt: enabledAt, createdAt: enabledAt };
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.order.createMany({ data: [
      { ...base, id: open, number: 3001n },
      // Unreachable in practice; proves the legacy completed-sales list filters too.
      { ...base, id: completed, number: 3002n, completedAt: enabledAt },
    ] });
    await prisma.orderItem.createMany({ data: [open, completed].map((orderId) => ({ orderId, variantId: seller.variantId,
      productName: "Camisa", variantAttributes: {}, quantity: 1n, unitPrice: 10, subtotal: 10 })) });
  });
  const ids = async (path: string) => ((await (await call(path, seller.cookie)).json()).items as { id: string }[]).map((item) => item.id);
  const confirm = (orderId: string) => withTenantIsolation(seller.companyId, async () => {
    await prisma.orderBuyer.create({ data: { orderId, name: "Ana", phone: "+51999999999" } });
    await prisma.order.update({ where: { id: orderId }, data: { checkoutConfirmedAt: new Date() } });
  });

  expect(await ids("/api/orders/mixed")).toEqual([]);
  expect(await ids("/api/orders")).toEqual([]);
  for (const path of [`/api/orders/${open}`, `/api/orders/${open}/aggregate`]) expect((await call(path, seller.cookie)).status).toBe(404);
  expect((await call(`/api/orders/${open}/cancel`, seller.cookie, {})).status).toBe(404);

  await confirm(open);
  expect(await ids("/api/orders/mixed")).toEqual([open]);
  const detail = await call(`/api/orders/${open}/aggregate`, seller.cookie);
  expect(detail.status).toBe(200);
  expect(orderAggregateSchema.parse(await detail.json())).toMatchObject({ source: "catalog", sellerId: null, number: 3001 });

  await confirm(completed);
  expect(await ids("/api/orders")).toEqual([completed]);
});

test("GET /api/orders/:id/aggregate returns the item's mentioned price", async () => {
  const seller = await fixture("PE");
  const orderId = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, items: [{ variantId: seller.variantId, quantity: 2 }] })).status).toBe(201);
  const unpriced = orderAggregateSchema.parse(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json());
  expect(unpriced.items.map((item) => item.mentionedPrice)).toEqual([null]);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.orderItem.updateMany({ where: { orderId }, data: { mentionedPriceAmount: "7.5", mentionedPriceUnits: 2 } });
  });
  const priced = orderAggregateSchema.parse(await (await call(`/api/orders/${orderId}/aggregate`, seller.cookie)).json());
  expect(priced.items[0]?.mentionedPrice).toEqual({ amount: { amount: 7.5, currency: "PEN" }, units: 2 });
});

async function reportedOrder(seller: Awaited<ReturnType<typeof fixture>>, quantity = 1) {
  const orderId = randomUUID();
  const paymentId = randomUUID();
  const imageId = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id: orderId, items: [{ variantId: seller.variantId, quantity }] }, "POST")).status).toBe(201);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.order.update({ where: { id: orderId }, data: { checkoutEnabledAt: new Date(), checkoutConfirmedAt: new Date(),
      buyer: { create: { name: "Ana", phone: "+51987654321" } } } });
    await prisma.image.create({ data: { id: imageId, storageKey: `test/${imageId}` } });
  });
  const buyerPath = `/api/buyer/orders/${orderId}`;
  const buyer = buyerCallFor(seller.companyId);
  expect((await buyer(`${buyerPath}/reports`, undefined, { paymentId, receiptImageId: imageId }, "POST")).status).toBe(201);
  return { orderId, paymentId, imageId, buyerPath, buyer, reject: (cookie: string, reason: string | null = null, id = paymentId) =>
    call(`/api/orders/${orderId}/payments/${id}/reject`, cookie, { reason }, "POST") };
}

const confirmBody = (paymentId: string, amount = 10) => ({ paymentId, source: "buyer_report", amount: { amount, currency: "PEN" }, method: "bank_transfer", deductStockIfPartial: false });

test("POST reject marks a reported payment rejected and keeps the balance", async () => {
  const seller = await fixture("PE");
  const report = await reportedOrder(seller);
  const stockBefore = await withTenantIsolation(seller.companyId, async () => await prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } }));
  const info = vi.spyOn(log, "info");
  const rejected = await report.reject(seller.cookie, "  El monto no coincide ");
  expect(rejected.status).toBe(200);
  const body = orderAggregateSchema.parse(await rejected.json());
  expect(body).toMatchObject({ paymentStatus: "pending", paidAmount: { amount: 0 }, balanceDue: { amount: 10 }, stockDeducted: false, completedAt: null,
    payments: [{ id: report.paymentId, status: "rejected", amount: null, method: null, currency: "PEN",
      data: { reason: "El monto no coincide", rejectedBy: seller.userId, report: { receiptImageId: report.imageId } } }] });
  await withTenantIsolation(seller.companyId, async () => {
    expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: seller.variantId } })).quantity).toBe(stockBefore.quantity);
    expect(await prisma.payment.count()).toBe(1);
  });
  expect(info.mock.calls.map(([entry]) => entry)).toContainEqual({ event: "payment_rejected", companyId: seller.companyId, userId: seller.userId,
    orderId: report.orderId, paymentId: report.paymentId, hasReason: true });
  expect((await call(`/api/orders/${report.orderId}/payments/${report.paymentId}/reject`, seller.cookie, { reason: "x".repeat(1001) }, "POST")).status).toBe(400);
  expect((await call(`/api/orders/${report.orderId}/payments/${report.paymentId}/reject`, seller.cookie, { }, "POST")).status).toBe(400);
});

test("POST reject answers 422 INVALID_PAYMENT for a reason longer than 200 characters", async () => {
  const seller = await fixture("PE");
  const report = await reportedOrder(seller);
  const response = await report.reject(seller.cookie, "x".repeat(201));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ code: "INVALID_PAYMENT" });
  expect((await report.reject(seller.cookie, "   ")).status).toBe(200);
});

test("POST reject answers 409 PAYMENT_CONFLICT for a confirmed payment", async () => {
  const seller = await fixture("PE");
  const report = await reportedOrder(seller);
  expect((await call(`/api/orders/${report.orderId}/payments`, seller.cookie, confirmBody(report.paymentId), "POST")).status).toBe(200);
  const response = await report.reject(seller.cookie, "tarde");
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "PAYMENT_CONFLICT" });
  expect((await report.reject(seller.cookie, null, randomUUID())).status).toBe(404);
});

test("POST reject answers 409 ORDER_CANCELLED in a cancelled order", async () => {
  const seller = await fixture("PE");
  const report = await reportedOrder(seller);
  expect((await call(`/api/orders/${report.orderId}/cancel`, seller.cookie, undefined, "POST")).status).toBe(200);
  const response = await report.reject(seller.cookie);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "ORDER_CANCELLED" });
});

test("POST reject answers 404 for an order of another company", async () => {
  const seller = await fixture("PE");
  const other = await fixture("CL");
  const report = await reportedOrder(seller);
  const response = await report.reject(other.cookie);
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: "ORDER_NOT_FOUND" });
  expect((await call(`/api/orders/${report.orderId}/payments/${report.paymentId}/reject`, undefined, { reason: null }, "POST")).status).toBe(401);
  await withTenantIsolation(seller.companyId, async () =>
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: report.paymentId } })).status).toBe("reported"));
});

test("repeating POST reject returns the same rejection", async () => {
  const seller = await fixture("PE");
  const report = await reportedOrder(seller);
  const first = await report.reject(seller.cookie, "Primero");
  const debug = vi.spyOn(log, "debug");
  const again = await report.reject(seller.cookie, "Otro motivo");
  expect(again.status).toBe(200);
  expect(await again.json()).toEqual(await first.json());
  expect(debug.mock.calls.map(([entry]) => entry)).toContainEqual({ event: "payment_operation_replayed", operation: "reject", paymentId: report.paymentId });
  expect((await report.reject(seller.cookie, "x".repeat(300))).status).toBe(200);
});

test("confirming a rejected payment answers 409 PAYMENT_CONFLICT", async () => {
  const seller = await fixture("PE");
  const report = await reportedOrder(seller);
  expect((await report.reject(seller.cookie, "No coincide")).status).toBe(200);
  const response = await call(`/api/orders/${report.orderId}/payments`, seller.cookie, confirmBody(report.paymentId), "POST");
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "PAYMENT_CONFLICT" });
  await withTenantIsolation(seller.companyId, async () =>
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: report.paymentId } })).status).toBe("rejected"));
});

test("POST void of a rejected payment answers 409 INVALID_TRANSITION", async () => {
  const seller = await fixture("PE");
  const report = await reportedOrder(seller);
  expect((await report.reject(seller.cookie)).status).toBe(200);
  const response = await call(`/api/orders/${report.orderId}/payments/${report.paymentId}/void`, seller.cookie, undefined, "POST");
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "INVALID_TRANSITION" });
});

test("buyer view exposes the rejected status, its reason and rejectedReport", async () => {
  const seller = await fixture("PE");
  const report = await reportedOrder(seller);
  const pending = await (await report.buyer(`${report.buyerPath}/payment`)).json();
  expect(pending).toMatchObject({ payments: [{ id: report.paymentId, status: "reported", rejectionReason: null }], rejectedReport: null });
  expect((await report.reject(seller.cookie, "El monto no coincide")).status).toBe(200);
  const view = await report.buyer(`${report.buyerPath}/payment`);
  expect(view.status).toBe(200);
  expect(buyerPaymentViewSchema.parse(await view.json())).toMatchObject({ balanceDue: { amount: 10 },
    payments: [{ id: report.paymentId, status: "rejected", amount: null, method: null, rejectionReason: "El monto no coincide" }],
    rejectedReport: { reason: "El monto no coincide" } });
  const newPaymentId = randomUUID();
  const newImageId = randomUUID();
  await withTenantIsolation(seller.companyId, async () => { await prisma.image.create({ data: { id: newImageId, storageKey: `test/${newImageId}` } }); });
  expect((await report.buyer(`${report.buyerPath}/reports`, undefined, { paymentId: newPaymentId, receiptImageId: newImageId }, "POST")).status).toBe(201);
  expect(await (await report.buyer(`${report.buyerPath}/payment`)).json()).toMatchObject({ rejectedReport: null,
    payments: expect.arrayContaining([expect.objectContaining({ status: "rejected" }), expect.objectContaining({ id: newPaymentId, status: "reported" })]) });
});

test("buyer view carries the report date of reported, rejected and report-confirmed payments and null for a manual payment", async () => {
  const seller = await fixture("PE");
  const report = await reportedOrder(seller, 4);
  const reportedAt = (id: string, view: { payments: Array<{ id: string; reportedAt: string | null }> }) => view.payments.find((payment) => payment.id === id)?.reportedAt;
  const viewOf = async () => buyerPaymentViewSchema.parse(await (await report.buyer(`${report.buyerPath}/payment`)).json());
  const pending = reportedAt(report.paymentId, await viewOf());
  expect(pending).toEqual(expect.any(String));
  expect(Math.abs(Date.now() - new Date(pending!).getTime())).toBeLessThan(60_000);
  expect((await report.reject(seller.cookie, "No coincide")).status).toBe(200);
  expect(reportedAt(report.paymentId, await viewOf())).toBe(pending);
  const secondId = randomUUID();
  const secondImageId = randomUUID();
  await withTenantIsolation(seller.companyId, async () => { await prisma.image.create({ data: { id: secondImageId, storageKey: `test/${secondImageId}` } }); });
  expect((await report.buyer(`${report.buyerPath}/reports`, undefined, { paymentId: secondId, receiptImageId: secondImageId }, "POST")).status).toBe(201);
  const second = reportedAt(secondId, await viewOf());
  expect(second).toEqual(expect.any(String));
  expect((await call(`/api/orders/${report.orderId}/payments`, seller.cookie, confirmBody(secondId), "POST")).status).toBe(200);
  expect(reportedAt(secondId, await viewOf())).toBe(second);
  const manualId = randomUUID();
  expect((await call(`/api/orders/${report.orderId}/payments`, seller.cookie, { ...confirmBody(manualId, 5), source: "manual" }, "POST")).status).toBe(200);
  expect(reportedAt(manualId, await viewOf())).toBeNull();
});

test("buyer view resolves the bank transfer image and every receipt url with one image lookup", async () => {
  const seller = await fixture("PE");
  const report = await reportedOrder(seller);
  expect((await report.reject(seller.cookie)).status).toBe(200);
  const secondImageId = randomUUID();
  const bankImageId = randomUUID();
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.image.create({ data: { id: secondImageId, storageKey: `test/${secondImageId}` } });
    await prisma.image.create({ data: { id: bankImageId, storageKey: `test/${bankImageId}` } });
    await prisma.companyPaymentSettings.create({ data: { companyId: seller.companyId, settings: [{ method: "bank_transfer", bank: "BCP", holder: "Ana",
      accountNumber: "1234", cci: null, imageId: bankImageId }] } });
  });
  expect((await report.buyer(`${report.buyerPath}/reports`, undefined, { paymentId: randomUUID(), receiptImageId: secondImageId }, "POST")).status).toBe(201);
  const findMany = vi.spyOn(imageRepository, "findMany");
  const find = vi.spyOn(imageRepository, "find");
  const view = await report.buyer(`${report.buyerPath}/payment`);
  expect(view.status).toBe(200);
  expect(findMany).toHaveBeenCalledTimes(1);
  expect(findMany.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([bankImageId, report.imageId, secondImageId]));
  expect(find).not.toHaveBeenCalled();
  expect(await view.json()).toMatchObject({ settings: [{ method: "bank_transfer", bank: "BCP" }], payments: expect.arrayContaining([expect.objectContaining({ status: "rejected" }), expect.objectContaining({ status: "reported" })]) });
});

test("buyer view drops a wallet whose image url does not resolve", async () => {
  const seller = await fixture("PE");
  const report = await reportedOrder(seller);
  const bankImageId = randomUUID();
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.image.create({ data: { id: bankImageId, storageKey: `test/${bankImageId}` } });
    await prisma.companyPaymentSettings.create({ data: { companyId: seller.companyId, settings: [
      { method: "digital_wallet", provider: "Yape", holder: "Ana", qr: { status: "verified", imageId: randomUUID() } },
      { method: "bank_transfer", bank: "BCP", holder: "Ana", accountNumber: "1234", cci: null, imageId: bankImageId }] } });
  });
  const view = await report.buyer(`${report.buyerPath}/payment`);
  expect(view.status).toBe(200);
  const parsed = buyerPaymentViewSchema.parse(await view.json());
  expect(parsed.settings.map((setting) => setting.method)).toEqual(["bank_transfer"]);
});

test("repeating a buyer report after its rejection returns the rejected payment", async () => {
  const seller = await fixture("PE");
  const report = await reportedOrder(seller);
  expect((await report.reject(seller.cookie, "No coincide")).status).toBe(200);
  const replay = await report.buyer(`${report.buyerPath}/reports`, undefined, { paymentId: report.paymentId, receiptImageId: report.imageId }, "POST");
  expect(replay.status).toBe(201);
  await withTenantIsolation(seller.companyId, async () => {
    expect(await prisma.payment.count()).toBe(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: report.paymentId } })).status).toBe("rejected");
  });
  expect(await (await report.buyer(`${report.buyerPath}/payment`)).json()).toMatchObject({ payments: [{ id: report.paymentId, status: "rejected" }], rejectedReport: { reason: "No coincide" } });
  const otherImageId = randomUUID();
  await withTenantIsolation(seller.companyId, async () => { await prisma.image.create({ data: { id: otherImageId, storageKey: `test/${otherImageId}` } }); });
  expect((await report.buyer(`${report.buyerPath}/reports`, undefined, { paymentId: report.paymentId, receiptImageId: otherImageId }, "POST")).status).toBe(409);
});

test("repeating a manual payment after a lost response keeps a single payment", async () => {
  const seller = await fixture("PE");
  const id = randomUUID();
  const paymentId = randomUUID();
  expect((await call("/api/orders/pending", seller.cookie, { id, items: [{ variantId: seller.variantId, quantity: 4 }] })).status).toBe(201);
  const manual = { paymentId, source: "manual", amount: { amount: 15, currency: "PEN" }, method: "bank_transfer", deductStockIfPartial: false };
  const first = await call(`/api/orders/${id}/payments`, seller.cookie, manual, "POST");
  expect(first.status).toBe(200);
  // The seller never saw that answer and presses «Confirmar pago» again with the same open form.
  const repeated = await call(`/api/orders/${id}/payments`, seller.cookie, manual, "POST");
  expect(repeated.status).toBe(200);
  expect(await repeated.json()).toMatchObject({ order: { paidAmount: { amount: 15 }, balanceDue: { amount: 25 }, payments: [{ id: paymentId, status: "confirmed" }] } });
  await withTenantIsolation(seller.companyId, async () => {
    expect(await prisma.payment.count({ where: { orderId: id } })).toBe(1);
  });
});

test("the deduct-stock route no longer exists", async () => {
  const seller = await fixture("PE");
  const id = randomUUID();
  expect((await call("/api/orders", seller.cookie, { id, items: [{ variantId: seller.variantId, quantity: 1 }] }, "POST")).status).toBe(201);
  expect((await call(`/api/orders/${id}/deduct-stock`, seller.cookie, undefined, "POST")).status).toBe(404);
});

test("every order detail response carries stockDue with the current available units", async () => {
  const seller = await fixture("PE");
  const id = randomUUID();
  expect((await call("/api/orders", seller.cookie, { id, items: [{ variantId: seller.variantId, quantity: 4 }] }, "POST")).status).toBe(201);
  expect(await (await call(`/api/orders/${id}/aggregate`, seller.cookie)).json()).toMatchObject({ stockDeducted: false, stockDue: null });
  const recorded = await call(`/api/orders/${id}/payments`, seller.cookie, { paymentId: randomUUID(), amount: { amount: 40, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, "POST");
  expect(recorded.status).toBe(200);
  const waiting = { kind: "waiting", shortItems: [{ variantId: seller.variantId, available: 3 }] };
  expect(await (await call(`/api/orders/${id}/aggregate`, seller.cookie)).json()).toMatchObject({ stockDeducted: false, stockDue: waiting });
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.productStock.update({ where: { variantId: seller.variantId }, data: { quantity: 2n } });
  });
  expect(await (await call(`/api/orders/${id}/aggregate`, seller.cookie)).json()).toMatchObject({ stockDue: { kind: "waiting", shortItems: [{ available: 2 }] } });
  // The paid list summary never exposes it and never reads stock.
  const list = await (await call("/api/orders/mixed", seller.cookie)).json();
  expect(list.items.flatMap((item: object) => Object.keys(item))).not.toContain("stockDue");
});

test("a queued sale with the old deferral option is saved as a plain save", async () => {
  const seller = await fixture("PE");
  const id = randomUUID();
  const created = await call("/api/orders", seller.cookie, { id, items: [{ variantId: seller.variantId, quantity: 4 }], deferStockDeduction: true,
    payments: [{ paymentId: randomUUID(), amount: { amount: 40, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }] }, "POST");
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({ id, paymentStatus: "paid", stockDeducted: false, stockDue: { kind: "waiting", shortItems: [{ available: 3 }] } });
});
