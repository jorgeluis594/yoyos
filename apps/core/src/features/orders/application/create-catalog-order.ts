import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { buildCatalogOrder, checkCartAvailability, type CartLine, type LineIssue, type SellableVariant } from "@core/src/features/orders/domain/catalog-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, OrderId, OrderItemId } from "@core/src/features/orders/domain/order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { VariantId } from "@core/src/features/products/domain/product";

export type CreateCatalogOrderInput = Readonly<{ id: OrderId; lines: readonly CartLine[] }>;
export type CatalogOrderAccess = Readonly<{ companyId: CompanyId }>;
export type CreateCatalogOrderError =
  | Readonly<{ code: "LINES_UNAVAILABLE"; message: string; issues: readonly LineIssue[] }>
  | Readonly<{ code: "ORDER_ID_CONFLICT" | "ORDER_NUMBER_EXHAUSTED" | "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string }>;
export type CreateCatalogOrderDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, CreateCatalogOrderError>>) => Promise<Result<T, CreateCatalogOrderError>>;
  findOrder: (id: OrderId) => Promise<Result<OrderAggregate | null, CreateCatalogOrderError>>;
  findSellableVariants: (ids: readonly VariantId[]) => Promise<Result<readonly SellableVariant[], CreateCatalogOrderError>>;
  allocateNumber: (companyId: CompanyId) => Promise<Result<OrderNumber, CreateCatalogOrderError>>;
  /** Fails with ORDER_ID_CONFLICT when the id is already stored, in this company or, invisible under RLS, in another one. */
  saveCatalogOrder: (order: OrderAggregate) => Promise<Result<null, CreateCatalogOrderError>>;
  newItemId: () => OrderItemId;
  clock: () => Date;
}>;

const conflict: CreateCatalogOrderError = { code: "ORDER_ID_CONFLICT", message: "Order id is already in use" };

/** The same cart id returns the order it already created; a rejected cart writes nothing and allocates no number. */
export async function createCatalogOrder(input: CreateCatalogOrderInput, access: CatalogOrderAccess, deps: CreateCatalogOrderDependencies): Promise<Result<OrderAggregate, CreateCatalogOrderError>> {
  const created = await deps.transaction(access.companyId, () => createInTransaction(input, access, deps));
  if (created.success || created.error.code !== "ORDER_ID_CONFLICT") return created;
  // A simultaneous Continuar with the same id won the insert; ours rolled back, number included.
  const stored = await deps.transaction(access.companyId, () => deps.findOrder(input.id));
  if (!stored.success) return stored;
  return stored.data?.fromCatalog ? ok(stored.data) : err(conflict);
}

async function createInTransaction(input: CreateCatalogOrderInput, access: CatalogOrderAccess, deps: CreateCatalogOrderDependencies): Promise<Result<OrderAggregate, CreateCatalogOrderError>> {
  const existing = await deps.findOrder(input.id);
  if (!existing.success) return existing;
  if (existing.data) return existing.data.fromCatalog ? ok(existing.data) : err(conflict);
  const variants = await deps.findSellableVariants(input.lines.map((line) => line.variantId));
  if (!variants.success) return variants;
  const issues = checkCartAvailability(input.lines, variants.data);
  if (issues.length) return err({ code: "LINES_UNAVAILABLE", message: "Some cart lines are not available", issues });
  const number = await deps.allocateNumber(access.companyId);
  if (!number.success) return number;
  const built = buildCatalogOrder({ id: input.id, companyId: access.companyId, number: number.data, lines: input.lines, variants: variants.data,
    itemIds: input.lines.map(() => deps.newItemId()), now: deps.clock() });
  if (!built.success) return err({ code: "INVALID_STORED_DATA", message: built.error.message });
  const saved = await deps.saveCatalogOrder(built.data);
  return saved.success ? built : saved;
}
