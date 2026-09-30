import { log } from "@core/src/shared/infrastructure/logger";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { err } from "@shared/functional";
import { withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { createOrder, type CreateOrderDependencies } from "@core/src/features/orders/application/create-order";
import { getOrder, listOrders } from "@core/src/features/orders/application/read-orders";
import { saveOrder, findOrder, findOrders, orderExists } from "@core/src/features/orders/infrastructure/order-repository";
import { findSellableVariant, deductProductStock, searchSaleCatalog } from "@core/src/features/products";
import { findContactById, searchSaleContacts } from "@core/src/features/contacts";

const orderTransaction: CreateOrderDependencies["transaction"] = async (callback) => {
  try {
    return await withinTransaction(callback);
  } catch (cause) {
    if (!(cause instanceof Prisma.PrismaClientKnownRequestError
      || cause instanceof Prisma.PrismaClientUnknownRequestError
      || cause instanceof Prisma.PrismaClientInitializationError)) throw cause;
    log.error({ event: "unable_to_complete_order_transaction", err: cause }, "unable_to_complete_order_transaction");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to complete order transaction" });
  }
};

export const orders = {
  create: (input: Parameters<typeof createOrder>[0], context: Parameters<typeof createOrder>[1]) =>
    createOrder(input, context, { transaction: orderTransaction, orderExists, findContact: findContactById, findVariant: findSellableVariant,
      save: saveOrder, deductStock: deductProductStock, newId: randomUUID, clock: () => new Date() }),
  list: (criteria: Parameters<typeof listOrders>[0]) => listOrders(criteria, findOrders),
  get: (id: string) => getOrder(id, findOrder),
  searchProducts: searchSaleCatalog,
  searchContacts: searchSaleContacts,
  contactById: findContactById,
};
