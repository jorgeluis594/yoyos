import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
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
      await prisma.orderItem.deleteMany();
      await prisma.order.deleteMany();
      await prisma.contact.deleteMany();
      await prisma.productStock.deleteMany();
      await prisma.productVariant.deleteMany();
      await prisma.product.deleteMany();
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

test("orders HTTP requires authentication", async () => {
  const anonymous = await call("/api/orders");
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get("cache-control")).toBe("no-store");
});

test("orders HTTP lets a Chile company complete sales, returns historical data, and isolates other companies", async () => {
  const seller = await fixture("CL");
  const other = await fixture("PE");
  const id = randomUUID();
  const input = { id, contactId: seller.contactId, items: [{ variantId: seller.variantId, quantity: 2 }] };
  const created = await call("/api/orders", seller.cookie, input, "POST");
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({ id, companyId: seller.companyId, sellerId: seller.userId,
    total: 20, currency: "PEN", customer: { kind: "contact", name: "Ana", phone: "+51999999999" },
    items: [{ productName: "Camisa", variantAttributes: { Talla: "M" }, quantity: 2, unitPrice: 10, subtotal: 20 }] });
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
  const list = await call(`/api/orders?customer=contact&contactId=${seller.contactId}`, seller.cookie);
  expect(await list.json()).toMatchObject({ total: 1, page: 1, pageSize: 20, items: [{ id, total: 20 }] });
  expect(await (await call("/api/orders", other.cookie)).json()).toMatchObject({ total: 0, items: [] });
  expect(await (await call("/api/orders/catalog?search=Camisa", other.cookie)).json()).toMatchObject([{ id: other.productId }]);
  expect(await (await call("/api/orders/contacts?search=Ana", other.cookie)).json()).toMatchObject([{ id: other.contactId }]);
});

test("orders HTTP rejects invalid input and stock without partial sale", async () => {
  const seller = await fixture("PE");
  const input = { id: randomUUID(), contactId: null, items: [{ variantId: seller.variantId, quantity: 4 }] };
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
});

test("orders HTTP combines contact and Lima-day UTC bounds with stable pages and capped search", async () => {
  const seller = await fixture("PE");
  const ids = Array.from({ length: 21 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.order.createMany({ data: ids.map((id) => ({ id, sellerId: seller.userId, contactId: seller.contactId,
      contactName: "Ana", contactPhone: "+51999999999", currency: "PEN", total: 10,
      paymentMethod: "digital_wallet", completedAt: new Date("2026-09-28T12:00:00.000Z") })) });
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
