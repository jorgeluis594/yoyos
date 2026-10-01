import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { err } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import { getCompanyId, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { createOrder } from "@core/src/features/orders/application/create-order";
import { createPendingOrder, type CreatePendingOrderDependencies } from "@core/src/features/orders/application/create-pending-order";
import { deductStock, type DeductStockDependencies } from "@core/src/features/orders/application/deduct-stock";
import { getOrder, listOrders } from "@core/src/features/orders/application/read-orders";
import { saveOrder, savePendingOrder, saveStockDeduction, findOrder, findOrderForUpdate, findOrders, orderExists } from "@core/src/features/orders/infrastructure/order-repository";
import { findSellableVariant, deductProductStock, searchSaleCatalog } from "@core/src/features/products";
import { findContactById, searchSaleContacts } from "@core/src/features/contacts";
import type { OrderItemId, PaymentId } from "@core/src/features/orders/domain/order";

async function orderTransaction<T, E extends AppError>(callback: () => Promise<Result<T, E>>): Promise<Result<T, E | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>> {
  try {
    return await withinTransaction(callback);
  } catch (cause) {
    if (!(cause instanceof Prisma.PrismaClientKnownRequestError
      || cause instanceof Prisma.PrismaClientUnknownRequestError
      || cause instanceof Prisma.PrismaClientInitializationError)) throw cause;
    console.error("Unable to complete order transaction", { error: cause.name, code: cause instanceof Prisma.PrismaClientKnownRequestError ? cause.code : undefined });
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to complete order transaction" });
  }
}

function scopedOrderTransaction<T, E extends AppError>(companyId: string, callback: () => Promise<Result<T, E>>): Promise<Result<T, E | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>> {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  return orderTransaction(callback);
}
const pendingTransaction: CreatePendingOrderDependencies["transaction"] = scopedOrderTransaction;
const stockTransaction: DeductStockDependencies["transaction"] = scopedOrderTransaction;

export const orders = {
  deductStock: (id: Parameters<typeof deductStock>[0], context: Parameters<typeof deductStock>[1]) =>
    deductStock(id, context, { transaction: stockTransaction, findOrderForUpdate, deductProductStock, saveStockDeduction }),
  createPending: (input: Parameters<typeof createPendingOrder>[0], context: Parameters<typeof createPendingOrder>[1]) =>
    createPendingOrder(input, context, { transaction: pendingTransaction, orderExists,
      findContact: findContactById, findVariant: findSellableVariant, saveOrder: savePendingOrder,
      newItemId: () => randomUUID() as OrderItemId, clock: () => new Date() }),
  create: (input: Parameters<typeof createOrder>[0], context: Parameters<typeof createOrder>[1]) =>
    createOrder(input, context, { transaction: orderTransaction, orderExists, findContact: findContactById, findVariant: findSellableVariant,
      save: saveOrder, deductStock: deductProductStock, newId: randomUUID, newPaymentId: () => randomUUID() as PaymentId, clock: () => new Date() }),
  list: (criteria: Parameters<typeof listOrders>[0]) => listOrders(criteria, findOrders),
  get: (id: string) => getOrder(id, findOrder),
  searchProducts: searchSaleCatalog,
  searchContacts: searchSaleContacts,
  contactById: findContactById,
};
