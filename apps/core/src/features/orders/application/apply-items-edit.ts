import { err, ok } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import type { TransactionEndingError } from "@core/src/shared/application/contained-failure";
import type { SellableVariant } from "@core/src/features/orders/domain/catalog-order";
import type { CompanyId, OrderId, OrderItemId, PositiveInteger } from "@core/src/features/orders/domain/order";
import { orderEdit, type OrderItemChanges, type OrderLineRequest, type VariantNotFound } from "@core/src/features/orders/domain/order-edit";
import type { OrderAggregate, OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { OrderEdited } from "@core/src/features/orders/application/events";
import type { DeductionOutcome } from "@core/src/features/orders/application/deduct-due-stock";
import { describeOrderStockDue, orderWithStockDue, type StockEventResult, type StockReader } from "@core/src/features/orders/application/describe-order-stock-due";

/** What an edit gives the unverdicted changes of the items it touched: `quantity_changed` to raised or lowered lines, `removed` to deleted ones. */
export type EditVerdicts = readonly Readonly<{ verdict: "quantity_changed" | "removed"; itemIds: readonly OrderItemId[] }>[];

/** The items step runs inside the caller's transaction, on the locked order. */
export type PlannedItemsEdit = Readonly<{
  order: OrderAggregate;
  changes: OrderItemChanges;
  /** The deducted units of the deleted lines, read before their rows go: the stock listener returns them. */
  returns: readonly Readonly<{ variantId: VariantId; quantity: PositiveInteger }>[];
}>;

export type PlanItemsEditDependencies<E extends AppError> = Readonly<{
  /** Products capability: active variants only, one batched lookup. */
  findSellableVariants: (ids: readonly VariantId[]) => Promise<Result<readonly SellableVariant[], E>>;
  newItemId: () => OrderItemId;
}>;

/** Plans and applies the final lines to the locked order in memory. It only reads. */
export async function planItemsEdit<E extends AppError>(order: OrderAggregate, lines: readonly OrderLineRequest[], deps: PlanItemsEditDependencies<E>):
  Promise<Result<PlannedItemsEdit, E | OrderDomainError | VariantNotFound>> {
  const plan = orderEdit.planItems(order, lines);
  if (!plan.success) return plan;
  let variants: readonly SellableVariant[] = [];
  if (plan.data.lookup.length > 0) {
    const looked = await deps.findSellableVariants(plan.data.lookup);
    if (!looked.success) return looked;
    variants = looked.data;
  }
  const applied = orderEdit.applyItems(order, lines, variants, deps.newItemId);
  if (!applied.success) return applied;
  const { changes } = applied.data;
  const returns = changes.removedItemIds.flatMap((itemId) => {
    const stored = order.items.find((candidate) => candidate.id === itemId);
    const units = stored?.stockDeductedQuantity ?? 0;
    return stored && units > 0 ? [{ variantId: stored.variantId, quantity: units as PositiveInteger }] : [];
  });
  return ok({ order: applied.data.order, changes, returns });
}

export type ItemsEditRecords<E extends AppError = AppError> = Readonly<{
  saveItemChanges: (order: OrderAggregate, changes: OrderItemChanges) => Promise<Result<null, E>>;
  /** Gives each verdict to the unverdicted, unsuperseded changes of the items; the first verdict of a change stays. */
  setVerdictsForEdit: (orderId: OrderId, companyId: CompanyId, verdicts: EditVerdicts, at: Date) => Promise<Result<null, E>>;
  /** `Order.sellerActedAt`: the last items edit, undo or confirmed review. */
  saveSellerActedAt: (orderId: OrderId, companyId: CompanyId, at: Date) => Promise<Result<null, E>>;
  clock: () => Date;
}>;

const verdictsOf = (changes: OrderItemChanges): EditVerdicts => [
  { verdict: "quantity_changed" as const, itemIds: changes.updated.map((item) => item.id) },
  { verdict: "removed" as const, itemIds: changes.removedItemIds },
].filter(({ itemIds }) => itemIds.length > 0);

/** Saves the lines, clears the marks of the edited items with their verdicts and records the seller's action. */
export async function writeItemsEdit<E extends AppError>(before: OrderAggregate, planned: PlannedItemsEdit, records: ItemsEditRecords<E>): Promise<Result<null, E>> {
  const saved = await records.saveItemChanges(planned.order, planned.changes);
  if (!saved.success) return saved;
  const at = records.clock();
  const verdicts = verdictsOf(planned.changes);
  if (verdicts.length > 0) {
    const set = await records.setVerdictsForEdit(before.id, before.companyId, verdicts, at);
    if (!set.success) return set;
  }
  const acted = await records.saveSellerActedAt(before.id, before.companyId, at);
  return acted;
}

export type SettleEditStockDependencies = Readonly<{
  /** In-transaction event: the orders listener deducts the stock when the edit made the order due and it fits, or settles the difference of an order that is already deducted. */
  publishStockEvent: (payload: OrderEdited) => Promise<Result<DeductionOutcome, TransactionEndingError>>;
  /** In-transaction event after units went back to the stock: waiting orders that now fit are served. Contained failures come back inside the outcome and are ignored. */
  publishStockIncreased: (variantIds: readonly [VariantId, ...VariantId[]]) => Promise<Result<unknown, TransactionEndingError>>;
  findVariantStock: StockReader;
}>;

/**
 * The single stock tail of an edit, run once by each caller after all its parts are saved: one `order_edited` when items changed (or the delivery changed on an
 * undeducted order), the rollback of a deducted order whose adjustment failed, `product_stock_increased` for the returned variants, and the order's `stockDue`.
 */
export async function settleEditStock(before: OrderAggregate, after: OrderAggregate, parts: Readonly<{ items: boolean; delivery: boolean }>,
  returns: readonly Readonly<{ variantId: VariantId; quantity: PositiveInteger }>[], deps: SettleEditStockDependencies):
  Promise<Result<StockEventResult, TransactionEndingError | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>> {
  if (parts.items || (parts.delivery && !before.stockDeducted)) {
    const outcome = await deps.publishStockEvent({ companyId: before.companyId, orderId: before.id, ...(returns.length > 0 ? { returns } : {}) });
    if (!outcome.success) return outcome;
    // The adjustment must be all or nothing with the edit: a failed or contended listener rolls the edit back, so a deleted line never leaks its deducted units.
    if (before.stockDeducted && (outcome.data.kind === "failed" || outcome.data.kind === "skipped_locked"))
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to adjust the stock of the order" });
    if (outcome.data.kind === "adjusted" && outcome.data.returnedVariantIds[0]) {
      const [firstVariant, ...otherVariants] = outcome.data.returnedVariantIds;
      const served = await deps.publishStockIncreased([firstVariant!, ...otherVariants]);
      if (!served.success) return served;
    }
    return orderWithStockDue(after, outcome.data, deps.findVariantStock);
  }
  const described = await describeOrderStockDue([after], { readStock: deps.findVariantStock, inSnapshot: (read) => read() });
  return described.success ? ok({ order: after, stockDue: described.data.get(after.id) ?? null, outcome: null }) : described;
}
