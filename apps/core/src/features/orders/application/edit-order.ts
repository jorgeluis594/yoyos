import { err, ok } from "@shared/functional";
import type { Currency, Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { PeruDistrictError } from "@shared/peru-geography";
import type { ResolveRateError } from "@core/src/features/delivery-settings";
import type { TransactionEndingError } from "@core/src/shared/application/contained-failure";
import type { BuyerData, OrderBuyer } from "@core/src/features/orders/domain/checkout";
import type { SellableVariant } from "@core/src/features/orders/domain/catalog-order";
import type { CompanyId, OrderId, OrderItemId, PositiveInteger } from "@core/src/features/orders/domain/order";
import { orderEdit, type CustomerRequired, type DeliveryEdit, type OrderItemChanges, type OrderLineRequest, type OrderPart, type VariantNotFound } from "@core/src/features/orders/domain/order-edit";
import { orderRevisions, type OrderRevision } from "@core/src/features/orders/domain/order-revisions";
import { orderStateMachine, type OrderAggregate, type OrderDomainError, type RatedDeliverySelection, type ResolvedDelivery } from "@core/src/features/orders/domain/order-state-machine";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { OrderEdited } from "@core/src/features/orders/application/events";
import type { DeductionOutcome } from "@core/src/features/orders/application/deduct-due-stock";
import { describeOrderStockDue, orderWithStockDue, type StockEventResult, type StockReader } from "@core/src/features/orders/application/describe-order-stock-due";

export type EditOrderInput = Readonly<{
  orderId: OrderId;
  items?: Readonly<{ base: OrderRevision; lines: readonly [OrderLineRequest, ...OrderLineRequest[]] }>;
  customer?: Readonly<{ base: OrderRevision; value: BuyerData | null }>;
  delivery?: Readonly<{ base: OrderRevision; change: DeliveryEdit }>;
}>;
export type EditOrderAccess = OrderAccess;

export type EditOrderError =
  | OrderDomainError | ResolveRateError | PeruDistrictError
  | Readonly<{ code: "INVALID_INPUT" | "ORDER_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA" | "DELIVERY_UNAVAILABLE" | "DELIVERY_METHOD_DISABLED"; message: string }>
  | CustomerRequired
  | Readonly<{ code: "ORDER_CHANGED"; message: string; parts: readonly [OrderPart, ...OrderPart[]] }>
  | VariantNotFound
  | TransactionEndingError;

export type EditOrderDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, EditOrderError>>) => Promise<Result<T, EditOrderError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, EditOrderError>>;
  /** Products capability: active variants only, one batched lookup. */
  findSellableVariants: (ids: readonly VariantId[]) => Promise<Result<readonly SellableVariant[], EditOrderError>>;
  resolveRatedDelivery: (selection: RatedDeliverySelection, access: OrderAccess, currency: Currency, expectedPrice: Money) => Promise<Result<ResolvedDelivery, EditOrderError>>;
  saveItemChanges: (order: OrderAggregate, changes: OrderItemChanges) => Promise<Result<null, EditOrderError>>;
  saveOrderCustomer: (id: OrderId, companyId: CompanyId, buyer: OrderBuyer | null) => Promise<Result<null, EditOrderError>>;
  saveDelivery: (id: OrderId, companyId: CompanyId, change: Pick<OrderAggregate, "delivery" | "deliveryCost" | "deliveryCharge" | "total">) => Promise<Result<null, EditOrderError>>;
  /** In-transaction event: the orders listener deducts the stock when the edit made the order due and it fits, or settles the difference of an order that is already deducted. */
  publishStockEvent: (payload: OrderEdited) => Promise<Result<DeductionOutcome, TransactionEndingError>>;
  /** In-transaction event after units went back to the stock: waiting orders that now fit are served. Contained failures come back inside the outcome and are ignored. */
  publishStockIncreased: (variantIds: readonly [VariantId, ...VariantId[]]) => Promise<Result<unknown, TransactionEndingError>>;
  findVariantStock: StockReader;
  newItemId: () => OrderItemId;
}>;

export type EditedOrder = StockEventResult & Readonly<{ applied: readonly OrderPart[] }>;

/** The parts that differ from the stored state, in the fixed order items, customer, delivery. */
function pendingParts(order: OrderAggregate, input: EditOrderInput): OrderPart[] {
  return (["items", "customer", "delivery"] as const).filter((part) => input[part] !== undefined && !orderEdit.isApplied(order, input, part));
}

/**
 * Applies the final state of the sent parts under the order lock. A part already equal to the stored state is dropped (idempotent repeat),
 * the others are refused by the state locks, then by their revision, and then written. It never touches payments, never moves stock itself and never refuses for stock:
 * when items or delivery changed it publishes `order_edited`; the orders listener deducts the stock if the order became due, or settles the difference
 * (with the deducted units of the deleted lines in the payload) when the stock was already deducted.
 */
export async function editOrder(input: EditOrderInput, access: EditOrderAccess, deps: EditOrderDependencies): Promise<Result<EditedOrder, EditOrderError>> {
  if (!input.items && !input.customer && !input.delivery) return err({ code: "INVALID_INPUT", message: "An edit needs at least one part" });
  return deps.transaction(access.companyId, async () => {
    const found = await deps.findOrderForUpdate(input.orderId, access.companyId);
    if (!found.success) return found;
    const order = found.data;
    if (!order) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });

    const parts = pendingParts(order, input);
    if (parts.length === 0) {
      const described = await describeOrderStockDue([order], { readStock: deps.findVariantStock, inSnapshot: (read) => read() });
      return described.success ? ok({ order, stockDue: described.data.get(order.id) ?? null, outcome: null, applied: [] }) : described;
    }
    const locked = orderEdit.checkLocks(order, new Set(parts));
    if (!locked.success) return locked;
    const required = parts.includes("customer") ? orderEdit.checkCustomerRequired(order, input) : ok(null);
    if (!required.success) return required;

    const revisions = orderRevisions(order);
    const changedElsewhere = parts.filter((part) => input[part]?.base !== revisions[part]);
    const [firstChanged, ...otherChanged] = changedElsewhere;
    if (firstChanged) return err({ code: "ORDER_CHANGED", message: "The order changed since it was loaded", parts: [firstChanged, ...otherChanged] });

    let next = order;
    let itemChanges: OrderItemChanges | null = null;
    let afterItems = order;
    if (parts.includes("items") && input.items) {
      const plan = orderEdit.planItems(order, input.items.lines);
      if (!plan.success) return plan;
      let variants: readonly SellableVariant[] = [];
      if (plan.data.lookup.length > 0) {
        const looked = await deps.findSellableVariants(plan.data.lookup);
        if (!looked.success) return looked;
        variants = looked.data;
      }
      const applied = orderEdit.applyItems(order, input.items.lines, variants, deps.newItemId);
      if (!applied.success) return applied;
      next = afterItems = applied.data.order;
      itemChanges = applied.data.changes;
    }
    if (parts.includes("customer") && input.customer) next = orderEdit.applyCustomer(next, input.customer.value);
    if (parts.includes("delivery") && input.delivery) {
      const change = input.delivery.change;
      const author = { kind: "seller" as const, userId: access.userId };
      if (change.kind === "amend") {
        const amended = orderEdit.amendDelivery(next, change.amendment, author);
        if (!amended.success) return amended;
        next = amended.data;
      } else {
        const allowed = orderStateMachine.canSetDelivery(next);
        if (!allowed.success) return allowed;
        const resolved = await deps.resolveRatedDelivery(change.selection, access, next.total.currency, change.expectedPrice);
        if (!resolved.success) return resolved;
        const replaced = orderStateMachine.setDelivery(next, { resolved: resolved.data });
        if (!replaced.success) return replaced;
        next = replaced.data;
      }
    }
    const summary = orderStateMachine.getPaymentSummary(next);
    if (!summary.success) return summary;

    // The units of lines the edit deleted are read before the rows go: the listener returns them to the stock.
    const returns = (itemChanges?.removedItemIds ?? []).flatMap((itemId) => {
      const item = order.items.find((candidate) => candidate.id === itemId);
      const units = item?.stockDeductedQuantity ?? 0;
      return item && units > 0 ? [{ variantId: item.variantId, quantity: units as PositiveInteger }] : [];
    });
    if (itemChanges) {
      const saved = await deps.saveItemChanges(afterItems, itemChanges);
      if (!saved.success) return saved;
    }
    if (parts.includes("customer")) {
      const saved = await deps.saveOrderCustomer(order.id, order.companyId, next.buyer);
      if (!saved.success) return saved;
    }
    if (parts.includes("delivery")) {
      const saved = await deps.saveDelivery(order.id, order.companyId, next);
      if (!saved.success) return saved;
    }

    if (parts.includes("items") || (parts.includes("delivery") && !order.stockDeducted)) {
      const outcome = await deps.publishStockEvent({ companyId: order.companyId, orderId: order.id, ...(returns.length > 0 ? { returns } : {}) });
      if (!outcome.success) return outcome;
      // The adjustment must be all or nothing with the edit: a failed or contended listener rolls the edit back, so a deleted line never leaks its deducted units.
      if (order.stockDeducted && (outcome.data.kind === "failed" || outcome.data.kind === "skipped_locked"))
        return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to adjust the stock of the order" });
      if (outcome.data.kind === "adjusted" && outcome.data.returnedVariantIds[0]) {
        const [firstVariant, ...otherVariants] = outcome.data.returnedVariantIds;
        const served = await deps.publishStockIncreased([firstVariant!, ...otherVariants]);
        if (!served.success) return served;
      }
      const result = await orderWithStockDue(next, outcome.data, deps.findVariantStock);
      return result.success ? ok({ ...result.data, applied: parts }) : result;
    }
    const described = await describeOrderStockDue([next], { readStock: deps.findVariantStock, inSnapshot: (read) => read() });
    return described.success ? ok({ order: next, stockDue: described.data.get(next.id) ?? null, outcome: null, applied: parts }) : described;
  });
}
