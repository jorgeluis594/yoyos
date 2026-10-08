import type { CreateCompleteOrderInput } from "@core/src/features/orders/application/create-complete-order";
import { log, safeError } from "@core/src/shared/infrastructure/logger";
import { parseBuyer, type CheckoutAccess } from "@core/src/features/orders/domain/checkout";
import { confirmCheckoutDelivery, confirmOrderCheckout } from "@core/src/features/orders/application/checkout";
import { findCheckoutOrderForUpdate, saveCheckoutBuyer, saveCheckoutConfirmed } from "@core/src/features/orders/infrastructure/checkout-repository";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test, vi } from "vitest";
import { ok, err } from "@shared/functional";
import type { Currency } from "@shared/money";
import { orders, setConfiguredOrderDelivery, createConfiguredOrder } from "@core/src/features/orders/composition";
import { prisma, systemPrisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { parseRatedDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import { findOrderAggregate, findOrderForUpdate, saveDelivery, saveStockDeduction } from "@core/src/features/orders/infrastructure/order-repository";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import type { CourierId } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { deductProductStock } from "@core/src/features/products";
import type { CompanyId, ContactId, OrderId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { ImageId } from "@core/src/features/orders/domain/payment";
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
      await prisma.image.deleteMany();
      await systemPrisma.user.delete({ where: { id: sellerId } });
      await prisma.deliveryRate.deleteMany();
      await prisma.quotation.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany();
      await prisma.deliveryZone.deleteMany();
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

test("reports a company receipt once without changing coverage or stock", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const paymentId = randomUUID() as PaymentId;
      const receiptImageId = randomUUID() as ImageId;
      const access = { kind: "buyer" as const, companyId: f.companyId as CompanyId, orderId };
      await orders.create({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] },
      { companyId: access.companyId, userId: f.sellerId as UserId });
      const input = { paymentId, receiptImageId };
      expect(await orders.reportPayment(input, access)).toMatchObject({ success: false, error: { code: "RECEIPT_NOT_FOUND" } });
      await prisma.image.create({ data: { id: receiptImageId, storageKey: `test/${receiptImageId}` } });
      const reported = await orders.reportPayment(input, access);
      expect(reported).toMatchObject({ success: true, data: { stockDeducted: false,
        payments: [{ id: paymentId, status: "reported", amount: null, method: null, data: { receiptImageId } }] } });
      expect(await orders.reportPayment(input, access)).toEqual(reported);
      expect(await orders.reportPayment({ ...input, receiptImageId: randomUUID() as ImageId }, access))
        .toMatchObject({ success: false, error: { code: "PAYMENT_CONFLICT" } });
      expect(await prisma.payment.count()).toBe(1);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("reported");
      expect(await orderDetail(orderId, f)).toMatchObject({ success: true, data: { payments: [{ status: "reported" }] } });
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(3n);
    });
  } finally { await f.cleanup(); }
});

test("confirms a report and voids a delivered payment without changing stock or delivery", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const paymentId = randomUUID() as PaymentId;
      const receiptImageId = randomUUID() as ImageId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      await orders.create({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] }, context);
      await prisma.image.create({ data: { id: receiptImageId, storageKey: `test/${receiptImageId}` } });
      const access = { kind: "buyer" as const, companyId: context.companyId, orderId };
      expect(await orders.reportPayment({ paymentId, receiptImageId }, access)).toMatchObject({ success: true });
      const confirmation = { orderId, paymentId, source: "buyer_report" as const, amount: { amount: 0.2, currency: "PEN" as const },
        method: "bank_transfer" as const, deductStockIfPartial: false };
      expect(await orders.registerPayment(confirmation, context)).toMatchObject({ success: true,
        data: { order: { payments: [{ status: "confirmed", method: "bank_transfer", data: { evidence: { kind: "buyer_report", report: { receiptImageId } } } }] } } });
      expect(await orders.registerPayment(confirmation, context)).toMatchObject({ success: true });
      expect(await orders.deliver(orderId, context)).toMatchObject({ success: true, data: { completedAt: expect.any(Date) } });
      const deliveredAt = (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).deliveredAt;
      const voided = await orders.voidPayment({ orderId, paymentId }, context);
      expect(voided).toMatchObject({ success: true, data: { completedAt: null, deliveredAt,
        payments: [{ status: "voided", amount: { amount: 0.2 }, data: { evidence: { kind: "buyer_report" }, voidedBy: context.userId } }] } });
      expect(await orders.voidPayment({ orderId, paymentId }, context)).toEqual(voided);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(1n);
      const correction = await orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId, amount: confirmation.amount,
        method: "digital_wallet", deductStockIfPartial: false }, context);
      expect(correction).toMatchObject({ success: true, data: { order: { deliveredAt, completedAt: expect.any(Date), payments: expect.arrayContaining([
        expect.objectContaining({ status: "voided" }), expect.objectContaining({ status: "confirmed" })]) } } });
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(1n);
    });
  } finally { await f.cleanup(); }
});

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
        amount: 0.2, currency: "PEN", method: "digital_wallet", status: "confirmed", data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } } });
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
        amount: 0.1, currency: "USD", method: "digital_wallet", status: "confirmed", data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } } });
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
        amount: 1, currency: "PEN", method: "digital_wallet", status: "confirmed", data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } } });
      expect(await orders.deductStock(orderId, context)).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK" } });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stockDeducted).toBe(false);
      expect((await prisma.productStock.findMany({ orderBy: { variantId: "asc" } })).map((stock) => stock.quantity)).toEqual([3n, 3n]);
    });
  } finally { await f.cleanup(); }
});

test("rolls back payment when stock is short and retries its ID after replenishment", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      expect(await orders.create({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 4 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      const input = { orderId, paymentId: randomUUID() as PaymentId, amount: { amount: 0.4, currency: "PEN" as const },
        method: "digital_wallet" as const, deductStockIfPartial: false };
      expect(await orders.registerPayment(input, context)).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK" } });
      expect(await prisma.payment.count({ where: { orderId } })).toBe(0);
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
      const before = await findOrderAggregate(orderId, context.companyId);
      expect(before.success).toBe(true);
      const cancellations = await Promise.all([orders.cancel(orderId, context), orders.cancel(orderId, context)]);
      for (const result of cancellations) expect(result).toMatchObject({ success: true,
        data: { cancelled: true, stockDeducted: false, payments: [{ amount: { amount: 0.2 } }] } });
      if (before.success && before.data) {
        expect(await findOrderAggregate(orderId, context.companyId)).toMatchObject({ data: { payments: before.data.payments } });
      }
      expect(await orders.cancel(orderId, context)).toMatchObject({ success: true, data: { cancelled: true } });
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(3n);
      expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
      expect(await orders.deductStock(orderId, context)).toMatchObject({ success: false, error: { code: "ORDER_CANCELLED" } });
      for (const operation of [orders.ship, orders.deliver])
        expect(await operation(orderId, context)).toMatchObject({ success: false, error: { code: "ORDER_CANCELLED" } });
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
      expect(await orders.deliver(orderId, context)).toMatchObject({ success: false, error: { code: "PAYMENT_REQUIRED" } });
      expect(await orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId,
        amount: { amount: 0.2, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, context))
        .toMatchObject({ success: true, data: { stock: { kind: "deducted" } } });
      expect(await orders.ship(orderId, context)).toMatchObject({ success: true,
        data: { deliveryStatus: "shipped", completedAt: null } });
      expect(await orders.ship(orderId, context)).toMatchObject({ success: false, error: { code: "INVALID_TRANSITION" } });
      expect(await orders.cancel(orderId, context)).toMatchObject({ success: false, error: { code: "INVALID_TRANSITION" } });
      expect(await orders.deliver(orderId, context)).toMatchObject({ success: true,
        data: { deliveryStatus: "delivered", completedAt: expect.any(Date) } });
      const saved = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
      expect(saved).toMatchObject({ deliveryStatus: "delivered", deliveredAt: expect.any(Date), completedAt: expect.any(Date), payments: [{ orderId }] });
      expect(await orders.deliver(orderId, context)).toMatchObject({ success: false, error: { code: "INVALID_TRANSITION" } });
      expect(await orders.ship(orderId, context)).toMatchObject({ success: false, error: { code: "INVALID_TRANSITION" } });
      expect(await orders.cancel(orderId, context)).toMatchObject({ success: false, error: { code: "INVALID_TRANSITION" } });
      expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } })).toEqual(saved);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(1n);
    });
  } finally { await f.cleanup(); }
});

test.each([2, 4])("replaces a paid delivery with a free rate atomically for quantity %s", async (quantity) => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      expect(await deliverySettings.saveZones({ method: "home", expectedVersion: 0, zones: [0.1, 0].map(amount => ({
        kind: "new" as const, name: "Replacement zone", enabled: true, districtCodes: ["150122"],
        price: { amount, currency: "PEN" as const },
      })) }, context)).toMatchObject({ success: true });
      expect(await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, couriers: [],
        store: { enabled: false, pickupPoint: null } }, context)).toMatchObject({ success: true });
      const quote = await deliverySettings.createQuotation({ companyId: f.companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
      if (!quote.success) throw new Error(quote.error.message);
      const selection = (amount: number, address: string) => {
        const rate = quote.data.rates.find(value => value.price.amount === amount);
        if (!rate) throw new Error("Missing replacement rate");
        const parsed = parseRatedDeliverySelection({ method: "home", rateId: rate.id,
          recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
          destination: { districtCode: "150122", address, instructions: null } });
        if (!parsed.success) throw new Error(parsed.error.message);
        return parsed.data;
      };
      expect(await orders.create({ id: orderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: quantity as PositiveInteger }] }, context)).toMatchObject({ success: true });
      expect(await orders.setDelivery({ orderId, delivery: selection(0.1, "Original"), expectedPrice: { amount: 0.1, currency: "PEN" } }, context))
        .toMatchObject({ success: true, data: { stockDeducted: false, deliveryCost: { amount: 0.1 }, deliveryCharge: { amount: 0.1 } } });
      expect(await orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId,
        amount: { amount: quantity === 2 ? 0.2 : 0.4, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, context))
        .toMatchObject({ success: true, data: { stock: { kind: "not_requested" } } });
      const before = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
      const replacement = await orders.setDelivery({ orderId, delivery: selection(0, "Changed"), expectedPrice: { amount: 0, currency: "PEN" } }, context);
      const saved = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
      if (quantity === 2) {
        expect(replacement).toMatchObject({ success: true, data: { total: { amount: 0.2 }, deliveryCost: { amount: 0 }, deliveryCharge: { amount: 0 }, stockDeducted: true } });
        expect(saved.total.toNumber()).toBe(0.2);
        expect(saved.delivery).toMatchObject({ destination: { address: "Changed" }, pricing: { quotationId: quote.data.quotation.id } });
        expect(saved.stockDeducted).toBe(true);
        expect(saved.payments).toEqual(before.payments);
      } else {
        expect(replacement).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK" } });
        expect(saved).toEqual(before);
      }
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(quantity === 2 ? 1n : 3n);
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
        buyer: { name: null, phone: "+51999999999" } } });
      const persisted = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
      expect(persisted).toMatchObject({ itemsTotal: expect.anything(), deliveryStatus: "delivered", stockDeducted: true,
        cancelled: false, delivery: null });
      expect(persisted.itemsTotal.toNumber()).toBe(0.7);
      expect(persisted.createdAt.getTime()).toBeLessThanOrEqual(persisted.completedAt!.getTime());
      expect(persisted.payments).toHaveLength(1);
      expect(persisted.payments[0]).toMatchObject({ orderId, currency: "PEN", method: "digital_wallet" });
      expect(new Date((persisted.payments[0].data as { confirmedAt: string }).confirmedAt).getTime()).toBeLessThanOrEqual(persisted.completedAt!.getTime());
      expect(persisted.payments[0].amount?.toNumber()).toBe(0.7);
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
      expect(detail).toMatchObject({ success: true, data: { buyer: { name: null, phone: "+51999999999" },
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
      await expect(prisma.order.create({ data: { number: 1001n, id: randomUUID(), companyId: a.companyId, sellerId: a.sellerId,
        buyer: { create: { contactId: b.contactId, phone: "+51999999999" } }, currency: "PEN", total: 1, itemsTotal: 1,
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

test("allocates permanent company numbers atomically across concurrent orders and rollbacks", async () => {
  const a = await fixture();
  const b = await fixture();
  const errorLog = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const create = (f: typeof a) => withTenantIsolation(f.companyId, () => orders.create({ id: randomUUID() as OrderId, contactId: null,
    items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] },
  { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId }));
  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => create(a)));
    expect(results.every((result) => result.success)).toBe(true);
    const numbers = results.flatMap((result) => result.success ? [result.data.number] : []).sort((x, y) => x - y);
    expect(numbers).toEqual([1001, 1002, 1003, 1004, 1005, 1006]);
    expect(await create(b)).toMatchObject({ data: { number: 1001 } });
    await withTenantIsolation(a.companyId, async () => {
      const cancelled = results[0];
      if (!cancelled.success) throw new Error("Creation failed");
      expect(await orders.cancel(cancelled.data.id, { companyId: a.companyId as CompanyId, userId: a.sellerId as UserId })).toMatchObject({ success: true });
      expect(await create(a)).toMatchObject({ data: { number: 1007 } });
      await prisma.company.update({ where: { id: a.companyId }, data: { nextOrderNumber: 1001n } });
      expect(await create(a)).toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
      expect(errorLog.mock.calls).toHaveLength(1);
      expect(errorLog.mock.calls[0][0]).toMatchObject({ event: "unable_to_save_pending_order", errorCode: "ORDER_NUMBER_CONFLICT" });
      await prisma.company.update({ where: { id: a.companyId }, data: { nextOrderNumber: 9999n } });
      expect(await create(a)).toMatchObject({ data: { number: 9999 } });
      expect(await create(a)).toMatchObject({ data: { number: 10000 } });
      const before = await prisma.company.findUniqueOrThrow({ where: { id: a.companyId } });
      const count = await prisma.order.count();
      // Stock failure occurs after allocating and saving the immediate sale.
      expect(await immediateSale({ id: randomUUID(), contactId: null, items: [{ variantId: a.variantIds[0], quantity: 100 }] },
        { companyId: a.companyId, sellerId: a.sellerId })).toMatchObject({ error: { code: "INSUFFICIENT_STOCK" } });
      expect((await prisma.company.findUniqueOrThrow({ where: { id: a.companyId } })).nextOrderNumber).toBe(before.nextOrderNumber);
      expect(await prisma.order.count()).toBe(count);
      const existing = await prisma.order.findFirstOrThrow();
      await expect(prisma.order.update({ where: { id: existing.id }, data: { number: 0n } })).rejects.toThrow();
      const another = await prisma.order.findFirstOrThrow({ where: { id: { not: existing.id } } });
      await expect(prisma.order.update({ where: { id: another.id }, data: { number: existing.number } })).rejects.toThrow();
      await prisma.company.update({ where: { id: a.companyId }, data: { nextOrderNumber: 9007199254740991n } });
      expect(await create(a)).toMatchObject({ data: { number: Number.MAX_SAFE_INTEGER } });
      expect(await create(a)).toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
      expect((await prisma.company.findUniqueOrThrow({ where: { id: a.companyId } })).nextOrderNumber).toBe(9007199254740992n);
    });
  } finally { errorLog.mockRestore(); await a.cleanup(); await b.cleanup(); }
});

test("buyer snapshots stay independent of contacts and preserve guest buyers in reads and filters", async () => {
  const a = await fixture();
  const b = await fixture();
  const create = (f: typeof a, contactId: string | null) => withTenantIsolation(f.companyId, () => orders.create({ id: randomUUID() as OrderId, contactId: contactId as ContactId | null,
    items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId }));
  try {
    const contactOrder = await create(a, a.contactId);
    const guestOrder = await create(a, null);
    const anonymousOrder = await create(a, null);
    const foreignOrder = await create(b, b.contactId);
    if (!contactOrder.success || !guestOrder.success || !anonymousOrder.success || !foreignOrder.success) throw new Error("Fixture creation failed");
    expect(contactOrder.data).toMatchObject({ buyer: { contactId: a.contactId, name: null, phone: "+51999999999" }, checkoutEnabledAt: null, checkoutConfirmedAt: null });
    await withTenantIsolation(a.companyId, async () => {
      await prisma.contact.update({ where: { id: a.contactId }, data: { name: "New global name", phone: "+51988888888" } });
      expect(await orderDetail(contactOrder.data.id, a)).toMatchObject({ data: { buyer: { name: null, phone: "+51999999999" } } });
      await prisma.orderBuyer.create({ data: { orderId: guestOrder.data.id, name: "Guest", phone: "+14155552671" } });
      expect(await orderDetail(guestOrder.data.id, a)).toMatchObject({ data: { buyer: { contactId: null, name: "Guest" } } });
      const context = { companyId: a.companyId as CompanyId, userId: a.sellerId as UserId };
      expect(await orders.listAggregates({ page: 1, customer: { kind: "general_public" } }, context))
        .toMatchObject({ data: { total: 1, items: [{ id: anonymousOrder.data.id, buyer: null }] } });
      expect(await orders.listAggregates({ page: 1, customer: { kind: "contact", contactId: a.contactId as ContactId } }, context))
        .toMatchObject({ data: { total: 1, items: [{ id: contactOrder.data.id }] } });
      expect(await prisma.orderBuyer.findUnique({ where: { orderId: foreignOrder.data.id } })).toBeNull();
      expect(await prisma.orderBuyer.updateMany({ where: { orderId: foreignOrder.data.id }, data: { name: "Forbidden" } })).toEqual({ count: 0 });
      await expect(prisma.orderBuyer.create({ data: { companyId: b.companyId, orderId: anonymousOrder.data.id, phone: "+14155552671" } })).rejects.toThrow();
      await expect(prisma.orderBuyer.create({ data: { orderId: anonymousOrder.data.id, contactId: b.contactId, phone: "+14155552671" } })).rejects.toThrow();
      await expect(prisma.orderBuyer.create({ data: { orderId: guestOrder.data.id, phone: "+14155552671" } })).rejects.toThrow();
      await expect(prisma.order.update({ where: { id: guestOrder.data.id }, data: { checkoutConfirmedAt: new Date() } })).rejects.toThrow();
    });
    expect(await systemPrisma.orderBuyer.findMany()).toEqual([]);
  } finally { await a.cleanup(); await b.cleanup(); }
});

function checkoutInput(name = "Ana") {
  const buyer = parseBuyer({ name, phone: "+14155552671" });
  if (!buyer.success) throw new Error("Invalid test buyer");
  return { buyer: buyer.data, expectedTotal: { amount: 0.1, currency: "PEN" as const } };
}

async function pendingCheckout(f: Awaited<ReturnType<typeof fixture>>, contactId: string | null = null) {
  return withTenantIsolation(f.companyId, async () => {
    const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
    const created = await orders.create({ id: randomUUID() as OrderId, contactId: contactId as ContactId | null,
      items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context);
    if (!created.success) throw new Error("Fixture creation failed");
    return { access: { companyId: context.companyId, orderId: created.data.id }, context, order: created.data };
  });
}

test("checkout enable and confirmation are idempotent under real concurrent transactions", async () => {
  const f = await fixture();
  const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
  try {
    const { access, context, order } = await pendingCheckout(f, f.contactId);
    expect(await orders.getCheckout(access)).toMatchObject({ error: { code: "CHECKOUT_UNAVAILABLE" } });
    const links = await Promise.all(Array.from({ length: 3 }, () => withTenantIsolation(f.companyId, () => orders.enableCheckout(access.orderId, context))));
    expect(links.every((link) => link.success)).toBe(true);
    expect(new Set(links.flatMap((link) => link.success ? [link.data.url] : [])).size).toBe(1);
    expect(links[0]).toMatchObject({ data: { url: `${process.env.BETTER_AUTH_URL}/checkout/${access.companyId}/${access.orderId}` } });
    expect(info.mock.calls.filter(([fields]) => typeof fields === "object" && fields && "event" in fields && fields.event === "order_checkout_enabled")).toHaveLength(1);
    const confirmations = await Promise.all(["Ana", "Other"].map((name) => orders.confirmCheckout(checkoutInput(name), access)));
    expect(confirmations.every((result) => result.success)).toBe(true);
    expect(confirmations[0]).toEqual(confirmations[1]);
    const original = confirmations[0];
    expect(await orders.confirmCheckout({ ...checkoutInput("Replacement"), expectedTotal: { amount: 1, currency: "USD" } }, access)).toEqual(original);
    expect(info.mock.calls.filter(([fields]) => typeof fields === "object" && fields && "event" in fields && fields.event === "order_checkout_confirmed")).toHaveLength(1);
    const stored = await withTenantIsolation(f.companyId, () => orderDetail(access.orderId, f));
    if (!stored.success) throw new Error("Unable to read confirmed order");
    expect({ ...stored.data, buyer: order.buyer, checkoutEnabledAt: null, checkoutConfirmedAt: null }).toEqual(order);
    expect(stored.data.buyer?.contactId).toBe(f.contactId);
    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.contact.findUnique({ where: { id: f.contactId } })).toMatchObject({ name: null, phone: "+51999999999" });
      expect(await prisma.orderBuyer.count({ where: { orderId: access.orderId } })).toBe(1);
      expect(await prisma.payment.count()).toBe(0);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(3n);
    });
  } finally { info.mockRestore(); await f.cleanup(); }
});

test("checkout rejects changed totals and rolls back buyer writes when confirmation cannot be saved", async () => {
  const f = await fixture();
  try {
    for (const contactId of [null, f.contactId]) {
      const { access, context, order } = await pendingCheckout(f, contactId);
      await withTenantIsolation(f.companyId, () => orders.enableCheckout(access.orderId, context));
      expect(await orders.confirmCheckout({ ...checkoutInput(), expectedTotal: { amount: 10, currency: "PEN" } }, access)).toMatchObject({ error: { code: "TOTAL_CHANGED" } });
      expect(await orders.confirmCheckout({ ...checkoutInput(), expectedTotal: { amount: 0.1, currency: "USD" } }, access)).toMatchObject({ error: { code: "TOTAL_CHANGED" } });
      const failed = await withTenantIsolation(f.companyId, () => confirmOrderCheckout(checkoutInput(), access, new Date(), {
        transaction: (_company, work) => withinTransaction(work), findOrderForUpdate: findCheckoutOrderForUpdate, saveBuyer: saveCheckoutBuyer,
        saveConfirmed: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "Injected failure after buyer write" }),
      }));
      expect(failed).toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
      const stored = await withTenantIsolation(f.companyId, () => orderDetail(access.orderId, f));
      expect(stored).toMatchObject({ data: { buyer: order.buyer, checkoutConfirmedAt: null } });
      expect(await orders.confirmCheckout(checkoutInput(), access)).toMatchObject({ data: { state: { kind: "confirmed" } } });
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
      await prisma.payment.create({ data: { id: randomUUID(), orderId, amount: 0.1, currency: "PEN", method: "digital_wallet", status: "confirmed", data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "seller", userId: f.sellerId }, evidence: { kind: "manual" } } } });
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

test("public checkout checks company, live cancellation, enablement and complete stored data", async () => {
  const f = await fixture();
  const other = await fixture();
  try {
    const { access, context } = await pendingCheckout(f);
    const swapped: CheckoutAccess = { ...access, companyId: other.companyId as CompanyId };
    expect(await orders.getCheckout(swapped)).toMatchObject({ error: { code: "CHECKOUT_UNAVAILABLE" } });
    expect(await orders.confirmCheckout(checkoutInput(), access)).toMatchObject({ error: { code: "CHECKOUT_UNAVAILABLE" } });
    await withTenantIsolation(f.companyId, () => orders.enableCheckout(access.orderId, context));
    expect(await orders.confirmCheckout(checkoutInput(), swapped)).toMatchObject({ error: { code: "CHECKOUT_UNAVAILABLE" } });
    await withTenantIsolation(f.companyId, async () => {
      await prisma.order.update({ where: { id: access.orderId }, data: { checkoutEnabledAt: new Date("2000-01-01") } });
      expect(await orders.cancel(access.orderId, context)).toMatchObject({ success: true });
    });
    expect(await orders.getCheckout(access)).toMatchObject({ data: { state: { kind: "cancelled" } } });
    expect(await orders.confirmCheckout(checkoutInput(), access)).toMatchObject({ error: { code: "ORDER_CANCELLED" } });
    const completed = await withTenantIsolation(f.companyId, () => immediateSale({ id: randomUUID(), contactId: null, items: [{ variantId: f.variantIds[0], quantity: 1 }] }, { companyId: f.companyId, sellerId: f.sellerId }));
    if (!completed.success) throw new Error("Immediate sale failed");
    const delivered = { companyId: access.companyId, orderId: completed.data.id };
    await withTenantIsolation(f.companyId, () => orders.enableCheckout(delivered.orderId, context));
    expect(await orders.confirmCheckout(checkoutInput(), delivered)).toMatchObject({ data: { state: { kind: "confirmed" } } });
    await withTenantIsolation(f.companyId, async () => await prisma.orderBuyer.update({ where: { orderId: delivered.orderId }, data: { name: null } }));
    expect(await orders.getCheckout(delivered)).toMatchObject({ error: { code: "INVALID_CHECKOUT" } });
  } finally { await f.cleanup(); await other.cleanup(); }
});

test("confirmation observes total changes and cancellation committed by a concurrent lock holder", async () => {
  const f = await fixture();
  try {
    for (const change of ["total", "cancel"] as const) {
      const { access, context } = await pendingCheckout(f);
      await withTenantIsolation(f.companyId, () => orders.enableCheckout(access.orderId, context));
      const locked = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const mutation = withTenantIsolation(f.companyId, () => withinTransaction(async () => {
        const found = await findOrderForUpdate(access.orderId, access.companyId);
        if (!found.success) throw new Error("Could not lock fixture");
        locked.resolve();
        await release.promise;
        await prisma.order.update({ where: { id: access.orderId }, data: change === "total" ? { total: 1, deliveryCost: 0.9, deliveryCharge: 0.9,
          delivery: { method: "home", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } }, destination: { address: "Av. Lima 123", district: "Lima", instructions: null }, recordedBy: { kind: "seller", userId: f.sellerId } } } : { cancelled: true } });
        return ok(null);
      }));
      await locked.promise;
      const confirmation = orders.confirmCheckout(checkoutInput(), access);
      release.resolve();
      await mutation;
      expect(await confirmation).toMatchObject({ error: { code: change === "total" ? "TOTAL_CHANGED" : "ORDER_CANCELLED" } });
      await withTenantIsolation(f.companyId, async () => {
        expect(await prisma.order.findUniqueOrThrow({ where: { id: access.orderId } })).toMatchObject({ checkoutConfirmedAt: null });
        expect(await prisma.orderBuyer.count({ where: { orderId: access.orderId } })).toBe(0);
      });
    }
  } finally { await f.cleanup(); }
});

test("checkout persistence failure produces one technical log and no confirmation hito", async () => {
  const f = await fixture();
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
  let write: ReturnType<typeof vi.spyOn> | undefined;
  try {
    const { access, context } = await pendingCheckout(f);
    await withTenantIsolation(f.companyId, () => orders.enableCheckout(access.orderId, context));
    info.mockClear();
    write = vi.spyOn(prisma.orderBuyer, "upsert").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("private database detail", { code: "P2003", clientVersion: "7.10.0" }));
    expect(await orders.confirmCheckout(checkoutInput(), access)).toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ event: "unable_to_save_order_buyer", errorCode: "PERSISTENCE_UNAVAILABLE" }), "Checkout persistence failed");
    expect(info).not.toHaveBeenCalled();
    write.mockRestore();
    expect(await orders.getCheckout(access)).toMatchObject({ data: { buyer: null, state: { kind: "pending" } } });
  } finally { write?.mockRestore(); error.mockRestore(); info.mockRestore(); await f.cleanup(); }
});


test("confirmation committed first survives a concurrent total update or cancellation", async () => {
  const f = await fixture();
  try {
    for (const change of ["total", "cancel"] as const) {
      const { access, context } = await pendingCheckout(f);
      await withTenantIsolation(f.companyId, () => orders.enableCheckout(access.orderId, context));
      const locked = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const confirmation = withTenantIsolation(f.companyId, () => confirmOrderCheckout(checkoutInput(), access, new Date(), {
        transaction: (_company, work) => withinTransaction(work),
        findOrderForUpdate: async (scope) => {
          const found = await findCheckoutOrderForUpdate(scope);
          locked.resolve();
          await release.promise;
          return found;
        },
        saveBuyer: saveCheckoutBuyer, saveConfirmed: saveCheckoutConfirmed,
      }));
      await locked.promise;
      const mutation = withTenantIsolation(f.companyId, () => withinTransaction(async () => {
        const found = await findOrderForUpdate(access.orderId, access.companyId);
        if (!found.success) return found;
        await prisma.order.update({ where: { id: access.orderId }, data: change === "cancel" ? { cancelled: true } : {
          total: 1, deliveryCost: 0.9, deliveryCharge: 0.9,
          delivery: { method: "home", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } }, destination: { address: "Av. Lima 123", district: "Lima", instructions: null }, recordedBy: { kind: "seller", userId: f.sellerId } },
        } });
        return ok(null);
      }));
      release.resolve();
      expect(await confirmation).toMatchObject({ success: true });
      expect(await mutation).toMatchObject({ success: true });
      expect(await orders.getCheckout(access)).toMatchObject({ data: {
        state: { kind: change === "cancel" ? "cancelled" : "confirmed" }, buyer: checkoutInput().buyer,
      } });
      await withTenantIsolation(f.companyId, async () => {
        expect((await prisma.order.findUniqueOrThrow({ where: { id: access.orderId } })).checkoutConfirmedAt).toBeInstanceOf(Date);
        expect(await prisma.orderBuyer.count({ where: { orderId: access.orderId } })).toBe(1);
      });
    }
  } finally { await f.cleanup(); }
});

test("interleaved public reads and confirmations retain their own company and buyer", async () => {
  const fixtures = await Promise.all([fixture(), fixture()]);
  try {
    const cases = await Promise.all(fixtures.map(async (f) => {
      const checkout = await pendingCheckout(f);
      await withTenantIsolation(f.companyId, () => orders.enableCheckout(checkout.access.orderId, checkout.context));
      return checkout;
    }));
    const results = await Promise.all(cases.map(async ({ access }, index) => {
      expect(await orders.getCheckout(access)).toMatchObject({ data: { buyer: null } });
      const input = checkoutInput(index ? "Bruno" : "Ana");
      expect(await orders.confirmCheckout(input, access)).toMatchObject({ data: { buyer: input.buyer } });
      return orders.getCheckout(access);
    }));
    expect(results[0]).toMatchObject({ data: { buyer: { name: "Ana" } } });
    expect(results[1]).toMatchObject({ data: { buyer: { name: "Bruno" } } });
    for (const [index, { access }] of cases.entries()) {
      const other = cases[1 - index];
      expect(await orders.getCheckout({ ...access, companyId: other.access.companyId })).toMatchObject({ error: { code: "CHECKOUT_UNAVAILABLE" } });
    }
  } finally { await Promise.all(fixtures.map((f) => f.cleanup())); }
});


test("a real deferred commit failure rolls back checkout and emits no successful transition", async () => {
  const f = await fixture();
  const admin = new pg.Client({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
  const trigger = `checkout_commit_${randomUUID().replaceAll("-", "")}`;
  const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  await admin.connect();
  try {
    const { access, context } = await pendingCheckout(f);
    await withTenantIsolation(f.companyId, () => orders.enableCheckout(access.orderId, context));
    info.mockClear();
    // This tenant's writes succeed, then PostgreSQL rejects COMMIT itself.
    await admin.query(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Injected deferred checkout failure' USING ERRCODE = '23514'; END $$;
      CREATE CONSTRAINT TRIGGER "${trigger}" AFTER UPDATE ON "Order" DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW WHEN (NEW."companyId" = '${f.companyId}'::uuid) EXECUTE FUNCTION "${trigger}"()`);
    expect(await orders.confirmCheckout(checkoutInput(), access)).toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
    expect(info).not.toHaveBeenCalled();
    expect(error.mock.calls).toHaveLength(1);
    expect(error.mock.calls[0][0]).toMatchObject({ event: "unable_to_complete_order_transaction" });
    expect(await orders.getCheckout(access)).toMatchObject({ data: { buyer: null, state: { kind: "pending" } } });
    await admin.query(`DROP TRIGGER "${trigger}" ON "Order"; DROP FUNCTION "${trigger}"()`);
    expect(await orders.confirmCheckout(checkoutInput(), access)).toMatchObject({ data: { state: { kind: "confirmed" } } });
  } finally {
    await admin.query(`DROP TRIGGER IF EXISTS "${trigger}" ON "Order"; DROP FUNCTION IF EXISTS "${trigger}"()`);
    await admin.end();
    info.mockRestore(); error.mockRestore(); await f.cleanup();
  }
});


test("filters mixed orders before pagination with literal buyer search and independent pending states", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      await prisma.contact.update({ where: { id: f.contactId }, data: { name: "Ana_100%" } });
      const ids: OrderId[] = [];
      for (let index = 0; index < 22; index++) {
        const id = randomUUID() as OrderId;
        const result = await orders.create({ id, contactId: f.contactId as ContactId,
          items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context);
        expect(result.success).toBe(true);
        ids.push(id);
      }
      const completed = await immediateSale({ id: randomUUID(), contactId: null,
        items: [{ variantId: f.variantIds[0], quantity: 1 }] }, f);
      expect(completed.success).toBe(true);
      await prisma.order.update({ where: { id: ids[0] }, data: { cancelled: true } });
      const criteria = { page: 1, customer: { kind: "all" as const } };
      const unpaid = await orders.listAggregates({ ...criteria, view: "unpaid" }, context);
      expect(unpaid).toMatchObject({ success: true, data: { total: 21 } });
      if (unpaid.success) expect(unpaid.data.items).toHaveLength(20);
      expect(await orders.listAggregates({ ...criteria, page: 2, view: "unpaid" }, context))
        .toMatchObject({ success: true, data: { total: 21, items: [expect.objectContaining({ cancelled: false })] } });
      expect(await orders.listAggregates({ ...criteria, view: "undelivered" }, context))
        .toMatchObject({ success: true, data: { total: 21 } });
      expect(await orders.listAggregates({ ...criteria, search: "  ana_100%  " }, context))
        .toMatchObject({ success: true, data: { total: 22 } });
      expect(await orders.listAggregates({ ...criteria, search: "anaX100" }, context))
        .toMatchObject({ success: true, data: { total: 0 } });
      expect(await orders.listAggregates({ ...criteria, search: "999999999" }, context))
        .toMatchObject({ success: true, data: { total: 22 } });
      const paymentId = randomUUID() as PaymentId;
      expect(await orders.registerPayment({ orderId: ids[1], paymentId, amount: { amount: 0.05, currency: "PEN" },
        method: "digital_wallet", deductStockIfPartial: false }, context)).toMatchObject({ success: true });
      expect(await orders.listAggregates({ ...criteria, view: "unpaid" }, context)).toMatchObject({ success: true, data: { total: 21 } });
      expect(await orders.registerPayment({ orderId: ids[1], paymentId: randomUUID() as PaymentId,
        amount: { amount: 0.05, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, context)).toMatchObject({ success: true });
      expect(await orders.listAggregates({ ...criteria, view: "unpaid" }, context)).toMatchObject({ success: true, data: { total: 20 } });
      expect(await orders.listAggregates({ ...criteria, view: "undelivered" }, context)).toMatchObject({ success: true, data: { total: 21 } });
      expect(await orders.voidPayment({ orderId: ids[1], paymentId }, context)).toMatchObject({ success: true });
      expect(await orders.listAggregates({ ...criteria, view: "unpaid" }, context)).toMatchObject({ success: true, data: { total: 21 } });
      if (completed.success) {
        expect(await orders.listAggregates({ ...criteria, search: `#${completed.data.number}` }, context))
          .toMatchObject({ success: true, data: { total: 1, items: [{ id: completed.data.id }] } });
        expect(await orders.listAggregates({ ...criteria, search: `#${completed.data.number}`, view: "unpaid" }, context))
          .toMatchObject({ success: true, data: { total: 0 } });
      }
    });
  } finally { await f.cleanup(); }
});


test.each([
  { amount: null, partial: false, immediate: false, deducted: false },
  { amount: 0.1, partial: false, immediate: false, deducted: false },
  { amount: 0.1, partial: true, immediate: false, deducted: true },
  { amount: 0.2, partial: false, immediate: false, deducted: true },
  { amount: 0.2, partial: false, immediate: true, deducted: true },
])("complete creation preserves payment and delivery choices: %j", async ({ amount, partial, immediate, deducted }) => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const id = randomUUID() as OrderId;
      const paymentId = randomUUID() as PaymentId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      const result = await createConfiguredOrder({ id, contactId: f.contactId as ContactId,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }],
        payments: amount === null ? [] : [{ paymentId, amount: { amount, currency: "PEN" }, method: "bank_transfer", deductStockIfPartial: partial }],
        deliverImmediately: immediate }, context);
      expect(result).toMatchObject({ success: true, data: { stockDeducted: deducted,
        deliveryStatus: immediate ? "delivered" : "pending", completedAt: immediate ? expect.any(Date) : null } });
      const saved = await findOrderAggregate(id, context.companyId);
      expect(saved).toEqual(result);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(deducted ? 1n : 3n);
      expect(await prisma.payment.count()).toBe(amount === null ? 0 : 1);
    });
  } finally { await f.cleanup(); }
});

test.each([true, false])("complete creation rejects legacy delivery without persisting order or payments (charge: %s)", async (chargeDeliveryToCustomer) => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      const input = { id: randomUUID(), contactId: null, items: [{ variantId: f.variantIds[0], quantity: 2 }],
        payments: [{ paymentId: randomUUID(), amount: { amount: 0.2, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }],
        delivery: { delivery: { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } }, chargeDeliveryToCustomer } };
      expect(await createConfiguredOrder(input as unknown as CreateCompleteOrderInput, context)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.orderItem.count()).toBe(0);
      expect(await prisma.payment.count()).toBe(0);
      expect((await prisma.productStock.findMany()).map(stock => stock.quantity)).toEqual([3n, 3n]);
    });
  } finally { await f.cleanup(); }
});

test("complete creation resolves delivery charge before coverage and retains its snapshot", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      expect(await deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, couriers: [],
        home: { enabled: true }, store: { enabled: false, pickupPoint: null } }, context)).toMatchObject({ success: true });
      expect(await deliverySettings.saveZones({ method: "home", expectedVersion: 1, zones: [{ kind: "new", name: "Creation zone", enabled: true,
        districtCodes: ["150122"], price: { amount: 0.1, currency: "PEN" } }] }, context)).toMatchObject({ success: true });
      const quote = await deliverySettings.createQuotation({ companyId: f.companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
      if (!quote.success || !quote.data.rates[0]) throw new Error("Missing creation rate");
      const id = randomUUID() as OrderId;
      const parsed = parseRatedDeliverySelection({ method: "home", rateId: quote.data.rates[0].id,
        recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
        destination: { address: "Av. Lima 123", districtCode: "150122", instructions: "Door 2" } });
      if (!parsed.success) throw new Error(parsed.error.message);
      const delivery = parsed.data;
      const result = await createConfiguredOrder({ id, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }],
        delivery: { delivery, expectedPrice: { amount: 0.1, currency: "PEN" } },
        payments: [{ paymentId: randomUUID() as PaymentId, amount: { amount: 0.2, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }] },
      context);
      expect(result).toMatchObject({ success: true, data: { delivery: { method: "home", destination: { districtCode: "150122", address: "Av. Lima 123" },
        pricing: { rateId: quote.data.rates[0].id, quotationId: quote.data.quotation.id } }, deliveryCost: { amount: 0.1 }, deliveryCharge: { amount: 0.1 },
        total: { amount: 0.3 }, stockDeducted: false, completedAt: null } });
      expect(await findOrderAggregate(id, context.companyId)).toEqual(result);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(3n);
    });
  } finally { await f.cleanup(); }
});

test.each(["payment", "stock", "delivery", "fulfillment"] as const)("complete creation rolls back every write after %s failure", async (failure) => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      const input: CreateCompleteOrderInput = { id: randomUUID() as OrderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: (failure === "stock" ? 4 : 2) as PositiveInteger }],
        payments: [{ paymentId: randomUUID() as PaymentId, amount: { amount: 0.1, currency: "PEN" as const },
          method: "digital_wallet" as const, deductStockIfPartial: true },
        ...(failure === "payment" ? [{ paymentId: randomUUID() as PaymentId, amount: { amount: -1, currency: "PEN" as const },
          method: "bank_transfer" as const, deductStockIfPartial: false }] : [])],
        deliverImmediately: failure === "fulfillment",
        ...(failure === "delivery" ? { delivery: { delivery: { method: "store" as const,
          recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } } }, expectedPrice: { amount: 0, currency: "PEN" as const } } } : {}) };
      expect(await createConfiguredOrder(input, context)).toMatchObject({ success: false });
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.orderItem.count()).toBe(0);
      expect(await prisma.payment.count()).toBe(0);
      expect((await prisma.productStock.findMany()).map(item => item.quantity)).toEqual([3n, 3n]);
    });
  } finally { await f.cleanup(); }
});

test("concurrent complete creations with the same IDs save and deduct only once", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      const input: CreateCompleteOrderInput = { id: randomUUID() as OrderId, contactId: null,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }],
        payments: [{ paymentId: randomUUID() as PaymentId, amount: { amount: 0.2, currency: "PEN" as const },
          method: "digital_wallet" as const, deductStockIfPartial: false }], deliverImmediately: true };
      const results = await Promise.all([createConfiguredOrder(input, context), createConfiguredOrder(input, context)]);
      expect(results.filter(result => result.success)).toHaveLength(1);
      expect(results.find(result => !result.success)).toMatchObject({ error: { code: "ORDER_ALREADY_EXISTS" } });
      expect(await prisma.order.count()).toBe(1);
      expect(await prisma.payment.count()).toBe(1);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(1n);
    });
  } finally { await f.cleanup(); }
});


test("rated assignment and initial creation persist prices atomically and deduct covered stock exactly once", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      const saved = await deliverySettings.saveZones({ method: "home", expectedVersion: 0, zones: [0, 8].map(amount => ({
        kind: "new" as const, name: "Zone", enabled: true, districtCodes: ["150122"], price: { amount, currency: "PEN" as const },
      })) }, context);
      if (!saved.success) throw new Error(saved.error.message);
      expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, couriers: [],
        store: { enabled: false, pickupPoint: null } }, context)).success).toBe(true);
      const quote = await deliverySettings.createQuotation({ companyId: f.companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
      if (!quote.success) throw new Error(quote.error.message);
      const selection = (amount: number) => {
        const rate = quote.data.rates.find(value => value.price.amount === amount);
        if (!rate) throw new Error("Expected option");
        const parsed = parseRatedDeliverySelection({ method: "home", rateId: rate.id, recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
          destination: { districtCode: "150122", address: "Street", instructions: null } });
        if (!parsed.success) throw new Error(parsed.error.message);
        return parsed.data;
      };
      const orderId = randomUUID() as OrderId;
      expect((await orders.create({ id: orderId, contactId: null, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] }, context)).success).toBe(true);
      await prisma.payment.create({ data: { id: randomUUID(), orderId, status: "confirmed", currency: "PEN", amount: 0.2, method: "digital_wallet",
        data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "seller", userId: f.sellerId }, evidence: { kind: "manual" } } } });
      expect(await orders.setDelivery({ orderId, delivery: selection(8), expectedPrice: { amount: 8, currency: "PEN" } }, context))
        .toMatchObject({ success: true, data: { total: { amount: 8.2 }, deliveryCost: { amount: 8 }, deliveryCharge: { amount: 8 }, stockDeducted: false,
          delivery: { pricing: { quotationId: quote.data.quotation.id, settingsVersion: 2 }, recordedBy: { kind: "seller", userId: f.sellerId } } } });
      const before = await orderDetail(orderId, f);
      const changed = await deliverySettings.saveZones({ method: "home", expectedVersion: 2, zones: saved.data.zones.map(zone => ({
        kind: "existing" as const, id: zone.id, name: zone.name, enabled: zone.enabled, districtCodes: zone.districtCodes,
        price: { amount: zone.price.amount === 8 ? 10 : 0, currency: "PEN" as const },
      })) }, context);
      expect(changed.success).toBe(true);
      expect(await orders.setDelivery({ orderId, delivery: selection(8), expectedPrice: { amount: 8, currency: "PEN" } }, context))
        .toMatchObject({ success: false, error: { code: "TOTAL_CHANGED", currentPrice: { amount: 10 } } });
      expect(await orderDetail(orderId, f)).toEqual(before);
      expect((await prisma.productStock.findUnique({ where: { variantId: f.variantIds[0] } }))?.quantity).toBe(3n);
      const rejectedId = randomUUID() as OrderId;
      expect(await createConfiguredOrder({ id: rejectedId, contactId: null, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }],
        delivery: { delivery: selection(8), expectedPrice: { amount: 8, currency: "PEN" } } }, context))
        .toMatchObject({ success: false, error: { code: "TOTAL_CHANGED" } });
      expect(await prisma.order.findUnique({ where: { id: rejectedId } })).toBeNull();
      const free = { orderId, delivery: selection(0), expectedPrice: { amount: 0, currency: "PEN" as const } };
      expect(await orders.setDelivery(free, context)).toMatchObject({ success: true, data: { total: { amount: 0.2 }, deliveryCost: { amount: 0 },
        deliveryCharge: { amount: 0 }, stockDeducted: true } });
      expect((await prisma.productStock.findUnique({ where: { variantId: f.variantIds[0] } }))?.quantity).toBe(1n);
      expect((await orders.setDelivery(free, context)).success).toBe(true);
      expect((await prisma.productStock.findUnique({ where: { variantId: f.variantIds[0] } }))?.quantity).toBe(1n);
      const failedId = randomUUID() as OrderId;
      expect(await createConfiguredOrder({ id: failedId, contactId: null, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }],
        delivery: { delivery: selection(0), expectedPrice: { amount: 0, currency: "PEN" } },
        payments: [{ paymentId: randomUUID() as PaymentId, amount: { amount: 0.2, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }] }, context))
        .toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK" } });
      expect(await prisma.order.findUnique({ where: { id: failedId } })).toBeNull();
      expect(await prisma.payment.count()).toBe(1);
      const newId = randomUUID() as OrderId;
      expect(await createConfiguredOrder({ id: newId, contactId: null, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }],
        delivery: { delivery: selection(0), expectedPrice: { amount: 0, currency: "PEN" } },
        payments: [{ paymentId: randomUUID() as PaymentId, amount: { amount: 0.1, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }] }, context))
        .toMatchObject({ success: true, data: { total: { amount: 0.1 }, stockDeducted: true, delivery: { pricing: { quotationId: quote.data.quotation.id } } } });
      expect((await prisma.productStock.findUnique({ where: { variantId: f.variantIds[0] } }))?.quantity).toBe(0n);
      expect(await prisma.deliveryRate.count()).toBe(2);
    });
  } finally { await f.cleanup(); }
});


test("checkout delivery, buyer, confirmation and covered stock commit together and roll back on failure", async () => {
  const f = await fixture();
  try {
    const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
    const buyer = parseBuyer({ name: "Ana", phone: "+51987654321" });
    if (!buyer.success) throw new Error("Invalid buyer");
    const parsed = parseRatedDeliverySelection({ method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } });
    if (!parsed.success) throw new Error("Invalid pickup");
    const input = { buyer: buyer.data, expectedTotal: { amount: 0.2, currency: "PEN" as const },
      delivery: { kind: "replace" as const, selection: parsed.data, expectedPrice: { amount: 0, currency: "PEN" as const } } };
    await withTenantIsolation(f.companyId, async () => {
      expect((await deliverySettings.save({ expectedVersion: 0, home: { enabled: false }, agency: { enabled: false }, couriers: [],
        store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } }, context)).success).toBe(true);
    });
    const create = async (quantity: number) => {
      const id = randomUUID() as OrderId;
      await withTenantIsolation(f.companyId, async () => {
        expect((await orders.create({ id, contactId: null, items: [{ variantId: f.variantIds[0] as VariantId, quantity: quantity as PositiveInteger }] }, context)).success).toBe(true);
        await prisma.order.update({ where: { id }, data: { checkoutEnabledAt: new Date() } });
        await prisma.payment.create({ data: { id: randomUUID(), orderId: id, status: "confirmed", currency: "PEN", amount: quantity * 0.1,
          method: "digital_wallet", data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "seller", userId: f.sellerId }, evidence: { kind: "manual" } } } });
      });
      return { companyId: context.companyId, orderId: id };
    };
    const access = await create(2);
    expect(await orders.confirmCheckoutDelivery({ ...input, expectedTotal: { amount: 1, currency: "PEN" } }, access))
      .toMatchObject({ error: { code: "TOTAL_CHANGED" } });
    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.order.findUnique({ where: { id: access.orderId } })).toMatchObject({ delivery: null, checkoutConfirmedAt: null, stockDeducted: false });
      expect(await prisma.orderBuyer.findUnique({ where: { orderId: access.orderId } })).toBeNull();
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(3n);
    });
    const results = await Promise.all([orders.confirmCheckoutDelivery(input, access), orders.confirmCheckoutDelivery(input, access)]);
    expect(results.every(result => result.success)).toBe(true);
    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.order.findUnique({ where: { id: access.orderId } })).toMatchObject({ delivery: { recordedBy: { kind: "buyer" }, settingsVersion: 1 }, stockDeducted: true });
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(1n);
      expect(await prisma.payment.count()).toBe(1);
    });
    const insufficient = await create(2);
    expect(await orders.confirmCheckoutDelivery(input, insufficient)).toMatchObject({ error: { code: "INSUFFICIENT_STOCK" } });
    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.order.findUnique({ where: { id: insufficient.orderId } })).toMatchObject({ delivery: null, checkoutConfirmedAt: null, stockDeducted: false });
      expect(await prisma.orderBuyer.findUnique({ where: { orderId: insufficient.orderId } })).toBeNull();
    });
    const failed = await create(1);
    await withTenantIsolation(f.companyId, async () => {
      expect(await confirmCheckoutDelivery({ ...input, expectedTotal: { amount: 0.1, currency: "PEN" } }, failed, new Date(), {
        transaction: (_company, work) => withinTransaction(work), findOrderForUpdate: findCheckoutOrderForUpdate,
        saveDelivery, deductProductStock, saveStockDeduction, saveBuyer: saveCheckoutBuyer,
        saveConfirmed: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "Confirmation failed" }),
        getStoreSettings: deliverySettings.getForCompany, resolveSelectedDeliveryRate: deliverySettings.resolveSelectedDeliveryRate,
      })).toMatchObject({ error: { code: "PERSISTENCE_UNAVAILABLE" } });
      expect(await prisma.order.findUnique({ where: { id: failed.orderId } })).toMatchObject({ delivery: null, checkoutConfirmedAt: null, stockDeducted: false });
      expect(await prisma.orderBuyer.findUnique({ where: { orderId: failed.orderId } })).toBeNull();
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(1n);
    });
  } finally { await f.cleanup(); }
});


test("checkout validates immutable home rate and current price before total and preserves confirmed snapshots", async () => {
  const f = await fixture();
  try {
    const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
    const access = { companyId: context.companyId, orderId: randomUUID() as OrderId };
    const buyer = parseBuyer({ name: "Ana", phone: "+51987654321" });
    if (!buyer.success) throw new Error("Invalid buyer");
    const prepare = await withTenantIsolation(f.companyId, async () => {
      const saved = await deliverySettings.saveZones({ method: "home", expectedVersion: 0,
        zones: [{ kind: "new", name: "Home", enabled: true, districtCodes: ["150122"], price: { amount: 8, currency: "PEN" } }] }, context);
      if (!saved.success) throw new Error(saved.error.message);
      expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, couriers: [], store: { enabled: false, pickupPoint: null } }, context)).success).toBe(true);
      expect((await orders.create({ id: access.orderId, contactId: null, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] }, context)).success).toBe(true);
      await prisma.order.update({ where: { id: access.orderId }, data: { checkoutEnabledAt: new Date() } });
      const quote = await deliverySettings.createQuotation({ companyId: f.companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
      if (!quote.success) throw new Error(quote.error.message);
      const selection = parseRatedDeliverySelection({ method: "home", rateId: quote.data.rates[0].id,
        recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } }, destination: { districtCode: "150122", address: "Street", instructions: null } });
      if (!selection.success) throw new Error(selection.error.message);
      const zone = saved.data.zones[0];
      expect((await deliverySettings.saveZones({ method: "home", expectedVersion: 2, zones: [{ kind: "existing", id: zone.id, name: zone.name, enabled: zone.enabled, districtCodes: zone.districtCodes, price: { amount: 10, currency: "PEN" } }] }, context)).success).toBe(true);
      return { selection: selection.data, zone };
    });
    const input = { buyer: buyer.data, delivery: { kind: "replace" as const, selection: prepare.selection, expectedPrice: { amount: 8, currency: "PEN" as const } }, expectedTotal: { amount: 10.2, currency: "PEN" as const } };
    expect(await orders.confirmCheckoutDelivery(input, access)).toMatchObject({ error: { code: "TOTAL_CHANGED", currentPrice: { amount: 10 } } });
    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.orderBuyer.findUnique({ where: { orderId: access.orderId } })).toBeNull();
      expect(await prisma.order.findUnique({ where: { id: access.orderId } })).toMatchObject({ delivery: null, checkoutConfirmedAt: null, stockDeducted: false });
      const quote = await deliverySettings.createQuotation({ companyId: f.companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
      if (!quote.success) throw new Error(quote.error.message);
      const selection = parseRatedDeliverySelection({ ...prepare.selection, rateId: quote.data.rates[0].id });
      if (!selection.success) throw new Error(selection.error.message);
      input.delivery.selection = selection.data;
      input.delivery.expectedPrice.amount = 10;
    });
    expect(await orders.confirmCheckoutDelivery({ ...input, expectedTotal: { amount: 0.2, currency: "PEN" } }, access)).toMatchObject({ error: { code: "TOTAL_CHANGED" } });
    expect(await orders.confirmCheckoutDelivery(input, access)).toMatchObject({ success: true, data: { total: { amount: 10.2 }, state: { kind: "confirmed" } } });
    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.order.findUnique({ where: { id: access.orderId } })).toMatchObject({ delivery: { recordedBy: { kind: "buyer" }, destination: { districtCode: "150122", district: "MIRAFLORES" } } });
      expect((await deliverySettings.saveZones({ method: "home", expectedVersion: 3, zones: [{ kind: "existing", id: prepare.zone.id, name: prepare.zone.name, districtCodes: prepare.zone.districtCodes, enabled: false, price: { amount: 11, currency: "PEN" } }] }, context)).success).toBe(true);
    });
    expect(await orders.confirmCheckoutDelivery({ ...input, expectedTotal: { amount: 1, currency: "PEN" } }, access)).toMatchObject({ success: true, data: { total: { amount: 10.2 } } });
    const checkout = await orders.getCheckout(access);
    expect(checkout).toMatchObject({ success: true, data: { deliveryCharge: { amount: 10 }, total: { amount: 10.2 },
      delivery: { method: "home", destination: { districtCode: "150122", address: "Street" } } } });
    if (!checkout.success) throw new Error("Expected persisted checkout");
    expect(checkout.data.delivery).not.toHaveProperty("recordedBy");
  } finally { await f.cleanup(); }
});
