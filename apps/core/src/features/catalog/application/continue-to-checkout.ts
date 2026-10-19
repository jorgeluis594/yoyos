import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CatalogOrderAccess, CreateCatalogOrderError, CreateCatalogOrderInput } from "@core/src/features/orders/application/create-catalog-order";
import type { CartLine } from "@core/src/features/orders/domain/catalog-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, OrderId } from "@core/src/features/orders";

export type ContinueToCheckoutInput = Readonly<{ orderId: OrderId; lines: readonly CartLine[] }>;
export type CatalogUnavailable = Readonly<{ code: "CATALOG_UNAVAILABLE"; message: string }>;
type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type ContinueToCheckoutError = CatalogUnavailable | PersistenceError | CreateCatalogOrderError;
export type ContinueToCheckoutDependencies = Readonly<{
  readPublished: (companyId: CompanyId) => Promise<Result<boolean, PersistenceError>>;
  createCatalogOrder: (input: CreateCatalogOrderInput, access: CatalogOrderAccess) => Promise<Result<OrderAggregate, CreateCatalogOrderError>>;
}>;

/** The publication check is not under lock: a catalog hidden in the same instant may still receive this order, which stays hidden until confirmed. */
export async function continueToCheckout(input: ContinueToCheckoutInput, access: CatalogOrderAccess, deps: ContinueToCheckoutDependencies): Promise<Result<OrderAggregate, ContinueToCheckoutError>> {
  const published = await deps.readPublished(access.companyId);
  if (!published.success) return published;
  if (!published.data) return err({ code: "CATALOG_UNAVAILABLE", message: "Catalog is not published" });
  return deps.createCatalogOrder({ id: input.orderId, lines: input.lines }, access);
}
