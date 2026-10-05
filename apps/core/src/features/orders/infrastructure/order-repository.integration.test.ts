import { log, safeError } from "@core/src/shared/infrastructure/logger";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import type { Currency } from "@shared/money";
import { orders, setConfiguredOrderDelivery } from "@core/src/features/orders/composition";
import { prisma, systemPrisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { setOrderDelivery, type SetDeliveryDependencies } from "@core/src/features/orders/application/set-delivery";
import { findOrderAggregate, findOrderForUpdate, saveDelivery, saveStockDeduction } from "@core/src/features/orders/infrastructure/order-repository";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import type { CourierId } from "@core/src/features/delivery-settings/domain/delivery-settings";
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
      await prisma.companyCourier.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
}

function immediateSale(input: { id: string; contactId: string | null; items: readonly { variantId: string; quantity: number }[] },
  context: { companyId: string; sellerId: string }) {
  const [first, ...rest] = input.items;
  if (!first) throw new Error("Test sale requires items");
  const item = (selection: typeof first) => ({ variantId: selection.variantId as VariantId, quantity: selection.quantity as PositiveInteger });
  return orders.registerImmediateSale({ id: input.id as OrderId, contactId: input.contactId as ContactId | null,
    items: [item(first), ...rest.map(item)] }, { companyId: context.companyId as CompanyId, userId: context.sellerId as UserId });
}

function orderDetail(id: string, owner: { companyId: string; sellerId: string }) {
  return orders.getAggregate(id as OrderId, { companyId: owner.companyId as CompanyId, userId: owner.sellerId as UserId });
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
      expect(saved).toMatchObject({ completedAt: null, createdAt: created.data.createdAt, cancelled: false,
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
        destination: { address: "Av. Lima 123", district: "Lima", instructions: null } };
      let cost = 0.1;
      const deps: SetDeliveryDependencies = { transaction: async (_companyId, work) => withinTransaction(work),
        findOrderForUpdate, saveDelivery, saveStockDeduction, deductProductStock,
        resolveDelivery: async (selection, access, currency) => {
          if (selection.method !== "home") throw new Error("Expected home selection");
          return ok({ delivery: { ...selection, recordedBy: { kind: "seller", userId: access.userId } }, cost: { amount: cost, currency } });
        } };
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
        destination: { address: "Original", district: "Lima", instructions: null } };
      let cost = 0.1;
      const deps: SetDeliveryDependencies = { transaction: async (_companyId, work) => withinTransaction(work),
        findOrderForUpdate, saveDelivery, saveStockDeduction, deductProductStock,
        resolveDelivery: async (selection, access, currency) => {
          if (selection.method !== "home") throw new Error("Expected home selection");
          return ok({ delivery: { ...selection, recordedBy: { kind: "seller", userId: access.userId } }, cost: { amount: cost, currency } });
        } };
      expect(await orders.create({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 4 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      expect(await setOrderDelivery({ orderId, delivery, chargeDeliveryToCustomer: true }, context, deps)).toMatchObject({ success: true });
      expect(await orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId,
        amount: { amount: 0.4, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, context))
        .toMatchObject({ success: true, data: { stock: { kind: "not_requested" } } });
      cost = 0;
      expect(await setOrderDelivery({ orderId, delivery: { ...delivery, destination: { address: "Changed", district: "Lima", instructions: null } },
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
      const created = await immediateSale({ id: orderId, contactId: f.contactId, items: [
        { variantId: f.variantIds[0], quantity: 3 }, { variantId: f.variantIds[1], quantity: 2 },
      ] }, { companyId: f.companyId, sellerId: f.sellerId });
      expect(created).toMatchObject({ success: true, data: { total: { amount: 0.7, currency: "PEN" },
        customer: { kind: "contact", name: null, phone: "+51999999999" } } });
      const persisted = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
      expect(persisted).toMatchObject({ itemsTotal: expect.anything(), deliveryStatus: "delivered", stockDeducted: true,
        cancelled: false, delivery: null });
      expect(persisted.itemsTotal.toNumber()).toBe(0.7);
      expect(persisted.createdAt.getTime()).toBeLessThanOrEqual(persisted.completedAt!.getTime());
      expect(persisted.payments).toHaveLength(1);
      expect(persisted.payments[0]).toMatchObject({ orderId, currency: "PEN", method: "digital_wallet" });
      expect(persisted.payments[0].recordedAt.getTime()).toBeLessThanOrEqual(persisted.completedAt!.getTime());
      expect(persisted.payments[0].amount.toNumber()).toBe(0.7);
      expect(await findOrderAggregate(orderId as OrderId, f.companyId as CompanyId)).toMatchObject({ success: true,
        data: { id: orderId, deliveryStatus: "delivered", stockDeducted: true, payments: [{ id: persisted.payments[0].id,
          amount: { amount: 0.7, currency: "PEN" } }] } });
      expect(await prisma.productStock.findMany({ orderBy: { variantId: "asc" } })).toHaveLength(2);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(0n);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[1] } })).quantity).toBe(1n);
      expect(await immediateSale({ id: orderId, contactId: null, items: [{ variantId: f.variantIds[1], quantity: 1 }] }, { companyId: f.companyId, sellerId: f.sellerId }))
        .toMatchObject({ success: false, error: { code: "ORDER_ALREADY_EXISTS" } });
      await prisma.contact.update({ where: { id: f.contactId }, data: { phone: "+51888888888", name: "Changed" } });
      await prisma.product.update({ where: { id: f.productId }, data: { name: "Changed product" } });
      await prisma.productVariant.update({ where: { id: f.variantIds[0] }, data: { attributes: { Size: "XL" }, sku: `CHANGED-${f.variantIds[0]}`, salePrice: 3.5 } });
      const detail = await orderDetail(orderId, f);
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
      expect(await orderDetail(orderId, f)).toMatchObject({ success: true });
    });
  } finally { await f.cleanup(); }
});

test("rolls back all writes and stock when a later item is unavailable", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const result = await immediateSale({ id: randomUUID(), contactId: null, items: [
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
      const results = await Promise.all([1, 2].map(() => immediateSale({ id: randomUUID(), contactId: null,
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
      const results = await Promise.all([1, 2].map(() => immediateSale({ id: orderId, contactId: null,
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
      expect(await immediateSale({ id: foreignOrderId, contactId: b.contactId, items: [{ variantId: b.variantIds[0], quantity: 1 }] },
        { companyId: b.companyId, sellerId: b.sellerId })).toMatchObject({ success: true });
    });
    await withTenantIsolation(a.companyId, async () => {
      expect(await orderDetail(foreignOrderId, a)).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
      expect(await orders.list({ page: 1, customer: { kind: "all" } })).toMatchObject({ success: true, data: { total: 0 } });
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.orderItem.count()).toBe(0);
      expect(await immediateSale({ id: randomUUID(), contactId: b.contactId, items: [{ variantId: a.variantIds[0], quantity: 1 }] },
        { companyId: a.companyId, sellerId: a.sellerId })).toMatchObject({ success: false, error: { code: "CONTACT_NOT_FOUND" } });
      expect(await immediateSale({ id: randomUUID(), contactId: null, items: [{ variantId: b.variantIds[0], quantity: 1 }] },
        { companyId: a.companyId, sellerId: a.sellerId })).toMatchObject({ success: false, error: { code: "VARIANT_NOT_FOUND", variantId: b.variantIds[0] } });
      expect(await immediateSale({ id: foreignOrderId, contactId: null, items: [{ variantId: a.variantIds[0], quantity: 1 }] },
        { companyId: a.companyId, sellerId: a.sellerId })).toMatchObject({ success: false, error: { code: "ORDER_ALREADY_EXISTS" } });
      expect(await prisma.order.count()).toBe(0);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: a.variantIds[0] } })).quantity).toBe(3n);
      await expect(prisma.order.create({ data: { id: randomUUID(), companyId: a.companyId, sellerId: a.sellerId,
        contactId: b.contactId, contactPhone: "+51999999999", currency: "PEN", total: 1, itemsTotal: 1,
        completedAt: new Date(), createdAt: new Date() } })).rejects.toThrow();
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
        expect(await immediateSale({ id, contactId: null, items: [{ variantId: f.variantIds[0], quantity: 1 }] },
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
      const result = await immediateSale({ id: randomUUID(), contactId: null, items: [{ variantId: f.variantIds[0], quantity: 1 }] },
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
      expect(await immediateSale({ id, contactId: null, items: [{ variantId: f.variantIds[0], quantity: 1 }] },
        { companyId: f.companyId, sellerId: f.sellerId })).toMatchObject({ success: true });
      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: id } });
      await expect(prisma.order.update({ where: { id }, data: { total: 0 } })).rejects.toThrow();
      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { quantity: 0n } })).rejects.toThrow();
      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { quantity: BigInt(Number.MAX_SAFE_INTEGER) + 1n } })).rejects.toThrow();
      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { unitPrice: 0 } })).rejects.toThrow();
      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { subtotal: 0 } })).rejects.toThrow();
      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { variantAttributes: { Size: 42 } } })).rejects.toThrow();
      await expect(prisma.orderItem.create({ data: { orderId: id, variantId: f.variantIds[0], productName: "Duplicate", variantAttributes: {}, quantity: 1n, unitPrice: 1, subtotal: 1 } })).rejects.toThrow();
      expect(await prisma.orderItem.count()).toBe(1);
    });
  } finally { await f.cleanup(); }
});

test("rolls back earlier stock deductions and the configured snapshot when a later item is short", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      const orderId = randomUUID() as OrderId;
      const [first, second] = [...f.variantIds].sort();
      expect(await deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true,
        pickupPoint: { name: "Store", address: "Original", instructions: null } } }, context)).toMatchObject({ success: true });
      expect(await orders.create({ id: orderId, contactId: null, items: [
        { variantId: first as VariantId, quantity: 2 as PositiveInteger },
        { variantId: second as VariantId, quantity: 4 as PositiveInteger },
      ] }, context)).toMatchObject({ success: true });
      const input = { orderId, delivery: { method: "store" as const, recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } } }, chargeDeliveryToCustomer: true };
      const cost = async (_selection: unknown, _context: unknown, currency: Currency) => ok({ amount: 1, currency });
      expect(await setConfiguredOrderDelivery(input, context, cost)).toMatchObject({ success: true });
      const before = await orderDetail(orderId, f);
      if (!before.success) throw new Error("Expected order");
      expect(await orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId,
        amount: before.data.itemsTotal, method: "digital_wallet", deductStockIfPartial: false }, context)).toMatchObject({ success: true });
      const paid = await orderDetail(orderId, f);
      expect(await setConfiguredOrderDelivery({ ...input, chargeDeliveryToCustomer: false }, context, cost))
        .toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK", variantId: second } });
      expect(await orderDetail(orderId, f)).toEqual(paid);
      expect((await prisma.productStock.findMany({ orderBy: { variantId: "asc" } })).map(row => row.quantity)).toEqual([3n, 3n]);
      await prisma.productStock.update({ where: { variantId: second }, data: { quantity: 5n } });
      const adminUrl = new URL(process.env.DATABASE_URL!);
      adminUrl.username = "core";
      adminUrl.password = "core";
      const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl.toString() }) });
      const name = `reject_delivery_${randomUUID().replaceAll("-", "")}`;
      try {
        await admin.$executeRawUnsafe(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."companyId" = '${f.companyId}'::uuid THEN RAISE EXCEPTION 'delivery write rejected by test'; END IF; RETURN NEW; END $$`);
        await admin.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE UPDATE OF "delivery" ON "Order" FOR EACH ROW EXECUTE FUNCTION public.${name}()`);
        expect(await setConfiguredOrderDelivery({ ...input, chargeDeliveryToCustomer: false }, context, cost))
          .toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
        expect(await orderDetail(orderId, f)).toEqual(paid);
        expect((await prisma.productStock.findMany({ orderBy: { variantId: "asc" } })).map(row => row.quantity)).toEqual([3n, 5n]);
      } finally {
        await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "Order"`);
        await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.${name}()`);
        await admin.$disconnect();
      }
    });
  } finally { await f.cleanup(); }
});


async function waitForDeliveryLock() {
  await vi.waitFor(async () => {
    const rows = await systemPrisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND (query LIKE '%CompanyDeliverySettings%' OR query LIKE '%Order%')`;
    expect(Number(rows[0].count)).toBeGreaterThan(0);
  });
}

test.each(["store", "agency"] as const)("%s assignment and disabling configuration serialize in both orders", async method => {
  const f = await fixture();
  const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
  const run = <T>(work: () => Promise<T>) => withTenantIsolation(f.companyId, async () => await work());
  const recipient = { name: "Recipient", phone: "00123", identity: { kind: "document" as const, documentType: "passport" as const, document: "00-A" } };
  try {
    const configured = await run(() => deliverySettings.save({ expectedVersion: 0, home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Original store", address: "Original address", instructions: null } }, agency: { enabled: true }, couriers: [{ kind: "new", name: "Original courier", enabled: true }, ...(method === "agency" ? [{ kind: "new" as const, name: "Alternate courier", enabled: true }] : [])] }, context));
    if (!configured.success) throw new Error("Expected configuration");
    const courier = configured.data.couriers.find(current => current.name === "Original courier");
    if (!courier) throw new Error("Expected original courier");
    const orderId = randomUUID() as OrderId;
    expect(await run(() => orders.create({ id: orderId, contactId: null, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context))).toMatchObject({ success: true });
    const delivery = method === "store" ? { method, recipient } : { method, recipient, courierId: courier.id as CourierId, agency: "Lima agency" };
    let release!: () => void;
    let arrived!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const protectedConfiguration = new Promise<void>(resolve => { arrived = resolve; });
    const assignment = run(() => setConfiguredOrderDelivery({ orderId, delivery, chargeDeliveryToCustomer: true }, context, async (_snapshot, _access, currency) => {
      arrived(); await held; return ok({ amount: 3, currency });
    }));
    await protectedConfiguration;
    const disableInput = { expectedVersion: 1, home: { enabled: false }, store: { ...configured.data.store, enabled: false as const }, agency: { enabled: method === "agency" }, couriers: configured.data.couriers.map(current => ({ ...current, kind: "existing" as const, name: current.id === courier.id ? "Renamed" : current.name, enabled: current.id !== courier.id })) };
    const disable = run(() => deliverySettings.save(disableInput, context));
    try { await waitForDeliveryLock(); } finally { release(); }
    expect(await assignment).toMatchObject({ success: true, data: { delivery: method === "store" ? { pickupPoint: { address: "Original address" } } : { courier: { name: "Original courier" } } } });
    expect(await disable).toMatchObject({ success: true, data: { version: 2 } });
    const before = await run(() => orderDetail(orderId, f));
    expect(await run(() => setConfiguredOrderDelivery({ orderId, delivery, chargeDeliveryToCustomer: false }, context, async (_snapshot, _access, currency) => ok({ amount: 3, currency })))).toMatchObject({ success: false, error: { code: method === "agency" ? "COURIER_UNAVAILABLE" : "DELIVERY_METHOD_DISABLED" } });
    expect(await run(() => orderDetail(orderId, f))).toEqual(before);
    // Reactivate, then hold the disabling transaction before starting the second assignment.
    expect(await run(() => deliverySettings.save({ ...disableInput, expectedVersion: 2, store: configured.data.store, agency: { enabled: true }, couriers: configured.data.couriers.map(current => ({ ...current, kind: "existing" as const })) }, context))).toMatchObject({ success: true });
    let unblock!: () => void;
    let disabled!: () => void;
    const holdDisable = new Promise<void>(resolve => { unblock = resolve; });
    const disabling = new Promise<void>(resolve => { disabled = resolve; });
    const first = run(() => withinTransaction(async () => {
      const result = await deliverySettings.save({ ...disableInput, expectedVersion: 3 }, context);
      disabled(); await holdDisable; return result;
    }));
    await disabling;
    const second = run(() => setConfiguredOrderDelivery({ orderId, delivery, chargeDeliveryToCustomer: false }, context, async (_snapshot, _access, currency) => ok({ amount: 3, currency })));
    try { await waitForDeliveryLock(); } finally { unblock(); }
    expect(await first).toMatchObject({ success: true });
    expect(await second).toMatchObject({ success: false, error: { code: method === "agency" ? "COURIER_UNAVAILABLE" : "DELIVERY_METHOD_DISABLED" } });
    expect(await run(() => orderDetail(orderId, f))).toEqual(before);
  } finally { await f.cleanup(); }
});

test.each(["ship", "cancel"] as const)("delivery editing and %s serialize without losing the confirmed snapshot", async close => {
  const f = await fixture();
  const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
  const run = <T>(work: () => Promise<T>) => withTenantIsolation(f.companyId, async () => await work());
  try {
    expect(await run(() => deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: false, pickupPoint: null } }, context))).toMatchObject({ success: true });
    for (const assignmentFirst of [true, false]) {
      const orderId = randomUUID() as OrderId;
      expect(await run(() => orders.create({ id: orderId, contactId: null, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context))).toMatchObject({ success: true });
      expect(await run(() => orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId, amount: { amount: 0.1, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, context))).toMatchObject({ success: true });
      const input = { orderId, delivery: { method: "home" as const, recipient: { name: "Recipient", phone: "00123", identity: { kind: "absent" as const } }, destination: { address: "Confirmed address", district: "Lima", instructions: null } }, chargeDeliveryToCustomer: false };
      const assign = () => setConfiguredOrderDelivery(input, context, async (_snapshot, _access, currency) => ok({ amount: 3, currency }));
      const finish = () => orders[close](orderId, context);
      let release!: () => void;
      let arrived!: () => void;
      const hold = new Promise<void>(resolve => { release = resolve; });
      const locked = new Promise<void>(resolve => { arrived = resolve; });
      const first = run(() => withinTransaction(async () => {
        const result = await (assignmentFirst ? assign() : finish());
        arrived(); await hold; return result;
      }));
      await locked;
      const second = run(assignmentFirst ? finish : assign);
      try { await waitForDeliveryLock(); } finally { release(); }
      expect(await first).toMatchObject({ success: true });
      expect(await second).toMatchObject(assignmentFirst ? { success: true } : { success: false, error: { code: close === "ship" ? "DELIVERY_LOCKED" : "ORDER_CANCELLED" } });
      expect(await run(() => orderDetail(orderId, f))).toMatchObject({ success: true, data: { cancelled: close === "cancel", deliveryStatus: close === "ship" ? "shipped" : "pending", delivery: assignmentFirst ? { destination: { address: "Confirmed address" }, recordedBy: { userId: f.sellerId } } : null } });
    }
  } finally { await f.cleanup(); }
});

test("concurrent delivery assignment and stock deduction consume stock once", async () => {
  const f = await fixture();
  const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
  const run = <T>(work: () => Promise<T>) => withTenantIsolation(f.companyId, async () => await work());
  let release!: () => void;
  let arrived!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const protectedOrder = new Promise<void>(resolve => { arrived = resolve; });
  try {
    const orderId = randomUUID() as OrderId;
    await run(async () => {
      expect(await deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: false, pickupPoint: null } }, context)).toMatchObject({ success: true });
      expect(await orders.create({ id: orderId, contactId: null, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      await prisma.payment.create({ data: { id: randomUUID(), orderId, amount: 0.1, currency: "PEN", method: "digital_wallet", recordedAt: new Date() } });
    });
    const assign = run(() => setConfiguredOrderDelivery({ orderId, delivery: { method: "home", recipient: { name: "Recipient", phone: "00123", identity: { kind: "absent" } }, destination: { address: "Address", district: "Lima", instructions: null } }, chargeDeliveryToCustomer: false }, context,
      async (_snapshot, _access, currency) => { arrived(); await hold; return ok({ amount: 3, currency }); }));
    await protectedOrder;
    const deduct = run(() => orders.deductStock(orderId, context));
    try { await waitForDeliveryLock(); } finally { release(); }
    expect(await assign).toMatchObject({ success: true, data: { stockDeducted: true } });
    expect(await deduct).toMatchObject({ success: true, data: { stockDeducted: true } });
    await run(async () => {
      expect(await orderDetail(orderId, f)).toMatchObject({ success: true, data: { total: { amount: 0.1 }, payments: [{ amount: { amount: 0.1 } }], stockDeducted: true } });
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(2n);
    });
  } finally { release?.(); await f.cleanup(); }
});

test("two delivery edits serialize complete snapshots, authors and amounts", async () => {
  const f = await fixture();
  const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
  const nextAuthor = randomUUID() as UserId;
  const run = <T>(work: () => Promise<T>) => withTenantIsolation(f.companyId, async () => await work());
  let release!: () => void;
  let arrived!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const resolving = new Promise<void>(resolve => { arrived = resolve; });
  try {
    const orderId = randomUUID() as OrderId;
    await run(async () => {
      expect(await deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: false, pickupPoint: null } }, context)).toMatchObject({ success: true });
      expect(await orders.create({ id: orderId, contactId: null, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context)).toMatchObject({ success: true });
    });
    const selection = (name: string) => ({ method: "home" as const, recipient: { name, phone: "00123", identity: { kind: "absent" as const } }, destination: { address: name, district: "Lima", instructions: null } });
    const first = run(() => setConfiguredOrderDelivery({ orderId, delivery: selection("First"), chargeDeliveryToCustomer: true }, context,
      async (_snapshot, _access, currency) => { arrived(); await hold; return ok({ amount: 3, currency }); }));
    await resolving;
    const second = run(() => setConfiguredOrderDelivery({ orderId, delivery: selection("Second"), chargeDeliveryToCustomer: false }, { ...context, userId: nextAuthor }, async (_snapshot, _access, currency) => ok({ amount: 4, currency })));
    try { await waitForDeliveryLock(); } finally { release(); }
    expect(await first).toMatchObject({ success: true, data: { delivery: { recipient: { name: "First" }, recordedBy: { userId: f.sellerId } }, total: { amount: 3.1 }, deliveryCharge: { amount: 3 } } });
    const confirmed = await second;
    expect(confirmed).toMatchObject({ success: true, data: { delivery: { recipient: { name: "Second" }, destination: { address: "Second" }, recordedBy: { userId: nextAuthor } }, total: { amount: 0.1 }, deliveryCost: { amount: 4 }, deliveryCharge: { amount: 0 }, stockDeducted: false } });
    expect(await run(() => orderDetail(orderId, f))).toEqual(confirmed);
  } finally { release?.(); await f.cleanup(); }
});


test.each(["CompanyDeliverySettings", "Order"] as const)("a deferred %s commit failure returns one safe error and no success summary", async table => {
  const f = await fixture();
  const adminUrl = new URL(process.env.MIGRATION_TEST_DATABASE_URL!);
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl.toString() }) });
  const trigger = `reject_commit_${randomUUID().replaceAll("-", "")}`;
  const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
  const summary = vi.spyOn(log, "info").mockImplementation(() => {});
  const failure = vi.spyOn(log, "error").mockImplementation(() => {});
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      expect(await deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: false, pickupPoint: null } }, context)).toMatchObject({ success: true });
      expect(await orders.create({ id: orderId, contactId: null, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      const settingsBefore = await deliverySettings.get(context);
      const orderBefore = await orderDetail(orderId, f);
      await admin.$executeRawUnsafe(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."companyId" = '${f.companyId}'::uuid THEN RAISE EXCEPTION 'private destination in deferred failure'; END IF; RETURN NEW; END $$`);
      await admin.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER ${trigger} AFTER UPDATE ON "${table}" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.${trigger}()`);
      summary.mockClear(); failure.mockClear();
      const operation = () => table === "CompanyDeliverySettings"
        ? deliverySettings.save({ expectedVersion: 1, agency: { enabled: false }, couriers: [{ kind: "new", name: "New courier", enabled: true }], home: { enabled: false }, store: { enabled: false, pickupPoint: null } }, context)
        : setConfiguredOrderDelivery({ orderId, delivery: { method: "home", recipient: { name: "Recipient", phone: "00123", identity: { kind: "absent" } }, destination: { address: "Address", district: "Lima", instructions: null } }, chargeDeliveryToCustomer: false }, context, async (_snapshot, _access, currency) => ok({ amount: 3, currency }));
      expect(await operation()).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
      expect(summary).not.toHaveBeenCalled();
      expect(failure).toHaveBeenCalledOnce();
      expect(failure.mock.calls[0][0]).toMatchObject({ event: table === "Order" ? "unable_to_complete_order_transaction" : "delivery_settings_transaction_failed", transactionOutcome: "unknown" });
      expect(JSON.stringify(safeError((failure.mock.calls[0][0] as { err: unknown }).err))).not.toContain("private destination");
      expect(await deliverySettings.get(context)).toEqual(settingsBefore);
      expect(await orderDetail(orderId, f)).toEqual(orderBefore);
      expect(await prisma.companyCourier.count()).toBe(0);
      await admin.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON "${table}"`);
      expect(await operation()).toMatchObject({ success: true });
      expect(summary).toHaveBeenCalledOnce();
    });
  } finally {
    await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON "${table}"`);
    await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.${trigger}()`);
    await admin.$disconnect();
    summary.mockRestore(); failure.mockRestore(); await f.cleanup();
  }
});

test("a corrupt persisted delivery snapshot fails explicitly without inventing legacy authorship", async () => {
  const f = await fixture();
  const failure = vi.spyOn(log, "error").mockImplementation(() => {});
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      expect(await orders.create({ id: orderId, contactId: null, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      await prisma.order.update({ where: { id: orderId }, data: { delivery: { method: "store", recipient: { name: "Private recipient", phone: "Private phone", identity: { kind: "absent" } }, pickupPoint: { name: "Private store", address: "Private address", instructions: null } } } });
      expect(await orderDetail(orderId, f)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
      expect(failure).toHaveBeenCalledOnce();
      expect(failure.mock.calls[0][0]).toMatchObject({ event: "order_delivery_stored_data_invalid", orderId, operation: "get_order_aggregate", reason: "invalid_snapshot_shape" });
      expect(JSON.stringify(failure.mock.calls)).not.toContain("Private");
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).delivery).not.toHaveProperty("recordedBy");
    });
  } finally { failure.mockRestore(); await f.cleanup(); }
});
