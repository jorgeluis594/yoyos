import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { orders } from "@core/src/features/orders/composition";
import { prisma, systemPrisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { setOrderDelivery, type SetDeliveryDependencies } from "@core/src/features/orders/application/set-delivery";
import { findOrderAggregate, findOrderForUpdate, saveDelivery, saveStockDeduction } from "@core/src/features/orders/infrastructure/order-repository";
import { deductProductStock } from "@core/src/features/products";
import type { CompanyId, ContactId, OrderId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

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
      await prisma.payment.deleteMany();
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

test("persists a pending order without payment or stock effects", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID();
      const input = { id: orderId as OrderId, contactId: null, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] } as const;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      const created = await orders.create(input, context);
      expect(created).toMatchObject({ success: true, data: { completedAt: null, payments: [], stockDeducted: false } });
      if (!created.success) throw new Error("Expected valid pending order");
      const saved = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, payments: true } });
      expect(saved).toMatchObject({ completedAt: null, paymentMethod: null, createdAt: created.data.createdAt, cancelled: false,
        delivery: null, deliveryStatus: "pending", stockDeducted: false, payments: [] });
      expect(saved.total.toNumber()).toBe(0.2);
      expect(saved.itemsTotal.toNumber()).toBe(0.2);
      expect(saved.items).toMatchObject([{ productName: "Sample product", variantAttributes: { Size: "M" } }]);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(3n);
      expect(await orders.create(input, context)).toMatchObject({ success: false, error: { code: "ORDER_ALREADY_EXISTS" } });
      expect(await prisma.payment.count()).toBe(0);
      expect(await findOrderAggregate(input.id, context.companyId)).toMatchObject({ success: true,
        data: { id: orderId, completedAt: null, payments: [], total: { amount: 0.2, currency: "PEN" } } });
      expect(await withinTransaction(() => findOrderForUpdate(input.id, context.companyId))).toMatchObject({ success: true,
        data: { id: orderId, stockDeducted: false } });
      await expect(findOrderForUpdate(input.id, context.companyId)).rejects.toThrow("active transaction");
      expect(await orders.deductStock(input.id, context)).toMatchObject({ success: true, data: { stockDeducted: false } });
      await prisma.payment.create({ data: { id: randomUUID(), orderId, companyId: f.companyId,
        amount: 0.2, currency: "PEN", method: "digital_wallet", recordedAt: new Date() } });
      expect(await orders.deductStock(input.id, context)).toMatchObject({ success: true, data: { stockDeducted: true } });
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(1n);
      expect(await orders.deductStock(input.id, context)).toMatchObject({ success: true, data: { stockDeducted: true } });
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(1n);
    });
  } finally { await f.cleanup(); }
});

test("reports incompatible stored payments instead of returning an invalid aggregate", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      expect(await orders.create({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      await prisma.payment.create({ data: { id: randomUUID(), orderId, companyId: f.companyId,
        amount: 0.1, currency: "USD", method: "digital_wallet", recordedAt: new Date() } });
      expect(await orders.getAggregate(orderId, context)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
      expect(await orders.listAggregates({ page: 1, customer: { kind: "all" } }, context))
        .toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
    });
  } finally { await f.cleanup(); }
});

test("keeps all stock when a pending order cannot deduct every item", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      expect(await orders.create({ id: orderId, contactId: null, items: [
        { variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger },
        { variantId: f.variantIds[1] as VariantId, quantity: 4 as PositiveInteger },
      ] }, context)).toMatchObject({ success: true });
      await prisma.payment.create({ data: { id: randomUUID(), orderId, companyId: f.companyId,
        amount: 1, currency: "PEN", method: "digital_wallet", recordedAt: new Date() } });
      expect(await orders.deductStock(orderId, context)).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK" } });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stockDeducted).toBe(false);
      expect((await prisma.productStock.findMany({ orderBy: { variantId: "asc" } })).map((stock) => stock.quantity)).toEqual([3n, 3n]);
    });
  } finally { await f.cleanup(); }
});

test("preserves a recorded payment when stock is short and retries its ID after replenishment", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      expect(await orders.create({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 4 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      const input = { orderId, paymentId: randomUUID() as PaymentId, amount: { amount: 0.4, currency: "PEN" as const },
        method: "digital_wallet" as const, deductStockIfPartial: false };
      expect(await orders.registerPayment(input, context)).toMatchObject({ success: true,
        data: { stock: { kind: "pending", reason: "INSUFFICIENT_STOCK" }, order: { payments: [{ id: input.paymentId }] } } });
      expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(3n);
      await prisma.productStock.update({ where: { variantId: f.variantIds[0] }, data: { quantity: { increment: 1n } } });
      expect(await orders.registerPayment(input, context)).toMatchObject({ success: true,
        data: { stock: { kind: "deducted" }, order: { stockDeducted: true } } });
      expect(await orders.registerPayment(input, context)).toMatchObject({ success: true, data: { stock: { kind: "deducted" } } });
      expect(await orders.registerPayment({ ...input, amount: { amount: 0.3, currency: "PEN" } }, context))
        .toMatchObject({ success: false, error: { code: "PAYMENT_CONFLICT" } });
      expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(0n);
    });
  } finally { await f.cleanup(); }
});

test("concurrent retries of one payment record once and deduct stock once", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      expect(await orders.create({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      const payment = { orderId, paymentId: randomUUID() as PaymentId, amount: { amount: 0.2, currency: "PEN" as const },
        method: "digital_wallet" as const, deductStockIfPartial: false };
      const results = await Promise.all([orders.registerPayment(payment, context), orders.registerPayment(payment, context)]);
      expect(results).toMatchObject([{ success: true }, { success: true }]);
      expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stockDeducted).toBe(true);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(1n);
    });
  } finally { await f.cleanup(); }
});

test("concurrent distinct payments preserve both amounts and deduct once when covered", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      expect(await orders.create({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      const payment = { orderId, amount: { amount: 0.1, currency: "PEN" as const },
        method: "digital_wallet" as const, deductStockIfPartial: false };
      const results = await Promise.all([1, 2].map(() => orders.registerPayment({ ...payment, paymentId: randomUUID() as PaymentId }, context)));
      expect(results).toMatchObject([{ success: true }, { success: true }]);
      expect(await prisma.payment.count({ where: { orderId } })).toBe(2);
      const order = await orders.getAggregate(orderId, context);
      expect(order).toMatchObject({ success: true, data: { stockDeducted: true, payments: [{}, {}] } });
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(1n);
    });
  } finally { await f.cleanup(); }
});

test("keeps stock after an unrequested partial payment and deducts it when payments cover the order", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      expect(await orders.create({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      const payment = { orderId, paymentId: randomUUID() as PaymentId, amount: { amount: 0.1, currency: "PEN" as const },
        method: "digital_wallet" as const, deductStockIfPartial: false };
      expect(await orders.registerPayment(payment, context)).toMatchObject({ success: true, data: { stock: { kind: "not_requested" } } });
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(3n);
      expect(await orders.registerPayment({ ...payment, paymentId: randomUUID() as PaymentId }, context))
        .toMatchObject({ success: true, data: { stock: { kind: "deducted" } } });
      expect(await prisma.payment.count({ where: { orderId } })).toBe(2);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(1n);
    });
  } finally { await f.cleanup(); }
});

test("commits immediate creation, payment, deduction and delivery together", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const result = await orders.registerImmediateSale({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 3 as PositiveInteger }] },
      { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId });
      expect(result).toMatchObject({ success: true, data: { deliveryStatus: "delivered", stockDeducted: true,
        completedAt: expect.any(Date), payments: [{ amount: { amount: 0.3, currency: "PEN" } }] } });
      const saved = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
      expect(saved).toMatchObject({ delivery: null, deliveryStatus: "delivered", stockDeducted: true,
        completedAt: expect.any(Date), payments: [{ orderId }] });
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(0n);
    });
  } finally { await f.cleanup(); }
});

test("rolls back every immediate-sale write when stock is insufficient", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      expect(await orders.registerImmediateSale({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 4 as PositiveInteger }] },
      { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId }))
        .toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK" } });
      expect(await prisma.order.count({ where: { id: orderId } })).toBe(0);
      expect(await prisma.orderItem.count()).toBe(0);
      expect(await prisma.payment.count()).toBe(0);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(3n);
    });
  } finally { await f.cleanup(); }
});

test("restores deducted stock once when cancelling before dispatch and preserves payments", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      expect(await orders.create({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      expect(await orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId,
        amount: { amount: 0.2, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, context))
        .toMatchObject({ success: true, data: { stock: { kind: "deducted" } } });
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(1n);
      expect(await orders.cancel(orderId, context)).toMatchObject({ success: true,
        data: { cancelled: true, stockDeducted: false, payments: [{ amount: { amount: 0.2 } }] } });
      expect(await orders.cancel(orderId, context)).toMatchObject({ success: true, data: { cancelled: true } });
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(3n);
      expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
      expect(await orders.deductStock(orderId, context)).toMatchObject({ success: false, error: { code: "ORDER_CANCELLED" } });
    });
  } finally { await f.cleanup(); }
});

test("ships and completes only a paid order with deducted stock", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      expect(await orders.create({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      expect(await orders.ship(orderId, context)).toMatchObject({ success: false, error: { code: "PAYMENT_REQUIRED" } });
      expect(await orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId,
        amount: { amount: 0.2, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, context))
        .toMatchObject({ success: true, data: { stock: { kind: "deducted" } } });
      expect(await orders.ship(orderId, context)).toMatchObject({ success: true,
        data: { deliveryStatus: "shipped", completedAt: null } });
      expect(await orders.cancel(orderId, context)).toMatchObject({ success: false, error: { code: "INVALID_TRANSITION" } });
      expect(await orders.deliver(orderId, context)).toMatchObject({ success: true,
        data: { deliveryStatus: "delivered", completedAt: expect.any(Date) } });
      const saved = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
      expect(saved).toMatchObject({ deliveryStatus: "delivered", completedAt: expect.any(Date), payments: [{ orderId }] });
      expect(await orders.deliver(orderId, context)).toMatchObject({ success: false, error: { code: "INVALID_TRANSITION" } });
    });
  } finally { await f.cleanup(); }
});

test("reducing a delivery charge to covered payment deducts stock atomically", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      const delivery = { method: "home" as const, recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } },
        destination: { address: "Av. Lima 123" } };
      let cost = 0.1;
      const deps: SetDeliveryDependencies = { transaction: async (_companyId, work) => withinTransaction(work),
        findOrderForUpdate, saveDelivery, saveStockDeduction, deductProductStock,
        resolveDelivery: async (selection, _companyId, currency) => ok({ delivery: selection, cost: { amount: cost, currency } }) };
      expect(await orders.create({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      expect(await setOrderDelivery({ orderId, delivery, chargeDeliveryToCustomer: true }, context, deps))
        .toMatchObject({ success: true, data: { total: { amount: 0.3 }, stockDeducted: false } });
      expect(await orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId,
        amount: { amount: 0.2, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, context))
        .toMatchObject({ success: true, data: { stock: { kind: "not_requested" } } });
      cost = 0;
      expect(await setOrderDelivery({ orderId, delivery, chargeDeliveryToCustomer: false }, context, deps))
        .toMatchObject({ success: true, data: { total: { amount: 0.2 }, deliveryCost: { amount: 0 }, stockDeducted: true } });
      const saved = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(saved.total.toNumber()).toBe(0.2);
      expect(saved.stockDeducted).toBe(true);
      expect(saved.delivery).toMatchObject(delivery);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(1n);
    });
  } finally { await f.cleanup(); }
});

test("keeps the previous delivery when its required stock deduction fails", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      const delivery = { method: "home" as const, recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } },
        destination: { address: "Original" } };
      let cost = 0.1;
      const deps: SetDeliveryDependencies = { transaction: async (_companyId, work) => withinTransaction(work),
        findOrderForUpdate, saveDelivery, saveStockDeduction, deductProductStock,
        resolveDelivery: async (selection, _companyId, currency) => ok({ delivery: selection, cost: { amount: cost, currency } }) };
      expect(await orders.create({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 4 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      expect(await setOrderDelivery({ orderId, delivery, chargeDeliveryToCustomer: true }, context, deps)).toMatchObject({ success: true });
      expect(await orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId,
        amount: { amount: 0.4, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, context))
        .toMatchObject({ success: true, data: { stock: { kind: "not_requested" } } });
      cost = 0;
      expect(await setOrderDelivery({ orderId, delivery: { ...delivery, destination: { address: "Changed" } },
        chargeDeliveryToCustomer: false }, context, deps))
        .toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK" } });
      const saved = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(saved.total.toNumber()).toBe(0.5);
      expect(saved.delivery).toMatchObject(delivery);
      expect(saved.stockDeducted).toBe(false);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(3n);
    });
  } finally { await f.cleanup(); }
});

test("persists completed sale, historical snapshots, listing and duplicate rejection", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID();
      const created = await orders.createLegacy({ id: orderId, contactId: f.contactId, items: [
        { variantId: f.variantIds[0], quantity: 3 }, { variantId: f.variantIds[1], quantity: 2 },
      ] }, { companyId: f.companyId, sellerId: f.sellerId });
      expect(created).toMatchObject({ success: true, data: { total: { amount: 0.7, currency: "PEN" },
        customer: { kind: "contact", name: null, phone: "+51999999999" } } });
      const persisted = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
      expect(persisted).toMatchObject({ itemsTotal: expect.anything(), deliveryStatus: "delivered", stockDeducted: true,
        cancelled: false, delivery: null });
      expect(persisted.itemsTotal.toNumber()).toBe(0.7);
      expect(persisted.createdAt).toEqual(persisted.completedAt);
      expect(persisted.payments).toHaveLength(1);
      expect(persisted.payments[0]).toMatchObject({ orderId, currency: "PEN", method: "digital_wallet", recordedAt: persisted.completedAt });
      expect(persisted.payments[0].amount.toNumber()).toBe(0.7);
      expect(await findOrderAggregate(orderId as OrderId, f.companyId as CompanyId)).toMatchObject({ success: true,
        data: { id: orderId, deliveryStatus: "delivered", stockDeducted: true, payments: [{ id: persisted.payments[0].id,
          amount: { amount: 0.7, currency: "PEN" } }] } });
      expect(await prisma.productStock.findMany({ orderBy: { variantId: "asc" } })).toHaveLength(2);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(0n);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[1] } })).quantity).toBe(1n);
      expect(await orders.createLegacy({ id: orderId, contactId: null, items: [{ variantId: f.variantIds[1], quantity: 1 }] }, { companyId: f.companyId, sellerId: f.sellerId }))
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
      const result = await orders.createLegacy({ id: randomUUID(), contactId: null, items: [
        { variantId: f.variantIds[0], quantity: 1 }, { variantId: f.variantIds[1], quantity: 4 },
      ] }, { companyId: f.companyId, sellerId: f.sellerId });
      expect(result).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK", variantId: f.variantIds[1] } });
      expect(await prisma.payment.count()).toBe(0);
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
      const results = await Promise.all([1, 2].map(() => orders.createLegacy({ id: randomUUID(), contactId: null,
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
      const results = await Promise.all([1, 2].map(() => orders.createLegacy({ id: orderId, contactId: null,
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
      expect(await orders.createLegacy({ id: foreignOrderId, contactId: b.contactId, items: [{ variantId: b.variantIds[0], quantity: 1 }] },
        { companyId: b.companyId, sellerId: b.sellerId })).toMatchObject({ success: true });
    });
    await withTenantIsolation(a.companyId, async () => {
      expect(await orders.get(foreignOrderId)).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
      expect(await orders.list({ page: 1, customer: { kind: "all" } })).toMatchObject({ success: true, data: { total: 0 } });
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.orderItem.count()).toBe(0);
      expect(await orders.createLegacy({ id: randomUUID(), contactId: b.contactId, items: [{ variantId: a.variantIds[0], quantity: 1 }] },
        { companyId: a.companyId, sellerId: a.sellerId })).toMatchObject({ success: false, error: { code: "CONTACT_NOT_FOUND" } });
      expect(await orders.createLegacy({ id: randomUUID(), contactId: null, items: [{ variantId: b.variantIds[0], quantity: 1 }] },
        { companyId: a.companyId, sellerId: a.sellerId })).toMatchObject({ success: false, error: { code: "VARIANT_NOT_FOUND", variantId: b.variantIds[0] } });
      expect(await orders.createLegacy({ id: foreignOrderId, contactId: null, items: [{ variantId: a.variantIds[0], quantity: 1 }] },
        { companyId: a.companyId, sellerId: a.sellerId })).toMatchObject({ success: false, error: { code: "ORDER_ALREADY_EXISTS" } });
      expect(await prisma.order.count()).toBe(0);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: a.variantIds[0] } })).quantity).toBe(3n);
      await expect(prisma.order.create({ data: { id: randomUUID(), companyId: a.companyId, sellerId: a.sellerId,
        contactId: b.contactId, contactPhone: "+51999999999", currency: "PEN", total: 1, itemsTotal: 1,
        paymentMethod: "digital_wallet", completedAt: new Date(), createdAt: new Date() } })).rejects.toThrow();
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
        expect(await orders.createLegacy({ id, contactId: null, items: [{ variantId: f.variantIds[0], quantity: 1 }] },
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
      const result = await orders.createLegacy({ id: randomUUID(), contactId: null, items: [{ variantId: f.variantIds[0], quantity: 1 }] },
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
      expect(await orders.createLegacy({ id, contactId: null, items: [{ variantId: f.variantIds[0], quantity: 1 }] },
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
