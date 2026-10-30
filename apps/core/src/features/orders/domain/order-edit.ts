import type { OrderItem, OrderItemId } from "@core/src/features/orders/domain/order";

/** Row changes of an order's items: items are compared by id, and a replaced variant is a removed item plus an added one. */
export type OrderItemChanges = Readonly<{ added: readonly OrderItem[]; updated: readonly OrderItem[]; removedItemIds: readonly OrderItemId[] }>;
