import { ok } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import { isPendingCatalogOrder } from "@core/src/features/orders/domain/catalog-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";

type OrderReader = (...args: never[]) => Promise<Result<Pick<OrderAggregate, "fromCatalog" | "checkoutConfirmedAt"> | null, AppError>>;

/** Seller readers: an unconfirmed catalog order does not exist for the seller. The public checkout keeps the unwrapped readers. */
export function rejectPendingCatalogOrder<F extends OrderReader>(find: F): F {
  return (async (...args: Parameters<F>) => {
    const found = await find(...args);
    return found.success && found.data && isPendingCatalogOrder(found.data) ? ok(null) : found;
  }) as F;
}
