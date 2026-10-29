import { toOrderAggregateJson, toOrderAggregateListJson } from "@core/src/features/orders/presentation/order-json";
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
import { orders, createConfiguredOrder } from "@core/src/features/orders/composition";
import { prisma, systemPrisma, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { buildPendingOrder, orderStateMachine, parseRatedDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import { findOpenChatOrderCandidate, findOrderAggregate, findOrderAggregates, findOrders, findOrderForUpdate, findChatOrderTargetForUpdate, recordProcessedMessage, saveItemChanges, saveDelivery, savePendingOrder, saveStockDeduction } from "@core/src/features/orders/infrastructure/order-repository";
import { storefrontConfig } from "@core/src/features/catalog/infrastructure/storefront-config";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import type { DeliveryZone } from "@core/src/features/delivery-settings/domain/delivery-zone";
import { deductProductStock, findProductIdsOfVariants } from "@core/src/features/products";
import * as products from "@core/src/features/products";
import { restoreCancelledStock } from "@core/src/composition/event-handlers";
import { applyChatActions, type ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { CompanyId, ContactId, OrderId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { ImageId } from "@core/src/features/orders/domain/payment";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import { catalogProductRepository } from "@core/src/features/products/infrastructure/catalog-products-repository";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";
import { seedProduct, deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";


async function fixture() {
  const companyId = randomUUID();
  const sellerId = randomUUID();
  const productId = randomUUID();
  const variantIds = [randomUUID(), randomUUID()];
  const contactId = randomUUID();
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Orders test", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    await seedProduct({ id: productId, name: "Sample product", qrCode: productId, variants: variantIds.map((variantId, index) => ({
      id: variantId, attributes: { Size: index ? "L" : "M" }, sku: `SKU-${variantId}`, salePrice: index ? 0.2 : 0.1, qrCode: variantId, stock: 3n })) });
    await prisma.contact.create({ data: { id: contactId, whatsappAccountId: "1@lid", whatsappLid: "2@lid" } });
  });
  return { companyId, sellerId, productId, variantIds, contactId, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany();
      await prisma.orderItem.deleteMany();
      await prisma.order.deleteMany();
      await prisma.chat.deleteMany();
      await prisma.contact.deleteMany();
      await deleteSeededProducts();
      await prisma.image.deleteMany();
      await systemPrisma.user.delete({ where: { id: sellerId } });
      await prisma.deliveryRate.deleteMany();
      await prisma.quotation.deleteMany();
      await prisma.deliveryOption.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany();
      await prisma.deliveryZone.deleteMany();
      await prisma.companyCourier.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
}

function immediateSale(input: { id: string; items: readonly { variantId: string; quantity: number }[] },
  context: { companyId: string; sellerId: string }) {
  const [first, ...rest] = input.items;
  if (!first) throw new Error("Test sale requires items");
  const item = (selection: typeof first) => ({ variantId: selection.variantId as VariantId, quantity: selection.quantity as PositiveInteger });
  return orders.registerImmediateSale({ id: input.id as OrderId,
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
      await orders.create({ id: orderId, 
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] },
      { companyId: access.companyId, userId: f.sellerId as UserId });
      await prisma.order.update({ where: { id: orderId }, data: { checkoutEnabledAt: new Date(), checkoutConfirmedAt: new Date(),
        buyer: { create: { name: "Ana", phone: "+51987654321" } } } });
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

test("round-trips a rejected payment with its report and reason", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const paymentId = randomUUID() as PaymentId;
      const receiptImageId = randomUUID() as ImageId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      await orders.create({ id: orderId, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] }, context);
      await prisma.order.update({ where: { id: orderId }, data: { checkoutEnabledAt: new Date(), checkoutConfirmedAt: new Date(),
        buyer: { create: { name: "Ana", phone: "+51987654321" } } } });
      await prisma.image.create({ data: { id: receiptImageId, storageKey: `test/${receiptImageId}` } });
      expect(await orders.reportPayment({ paymentId, receiptImageId }, { kind: "buyer", companyId: context.companyId, orderId })).toMatchObject({ success: true });
      const rejected = await orders.rejectPayment({ orderId, paymentId, reason: "El monto no coincide" }, context);
      expect(rejected).toMatchObject({ success: true, data: { applied: true } });
      const row = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(row).toMatchObject({ status: "rejected", amount: null, method: null, currency: "PEN" });
      expect(row.data).toMatchObject({ report: { receiptImageId }, rejectedBy: context.userId, reason: "El monto no coincide" });
      const loaded = await orderDetail(orderId, f);
      expect(loaded).toMatchObject({ success: true, data: { stockDeducted: false, payments: [{ id: paymentId, status: "rejected", currency: "PEN",
        data: { report: { receiptImageId, reportedAt: expect.any(Date) }, rejectedAt: expect.any(Date), rejectedBy: context.userId, reason: "El monto no coincide" } }] } });
      if (!rejected.success || !loaded.success) return;
      expect(loaded.data.payments).toEqual(rejected.data.order.payments);
      await prisma.payment.update({ where: { id: paymentId }, data: { amount: new Prisma.Decimal("1") } });
      expect(await orderDetail(orderId, f)).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
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
      await orders.create({ id: orderId, 
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] }, context);
      await prisma.order.update({ where: { id: orderId }, data: { checkoutEnabledAt: new Date(), checkoutConfirmedAt: new Date(),
        buyer: { create: { name: "Ana", phone: "+51987654321" } } } });
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
      const input = { id: orderId as OrderId, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] } as const;
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
      expect(await orders.create({ id: orderId, 
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
      expect(await orders.create({ id: orderId, items: [
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
      expect(await orders.create({ id: orderId, 
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
      expect(await orders.create({ id: orderId, 
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
      expect(await orders.create({ id: orderId, 
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
      expect(await orders.create({ id: orderId, 
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
      const result = await orders.registerImmediateSale({ id: orderId, 
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
      expect(await orders.registerImmediateSale({ id: orderId, 
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

test("cancelling before dispatch retains deducted stock for deferred restoration and preserves payments", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      expect(await orders.create({ id: orderId, 
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      expect(await orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId,
        amount: { amount: 0.2, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, context))
        .toMatchObject({ success: true, data: { stock: { kind: "deducted" } } });
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(1n);
      const before = await findOrderAggregate(orderId, context.companyId);
      expect(before.success).toBe(true);
      const cancellations = await Promise.all([orders.cancel(orderId, context), orders.cancel(orderId, context)]);
      for (const result of cancellations) expect(result).toMatchObject({ success: true,
        data: { cancelled: true, cancelledAt: expect.any(Date), stockDeducted: true, stockDeductedAt: expect.any(Date), payments: [{ amount: { amount: 0.2 } }] } });
      if (before.success && before.data) {
        expect(await findOrderAggregate(orderId, context.companyId)).toMatchObject({ data: { payments: before.data.payments } });
      }
      expect(await orders.cancel(orderId, context)).toMatchObject({ success: true, data: { cancelled: true, cancelledAt: expect.any(Date) } });
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(1n);
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
      expect(await orders.create({ id: orderId, 
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
      expect(await deliverySettings.saveZones({ expectedVersion: 0, zones: [0.1, 0].map(amount => ({
        kind: "new" as const, name: "Replacement zone", enabled: true, districtCodes: ["150122"], options: [{ kind: "new" as const, method: "home" as const, name: "Home", enabled: true, price: { amount, currency: "PEN" as const } }],
      })) }, context)).toMatchObject({ success: true });
      expect(await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, store: { enabled: false, pickupPoint: null } }, context)).toMatchObject({ success: true });
      const quote = await deliverySettings.createQuotation({ companyId: f.companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
      if (!quote.success) throw new Error(quote.error.message);
      const selection = (amount: number, address: string) => {
        const rate = quote.data.rates.find(value => value.rate.price.amount === amount)?.rate;
        if (!rate) throw new Error("Missing replacement rate");
        const parsed = parseRatedDeliverySelection({ method: "home", rateId: rate.id,
          recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
          destination: { districtCode: "150122", address, instructions: null } });
        if (!parsed.success) throw new Error(parsed.error.message);
        return parsed.data;
      };
      expect(await orders.create({ id: orderId, 
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
      const created = await immediateSale({ id: orderId, items: [
        { variantId: f.variantIds[0], quantity: 3 }, { variantId: f.variantIds[1], quantity: 2 },
      ] }, { companyId: f.companyId, sellerId: f.sellerId });
      expect(created).toMatchObject({ success: true, data: { total: { amount: 0.7, currency: "PEN" }, buyer: null } });
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
      expect(await immediateSale({ id: orderId, items: [{ variantId: f.variantIds[1], quantity: 1 }] }, { companyId: f.companyId, sellerId: f.sellerId }))
        .toMatchObject({ success: false, error: { code: "ORDER_ALREADY_EXISTS" } });
      await prisma.product.update({ where: { id: f.productId }, data: { name: "Changed product" } });
      await prisma.productOptionValue.updateMany({ where: { name: "M" }, data: { name: "XL" } });
      await prisma.productVariant.update({ where: { id: f.variantIds[0] }, data: { sku: `CHANGED-${f.variantIds[0]}`, salePrice: 3.5 } });
      const detail = await orderDetail(orderId, f);
      expect(detail).toMatchObject({ success: true, data: { buyer: null,
        items: expect.arrayContaining([expect.objectContaining({ productName: "Sample product", variantAttributes: { Size: "M" },
          sku: `SKU-${f.variantIds[0]}`, unitPrice: { amount: 0.1, currency: "PEN" }, subtotal: { amount: 0.3, currency: "PEN" } })]) } });
      const list = await orders.list({ page: 1, customer: { kind: "general_public" } });
      expect(list).toMatchObject({ success: true, data: { total: 1, pageSize: 20, items: [{ id: orderId }] } });
      expect(await orders.list({ page: 1, customer: { kind: "all" },
        completedFrom: new Date("2020-01-01"), completedBefore: new Date("2100-01-01") })).toMatchObject({ success: true, data: { total: 1 } });
      await prisma.productStock.delete({ where: { variantId: f.variantIds[0] } });
      await expect(prisma.productVariant.delete({ where: { id: f.variantIds[0] } })).rejects.toThrow(/OrderItem_companyId_variantId_fkey/);
      await expect(prisma.product.delete({ where: { id: f.productId } })).rejects.toThrow();
      expect(await orderDetail(orderId, f)).toMatchObject({ success: true });
    });
  } finally { await f.cleanup(); }
});

test("rolls back all writes and stock when a later item is unavailable", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const result = await immediateSale({ id: randomUUID(), items: [
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
      const results = await Promise.all([1, 2].map(() => immediateSale({ id: randomUUID(), 
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
      const results = await Promise.all([1, 2].map(() => immediateSale({ id: orderId, 
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
      expect(await immediateSale({ id: foreignOrderId, items: [{ variantId: b.variantIds[0], quantity: 1 }] },
        { companyId: b.companyId, sellerId: b.sellerId })).toMatchObject({ success: true });
    });
    await withTenantIsolation(a.companyId, async () => {
      expect(await orderDetail(foreignOrderId, a)).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
      expect(await orders.list({ page: 1, customer: { kind: "all" } })).toMatchObject({ success: true, data: { total: 0 } });
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.orderItem.count()).toBe(0);
      expect(await immediateSale({ id: randomUUID(), items: [{ variantId: b.variantIds[0], quantity: 1 }] },
        { companyId: a.companyId, sellerId: a.sellerId })).toMatchObject({ success: false, error: { code: "VARIANT_NOT_FOUND", variantId: b.variantIds[0] } });
      expect(await immediateSale({ id: foreignOrderId, items: [{ variantId: a.variantIds[0], quantity: 1 }] },
        { companyId: a.companyId, sellerId: a.sellerId })).toMatchObject({ success: false, error: { code: "ORDER_ALREADY_EXISTS" } });
      expect(await prisma.order.count()).toBe(0);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: a.variantIds[0] } })).quantity).toBe(3n);
      await expect(prisma.order.create({ data: { number: 1001n, id: randomUUID(), companyId: a.companyId, sellerId: a.sellerId,
        buyer: { create: { contactId: b.contactId, phone: "+51999999999" } }, currency: "PEN", total: 1, itemsTotal: 1,
        completedAt: new Date(), createdAt: new Date() } })).rejects.toThrow();
      await expect(prisma.orderItem.create({ data: { orderId: foreignOrderId, variantId: a.variantIds[0], productName: "Foreign order",
        variantAttributes: {}, quantity: 1n, unitPrice: 1, subtotal: 1 } })).rejects.toThrow(/OrderItem_companyId_orderId_fkey/);
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
        expect(await immediateSale({ id, items: [{ variantId: f.variantIds[0], quantity: 1 }] },
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
      const result = await immediateSale({ id: randomUUID(), items: [{ variantId: f.variantIds[0], quantity: 1 }] },
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
      expect(await immediateSale({ id, items: [{ variantId: f.variantIds[0], quantity: 1 }] },
        { companyId: f.companyId, sellerId: f.sellerId })).toMatchObject({ success: true });
      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: id } });
      await expect(prisma.order.update({ where: { id }, data: { total: 0 } })).rejects.toThrow();
      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { quantity: 0n } })).rejects.toThrow();
      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { quantity: BigInt(Number.MAX_SAFE_INTEGER) + 1n } })).rejects.toThrow();
      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { unitPrice: 0 } })).rejects.toThrow();
      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { subtotal: 0 } })).rejects.toThrow();
      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { variantAttributes: { Size: 42 } } })).rejects.toThrow(/OrderItem_attributes_object/);
      await expect(prisma.orderItem.create({ data: { orderId: id, variantId: f.variantIds[0], productName: "Duplicate", variantAttributes: {}, quantity: 1n, unitPrice: 1, subtotal: 1 } })).rejects.toThrow(/OrderItem_companyId_orderId_variantId_key/);
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
      expect(await deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, home: { enabled: true }, store: { enabled: true,
        pickupPoint: { name: "Store", address: "Original", instructions: null } } }, context)).toMatchObject({ success: true });
      expect(await deliverySettings.saveZones({ expectedVersion: 1, zones: [{ kind: "new", name: "Paid delivery", enabled: true,
        districtCodes: ["150122"], options: [{ kind: "new", method: "home", name: "Home", enabled: true, price: { amount: 1, currency: "PEN" } }] }] }, context)).toMatchObject({ success: true });
      const quote = await deliverySettings.createQuotation({ companyId: f.companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
      if (!quote.success || !quote.data.rates[0]) throw new Error("Missing paid delivery rate");
      const recipient = { name: "Ana", phone: "999", identity: { kind: "absent" as const } };
      const home = parseRatedDeliverySelection({ method: "home", rateId: quote.data.rates[0].rate.id, recipient,
        destination: { address: "Original", districtCode: "150122", instructions: null } });
      const store = parseRatedDeliverySelection({ method: "store", recipient });
      if (!home.success || !store.success) throw new Error("Invalid delivery fixture");
      expect(await orders.create({ id: orderId, items: [
        { variantId: first as VariantId, quantity: 2 as PositiveInteger },
        { variantId: second as VariantId, quantity: 4 as PositiveInteger },
      ] }, context)).toMatchObject({ success: true });
      expect(await orders.setDelivery({ orderId, delivery: home.data, expectedPrice: { amount: 1, currency: "PEN" } }, context))
        .toMatchObject({ success: true, data: { deliveryCost: { amount: 1 }, deliveryCharge: { amount: 1 } } });
      const input = { orderId, delivery: store.data, expectedPrice: { amount: 0, currency: "PEN" as const } };
      const before = await orderDetail(orderId, f);
      if (!before.success) throw new Error("Expected order");
      expect(await orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId,
        amount: before.data.itemsTotal, method: "digital_wallet", deductStockIfPartial: false }, context)).toMatchObject({ success: true });
      const paid = await orderDetail(orderId, f);
      expect(await orders.setDelivery(input, context))
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
        expect(await orders.setDelivery(input, context))
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


const existingZone = (zone: DeliveryZone, change: Readonly<{ amount?: number; enabled?: boolean }> = {}, enabled = zone.enabled) => ({
  kind: "existing" as const, id: zone.id, name: zone.name, enabled, districtCodes: zone.districtCodes,
  options: zone.options.map(value => ({ kind: "existing" as const, id: value.id, method: "home" as const, name: value.name, enabled: change.enabled ?? value.enabled,
    price: { amount: change.amount ?? value.price.amount, currency: "PEN" as const } })),
});

async function waitForDeliveryLock() {
  await vi.waitFor(async () => {
    const rows = await systemPrisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND (query LIKE '%CompanyDeliverySettings%' OR query LIKE '%Order%')`;
    expect(Number(rows[0].count)).toBeGreaterThan(0);
  });
}

test("store assignment and disabling configuration serialize in both orders", async () => {
  const f = await fixture();
  const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
  const run = <T>(work: () => Promise<T>) => withTenantIsolation(f.companyId, async () => await work());
  const recipient = { name: "Recipient", phone: "00123", identity: { kind: "document" as const, documentType: "passport" as const, document: "00-A" } };
  try {
    const configured = await run(() => deliverySettings.save({ expectedVersion: 0, home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Original store", address: "Original address", instructions: null } }, agency: { enabled: true } }, context));
    if (!configured.success) throw new Error("Expected configuration");
    const orderId = randomUUID() as OrderId;
    expect(await run(() => orders.create({ id: orderId, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context))).toMatchObject({ success: true });
    const parsed = parseRatedDeliverySelection({ method: "store", recipient });
    if (!parsed.success) throw new Error(parsed.error.message);
    const input = { orderId, delivery: parsed.data, expectedPrice: { amount: 0, currency: "PEN" as const } };
    let release!: () => void;
    let arrived!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const protectedConfiguration = new Promise<void>(resolve => { arrived = resolve; });
    const assignment = run(() => withinTransaction(async () => {
      const result = await orders.setDelivery(input, context);
      arrived(); await held; return result;
    }));
    await protectedConfiguration;
    const disableInput = { expectedVersion: 1, home: { enabled: false }, store: { ...configured.data.store, enabled: false as const }, agency: { enabled: false } };
    const disable = run(() => deliverySettings.save(disableInput, context));
    try { await waitForDeliveryLock(); } finally { release(); }
    expect(await assignment).toMatchObject({ success: true, data: { delivery: { pickupPoint: { address: "Original address" } } } });
    expect(await disable).toMatchObject({ success: true, data: { version: 2 } });
    const before = await run(() => orderDetail(orderId, f));
    expect(await run(() => orders.setDelivery(input, context))).toMatchObject({ success: false, error: { code: "DELIVERY_METHOD_DISABLED" } });
    expect(await run(() => orderDetail(orderId, f))).toEqual(before);
    // Reactivate, then hold the disabling transaction before starting the second assignment.
    expect(await run(() => deliverySettings.save({ ...disableInput, expectedVersion: 2, store: configured.data.store, agency: { enabled: true } }, context))).toMatchObject({ success: true });
    let unblock!: () => void;
    let disabled!: () => void;
    const holdDisable = new Promise<void>(resolve => { unblock = resolve; });
    const disabling = new Promise<void>(resolve => { disabled = resolve; });
    const first = run(() => withinTransaction(async () => {
      const result = await deliverySettings.save({ ...disableInput, expectedVersion: 3 }, context);
      disabled(); await holdDisable; return result;
    }));
    await disabling;
    const second = run(() => orders.setDelivery(input, context));
    try { await waitForDeliveryLock(); } finally { unblock(); }
    expect(await first).toMatchObject({ success: true });
    expect(await second).toMatchObject({ success: false, error: { code: "DELIVERY_METHOD_DISABLED" } });
    expect(await run(() => orderDetail(orderId, f))).toEqual(before);
  } finally { await f.cleanup(); }
});

test.each(["ship", "cancel"] as const)("delivery editing and %s serialize without losing the confirmed snapshot", async close => {
  const f = await fixture();
  const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
  const run = <T>(work: () => Promise<T>) => withTenantIsolation(f.companyId, async () => await work());
  try {
    expect(await run(() => deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, home: { enabled: true }, store: { enabled: false, pickupPoint: null } }, context))).toMatchObject({ success: true });
    expect(await run(() => deliverySettings.saveZones({ expectedVersion: 1, zones: [{ kind: "new", name: "Free delivery", enabled: true,
      districtCodes: ["150122"], options: [{ kind: "new", method: "home", name: "Home", enabled: true, price: { amount: 0, currency: "PEN" } }] }] }, context))).toMatchObject({ success: true });
    const quote = await run(() => deliverySettings.createQuotation({ companyId: f.companyId, country: "PE", districtCode: "150122", address: null, instructions: null }));
    if (!quote.success || !quote.data.rates[0]) throw new Error("Missing free delivery rate");
    const parsed = parseRatedDeliverySelection({ method: "home", rateId: quote.data.rates[0].rate.id,
      recipient: { name: "Recipient", phone: "00123", identity: { kind: "absent" } },
      destination: { address: "Confirmed address", districtCode: "150122", instructions: null } });
    if (!parsed.success) throw new Error(parsed.error.message);
    for (const assignmentFirst of [true, false]) {
      const orderId = randomUUID() as OrderId;
      expect(await run(() => orders.create({ id: orderId, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context))).toMatchObject({ success: true });
      expect(await run(() => orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId, amount: { amount: 0.1, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, context))).toMatchObject({ success: true });
      const input = { orderId, delivery: parsed.data, expectedPrice: { amount: 0, currency: "PEN" as const } };
      const assign = () => orders.setDelivery(input, context);
      const finish = () => orders[close](orderId, context);
      if (close === "cancel" && !assignmentFirst) {
        expect(await run(finish)).toMatchObject({ success: true });
        expect(await run(assign)).toMatchObject({ success: false, error: { code: "ORDER_CANCELLED" } });
      } else {
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
        expect(await second).toMatchObject(assignmentFirst ? { success: true } : { success: false, error: { code: "DELIVERY_LOCKED" } });
      }
      expect(await run(() => orderDetail(orderId, f))).toMatchObject({ success: true, data: { cancelled: close === "cancel", deliveryStatus: close === "ship" ? "shipped" : "pending", deliveryCost: { amount: 0 }, deliveryCharge: { amount: 0 }, total: { amount: 0.1 }, stockDeducted: true, delivery: assignmentFirst ? { pricing: { rateId: quote.data.rates[0].rate.id, quotationId: quote.data.quotation.id }, destination: { address: "Confirmed address" }, recordedBy: { userId: f.sellerId } } : null } });

    }
  } finally { await f.cleanup(); }
});

test("allocates permanent company numbers atomically across concurrent orders and rollbacks", async () => {
  const a = await fixture();
  const b = await fixture();
  const errorLog = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const create = (f: typeof a) => withTenantIsolation(f.companyId, () => orders.create({ id: randomUUID() as OrderId, 
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
      const numberConflicts = errorLog.mock.calls.filter(([entry]) => (entry as { event?: string })?.event === "unable_to_save_pending_order");
      expect(numberConflicts).toHaveLength(1);
      expect(numberConflicts[0][0]).toMatchObject({ event: "unable_to_save_pending_order", errorCode: "ORDER_NUMBER_CONFLICT" });
      await prisma.company.update({ where: { id: a.companyId }, data: { nextOrderNumber: 9999n } });
      expect(await create(a)).toMatchObject({ data: { number: 9999 } });
      expect(await create(a)).toMatchObject({ data: { number: 10000 } });
      const before = await prisma.company.findUniqueOrThrow({ where: { id: a.companyId } });
      const count = await prisma.order.count();
      // Stock failure occurs after allocating and saving the immediate sale.
      expect(await immediateSale({ id: randomUUID(), items: [{ variantId: a.variantIds[0], quantity: 100 }] },
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
  const create = (f: typeof a) => withTenantIsolation(f.companyId, () => orders.create({ id: randomUUID() as OrderId,
    items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId }));
  try {
    const contactOrder = await create(a);
    const guestOrder = await create(a);
    const anonymousOrder = await create(a);
    const foreignOrder = await create(b);
    if (!contactOrder.success || !guestOrder.success || !anonymousOrder.success || !foreignOrder.success) throw new Error("Fixture creation failed");
    await withTenantIsolation(a.companyId, async () => {
      await prisma.orderBuyer.create({ data: { orderId: contactOrder.data.id, contactId: a.contactId, phone: "+51999999999" } });
      expect(await orderDetail(contactOrder.data.id, a)).toMatchObject({ data: { buyer: { contactId: a.contactId, name: null, phone: "+51999999999" }, checkoutEnabledAt: expect.any(Date), checkoutConfirmedAt: null } });
      await prisma.orderBuyer.create({ data: { orderId: guestOrder.data.id, name: "Guest", phone: "+14155552671" } });
      expect(await orderDetail(guestOrder.data.id, a)).toMatchObject({ data: { buyer: { contactId: null, name: "Guest" } } });
      const context = { companyId: a.companyId as CompanyId, userId: a.sellerId as UserId };
      expect(await orders.listAggregates({ page: 1, customer: { kind: "general_public" } }, context))
        .toMatchObject({ data: { total: 1, items: [{ id: anonymousOrder.data.id, buyer: null }] } });
      expect(await prisma.orderBuyer.findUnique({ where: { orderId: foreignOrder.data.id } })).toBeNull();
      expect(await prisma.orderBuyer.updateMany({ where: { orderId: foreignOrder.data.id }, data: { name: "Forbidden" } })).toEqual({ count: 0 });
      await expect(prisma.orderBuyer.create({ data: { companyId: b.companyId, orderId: anonymousOrder.data.id, phone: "+14155552671" } })).rejects.toThrow();
      await expect(prisma.orderBuyer.create({ data: { orderId: anonymousOrder.data.id, contactId: b.contactId, phone: "+14155552671" } })).rejects.toThrow();
      await expect(prisma.orderBuyer.create({ data: { orderId: guestOrder.data.id, phone: "+14155552671" } })).rejects.toThrow();
      await expect(prisma.order.update({ where: { id: guestOrder.data.id }, data: { checkoutEnabledAt: null, checkoutConfirmedAt: new Date() } })).rejects.toThrow();
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
    const created = await orders.create({ id: randomUUID() as OrderId,
      items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context);
    if (!created.success) throw new Error("Fixture creation failed");
    // A message order is the only way an order gets a contact buyer.
    if (contactId) await prisma.orderBuyer.create({ data: { orderId: created.data.id, contactId, phone: "+51999999999" } });
    const order = contactId ? await orderDetail(created.data.id, f) : created;
    if (!order.success || !order.data) throw new Error("Fixture read failed");
    return { access: { companyId: context.companyId, orderId: created.data.id }, context, order: order.data };
  });
}

test("checkout enable and confirmation are idempotent under real concurrent transactions", async () => {
  const f = await fixture();
  const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
  try {
    const { access, context, order } = await pendingCheckout(f, f.contactId);
    const subdomain = `t4-${randomUUID().slice(0, 8)}`;
    await withTenantIsolation(f.companyId, async () => { await prisma.company.update({ where: { id: f.companyId }, data: { catalogSubdomain: subdomain } }); });
    expect(await orders.getCheckout(access)).toMatchObject({ data: { checkout: { state: { kind: "pending" } } } });
    const links = await Promise.all(Array.from({ length: 3 }, () => withTenantIsolation(f.companyId, () => orders.enableCheckout(access.orderId, context))));
    expect(links.every((link) => link.success)).toBe(true);
    expect(new Set(links.flatMap((link) => link.success ? [link.data.url] : [])).size).toBe(1);
    expect(links[0]).toMatchObject({ data: { url: `${storefrontConfig.baseUrl.protocol}//${subdomain}.${storefrontConfig.baseUrl.host}/checkout/${access.orderId}` } });
    expect(info.mock.calls.filter(([fields]) => typeof fields === "object" && fields && "event" in fields && fields.event === "order_checkout_enabled")).toHaveLength(0);
    const confirmations = await Promise.all(["Ana", "Other"].map((name) => orders.confirmCheckout(checkoutInput(name), access)));
    expect(confirmations.every((result) => result.success)).toBe(true);
    expect(confirmations[0]).toEqual(confirmations[1]);
    const original = confirmations[0];
    expect(await orders.confirmCheckout({ ...checkoutInput("Replacement"), expectedTotal: { amount: 1, currency: "USD" } }, access)).toEqual(original);
    expect(info.mock.calls.filter(([fields]) => typeof fields === "object" && fields && "event" in fields && fields.event === "order_checkout_confirmed")).toHaveLength(1);
    const stored = await withTenantIsolation(f.companyId, () => orderDetail(access.orderId, f));
    if (!stored.success) throw new Error("Unable to read confirmed order");
    expect({ ...stored.data, buyer: order.buyer, checkoutConfirmedAt: null }).toEqual(order);
    expect(stored.data.buyer?.contactId).toBe(f.contactId);
    await withTenantIsolation(f.companyId, async () => {
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
      expect(await deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Store", address: "Address", instructions: null } } }, context)).toMatchObject({ success: true });
      expect(await orders.create({ id: orderId, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      await prisma.payment.create({ data: { id: randomUUID(), orderId, amount: 0.1, currency: "PEN", method: "digital_wallet", status: "confirmed", data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "seller", userId: f.sellerId }, evidence: { kind: "manual" } } } });
    });
    const store = parseRatedDeliverySelection({ method: "store", recipient: { name: "Recipient", phone: "00123", identity: { kind: "absent" } } });
    if (!store.success) throw new Error(store.error.message);
    const assign = run(() => withinTransaction(async () => {
      const result = await orders.setDelivery({ orderId, delivery: store.data, expectedPrice: { amount: 0, currency: "PEN" } }, context);
      arrived(); await hold; return result;
    }));
    await protectedOrder;
    const deduct = run(() => orders.deductStock(orderId, context));
    try { await waitForDeliveryLock(); } finally { release(); }
    expect(await assign).toMatchObject({ success: true, data: { delivery: { method: "store", pickupPoint: { address: "Address" } }, deliveryCost: { amount: 0 }, deliveryCharge: { amount: 0 }, stockDeducted: true } });
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
      expect(await deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, home: { enabled: true }, store: { enabled: false, pickupPoint: null } }, context)).toMatchObject({ success: true });
      expect(await orders.create({ id: orderId, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context)).toMatchObject({ success: true });
    });
    const quote = await run(async () => {
      expect(await deliverySettings.saveZones({ expectedVersion: 1, zones: [3, 4].map(amount => ({
        kind: "new" as const, name: "Concurrent delivery", enabled: true, districtCodes: ["150122"], options: [{ kind: "new" as const, method: "home" as const, name: "Home", enabled: true, price: { amount, currency: "PEN" as const } }],
      })) }, context)).toMatchObject({ success: true });
      return deliverySettings.createQuotation({ companyId: f.companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
    });
    if (!quote.success) throw new Error(quote.error.message);
    const selection = (name: string, amount: number) => {
      const rate = quote.data.rates.find(value => value.rate.price.amount === amount)?.rate;
      if (!rate) throw new Error("Missing concurrent delivery rate");
      const parsed = parseRatedDeliverySelection({ method: "home", rateId: rate.id,
        recipient: { name, phone: "00123", identity: { kind: "absent" } },
        destination: { address: name, districtCode: "150122", instructions: null } });
      if (!parsed.success) throw new Error(parsed.error.message);
      return parsed.data;
    };
    const firstSelection = selection("First", 3);
    const secondSelection = selection("Second", 4);
    const first = run(() => withinTransaction(async () => {
      const result = await orders.setDelivery({ orderId, delivery: firstSelection, expectedPrice: { amount: 3, currency: "PEN" } }, context);
      arrived(); await hold; return result;
    }));
    await resolving;
    const second = run(() => orders.setDelivery({ orderId, delivery: secondSelection, expectedPrice: { amount: 4, currency: "PEN" } }, { ...context, userId: nextAuthor }));
    try { await waitForDeliveryLock(); } finally { release(); }
    expect(await first).toMatchObject({ success: true, data: { delivery: { pricing: { quotationId: quote.data.quotation.id }, recipient: { name: "First" }, recordedBy: { userId: f.sellerId } }, total: { amount: 3.1 }, deliveryCharge: { amount: 3 } } });
    const confirmed = await second;
    expect(confirmed).toMatchObject({ success: true, data: { delivery: { pricing: { quotationId: quote.data.quotation.id }, recipient: { name: "Second" }, destination: { address: "Second" }, recordedBy: { userId: nextAuthor } }, total: { amount: 4.1 }, deliveryCost: { amount: 4 }, deliveryCharge: { amount: 4 }, stockDeducted: false } });
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
      expect(await deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Store", address: "Address", instructions: null } } }, context)).toMatchObject({ success: true });
      expect(await orders.create({ id: orderId, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      const store = parseRatedDeliverySelection({ method: "store", recipient: { name: "Recipient", phone: "00123", identity: { kind: "absent" } } });
      if (!store.success) throw new Error(store.error.message);
      const settingsBefore = await deliverySettings.get(context);
      const orderBefore = await orderDetail(orderId, f);
      await admin.$executeRawUnsafe(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."companyId" = '${f.companyId}'::uuid THEN RAISE EXCEPTION 'private destination in deferred failure'; END IF; RETURN NEW; END $$`);
      await admin.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER ${trigger} AFTER UPDATE ON "${table}" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.${trigger}()`);
      summary.mockClear(); failure.mockClear();
      const operation = () => table === "CompanyDeliverySettings"
        ? deliverySettings.save({ expectedVersion: 1, agency: { enabled: false }, home: { enabled: false }, store: { enabled: false, pickupPoint: null } }, context)
        : orders.setDelivery({ orderId, delivery: store.data, expectedPrice: { amount: 0, currency: "PEN" } }, context);
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

test("a corrupt persisted delivery snapshot fails explicitly without inventing authorship", async () => {
  const f = await fixture();
  const failure = vi.spyOn(log, "error").mockImplementation(() => {});
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      expect(await orders.create({ id: orderId, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context)).toMatchObject({ success: true });
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
    expect(await orders.getCheckout(access)).toMatchObject({ data: { checkout: { state: { kind: "pending" } } } });
    // New orders are born enabled, so a legacy row without the timestamp is simulated.
    await withTenantIsolation(f.companyId, async () => await prisma.order.update({ where: { id: access.orderId }, data: { checkoutEnabledAt: null } }));
    expect(await orders.confirmCheckout(checkoutInput(), access)).toMatchObject({ error: { code: "CHECKOUT_UNAVAILABLE" } });
    expect(await withTenantIsolation(f.companyId, () => orders.enableCheckout(access.orderId, context))).toMatchObject({ error: { code: "CHECKOUT_UNAVAILABLE" } });
    await withTenantIsolation(f.companyId, async () => await prisma.order.update({ where: { id: access.orderId }, data: { checkoutEnabledAt: new Date() } }));
    expect(await orders.confirmCheckout(checkoutInput(), swapped)).toMatchObject({ error: { code: "CHECKOUT_UNAVAILABLE" } });
    await withTenantIsolation(f.companyId, async () => {
      await prisma.order.update({ where: { id: access.orderId }, data: { checkoutEnabledAt: new Date("2000-01-01") } });
      expect(await orders.cancel(access.orderId, context)).toMatchObject({ success: true });
    });
    expect(await orders.getCheckout(access)).toMatchObject({ data: { checkout: { state: { kind: "cancelled" } } } });
    expect(await orders.confirmCheckout(checkoutInput(), access)).toMatchObject({ error: { code: "ORDER_CANCELLED" } });
    const completed = await withTenantIsolation(f.companyId, () => immediateSale({ id: randomUUID(), items: [{ variantId: f.variantIds[0], quantity: 1 }] }, { companyId: f.companyId, sellerId: f.sellerId }));
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
          delivery: { method: "home", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } }, destination: { address: "Av. Lima 123", country: "PE", districtCode: "150101", district: "Lima", province: "Lima", department: "Lima", instructions: null }, pricing: { quotationId: randomUUID(), rateId: randomUUID(), optionId: randomUUID(), settingsVersion: 1 }, recordedBy: { kind: "seller", userId: f.sellerId } } } : { cancelled: true, cancelledAt: new Date() } });
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
    expect(await orders.getCheckout(access)).toMatchObject({ data: { checkout: { buyer: null, state: { kind: "pending" } } } });
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
        await prisma.order.update({ where: { id: access.orderId }, data: change === "cancel" ? { cancelled: true, cancelledAt: new Date() } : {
          total: 1, deliveryCost: 0.9, deliveryCharge: 0.9,
          delivery: { method: "home", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } }, destination: { address: "Av. Lima 123", country: "PE", districtCode: "150101", district: "Lima", province: "Lima", department: "Lima", instructions: null }, pricing: { quotationId: randomUUID(), rateId: randomUUID(), optionId: randomUUID(), settingsVersion: 1 }, recordedBy: { kind: "seller", userId: f.sellerId } },
        } });
        return ok(null);
      }));
      release.resolve();
      expect(await confirmation).toMatchObject({ success: true });
      expect(await mutation).toMatchObject({ success: true });
      expect(await orders.getCheckout(access)).toMatchObject({ data: { checkout: {
        state: { kind: change === "cancel" ? "cancelled" : "confirmed" }, buyer: checkoutInput().buyer,
      } } });
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
      expect(await orders.getCheckout(access)).toMatchObject({ data: { checkout: { buyer: null } } });
      const input = checkoutInput(index ? "Bruno" : "Ana");
      expect(await orders.confirmCheckout(input, access)).toMatchObject({ data: { buyer: input.buyer } });
      return orders.getCheckout(access);
    }));
    expect(results[0]).toMatchObject({ data: { checkout: { buyer: { name: "Ana" } } } });
    expect(results[1]).toMatchObject({ data: { checkout: { buyer: { name: "Bruno" } } } });
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
    expect(await orders.getCheckout(access)).toMatchObject({ data: { checkout: { buyer: null, state: { kind: "pending" } } } });
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
      const ids: OrderId[] = [];
      for (let index = 0; index < 22; index++) {
        const id = randomUUID() as OrderId;
        const result = await orders.create({ id,
          items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] }, context);
        expect(result.success).toBe(true);
        await prisma.orderBuyer.create({ data: { orderId: id, name: "Ana_100%", phone: "+51999999999" } });
        ids.push(id);
      }
      const completed = await immediateSale({ id: randomUUID(), 
        items: [{ variantId: f.variantIds[0], quantity: 1 }] }, f);
      expect(completed.success).toBe(true);
      await prisma.order.update({ where: { id: ids[0] }, data: { cancelled: true, cancelledAt: new Date() } });
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
      const result = await createConfiguredOrder({ id,
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }],
        payments: amount === null ? [] : [{ paymentId, amount: { amount, currency: "PEN" }, method: "bank_transfer", deductStockIfPartial: partial }],
        deliverImmediately: immediate }, context);
      expect(result).toMatchObject({ success: true, data: { stockDeducted: deducted,
        deliveryStatus: immediate ? "delivered" : "pending", completedAt: immediate ? expect.any(Date) : null } });
      const saved = await findOrderAggregate(id, context.companyId);
      expect(saved).toMatchObject(result);
      expect(saved.success && saved.data?.chatId).toBeUndefined();
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(deducted ? 1n : 3n);
      expect(await prisma.payment.count()).toBe(amount === null ? 0 : 1);
    });
  } finally { await f.cleanup(); }
});

test.each([true, false])("complete creation rejects obsolete delivery without persisting order or payments (charge: %s)", async (obsoleteCharge) => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      const input = { id: randomUUID(), items: [{ variantId: f.variantIds[0], quantity: 2 }],
        payments: [{ paymentId: randomUUID(), amount: { amount: 0.2, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }],
        delivery: { delivery: { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } }, obsoleteCharge } };
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
      expect(await deliverySettings.save({ expectedVersion: 0, agency: { enabled: false }, home: { enabled: true }, store: { enabled: false, pickupPoint: null } }, context)).toMatchObject({ success: true });
      expect(await deliverySettings.saveZones({ expectedVersion: 1, zones: [{ kind: "new", name: "Creation zone", enabled: true,
        districtCodes: ["150122"], options: [{ kind: "new", method: "home", name: "Home", enabled: true, price: { amount: 0.1, currency: "PEN" } }] }] }, context)).toMatchObject({ success: true });
      const quote = await deliverySettings.createQuotation({ companyId: f.companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
      if (!quote.success || !quote.data.rates[0]) throw new Error("Missing creation rate");
      const id = randomUUID() as OrderId;
      const parsed = parseRatedDeliverySelection({ method: "home", rateId: quote.data.rates[0].rate.id,
        recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
        destination: { address: "Av. Lima 123", districtCode: "150122", instructions: "Door 2" } });
      if (!parsed.success) throw new Error(parsed.error.message);
      const delivery = parsed.data;
      const result = await createConfiguredOrder({ id, 
        items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }],
        delivery: { delivery, expectedPrice: { amount: 0.1, currency: "PEN" } },
        payments: [{ paymentId: randomUUID() as PaymentId, amount: { amount: 0.2, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }] },
      context);
      expect(result).toMatchObject({ success: true, data: { delivery: { method: "home", destination: { districtCode: "150122", address: "Av. Lima 123" },
        pricing: { rateId: quote.data.rates[0].rate.id, quotationId: quote.data.quotation.id } }, deliveryCost: { amount: 0.1 }, deliveryCharge: { amount: 0.1 },
        total: { amount: 0.3 }, stockDeducted: false, completedAt: null } });
      const saved = await findOrderAggregate(id, context.companyId);
      expect(saved).toMatchObject(result);
      expect(saved.success && saved.data?.chatId).toBeUndefined();
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId: f.variantIds[0] } })).quantity).toBe(3n);
    });
  } finally { await f.cleanup(); }
});

test.each(["payment", "stock", "delivery", "fulfillment"] as const)("complete creation rolls back every write after %s failure", async (failure) => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      const input: CreateCompleteOrderInput = { id: randomUUID() as OrderId, 
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
      const input: CreateCompleteOrderInput = { id: randomUUID() as OrderId, 
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
      const saved = await deliverySettings.saveZones({ expectedVersion: 0, zones: [0, 8].map(amount => ({
        kind: "new" as const, name: "Zone", enabled: true, districtCodes: ["150122"], options: [{ kind: "new" as const, method: "home" as const, name: "Home", enabled: true, price: { amount, currency: "PEN" as const } }],
      })) }, context);
      if (!saved.success) throw new Error(saved.error.message);
      expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, store: { enabled: false, pickupPoint: null } }, context)).success).toBe(true);
      const quote = await deliverySettings.createQuotation({ companyId: f.companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
      if (!quote.success) throw new Error(quote.error.message);
      const selection = (amount: number) => {
        const rate = quote.data.rates.find(value => value.rate.price.amount === amount)?.rate;
        if (!rate) throw new Error("Expected option");
        const parsed = parseRatedDeliverySelection({ method: "home", rateId: rate.id, recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
          destination: { districtCode: "150122", address: "Street", instructions: null } });
        if (!parsed.success) throw new Error(parsed.error.message);
        return parsed.data;
      };
      const orderId = randomUUID() as OrderId;
      expect((await orders.create({ id: orderId, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] }, context)).success).toBe(true);
      await prisma.payment.create({ data: { id: randomUUID(), orderId, status: "confirmed", currency: "PEN", amount: 0.2, method: "digital_wallet",
        data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "seller", userId: f.sellerId }, evidence: { kind: "manual" } } } });
      expect(await orders.setDelivery({ orderId, delivery: selection(8), expectedPrice: { amount: 8, currency: "PEN" } }, context))
        .toMatchObject({ success: true, data: { total: { amount: 8.2 }, deliveryCost: { amount: 8 }, deliveryCharge: { amount: 8 }, stockDeducted: false,
          delivery: { pricing: { quotationId: quote.data.quotation.id, settingsVersion: 2 }, recordedBy: { kind: "seller", userId: f.sellerId } } } });
      const before = await orderDetail(orderId, f);
      const changed = await deliverySettings.saveZones({ expectedVersion: 2, zones: saved.data.zones.map(zone => existingZone(zone, { amount: zone.options[0].price.amount === 8 ? 10 : 0 })) }, context);
      expect(changed.success).toBe(true);
      expect(await orders.setDelivery({ orderId, delivery: selection(8), expectedPrice: { amount: 8, currency: "PEN" } }, context))
        .toMatchObject({ success: false, error: { code: "TOTAL_CHANGED", currentPrice: { amount: 10 } } });
      expect(await orderDetail(orderId, f)).toEqual(before);
      expect((await prisma.productStock.findUnique({ where: { variantId: f.variantIds[0] } }))?.quantity).toBe(3n);
      const rejectedId = randomUUID() as OrderId;
      expect(await createConfiguredOrder({ id: rejectedId, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }],
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
      expect(await createConfiguredOrder({ id: failedId, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }],
        delivery: { delivery: selection(0), expectedPrice: { amount: 0, currency: "PEN" } },
        payments: [{ paymentId: randomUUID() as PaymentId, amount: { amount: 0.2, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }] }, context))
        .toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK" } });
      expect(await prisma.order.findUnique({ where: { id: failedId } })).toBeNull();
      expect(await prisma.payment.count()).toBe(1);
      const newId = randomUUID() as OrderId;
      expect(await createConfiguredOrder({ id: newId, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }],
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
      expect((await deliverySettings.save({ expectedVersion: 0, home: { enabled: false }, agency: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } }, context)).success).toBe(true);
    });
    const create = async (quantity: number) => {
      const id = randomUUID() as OrderId;
      await withTenantIsolation(f.companyId, async () => {
        expect((await orders.create({ id, items: [{ variantId: f.variantIds[0] as VariantId, quantity: quantity as PositiveInteger }] }, context)).success).toBe(true);
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
      const saved = await deliverySettings.saveZones({ expectedVersion: 0,
        zones: [{ kind: "new", name: "Home", enabled: true, districtCodes: ["150122"], options: [{ kind: "new", method: "home", name: "Home", enabled: true, price: { amount: 8, currency: "PEN" } }] }] }, context);
      if (!saved.success) throw new Error(saved.error.message);
      expect((await deliverySettings.save({ expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, store: { enabled: false, pickupPoint: null } }, context)).success).toBe(true);
      expect((await orders.create({ id: access.orderId, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] }, context)).success).toBe(true);
      await prisma.order.update({ where: { id: access.orderId }, data: { checkoutEnabledAt: new Date() } });
      const quote = await deliverySettings.createQuotation({ companyId: f.companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
      if (!quote.success) throw new Error(quote.error.message);
      const selection = parseRatedDeliverySelection({ method: "home", rateId: quote.data.rates[0].rate.id,
        recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } }, destination: { districtCode: "150122", address: "Street", instructions: null } });
      if (!selection.success) throw new Error(selection.error.message);
      const zone = saved.data.zones[0];
      expect((await deliverySettings.saveZones({ expectedVersion: 2, zones: [existingZone(zone, { amount: 10 })] }, context)).success).toBe(true);
      return { selection: selection.data, zone };
    });
    const input = { buyer: buyer.data, delivery: { kind: "replace" as const, selection: prepare.selection, expectedPrice: { amount: 8, currency: "PEN" as const } }, expectedTotal: { amount: 10.2, currency: "PEN" as const } };
    expect(await orders.confirmCheckoutDelivery(input, access)).toMatchObject({ error: { code: "TOTAL_CHANGED", currentPrice: { amount: 10 } } });
    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.orderBuyer.findUnique({ where: { orderId: access.orderId } })).toBeNull();
      expect(await prisma.order.findUnique({ where: { id: access.orderId } })).toMatchObject({ delivery: null, checkoutConfirmedAt: null, stockDeducted: false });
      const quote = await deliverySettings.createQuotation({ companyId: f.companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
      if (!quote.success) throw new Error(quote.error.message);
      const selection = parseRatedDeliverySelection({ ...prepare.selection, rateId: quote.data.rates[0].rate.id });
      if (!selection.success) throw new Error(selection.error.message);
      input.delivery.selection = selection.data;
      input.delivery.expectedPrice.amount = 10;
    });
    expect(await orders.confirmCheckoutDelivery({ ...input, expectedTotal: { amount: 0.2, currency: "PEN" } }, access)).toMatchObject({ error: { code: "TOTAL_CHANGED" } });
    expect(await orders.confirmCheckoutDelivery(input, access)).toMatchObject({ success: true, data: { total: { amount: 10.2 }, state: { kind: "confirmed" } } });
    await withTenantIsolation(f.companyId, async () => {
      expect(await prisma.order.findUnique({ where: { id: access.orderId } })).toMatchObject({ delivery: { recordedBy: { kind: "buyer" }, destination: { districtCode: "150122", district: "MIRAFLORES" } } });
      expect((await deliverySettings.saveZones({ expectedVersion: 3, zones: [existingZone(prepare.zone, { amount: 11 }, false)] }, context)).success).toBe(true);
    });
    expect(await orders.confirmCheckoutDelivery({ ...input, expectedTotal: { amount: 1, currency: "PEN" } }, access)).toMatchObject({ success: true, data: { total: { amount: 10.2 } } });
    const checkout = await orders.getCheckout(access);
    expect(checkout).toMatchObject({ success: true, data: { checkout: { deliveryCharge: { amount: 10 }, total: { amount: 10.2 },
      delivery: { method: "home", destination: { districtCode: "150122", address: "Street" } } } } });
    if (!checkout.success) throw new Error("Expected persisted checkout");
    expect(checkout.data.checkout.delivery).not.toHaveProperty("recordedBy");
  } finally { await f.cleanup(); }
});

async function chatFixture(owner: Awaited<ReturnType<typeof fixture>>) {
  const customerId = randomUUID() as CustomerId;
  const chatId = randomUUID() as ChatId;
  const messageId = randomUUID() as ChatMessageId;
  const imageId = randomUUID();
  await withTenantIsolation(owner.companyId, async () => {
    await prisma.customer.create({ data: { id: customerId, createdAt: new Date() } });
    await prisma.contact.update({ where: { id: owner.contactId }, data: { customerId } });
    await prisma.chat.create({ data: { id: chatId, contactId: owner.contactId } });
    await prisma.image.create({ data: { id: imageId, storageKey: `images/${imageId}` } });
    await prisma.chatMessage.create({ data: { id: messageId, chatId, externalId: `ext-${messageId}`, whatsappMessageId: `wa-${messageId}`, direction: "incoming",
      source: "contact", type: "image", imageId, uploadedByUserId: owner.sellerId, sentAt: new Date(), receivedAt: new Date() } });
  });
  return { customerId, chatId, messageId, source: { chatId, customerId } };
}

async function chatCleanup(...fixtures: Awaited<ReturnType<typeof fixture>>[]) {
  for (const f of fixtures) await withTenantIsolation(f.companyId, async () => {
    await prisma.orderMessage.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.chatMessage.deleteMany();
    await prisma.chat.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.customer.deleteMany();
  });
}

let nextNumber = 1000;
function chatOrder(f: Awaited<ReturnType<typeof fixture>>, over: Partial<{ id: string; createdAt: Date; buyer: { name: string | null; phone: string | null } }> = {}) {
  const built = buildPendingOrder({ number: ++nextNumber as OrderNumber, id: (over.id ?? randomUUID()) as OrderId, companyId: f.companyId as CompanyId, sellerId: f.sellerId as UserId,
    customer: { kind: "contact", contactId: f.contactId as ContactId, name: over.buyer?.name ?? null, phone: over.buyer?.phone ?? null }, createdAt: over.createdAt ?? new Date(),
    items: [{ id: randomUUID() as never, variantId: f.variantIds[0] as VariantId, productName: "Sample", variantAttributes: { Size: "M" }, sku: null, quantity: 1, unitPrice: { amount: 10, currency: "PEN" } }] });
  if (!built.success) throw new Error(built.error.message);
  return built.data;
}

test("saves a chat order with customerId, chatId and a buyer without phone", async () => {
  const f = await fixture();
  try {
    const chat = await chatFixture(f);
    const order = chatOrder(f);
    await withTenantIsolation(f.companyId, async () => {
      expect(await withinTransaction(() => savePendingOrder(order, chat.source))).toEqual(ok(null));
      const row = await prisma.order.findFirstOrThrow({ where: { id: order.id }, include: { buyer: true } });
      expect(row).toMatchObject({ customerId: chat.customerId, chatId: chat.chatId, buyer: { contactId: f.contactId, name: null, phone: null } });
      expect(await findOrderAggregate(order.id, f.companyId as CompanyId)).toMatchObject({ success: true, data: { chatId: chat.chatId, buyer: { phone: null } } });
      const manual = chatOrder(f);
      await savePendingOrder(manual);
      expect(await prisma.order.findFirstOrThrow({ where: { id: manual.id } })).toMatchObject({ customerId: null, chatId: null });
    });
  } finally { await chatCleanup(f); await f.cleanup(); }
});

test("findOpenChatOrderCandidate returns the most recent open order of the chat", async () => {
  const f = await fixture();
  try {
    const chat = await chatFixture(f);
    const older = chatOrder(f, { createdAt: new Date("2026-10-01T00:00:00Z") });
    const newer = chatOrder(f, { createdAt: new Date("2026-10-02T00:00:00Z") });
    await withTenantIsolation(f.companyId, async () => {
      for (const order of [newer, older]) await withinTransaction(() => savePendingOrder(order, chat.source));
      expect(await findOpenChatOrderCandidate(chat.chatId)).toEqual(ok(newer.id));
    });
  } finally { await chatCleanup(f); await f.cleanup(); }
});

test("findOpenChatOrderCandidate ignores manual orders, other chats and orders that are not open", async () => {
  const f = await fixture();
  try {
    const chat = await chatFixture(f);
    const states: Record<string, (order: ReturnType<typeof chatOrder>) => Promise<unknown>> = {
      cancelled: (order) => prisma.order.update({ where: { id: order.id }, data: { cancelled: true, cancelledAt: new Date() } }),
      completed: (order) => prisma.order.update({ where: { id: order.id }, data: { completedAt: new Date() } }),
      checkoutConfirmed: (order) => prisma.order.update({ where: { id: order.id }, data: { checkoutEnabledAt: new Date(), checkoutConfirmedAt: new Date() } }),
      stockDeducted: (order) => prisma.order.update({ where: { id: order.id }, data: { stockDeducted: true, stockDeductedAt: new Date() } }),
      shipped: (order) => prisma.order.update({ where: { id: order.id }, data: { stockDeducted: true, stockDeductedAt: new Date(), deliveryStatus: "shipped" } }),
      confirmedPayment: (order) => prisma.payment.create({ data: { id: randomUUID(), orderId: order.id, status: "confirmed", amount: new Prisma.Decimal("1"), currency: "PEN",
        method: "digital_wallet", data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } } }),
      reportedPayment: (order) => prisma.payment.create({ data: { id: randomUUID(), orderId: order.id, status: "reported", currency: "PEN",
        data: { receiptImageId: randomUUID(), reportedAt: new Date().toISOString() } } }),
    };
    await withTenantIsolation(f.companyId, async () => {
      for (const change of Object.values(states)) {
        const order = chatOrder(f);
        await withinTransaction(() => savePendingOrder(order, chat.source));
        await change(order);
      }
      await savePendingOrder(chatOrder(f)); // manual
      expect(await findOpenChatOrderCandidate(chat.chatId)).toEqual(ok(null));
      expect(await findOpenChatOrderCandidate(randomUUID() as ChatId)).toEqual(ok(null));
      const open = chatOrder(f);
      await withinTransaction(() => savePendingOrder(open, chat.source));
      await prisma.payment.create({ data: { id: randomUUID(), orderId: open.id, status: "voided", amount: new Prisma.Decimal("1"), currency: "PEN", method: "digital_wallet",
        data: { confirmedAt: new Date().toISOString(), confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" }, voidedAt: new Date().toISOString(), voidedBy: "x" } } });
      expect(await findOpenChatOrderCandidate(chat.chatId)).toEqual(ok(open.id));
    });
  } finally { await chatCleanup(f); await f.cleanup(); }
});

test("saves removed items, changed quantities and mentioned prices and recalculates the total", async () => {
  const f = await fixture();
  try {
    const chat = await chatFixture(f);
    const order = chatOrder(f);
    await withTenantIsolation(f.companyId, async () => {
      await withinTransaction(() => savePendingOrder(order, chat.source));
      const target = await withinTransaction(() => findChatOrderTargetForUpdate(chat.chatId, findProductIds));
      if (!target.success || target.data.kind !== "open") throw new Error("Expected an open chat order");
      const other = { variantId: f.variantIds[1] as VariantId, productName: "Other", variantAttributes: { Size: "L" }, sku: null, unitPrice: { amount: 5, currency: "PEN" as const } };
      const identification = { method: "text" as const, productId: f.productId as never, confidence: 0.9 };
      const actions: ResolvedChatAction[] = [
        { kind: "add", item: other, quantity: 3 as PositiveInteger, mentionedPrice: { amount: { amount: 12.5, currency: "PEN" }, units: 3 }, identification },
        { kind: "set_quantity", target: { kind: "variant", variantId: f.variantIds[0] as VariantId }, quantity: 4 },
      ];
      const applied = applyChatActions(target.data, noPendings, actions, { newOrderId: () => randomUUID() as OrderId, newItemId: () => randomUUID() as never, newPendingId: () => randomUUID() as never }, new Date(), { maxItemQuantity: 99 as PositiveInteger },
        { number: 1 as OrderNumber, companyId: f.companyId as CompanyId, sellerId: f.sellerId as UserId, chatId: chat.chatId, contactId: f.contactId as ContactId, messageId: randomUUID() as never });
      if (!applied.success || applied.data.target.kind !== "open") throw new Error("Expected applied actions");
      expect(await withinTransaction(() => saveItemChanges(applied.data.target.kind === "open" ? applied.data.target.order : order, applied.data.changes))).toEqual(ok(null));
      const stored = await findOrderAggregate(order.id, f.companyId as CompanyId);
      if (!stored.success || !stored.data) throw new Error("order missing");
      expect(stored.data).toMatchObject({ itemsTotal: { amount: 55 }, total: { amount: 55 } });
      expect(stored.data.items.map((item) => [item.variantId, item.quantity, item.subtotal.amount, item.mentionedPrice?.amount.amount ?? null, item.mentionedPrice?.units ?? null]).sort())
        .toEqual([[f.variantIds[0], 4, 40, null, null], [f.variantIds[1], 3, 15, 12.5, 3]].sort());
      const removal = applyChatActions(applied.data.target, noPendings, [{ kind: "remove", target: { kind: "variant", variantId: f.variantIds[0] as VariantId }, amount: "all" },
        { kind: "set_mentioned_price", target: { kind: "variant", variantId: f.variantIds[1] as VariantId }, price: null }],
      { newOrderId: () => randomUUID() as OrderId, newItemId: () => randomUUID() as never, newPendingId: () => randomUUID() as never }, new Date(), { maxItemQuantity: 99 as PositiveInteger },
      { number: 1 as OrderNumber, companyId: f.companyId as CompanyId, sellerId: f.sellerId as UserId, chatId: chat.chatId, contactId: f.contactId as ContactId, messageId: randomUUID() as never });
      if (!removal.success || removal.data.target.kind !== "open") throw new Error("Expected removal");
      expect(await withinTransaction(() => saveItemChanges(removal.data.target.kind === "open" ? removal.data.target.order : order, removal.data.changes))).toEqual(ok(null));
      const after = await findOrderAggregate(order.id, f.companyId as CompanyId);
      expect(after).toMatchObject({ success: true, data: { itemsTotal: { amount: 15 }, items: [{ variantId: f.variantIds[1], quantity: 3 }] } });
    });
  } finally { await chatCleanup(f); await f.cleanup(); }
});

test("saveItemChanges inserts the new items in variant order whatever the order they were added in", async () => {
  const f = await fixture();
  try {
    const chat = await chatFixture(f);
    const order = chatOrder(f);
    await withTenantIsolation(f.companyId, async () => {
      await withinTransaction(() => savePendingOrder(order, chat.source));
      const extra = [randomUUID(), randomUUID()].sort() as [VariantId, VariantId];
      await seedProduct({ name: "Added", variants: extra.map((id, index) => ({ id, attributes: { Size: `T${index}` }, salePrice: 5, qrCode: id, stock: 3n })) });
      const [low, high] = extra;
      const added = orderStateMachine.appendItems(order, [high, low].map((variantId) => (
        { variantId, productName: "Sample", variantAttributes: {}, sku: null, unitPrice: { amount: 5, currency: "PEN" as const } })), () => randomUUID() as never);
      if (!added.success) throw new Error(added.error.message);
      const existing = new Set(order.items.map((item) => item.id));
      const changes = { added: added.data.items.filter((item) => !existing.has(item.id)), updated: [], removedItemIds: [] };
      const created = vi.spyOn(prisma.orderItem, "create");
      try {
        expect(await withinTransaction(() => saveItemChanges(added.data, changes))).toEqual(ok(null));
        const inserted = created.mock.calls.map(([args]) => args.data.variantId).filter((id) => id === low || id === high);
        expect(inserted).toEqual([low, high]);
      } finally { created.mockRestore(); }
    });
  } finally { await chatCleanup(f); await f.cleanup(); }
});

test("a mentioned price with only an amount or only units is rejected by the database", async () => {
  const f = await fixture();
  try {
    const chat = await chatFixture(f);
    const order = chatOrder(f);
    await withTenantIsolation(f.companyId, async () => {
      await withinTransaction(() => savePendingOrder(order, chat.source));
      await expect(prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { mentionedPriceAmount: new Prisma.Decimal("5") } })).rejects.toBeDefined();
      await expect(prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { mentionedPriceUnits: 2 } })).rejects.toBeDefined();
    });
  } finally { await chatCleanup(f); await f.cleanup(); }
});

const findProductIds = findProductIdsOfVariants;
const noPendings = { pendings: [], readyRemembered: false } as const;

test("findChatOrderTargetForUpdate fills the product of every item of the open order", async () => {
  const f = await fixture();
  try {
    const chat = await chatFixture(f);
    const order = chatOrder(f);
    await withTenantIsolation(f.companyId, async () => {
      await withinTransaction(() => savePendingOrder(order, chat.source));
      const target = await withinTransaction(() => findChatOrderTargetForUpdate(chat.chatId, findProductIds));
      expect(target).toMatchObject({ success: true, data: { kind: "open", order: { id: order.id } } });
      if (target.success && target.data.kind === "open") expect([...target.data.productIds]).toEqual([[f.variantIds[0], f.productId]]);
    });
  } finally { await chatCleanup(f); await f.cleanup(); }
});

test("findChatOrderTargetForUpdate says why the chat has no open order", async () => {
  const f = await fixture();
  try {
    const chat = await chatFixture(f);
    await withTenantIsolation(f.companyId, async () => {
      expect(await withinTransaction(() => findChatOrderTargetForUpdate(chat.chatId, findProductIds))).toEqual(ok({ kind: "none" }));
      const first = chatOrder(f, { createdAt: new Date("2026-10-01T00:00:00Z") });
      await withinTransaction(() => savePendingOrder(first, chat.source));
      await prisma.order.update({ where: { id: first.id }, data: { cancelled: true, cancelledAt: new Date() } });
      expect(await withinTransaction(() => findChatOrderTargetForUpdate(chat.chatId, findProductIds))).toEqual(ok({ kind: "cancelled" }));
      const second = chatOrder(f, { createdAt: new Date("2026-10-02T00:00:00Z") });
      await withinTransaction(() => savePendingOrder(second, chat.source));
      await prisma.order.update({ where: { id: second.id }, data: { stockDeducted: true, stockDeductedAt: new Date(), deliveryStatus: "shipped" } });
      expect(await withinTransaction(() => findChatOrderTargetForUpdate(chat.chatId, findProductIds))).toEqual(ok({ kind: "closed", orderId: second.id, number: second.number }));
    });
  } finally { await chatCleanup(f); await f.cleanup(); }
});

test("recordProcessedMessage maps a repeated message to MESSAGE_ALREADY_PROCESSED", async () => {
  const f = await fixture();
  try {
    const chat = await chatFixture(f);
    const [first, second] = [chatOrder(f), chatOrder(f)];
    await withTenantIsolation(f.companyId, async () => {
      for (const order of [first, second]) await withinTransaction(() => savePendingOrder(order, chat.source));
      expect(await withinTransaction(() => recordProcessedMessage(first.id, chat.messageId))).toEqual(ok(null));
      expect(await withinTransaction(() => recordProcessedMessage(second.id, chat.messageId))).toMatchObject({ success: false, error: { code: "MESSAGE_ALREADY_PROCESSED" } });
      expect(await prisma.orderMessage.findFirstOrThrow({ where: { messageId: chat.messageId } })).toMatchObject({ orderId: first.id });
    });
  } finally { await chatCleanup(f); await f.cleanup(); }
});

test("lists, filters and searches orders whose buyer has no phone", async () => {
  const f = await fixture();
  try {
    const chat = await chatFixture(f);
    const named = chatOrder(f, { buyer: { name: "Ana Quispe", phone: null } });
    const anonymous = chatOrder(f);
    const criteria = (over: object = {}) => ({ page: 1, view: "all" as const, customer: { kind: "all" as const }, ...over }) as never;
    await withTenantIsolation(f.companyId, async () => {
      for (const order of [named, anonymous]) await withinTransaction(() => savePendingOrder(order, chat.source));
      const ids = async (over?: object) => {
        const page = await findOrderAggregates(criteria(over), f.companyId as CompanyId);
        if (!page.success) throw new Error(page.error.message);
        return page.data.items.map((item) => item.id).sort();
      };
      expect(await ids()).toEqual([named.id, anonymous.id].sort());
      expect(await ids({ customer: { kind: "contact", contactId: f.contactId } })).toEqual([named.id, anonymous.id].sort());
      expect(await ids({ search: "quispe" })).toEqual([named.id]);
      expect(await ids({ search: "999" })).toEqual([]);
      expect(await ids({ search: `#${named.number}` })).toEqual([named.id]);
    });
  } finally { await chatCleanup(f); await f.cleanup(); }
});

test("composite foreign keys reject a chat, customer or message of another company", async () => {
  const a = await fixture();
  const b = await fixture();
  try {
    const foreign = await chatFixture(a);
    const own = await chatFixture(b);
    const order = chatOrder(b);
    await withTenantIsolation(b.companyId, async () => {
      await withinTransaction(() => savePendingOrder(order, own.source));
      await expect(prisma.order.create({ data: { ...(await orderData(chatOrder(b))), chatId: foreign.chatId } })).rejects.toMatchObject({ code: "P2003" });
      await expect(prisma.order.create({ data: { ...(await orderData(chatOrder(b))), customerId: foreign.customerId } })).rejects.toMatchObject({ code: "P2003" });
      await expect(prisma.orderMessage.create({ data: { orderId: order.id, messageId: foreign.messageId, createdAt: new Date() } })).rejects.toMatchObject({ code: "P2003" });
    });
  } finally { await chatCleanup(a, b); await a.cleanup(); await b.cleanup(); }
});

async function orderData(order: ReturnType<typeof chatOrder>) {
  return { number: BigInt(order.number), id: order.id, sellerId: order.sellerId, currency: "PEN", total: 10, itemsTotal: 10, createdAt: new Date() };
}

test("tenant isolation hides customers and order messages of another company", async () => {
  const a = await fixture();
  const b = await fixture();
  try {
    const chat = await chatFixture(a);
    const order = chatOrder(a);
    await withTenantIsolation(a.companyId, async () => {
      await withinTransaction(async () => {
        await savePendingOrder(order, chat.source);
        return recordProcessedMessage(order.id, chat.messageId);
      });
      expect(await prisma.customer.count()).toBe(1);
      expect(await prisma.orderMessage.count()).toBe(1);
    });
    await withTenantIsolation(b.companyId, async () => {
      expect(await prisma.customer.count()).toBe(0);
      expect(await prisma.orderMessage.count()).toBe(0);
    });
  } finally { await chatCleanup(a, b); await a.cleanup(); await b.cleanup(); }
});

test("derives source whatsapp for chat orders and manual otherwise", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const context = { companyId: f.companyId as CompanyId, sellerId: f.sellerId };
      const chatOrder = randomUUID();
      const manualOrder = randomUUID();
      for (const id of [chatOrder, manualOrder]) {
        const sale = await immediateSale({ id, items: [{ variantId: f.variantIds[0], quantity: 1 }] }, context);
        expect(sale.success).toBe(true);
      }
      const chat = await prisma.chat.create({ data: { contactId: f.contactId } });
      await prisma.order.update({ where: { companyId_id: { companyId: f.companyId, id: chatOrder } }, data: { chatId: chat.id } });
      const sourceOf = (id: string) => (id === chatOrder ? "whatsapp" : "manual");
      for (const id of [chatOrder, manualOrder])
        expect(await findOrderAggregate(id as OrderId, context.companyId)).toMatchObject({ success: true, data: { id } });
      const stored = await Promise.all([chatOrder, manualOrder].map((id) => findOrderAggregate(id as OrderId, context.companyId)));
      expect(stored.map((found) => found.success && found.data && toOrderAggregateJson(found.data).source)).toEqual(["whatsapp", "manual"]);
      const aggregates = await findOrderAggregates({ page: 1, customer: { kind: "all" } }, context.companyId);
      const summaries = await findOrders({ page: 1, customer: { kind: "all" } });
      if (!aggregates.success || !summaries.success) throw new Error("Unable to list orders");
      const expected = [chatOrder, manualOrder].map((id) => [id, sourceOf(id)]).sort();
      expect(toOrderAggregateListJson(aggregates.data).items.map((item) => [item.id, item.source]).sort()).toEqual(expected);
      expect(summaries.data.items.map((item) => [item.id, item.source]).sort()).toEqual(expected);
    });
  } finally { await f.cleanup(); }
});

test("rejects a mentioned price with only an amount or only units", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const id = randomUUID();
      expect((await immediateSale({ id, items: [{ variantId: f.variantIds[0], quantity: 1 }] }, f)).success).toBe(true);
      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: id } });
      const update = (data: Prisma.OrderItemUpdateInput) => prisma.orderItem.update({ where: { id: item.id }, data });
      const violation = (constraint: string) => ({ meta: { driverAdapterError: { cause: { originalCode: "23514", originalMessage: expect.stringContaining(`"${constraint}"`) } } } });
      const rejected = async (data: Prisma.OrderItemUpdateInput, constraint: string) => {
        const failure = await update(data).then(() => null, (error: unknown) => error);
        expect(failure).toMatchObject(violation(constraint));
      };
      await rejected({ mentionedPriceAmount: new Prisma.Decimal("7.50") }, "OrderItem_mentioned_price_both_or_none");
      await rejected({ mentionedPriceUnits: 2 }, "OrderItem_mentioned_price_both_or_none");
      await rejected({ mentionedPriceAmount: new Prisma.Decimal("0"), mentionedPriceUnits: 1 }, "OrderItem_mentioned_price_amount_positive");
      await rejected({ mentionedPriceAmount: new Prisma.Decimal("7.50"), mentionedPriceUnits: 0 }, "OrderItem_mentioned_price_units_range");
      await rejected({ mentionedPriceAmount: new Prisma.Decimal("7.50"), mentionedPriceUnits: 100 }, "OrderItem_mentioned_price_units_range");
      await update({ mentionedPriceAmount: new Prisma.Decimal("7.50"), mentionedPriceUnits: 99 });
      expect(await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ mentionedPriceUnits: 99 });
    });
  } finally { await f.cleanup(); }
});

test("keeps the chat message outcome of one company invisible to another", async () => {
  const a = await fixture();
  const b = await fixture();
  try {
    const chat = await chatFixture(a);
    await withTenantIsolation(a.companyId, async () => {
      await prisma.chatMessageOutcome.create({ data: { messageId: chat.messageId, outcomes: [{ kind: "no_intent" }] } });
      expect(await prisma.chatMessageOutcome.count()).toBe(1);
      await prisma.chatMessage.update({ where: { companyId_id: { companyId: a.companyId, id: chat.messageId } }, data: { registeredBySessionId: "session-1" } });
    });
    await withTenantIsolation(b.companyId, async () => {
      expect(await prisma.chatMessageOutcome.count()).toBe(0);
      await expect(prisma.chatMessageOutcome.create({ data: { companyId: a.companyId, messageId: chat.messageId, outcomes: [] } })).rejects.toThrow();
    });
    await withTenantIsolation(a.companyId, async () => {
      await expect(prisma.chatMessage.deleteMany()).rejects.toThrow();
      await prisma.chatMessageOutcome.deleteMany();
    });
  } finally { await chatCleanup(a, b); await a.cleanup(); await b.cleanup(); }
});

test("reads the confirmation of a catalog order of the company and answers not_confirmed for another company's order", async () => {
  const a = await fixture();
  const b = await fixture();
  try {
    const create = (companyId: string, number: bigint, values: Readonly<{ fromCatalog: boolean; confirmed: boolean }>) => withTenantIsolation(companyId, async () => {
      const id = randomUUID() as OrderId;
      await prisma.order.create({ data: { id, number, currency: "PEN", total: 10, itemsTotal: 10, createdAt: new Date(), fromCatalog: values.fromCatalog,
        sellerId: values.fromCatalog ? null : (companyId === a.companyId ? a.sellerId : b.sellerId), checkoutEnabledAt: values.fromCatalog || values.confirmed ? new Date() : null,
        checkoutConfirmedAt: values.confirmed ? new Date() : null } });
      return id;
    });
    const confirmed = await create(a.companyId, 1901n, { fromCatalog: true, confirmed: true });
    const pending = await create(a.companyId, 1902n, { fromCatalog: true, confirmed: false });
    const manual = await create(a.companyId, 1903n, { fromCatalog: false, confirmed: true });
    const other = await create(b.companyId, 1901n, { fromCatalog: true, confirmed: true });
    const read = (companyId: string, orderId: OrderId) => orders.readCatalogOrderConfirmation(companyId as CompanyId, orderId);
    expect(await read(a.companyId, confirmed)).toEqual(ok("confirmed"));
    expect(await read(a.companyId, pending)).toEqual(ok("not_confirmed"));
    expect(await read(a.companyId, manual)).toEqual(ok("not_confirmed"));
    expect(await read(a.companyId, randomUUID() as OrderId)).toEqual(ok("not_confirmed"));
    expect(await read(a.companyId, other)).toEqual(ok("not_confirmed"));
    expect(await read(b.companyId, other)).toEqual(ok("confirmed"));
  } finally { await a.cleanup(); await b.cleanup(); }
});

test("an existing order with an inactive variant is paid with stock deduction and cancelled with stock restore", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const orderId = randomUUID() as OrderId;
      const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
      const variantId = f.variantIds[1] as VariantId;
      expect(await orders.create({ id: orderId, items: [{ variantId, quantity: 2 as PositiveInteger }] }, context)).toMatchObject({ success: true });
      await prisma.productVariant.update({ where: { id: variantId }, data: { status: "inactive" } });
      const stock = async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity;
      expect(await orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId, amount: { amount: 0.4, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, context))
        .toMatchObject({ success: true, data: { stock: { kind: "deducted" } } });
      expect(await stock()).toBe(1n);
      expect(await orders.cancel(orderId, context)).toMatchObject({ success: true, data: { cancelled: true, stockDeducted: true } });
      expect(await restoreCancelledStock.handler({ orderId, companyId: f.companyId } as never, {} as never, {} as never)).toMatchObject({ success: true });
      expect(await stock()).toBe(3n);
    });
  } finally { await f.cleanup(); }
});

async function paidOrderWithDeductedStock(f: Awaited<ReturnType<typeof fixture>>) {
  const orderId = randomUUID() as OrderId;
  const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
  expect(await orders.create({ id: orderId, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 2 as PositiveInteger }] }, context)).toMatchObject({ success: true });
  expect(await orders.registerPayment({ orderId, paymentId: randomUUID() as PaymentId, amount: { amount: 0.2, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }, context))
    .toMatchObject({ success: true, data: { stock: { kind: "deducted" } } });
  return { orderId, context };
}

test("saves and reads the cancellation and stock deduction times", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const { orderId, context } = await paidOrderWithDeductedStock(f);
      const stored = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(stored.stockDeductedAt).toBeInstanceOf(Date);
      expect(stored.cancelledAt).toBeNull();
      expect(await orders.cancel(orderId, context)).toMatchObject({ success: true });
      const cancelled = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(cancelled.cancelledAt).toBeInstanceOf(Date);
      expect(await findOrderAggregate(orderId, context.companyId)).toMatchObject({ success: true,
        data: { cancelled: true, cancelledAt: cancelled.cancelledAt, stockDeducted: true, stockDeductedAt: stored.stockDeductedAt } });
    });
  } finally { await f.cleanup(); }
});

test("a cancelled order whose stock was restored still parses and keeps its deduction time", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const { orderId, context } = await paidOrderWithDeductedStock(f);
      const deductedAt = (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stockDeductedAt;
      expect(await orders.cancel(orderId, context)).toMatchObject({ success: true });
      expect(await restoreCancelledStock.handler({ orderId, companyId: f.companyId } as never, {} as never, {} as never)).toMatchObject({ success: true });
      expect(await findOrderAggregate(orderId, context.companyId)).toMatchObject({ success: true,
        data: { cancelled: true, stockDeducted: false, stockDeductedAt: deductedAt } });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stockDeductedAt).toEqual(deductedAt);
    });
  } finally { await f.cleanup(); }
});

test("a second stock deduction call keeps the first deduction time", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const { orderId, context } = await paidOrderWithDeductedStock(f);
      const first = (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stockDeductedAt;
      expect(await orders.deductStock(orderId, context)).toMatchObject({ success: true, data: { stockDeducted: true } });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).stockDeductedAt).toEqual(first);
    });
  } finally { await f.cleanup(); }
});

test("a twenty-item order and an immediate sale resolve their variants with one batched lookup", async () => {
  const f = await fixture();
  try {
    const lookup = vi.spyOn(products, "findSellableVariants");
    const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
    const variantIds = await withTenantIsolation(f.companyId, async () => {
      const seeded = await seedProduct({ name: "Twenty", variants: Array.from({ length: 20 }, (_, index) => ({ attributes: { Number: String(index) }, salePrice: 1, stock: 5n })) });
      return seeded.variantIds;
    });
    const items = variantIds.map((variantId) => ({ variantId: variantId as VariantId, quantity: 1 as PositiveInteger })) as unknown as Parameters<typeof orders.create>[0]["items"];
    await withTenantIsolation(f.companyId, async () => {
      expect(await orders.create({ id: randomUUID() as OrderId, items }, context)).toMatchObject({ success: true, data: { items: expect.arrayContaining([expect.anything()]) } });
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(lookup).toHaveBeenLastCalledWith(variantIds);
      expect(await orders.registerImmediateSale({ id: randomUUID() as OrderId, items }, context)).toMatchObject({ success: true, data: { stockDeducted: true } });
      expect(lookup).toHaveBeenCalledTimes(2);
    });
    lookup.mockRestore();
  } finally { await f.cleanup(); }
});

test("a variant deleted between the sellable read and the item insert answers VARIANT_NOT_FOUND with its variantId", async () => {
  const f = await fixture();
  try {
    const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
    const doomed = f.variantIds[1] as VariantId;
    const real = products.findSellableVariants;
    const lookup = vi.spyOn(products, "findSellableVariants").mockImplementation(async (ids) => {
      const found = await real(ids);
      await prisma.productStock.deleteMany({ where: { variantId: doomed } });
      await prisma.productVariant.delete({ where: { id: doomed } });
      return found;
    });
    try {
      for (const sale of [orders.create, orders.registerImmediateSale]) {
        await withTenantIsolation(f.companyId, async () => {
          const orderId = randomUUID() as OrderId;
          const result = await sale({ id: orderId, items: [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }, { variantId: doomed, quantity: 1 as PositiveInteger }] }, context);
          expect(result).toMatchObject({ success: false, error: { code: "VARIANT_NOT_FOUND", variantId: doomed } });
          expect(await prisma.order.count({ where: { id: orderId } })).toBe(0);
        });
      }
    } finally { lookup.mockRestore(); }
  } finally { await f.cleanup(); }
});

test("searchSaleCatalog omits products without active variants and variants that are inactive", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      await seedProduct({ name: "Retired cap", variants: [{ attributes: { Talla: "M" }, status: "inactive" }, { attributes: { Talla: "L" }, status: "inactive" }] });
      await seedProduct({ name: "Retired shirt", variants: [{ attributes: { Talla: "M" }, status: "inactive", salePrice: 5 }, { attributes: { Talla: "L" }, salePrice: 6 }] });
      const found = await orders.searchProducts("retired");
      expect(found.success && found.data.map(({ name, variants }) => [name, variants.map(({ attributes }) => attributes)])).toEqual([["Retired shirt", [{ Talla: "L" }]]]);
    });
  } finally { await f.cleanup(); }
});

test("searchSaleCatalog and the public catalog list variants in the saved option and value order, also after a reorder", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      // Ids sort against the saved order, so an id-ordered read cannot pass by chance.
      const ids = { "azul-l": "00000000-0000-4000-8000-000000000001", "negro-m": "00000000-0000-4000-8000-000000000002",
        "azul-m": "00000000-0000-4000-8000-000000000003", "negro-l": "00000000-0000-4000-8000-000000000004" };
      const seeded = await seedProduct({ name: "Ordered shirt", options: [{ name: "Color", values: ["Negro", "Azul"] }, { name: "Talla", values: ["M", "L"] }],
        variants: [{ id: ids["azul-l"], attributes: { Color: "Azul", Talla: "L" } }, { id: ids["negro-m"], attributes: { Color: "Negro", Talla: "M" } },
          { id: ids["azul-m"], attributes: { Color: "Azul", Talla: "M" } }, { id: ids["negro-l"], attributes: { Color: "Negro", Talla: "L" } }] });
      const sold = async () => {
        const found = await orders.searchProducts("ordered shirt");
        return found.success ? found.data[0].variants.map(({ attributes }) => `${attributes.Color} ${attributes.Talla}`) : found;
      };
      const catalog = async () => {
        const found = await catalogProductRepository.find(seeded.productId as ProductId, "PEN");
        return found.success && found.data ? found.data.variants.map(({ attributes }) => `${attributes.Color} ${attributes.Talla}`) : found;
      };
      const saved = ["Negro M", "Negro L", "Azul M", "Azul L"];
      expect(await sold()).toEqual(saved);
      expect(await catalog()).toEqual(saved);
      // The seller moves Azul first and L before M.
      for (const [id, position] of [[seeded.valueIds.Color.Negro, 2], [seeded.valueIds.Color.Azul, 0], [seeded.valueIds.Talla.M, 2], [seeded.valueIds.Talla.L, 0]] as const)
        await prisma.productOptionValue.update({ where: { id }, data: { position } });
      const reordered = ["Azul L", "Azul M", "Negro L", "Negro M"];
      expect(await sold()).toEqual(reordered);
      expect(await catalog()).toEqual(reordered);
      // Checkout lookups by id keep the saved order too.
      const byId = await orders.searchProducts("", Object.values(ids));
      expect(byId.success && byId.data[0].variants.map(({ id }) => id)).toEqual([ids["azul-l"], ids["azul-m"], ids["negro-l"], ids["negro-m"]]);
    });
  } finally { await f.cleanup(); }
});

test("renaming a seeded value keeps old order items and a new order reads the new name", async () => {
  const f = await fixture();
  try {
    const context = { companyId: f.companyId as CompanyId, userId: f.sellerId as UserId };
    await withTenantIsolation(f.companyId, async () => {
      const [first, second] = [randomUUID() as OrderId, randomUUID() as OrderId];
      const items = [{ variantId: f.variantIds[0] as VariantId, quantity: 1 as PositiveInteger }] as const;
      expect(await orders.create({ id: first, items: [...items] }, context)).toMatchObject({ success: true });
      await prisma.productOptionValue.updateMany({ where: { name: "M" }, data: { name: "Medium" } });
      expect(await orders.create({ id: second, items: [...items] }, context)).toMatchObject({ success: true });
      expect(await findOrderAggregate(first, context.companyId)).toMatchObject({ data: { items: [{ variantAttributes: { Size: "M" } }] } });
      expect(await findOrderAggregate(second, context.companyId)).toMatchObject({ data: { items: [{ variantAttributes: { Size: "Medium" } }] } });
    });
  } finally { await f.cleanup(); }
});
