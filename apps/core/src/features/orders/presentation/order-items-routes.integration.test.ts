import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { editOrderItemsErrorSchema, editOrderItemsResponseSchema } from "@shared/contracts/order-items-edit";
import { orderAggregateSchema } from "@shared/contracts/orders";
import { app } from "@core/src/app";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { deleteSeededProducts, seedProduct } from "@core/src/features/products/infrastructure/product-seed";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Order items test server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const cleanups: (() => Promise<void>)[] = [];

async function call(path: string, cookie: string, input?: unknown, method?: string) {
  return fetch(`${base}${path}`, { method: method ?? (input === undefined ? "GET" : "POST"), headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}

/** A signed-in seller with an open order of «Polo básico» ×3 and a «Gorra» ×1. */
async function openOrder() {
  const companyId = randomUUID();
  const email = `order-items-${randomUUID()}@example.test`;
  const password = "test-password-123";
  await withTenantIsolation(companyId, async () => { await prisma.company.create({ data: { id: companyId, name: "Order items", country: "PE" } }); });
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: "Seller", email, password }) });
  expect(signup.status).toBe(200);
  const userId = (await signup.json()).user.id as string;
  await systemPrisma.user.update({ where: { id: userId }, data: { emailVerified: true, companyId } });
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Order items test session missing");
  const { poloId, gorraId } = await withTenantIsolation(companyId, async () => {
    const polo = await seedProduct({ name: "Polo básico", variants: [{ attributes: { Talla: "M" }, salePrice: 30, stock: 10 }] });
    const gorra = await seedProduct({ name: "Gorra trucker", variants: [{ attributes: { Color: "Negro" }, salePrice: 20, stock: 10 }] });
    return { poloId: polo.variantIds[0]!, gorraId: gorra.variantIds[0]! };
  });
  cleanups.push(async () => {
    await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany(); await deleteSeededProducts();
      await systemPrisma.user.delete({ where: { id: userId } }); await prisma.company.delete({ where: { id: companyId } });
    });
  });
  const orderId = randomUUID();
  expect((await call("/api/orders/pending", cookie, { id: orderId, items: [{ variantId: poloId, quantity: 3 }, { variantId: gorraId, quantity: 1 }] }, "POST")).status).toBe(201);
  const aggregate = async () => orderAggregateSchema.parse(await (await call(`/api/orders/${orderId}/aggregate`, cookie)).json());
  return { companyId, cookie, orderId, poloId, gorraId, aggregate };
}

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await systemPrisma.$disconnect();
});

test("PATCH items lowers a quantity and removes a line with the edit's revisions and locks", async () => {
  const seller = await openOrder();
  const loaded = await seller.aggregate();
  const baseRevision = loaded.revisions?.items;
  expect(baseRevision).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const edit = { version: 1, base: baseRevision, lines: [{ variantId: seller.poloId, quantity: 2 }] };

  const saved = await call(`/api/orders/${seller.orderId}/items`, seller.cookie, edit, "PATCH");
  expect(saved.status).toBe(200);
  const body = editOrderItemsResponseSchema.parse(await saved.json());
  expect(body.applied).toEqual(["items"]);
  expect(body.order.items.map((item) => [item.productName, item.quantity])).toEqual([["Polo básico", 2]]);
  expect(body.order.itemsTotal).toEqual({ amount: 60, currency: "PEN" });
  expect(body.order.revisions.items).toBe(body.revisions.items);
  expect(body.revisions.items).not.toBe(baseRevision);
  expect((await seller.aggregate()).revisions.items).toBe(body.revisions.items);

  // The same final state is a repeat: nothing is applied, nothing is refused.
  const repeated = editOrderItemsResponseSchema.parse(await (await call(`/api/orders/${seller.orderId}/items`, seller.cookie, edit, "PATCH")).json());
  expect(repeated.applied).toEqual([]);

  // The same variant twice is the client's mistake, not a server failure.
  const duplicated = await call(`/api/orders/${seller.orderId}/items`, seller.cookie, { ...edit, base: body.revisions.items, lines: [{ variantId: seller.poloId, quantity: 1 }, { variantId: seller.poloId, quantity: 2 }] }, "PATCH");
  expect(duplicated.status).toBe(400);
  expect(editOrderItemsErrorSchema.parse(await duplicated.json())).toMatchObject({ code: "INVALID_INPUT" });

  // A cancelled order is locked.
  expect((await call(`/api/orders/${seller.orderId}/cancel`, seller.cookie, undefined, "POST")).status).toBe(200);
  const locked = await call(`/api/orders/${seller.orderId}/items`, seller.cookie, { ...edit, base: body.revisions.items, lines: [{ variantId: seller.poloId, quantity: 1 }] }, "PATCH");
  expect(locked.status).toBe(409);
  expect(editOrderItemsErrorSchema.parse(await locked.json())).toMatchObject({ code: "ORDER_CANCELLED" });

  // Malformed edits and unknown orders.
  expect((await call(`/api/orders/${seller.orderId}/items`, seller.cookie, { version: 1, base: "x", lines: [] }, "PATCH")).status).toBe(400);
  expect((await call(`/api/orders/${randomUUID()}/items`, seller.cookie, edit, "PATCH")).status).toBe(404);
});

test("PATCH items answers ORDER_CHANGED when a message changed the items meanwhile", async () => {
  const seller = await openOrder();
  const loaded = await seller.aggregate();
  // What a message does meanwhile: the stored lines change under the seller's loaded revision.
  await withTenantIsolation(seller.companyId, async () => {
    await prisma.orderItem.updateMany({ where: { orderId: seller.orderId, variantId: seller.gorraId }, data: { quantity: 2, subtotal: 40 } });
    await prisma.order.update({ where: { id: seller.orderId }, data: { itemsTotal: 130, total: 130 } });
  });
  const stale = await call(`/api/orders/${seller.orderId}/items`, seller.cookie, { version: 1, base: loaded.revisions?.items, lines: [{ variantId: seller.poloId, quantity: 2 }] }, "PATCH");
  expect(stale.status).toBe(409);
  expect(editOrderItemsErrorSchema.parse(await stale.json())).toMatchObject({ code: "ORDER_CHANGED" });
  const after = await seller.aggregate();
  expect(after.items.map((item) => [item.productName, item.quantity])).toEqual([["Polo básico", 3], ["Gorra trucker", 2]]);
  expect(after.revisions?.items).not.toBe(loaded.revisions?.items);
});
