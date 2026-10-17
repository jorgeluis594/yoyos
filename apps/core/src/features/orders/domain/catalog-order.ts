import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";

/** A catalog order the buyer has not confirmed yet; sellers treat it as non-existent. */
export function isPendingCatalogOrder(order: Pick<OrderAggregate, "fromCatalog" | "checkoutConfirmedAt">) {
  return order.fromCatalog && order.checkoutConfirmedAt === null;
}
