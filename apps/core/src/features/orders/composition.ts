import { randomUUID } from "node:crypto";
import { withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { createOrder } from "@core/src/features/orders/application/create-order";
import { getOrder, listOrders } from "@core/src/features/orders/application/read-orders";
import { saveOrder, findOrder, findOrders, orderExists } from "@core/src/features/orders/infrastructure/order-repository";
import { findSellableVariant, deductProductStock, searchSaleCatalog } from "@core/src/features/products";
import { findContactById, searchSaleContacts } from "@core/src/features/contacts";

export const orders = {
  create: (input: Parameters<typeof createOrder>[0], context: Parameters<typeof createOrder>[1]) =>
    createOrder(input, context, { transaction: withinTransaction, orderExists, findContact: findContactById, findVariant: findSellableVariant,
      save: saveOrder, deductStock: deductProductStock, newId: randomUUID, clock: () => new Date() }),
  list: (criteria: Parameters<typeof listOrders>[0]) => listOrders(criteria, findOrders),
  get: (id: string) => getOrder(id, findOrder),
  searchProducts: searchSaleCatalog,
  searchContacts: searchSaleContacts,
  contactById: findContactById,
};
