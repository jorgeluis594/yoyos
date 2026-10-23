import type { Result } from "@shared/result";
import type { CompanyId, OrderId } from "@core/src/features/orders";
import type { CatalogAccess } from "@core/src/features/catalog/application/browse-catalog";

export type CartOrderState = "confirmed" | "not_confirmed";
type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type CheckCartOrderDependencies = Readonly<{
  /** A missing, pending, non-catalog or other company's order reads as `not_confirmed`. */
  readCatalogOrderConfirmation: (companyId: CompanyId, orderId: OrderId) => Promise<Result<CartOrderState, PersistenceError>>;
}>;

/** Tells the brand-host cart whether the order it sent to Continuar was confirmed in the checkout. */
export function checkCartOrder(input: Readonly<{ orderId: OrderId }>, access: CatalogAccess, deps: CheckCartOrderDependencies): Promise<Result<CartOrderState, PersistenceError>> {
  return deps.readCatalogOrderConfirmation(access.companyId, input.orderId);
}
