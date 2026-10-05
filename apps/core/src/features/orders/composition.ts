import { log } from "@core/src/shared/infrastructure/logger";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { err } from "@shared/functional";
import { z } from "zod";
import type { AppError, Result } from "@shared/result";
import { getCompanyId, withTenantIsolation, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { createOrder, type CreateOrderDependencies } from "@core/src/features/orders/application/create-order";
import { deductStock, type DeductStockDependencies } from "@core/src/features/orders/application/deduct-stock";
import { registerPayment, type RegisterPaymentDependencies } from "@core/src/features/orders/application/register-payment";
import { reportPayment, type ReportPaymentDependencies } from "@core/src/features/orders/application/report-payment";
import { voidPayment, type VoidPaymentDependencies } from "@core/src/features/orders/application/void-payment";
import { registerImmediateSale, type RegisterImmediateSaleDependencies } from "@core/src/features/orders/application/register-immediate-sale";
import { cancelOrder, type CancelOrderDependencies } from "@core/src/features/orders/application/cancel-order";
import { registerShipment, registerDelivery, type FulfillOrderDependencies } from "@core/src/features/orders/application/fulfill-order";
import { getOrderAggregate } from "@core/src/features/orders/application/read-order-aggregate";
import { listOrderAggregates } from "@core/src/features/orders/application/list-order-aggregates";
import { listOrders } from "@core/src/features/orders/application/read-orders";
import { savePendingOrder, savePayment, updatePayment, saveCompletion, saveStockDeduction, saveFulfillment, saveCancellation, findOrderAggregate, findOrderAggregates, findOrderForUpdate, findOrders, orderExists, resolveBuyerOrderCompany } from "@core/src/features/orders/infrastructure/order-repository";
import { findSellableVariant, deductProductStock, restoreProductStock, searchSaleCatalog } from "@core/src/features/products";
import { findContactById, searchSaleContacts } from "@core/src/features/contacts";
import { findAvailablePublicImage, resolvePublicImage } from "@core/src/shared/images";
import { companyPaymentSettings } from "@core/src/features/companies";
import { orderStateMachine } from "@core/src/features/orders/domain/order-state-machine";
import type { BuyerPaymentView } from "@shared/contracts/orders";
import type { CompanyId, OrderId, OrderItemId, PaymentId } from "@core/src/features/orders/domain/order";

async function orderTransaction<T, E extends AppError>(callback: () => Promise<Result<T, E>>): Promise<Result<T, E | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>> {
  try {
    return await withinTransaction(callback);
  } catch (cause) {
    if (!(cause instanceof Prisma.PrismaClientKnownRequestError
      || cause instanceof Prisma.PrismaClientUnknownRequestError
      || cause instanceof Prisma.PrismaClientInitializationError)) throw cause;
    log.error({ event: "unable_to_complete_order_transaction", err: cause }, "unable_to_complete_order_transaction");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to complete order transaction" });
  }
}

function scopedOrderTransaction<T, E extends AppError>(companyId: string, callback: () => Promise<Result<T, E>>): Promise<Result<T, E | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>> {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  return orderTransaction(callback);
}
const pendingTransaction: CreateOrderDependencies["transaction"] = scopedOrderTransaction;
const stockTransaction: DeductStockDependencies["transaction"] = scopedOrderTransaction;
const paymentTransaction: RegisterPaymentDependencies["transaction"] = scopedOrderTransaction;
const reportTransaction: ReportPaymentDependencies["transaction"] = scopedOrderTransaction;
const voidTransaction: VoidPaymentDependencies["transaction"] = scopedOrderTransaction;
const immediateTransaction: RegisterImmediateSaleDependencies["transaction"] = scopedOrderTransaction;
const cancellationTransaction: CancelOrderDependencies["transaction"] = scopedOrderTransaction;
const fulfillmentTransaction: FulfillOrderDependencies["transaction"] = scopedOrderTransaction;
const fulfillmentDependencies: FulfillOrderDependencies = { transaction: fulfillmentTransaction, findOrderForUpdate,
  saveFulfillment, clock: () => new Date() };

export async function resolveBuyerAccess(id: string) {
  if (!z.uuid().safeParse(id).success) return err({ code: "INVALID_ORDER" as const, message: "Invalid order ID" });
  const resolved = await resolveBuyerOrderCompany(id as OrderId);
  return resolved.success ? resolved.data ? { success: true as const, data: { kind: "buyer" as const,
    companyId: resolved.data as CompanyId, orderId: id as OrderId } }
    : err({ code: "ORDER_NOT_FOUND" as const, message: "Order not found" }) : resolved;
}

export async function getBuyerPaymentView(id: string) {
  const access = await resolveBuyerAccess(id);
  if (!access.success) return access;
  return withTenantIsolation(access.data.companyId, async () => {
    const [found, settings] = await Promise.all([
      findOrderAggregate(access.data.orderId, access.data.companyId), companyPaymentSettings.get(access.data.companyId),
    ]);
    if (!found.success) return found;
    if (!found.data) return err({ code: "ORDER_NOT_FOUND" as const, message: "Order not found" });
    if (!settings.success) return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Payment settings unavailable" });
    const summary = orderStateMachine.getPaymentSummary(found.data);
    if (!summary.success) return summary;
    const imageIds = [...settings.data.map((item) => item.imageId), ...found.data.payments.map((payment) =>
      payment.status === "reported" ? payment.data.receiptImageId : payment.data.evidence.kind === "buyer_report"
        ? payment.data.evidence.report.receiptImageId : null)].filter((value): value is NonNullable<typeof value> => value !== null);
    const images = new Map<string, string | null>();
    for (const imageId of new Set(imageIds)) {
      const resolved = await resolvePublicImage(imageId);
      if (!resolved.success) return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Image unavailable" });
      images.set(imageId, resolved.data?.url ?? null);
    }
    const view: BuyerPaymentView = { orderId: found.data.id, total: found.data.total, deliveryCharge: found.data.deliveryCharge,
      paidAmount: summary.data.paidAmount, balanceDue: summary.data.balanceDue, paymentStatus: summary.data.status,
      settings: settings.data.map((item) => { const imageUrl = item.imageId ? images.get(item.imageId) ?? null : null;
        return item.method === "digital_wallet" ? { method: item.method, provider: item.provider, holder: item.holder, imageUrl }
          : { method: item.method, bank: item.bank, holder: item.holder, accountNumber: item.accountNumber, cci: item.cci, imageUrl }; }),
      payments: found.data.payments.map((payment) => { const imageId = payment.status === "reported" ? payment.data.receiptImageId
        : payment.data.evidence.kind === "buyer_report" ? payment.data.evidence.report.receiptImageId : null;
      return { id: payment.id, status: payment.status, amount: payment.amount, method: payment.method,
        receiptImageUrl: imageId ? images.get(imageId) ?? null : null }; }) };
    return { success: true as const, data: view };
  });
}

export const orders = {
  resolveBuyerAccess,
  getBuyerPaymentView,
  listAggregates: (criteria: Parameters<typeof listOrderAggregates>[0], context: Parameters<typeof listOrderAggregates>[1]) =>
    listOrderAggregates(criteria, context, findOrderAggregates),
  getAggregate: (id: Parameters<typeof getOrderAggregate>[0], context: Parameters<typeof getOrderAggregate>[1]) =>
    getOrderAggregate(id, context, findOrderAggregate),
  ship: (id: Parameters<typeof registerShipment>[0], context: Parameters<typeof registerShipment>[1]) =>
    registerShipment(id, context, fulfillmentDependencies),
  deliver: (id: Parameters<typeof registerDelivery>[0], context: Parameters<typeof registerDelivery>[1]) =>
    registerDelivery(id, context, fulfillmentDependencies),
  cancel: (id: Parameters<typeof cancelOrder>[0], context: Parameters<typeof cancelOrder>[1]) =>
    cancelOrder(id, context, { transaction: cancellationTransaction, findOrderForUpdate, restoreProductStock, saveCancellation }),
  registerImmediateSale: (input: Parameters<typeof registerImmediateSale>[0], context: Parameters<typeof registerImmediateSale>[1]) =>
    registerImmediateSale(input, context, { transaction: immediateTransaction, orderExists,
      findContact: findContactById, findVariant: findSellableVariant, saveOrder: savePendingOrder,
      savePayment, deductProductStock, saveStockDeduction, saveFulfillment,
      newItemId: () => randomUUID() as OrderItemId, newPaymentId: () => randomUUID() as PaymentId, clock: () => new Date() }),
  registerPayment: (input: Parameters<typeof registerPayment>[0], context: Parameters<typeof registerPayment>[1]) =>
    registerPayment(input, context, { transaction: paymentTransaction, findOrderForUpdate, savePayment, updatePayment, saveCompletion,
      deductProductStock, saveStockDeduction, clock: () => new Date() }),
  reportPayment: (input: Parameters<typeof reportPayment>[0], access: Parameters<typeof reportPayment>[1]) =>
    reportPayment(input, access, { transaction: reportTransaction, findOrderForUpdate, findReceipt: findAvailablePublicImage,
      savePayment, clock: () => new Date() }),
  voidPayment: (input: Parameters<typeof voidPayment>[0], context: Parameters<typeof voidPayment>[1]) =>
    voidPayment(input, context, { transaction: voidTransaction, findOrderForUpdate, updatePayment, saveCompletion, clock: () => new Date() }),
  deductStock: (id: Parameters<typeof deductStock>[0], context: Parameters<typeof deductStock>[1]) =>
    deductStock(id, context, { transaction: stockTransaction, findOrderForUpdate, deductProductStock, saveStockDeduction }),
  create: (input: Parameters<typeof createOrder>[0], context: Parameters<typeof createOrder>[1]) =>
    createOrder(input, context, { transaction: pendingTransaction, orderExists,
      findContact: findContactById, findVariant: findSellableVariant, saveOrder: savePendingOrder,
      newItemId: () => randomUUID() as OrderItemId, clock: () => new Date() }),
  list: (criteria: Parameters<typeof listOrders>[0]) => listOrders(criteria, findOrders),
  searchProducts: searchSaleCatalog,
  searchContacts: searchSaleContacts,
  contactById: findContactById,
};
