import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test } from "vitest";
import { orders } from "@core/src/features/orders/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { ContactId } from "@core/src/features/orders/domain/order";

async function fixture() {
  const companyId = randomUUID();
  const sellerId = randomUUID();
  const productId = randomUUID();
  const variantIds = [randomUUID(), randomUUID()];
  const contactId = randomUUID();
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Orders test", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    await prisma.product.create({ data: { id: productId, name: "Sample product", currency: "PEN", qrCode: productId, status: "active", createdAt: new Date(), updatedAt: new Date() } });
    for (const [index, variantId] of variantIds.entries()) {
      await prisma.productVariant.create({ data: { id: variantId, productId, attributes: { Size: index ? "L" : "M" }, sku: `SKU-${variantId}`, salePrice: index ? 0.2 : 0.1, qrCode: variantId, status: "active" } });
      await prisma.productStock.create({ data: { variantId, quantity: 3n } });
    }
    await prisma.contact.create({ data: { id: contactId, phone: "+51999999999", name: null } });
  });
  return { companyId, sellerId, productId, variantIds, contactId, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      await prisma.orderItem.deleteMany();
      await prisma.order.deleteMany();
      await prisma.contact.deleteMany();
      await prisma.productStock.deleteMany();
      await prisma.productVariant.deleteMany();
      await prisma.product.deleteMany();
      await systemPrisma.user.delete({ where: { id: sellerId } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
}

test("persists completed sale, historical snapshots, listing and duplicate rejection", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID();
      const created = await orders.create({ id: orderId, contactId: f.contactId, items: [
        { variantId: f.variantIds[0], quantity: 3 }, { variantId: f.variantIds[1], quantity: 2 },
      ] }, { companyId: f.companyId, sellerId: f.sellerId });
      expect(created).toMatchObject({ success: true, data: { total: { amount: 0.7, currency: "PEN" },
        customer: { kind: "contact", name: null, phone: "+51999999999" } } });
      expect(await prisma.productStock.findMany({ orderBy: { variantId: "asc" } })).toHaveLength(2);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(0n);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[1] } })).quantity).toBe(1n);
      expect(await orders.create({ id: orderId, contactId: null, items: [{ variantId: f.variantIds[1], quantity: 1 }] }, { companyId: f.companyId, sellerId: f.sellerId }))
        .toMatchObject({ success: false, error: { code: "ORDER_ALREADY_EXISTS" } });
      await prisma.contact.update({ where: { id: f.contactId }, data: { phone: "+51888888888", name: "Changed" } });
      await prisma.product.update({ where: { id: f.productId }, data: { name: "Changed product" } });
      await prisma.productVariant.update({ where: { id: f.variantIds[0] }, data: { attributes: { Size: "XL" }, sku: `CHANGED-${f.variantIds[0]}`, salePrice: 3.5 } });
      const detail = await orders.get(orderId);
      expect(detail).toMatchObject({ success: true, data: { customer: { name: null, phone: "+51999999999" },
        items: expect.arrayContaining([expect.objectContaining({ productName: "Sample product", variantAttributes: { Size: "M" },
          sku: `SKU-${f.variantIds[0]}`, unitPrice: { amount: 0.1, currency: "PEN" }, subtotal: { amount: 0.3, currency: "PEN" } })]) } });
      const list = await orders.list({ page: 1, customer: { kind: "contact", contactId: f.contactId as ContactId } });
      expect(list).toMatchObject({ success: true, data: { total: 1, pageSize: 20, items: [{ id: orderId }] } });
      expect(await orders.list({ page: 1, customer: { kind: "contact", contactId: f.contactId as ContactId },
        completedFrom: new Date("2020-01-01"), completedBefore: new Date("2100-01-01") })).toMatchObject({ success: true, data: { total: 1 } });
      expect(await orders.list({ page: 1, customer: { kind: "general_public" } })).toMatchObject({ success: true, data: { total: 0, items: [] } });
      await expect(prisma.contact.delete({ where: { id: f.contactId } })).rejects.toThrow();
      await prisma.productStock.delete({ where: { variantId: f.variantIds[0] } });
      await expect(prisma.productVariant.delete({ where: { id: f.variantIds[0] } })).rejects.toThrow();
      await expect(prisma.product.delete({ where: { id: f.productId } })).rejects.toThrow();
      expect(await orders.get(orderId)).toMatchObject({ success: true });
    });
  } finally { await f.cleanup(); }
});

test("rolls back all writes and stock when a later item is unavailable", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const result = await orders.create({ id: randomUUID(), contactId: null, items: [
        { variantId: f.variantIds[0], quantity: 1 }, { variantId: f.variantIds[1], quantity: 4 },
      ] }, { companyId: f.companyId, sellerId: f.sellerId });
      expect(result).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK", variantId: f.variantIds[1] } });
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.orderItem.count()).toBe(0);
      expect((await prisma.productStock.findMany()).map(({ quantity }) => quantity)).toEqual([3n, 3n]);
    });
  } finally { await f.cleanup(); }
});

test("two simultaneous sales cannot consume the last stock twice", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      await prisma.productStock.update({ where: { variantId: f.variantIds[0] }, data: { quantity: 1n } });
      const results = await Promise.all([1, 2].map(() => orders.create({ id: randomUUID(), contactId: null,
        items: [{ variantId: f.variantIds[0], quantity: 1 }] }, { companyId: f.companyId, sellerId: f.sellerId })));
      expect(results.filter((result) => result.success)).toHaveLength(1);
      expect(results.filter((result) => !result.success).map((result) => !result.success && result.error.code)).toEqual(["INSUFFICIENT_STOCK"]);
      expect(await prisma.order.count()).toBe(1);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(0n);
    });
  } finally { await f.cleanup(); }
});

test("concurrent submissions of one order ID create only one sale", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID();
      const results = await Promise.all([1, 2].map(() => orders.create({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0], quantity: 1 }] }, { companyId: f.companyId, sellerId: f.sellerId })));
      expect(results.filter((result) => result.success)).toHaveLength(1);
      expect(results.filter((result) => !result.success).map((result) => !result.success && result.error.code)).toEqual(["ORDER_ALREADY_EXISTS"]);
      expect(await prisma.order.count()).toBe(1);
      expect(await prisma.orderItem.count()).toBe(1);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(2n);
    });
  } finally { await f.cleanup(); }
});

test("separates companies and blocks cross-company references", async () => {
  const a = await fixture();
  const b = await fixture();
  try {
    const foreignOrderId = randomUUID();
    await withTenantIsolation(b.companyId, async () => {
      expect(await orders.create({ id: foreignOrderId, contactId: b.contactId, items: [{ variantId: b.variantIds[0], quantity: 1 }] },
        { companyId: b.companyId, sellerId: b.sellerId })).toMatchObject({ success: true });
    });
    await withTenantIsolation(a.companyId, async () => {
      expect(await orders.get(foreignOrderId)).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
      expect(await orders.list({ page: 1, customer: { kind: "all" } })).toMatchObject({ success: true, data: { total: 0 } });
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.orderItem.count()).toBe(0);
      expect(await orders.create({ id: randomUUID(), contactId: b.contactId, items: [{ variantId: a.variantIds[0], quantity: 1 }] },
        { companyId: a.companyId, sellerId: a.sellerId })).toMatchObject({ success: false, error: { code: "CONTACT_NOT_FOUND" } });
      expect(await orders.create({ id: randomUUID(), contactId: null, items: [{ variantId: b.variantIds[0], quantity: 1 }] },
        { companyId: a.companyId, sellerId: a.sellerId })).toMatchObject({ success: false, error: { code: "VARIANT_NOT_FOUND", variantId: b.variantIds[0] } });
      expect(await orders.create({ id: foreignOrderId, contactId: null, items: [{ variantId: a.variantIds[0], quantity: 1 }] },
        { companyId: a.companyId, sellerId: a.sellerId })).toMatchObject({ success: false, error: { code: "ORDER_ALREADY_EXISTS" } });
      expect(await prisma.order.count()).toBe(0);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: a.variantIds[0] } })).quantity).toBe(3n);
      await expect(prisma.order.create({ data: { id: randomUUID(), companyId: a.companyId, sellerId: a.sellerId,
        contactId: b.contactId, contactPhone: "+51999999999", currency: "PEN", total: 1, paymentMethod: "digital_wallet", completedAt: new Date() } })).rejects.toThrow();
      await expect(prisma.orderItem.create({ data: { orderId: foreignOrderId, variantId: a.variantIds[0], productName: "Foreign order",
        variantAttributes: {}, quantity: 1n, unitPrice: 1, subtotal: 1 } })).rejects.toThrow();
    });
  } finally { await a.cleanup(); await b.cleanup(); }
});

test("lists 20 per page with stable tie ordering and exclusive end date", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      await prisma.productStock.update({ where: { variantId: f.variantIds[0] }, data: { quantity: 30n } });
      const completedAt = new Date("2026-09-27T12:00:00.000Z");
      for (let index = 0; index < 25; index++) {
        const id = randomUUID();
        expect(await orders.create({ id, contactId: null, items: [{ variantId: f.variantIds[0], quantity: 1 }] },
          { companyId: f.companyId, sellerId: f.sellerId })).toMatchObject({ success: true });
        await prisma.order.update({ where: { id }, data: { completedAt } });
      }
      const criteria = { customer: { kind: "all" as const }, completedFrom: completedAt, completedBefore: new Date("2026-09-27T12:00:00.001Z") };
      const first = await orders.list({ ...criteria, page: 1 });
      const second = await orders.list({ ...criteria, page: 2 });
      expect(first).toMatchObject({ success: true, data: { page: 1, pageSize: 20, total: 25 } });
      expect(second).toMatchObject({ success: true, data: { page: 2, pageSize: 20, total: 25 } });
      if (!first.success || !second.success) return;
      expect(first.data.items).toHaveLength(20);
      expect(second.data.items).toHaveLength(5);
      const ids = [...first.data.items, ...second.data.items].map((item) => item.id);
      expect(ids).toEqual([...ids].sort());
      expect(new Set(ids).size).toBe(25);
      expect(await orders.list({ ...criteria, page: 3 })).toMatchObject({ success: true, data: { items: [], total: 25 } });
      expect(await orders.list({ page: 1, customer: criteria.customer, completedBefore: completedAt })).toMatchObject({ success: true, data: { items: [], total: 0 } });
      expect(await orders.list({ page: 1, customer: criteria.customer, completedFrom: new Date("2026-09-27T12:00:00.001Z") })).toMatchObject({ success: true, data: { items: [], total: 0 } });
    });
  } finally { await f.cleanup(); }
});

test("rolls back order and items after a stock write fails", async () => {
  const f = await fixture();
  const adminUrl = new URL(process.env.DATABASE_URL!);
  adminUrl.username = "core";
  adminUrl.password = "core";
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl.toString() }) });
  const name = `reject_sale_${randomUUID().replaceAll("-", "")}`;
  try {
    await admin.$executeRawUnsafe(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."companyId" = '${f.companyId}'::uuid THEN RAISE EXCEPTION 'stock write rejected by test'; END IF; RETURN NEW; END $$`);
    await admin.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE UPDATE ON "ProductStock" FOR EACH ROW EXECUTE FUNCTION public.${name}()`);
    await withTenantIsolation(f.companyId, async () => {
      const result = await orders.create({ id: randomUUID(), contactId: null, items: [{ variantId: f.variantIds[0], quantity: 1 }] },
        { companyId: f.companyId, sellerId: f.sellerId });
      expect(result).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.orderItem.count()).toBe(0);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(3n);
    });
  } finally {
    await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "ProductStock"`);
    await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.${name}()`);
    await admin.$disconnect();
    await f.cleanup();
  }
});

test("database constraints reject invalid completed sale writes", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const id = randomUUID();
      expect(await orders.create({ id, contactId: null, items: [{ variantId: f.variantIds[0], quantity: 1 }] },
        { companyId: f.companyId, sellerId: f.sellerId })).toMatchObject({ success: true });
      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: id } });
      await expect(prisma.order.update({ where: { id }, data: { paymentMethod: "cash" } })).rejects.toThrow();
      await expect(prisma.order.update({ where: { id }, data: { total: 0 } })).rejects.toThrow();
      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { quantity: 0n } })).rejects.toThrow();
      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { quantity: BigInt(Number.MAX_SAFE_INTEGER) + 1n } })).rejects.toThrow();
      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { unitPrice: 0 } })).rejects.toThrow();
      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { subtotal: 0 } })).rejects.toThrow();
      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { variantAttributes: { Size: 42 } } })).rejects.toThrow();
      await expect(prisma.orderItem.create({ data: { orderId: id, variantId: f.variantIds[0], productName: "Duplicate", variantAttributes: {}, quantity: 1n, unitPrice: 1, subtotal: 1 } })).rejects.toThrow();
      expect(await prisma.orderItem.count()).toBe(1);
      expect(await prisma.order.findUniqueOrThrow({ where: { id } })).toMatchObject({ paymentMethod: "digital_wallet" });
    });
  } finally { await f.cleanup(); }
});
