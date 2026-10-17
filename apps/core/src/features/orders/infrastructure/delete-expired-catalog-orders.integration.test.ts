import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterEach, expect, test } from "vitest";
import { ok } from "@shared/functional";
import { deleteConfiguredExpiredCatalogOrders } from "@core/src/features/orders/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

// Rows live in 2001 so the sweep cannot touch data of tests running in parallel.
const now = new Date("2001-01-10T09:00:00.000Z");
const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function company() {
  const companyId = randomUUID();
  const sellerId = randomUUID();
  const variantId = randomUUID();
  let number = 1000n;
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Cleanup test", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    const productId = randomUUID();
    await prisma.product.create({ data: { id: productId, name: "Polo", currency: "PEN", qrCode: productId, status: "active", createdAt: now, updatedAt: now } });
    await prisma.productVariant.create({ data: { id: variantId, productId, attributes: {}, salePrice: 10, qrCode: variantId, status: "active" } });
  });
  cleanups.push(() => withTenantIsolation(companyId, async () => {
    await prisma.payment.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await systemPrisma.user.delete({ where: { id: sellerId } });
    await prisma.company.delete({ where: { id: companyId } });
  }));
  const order = (values: Readonly<{ createdAt: Date; fromCatalog?: boolean; confirmed?: boolean }>) => withTenantIsolation(companyId, async () => {
    const id = randomUUID();
    const catalog = values.fromCatalog ?? true;
    await prisma.order.create({ data: { id, number: number += 1n, currency: "PEN", total: 10, itemsTotal: 10, createdAt: values.createdAt,
      fromCatalog: catalog, sellerId: catalog ? null : sellerId, checkoutEnabledAt: catalog ? values.createdAt : null,
      checkoutConfirmedAt: values.confirmed ? values.createdAt : null } });
    await prisma.orderItem.create({ data: { orderId: id, variantId, productName: "Polo", variantAttributes: {}, quantity: 1n, unitPrice: 10, subtotal: 10 } });
    return id;
  });
  const remaining = () => withTenantIsolation(companyId, async () => ({
    orders: (await prisma.order.findMany({ select: { id: true }, orderBy: { number: "asc" } })).map((row) => row.id),
    items: (await prisma.orderItem.findMany({ select: { orderId: true } })).map((row) => row.orderId).sort(),
  }));
  return { companyId, order, remaining };
}

test("cleanup deletes unconfirmed catalog orders older than the cutoff with their items and keeps newer ones, confirmed ones and non-catalog orders", async () => {
  const store = await company();
  await store.order({ createdAt: daysAgo(8) });
  const kept = [await store.order({ createdAt: daysAgo(6) }), await store.order({ createdAt: daysAgo(30), confirmed: true }),
    await store.order({ createdAt: daysAgo(30), fromCatalog: false })];

  const result = await deleteConfiguredExpiredCatalogOrders({ cutoff });

  expect(result).toMatchObject({ success: true, data: { deleted: 1, failedCompanies: 0 } });
  expect(await store.remaining()).toEqual({ orders: kept, items: [...kept].sort() });
});

test("cleanup skips an order locked by a confirmation in progress", async () => {
  const store = await company();
  const orderId = await store.order({ createdAt: daysAgo(8) });
  const buyer = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await buyer.connect();
  try {
    await buyer.query("BEGIN");
    await buyer.query("SELECT set_config('app.company_id', $1, true)", [store.companyId]);
    await buyer.query(`SELECT id FROM "Order" WHERE id = $1 FOR UPDATE`, [orderId]);

    expect(await deleteConfiguredExpiredCatalogOrders({ cutoff })).toMatchObject({ success: true, data: { failedCompanies: 0 } });

    await buyer.query(`UPDATE "Order" SET "checkoutConfirmedAt" = now() WHERE id = $1`, [orderId]);
    await buyer.query("COMMIT");
  } finally { await buyer.end(); }
  expect(await deleteConfiguredExpiredCatalogOrders({ cutoff })).toMatchObject({ success: true, data: { failedCompanies: 0 } });
  expect((await store.remaining()).orders).toEqual([orderId]);
  const confirmed = await withTenantIsolation(store.companyId, async () => await prisma.order.findUniqueOrThrow({ where: { id: orderId } }));
  expect(confirmed.checkoutConfirmedAt).not.toBeNull();
});

test("cleanup leaves orders with payments untouched", async () => {
  const store = await company();
  const orderId = await store.order({ createdAt: daysAgo(8) });
  await withTenantIsolation(store.companyId, async () => await prisma.payment.create({ data: { id: randomUUID(), orderId, amount: 10, currency: "PEN",
    method: "digital_wallet", status: "reported", data: { receiptImageId: randomUUID(), reportedAt: daysAgo(8).toISOString() } } }));

  expect(await deleteConfiguredExpiredCatalogOrders({ cutoff })).toEqual(ok({ companies: 1, deleted: 0, failedCompanies: 0 }));
  expect(await store.remaining()).toEqual({ orders: [orderId], items: [orderId] });
});
