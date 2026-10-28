import { z } from "zod";
import { listOrderAggregatesResponseSchema, listOrderAggregatesSchema, listOrdersResponseSchema, listOrdersSchema, orderCatalogSchema,
  type ListOrderAggregatesRequest, type UpdateOrderShippingRequest, type ListOrdersRequest, type OrderAggregateResponse, type OrderApiError, type OrderApiIssue } from "@shared/contracts/orders";
import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import { limaMidnightUtc, nextCalendarDay } from "@shared/orders-date";
import type { Result } from "@shared/result";
import { addDraftItem, emptyOrderDraft, prepareOrder, ratedDeliveryAssignmentSchema, type CartError, type OrderDraft, type OrderSubmission, type RatedDeliveryAssignment } from "@mobile/features/orders/domain/order-draft";
import type { TransportError } from "@mobile/shared/application/transport-error";
import type { PendingOrderSyncSummary } from "@mobile/features/orders/application/pending-order-sync";

export type PendingOrderConfirmation = Readonly<{
  companyId: OrderAggregateResponse["companyId"];
  id: string;
  shownTotal: Money;
  version: 2;
  request: OrderSubmission;
  /** Set when core refused the sale; it is no longer retried until the seller reviews it. */
  rejection?: Readonly<{ code: string; message: string; /** The item core could not find, when it said which. */ variantId?: string }>;
  /** «L / Azul» per item, as the seller saw it when the sale was built: a review names an item that is gone from the catalog. */
  itemLabels?: Readonly<Record<string, string>>;
}>;
export type PendingOrderStoreError = Readonly<{
  code: "PENDING_CONFIRMATION" | "PENDING_STORAGE_UNAVAILABLE" | "INVALID_PENDING_DATA";
  message: string;
}>;
export type OrderRequestError = Readonly<{
  code: TransportError["code"] | OrderApiError["code"];
  message: string;
  issues?: readonly OrderApiIssue[];
  currentPrice?: Money;
}>;
export type RejectPaymentOutcome =
  | Readonly<{ kind: "rejected"; order: OrderAggregateResponse }>
  | Readonly<{ kind: "already_reviewed" | "order_cancelled" | "unknown" }>
  | Readonly<{ kind: "failed"; error: OrderRequestError }>;
const unknownResult = new Set<string>(["NETWORK_ERROR", "SERVER_ERROR", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR", "INVALID_RESPONSE"] satisfies OrderRequestError["code"][]);
/** How a failed payment confirmation reads to the seller: reviewed by somebody else, a lost answer to reload, or a plain failure. */
export function confirmPaymentFailure(code: OrderRequestError["code"]): "already_reviewed" | "unknown" | "failed" {
  if (code === "PAYMENT_CONFLICT" || code === "INVALID_TRANSITION") return "already_reviewed";
  return unknownResult.has(code) ? "unknown" : "failed";
}
export type ConfirmOrderError = OrderRequestError | PendingOrderStoreError | CartError;
export type ConfirmOrderOutcome =
  | Readonly<{ kind: "completed"; order: OrderAggregateResponse; shownTotal: Money }>
  | Readonly<{ kind: "queued"; pending: PendingOrderConfirmation }>;

export type PendingOrderReview = Readonly<{
  kind: "review"; pending: PendingOrderConfirmation; draft: OrderDraft;
  unavailableVariantIds: readonly string[];
  /** Labels of the unavailable items, when the sale was saved with them. */
  unavailableLabels: Readonly<Record<string, string>>;
}>;
const itemLabelsOf = (draft: OrderDraft): Record<string, string> => draft.kind !== "items" ? {} : Object.fromEntries(draft.items
  .map((item) => [item.variantId, Object.values(item.variantAttributes).join(" / ")] as const).filter(([, label]) => label));

export type OrderListCriteria = Readonly<{
  page: number;
  customer: { kind: "all" } | { kind: "general_public" };
  search?: string;
  view?: "all" | "unpaid" | "undelivered";
  fromDay?: string;
  throughDay?: string;
  deliveryStatus?: "pending" | "shipped" | "delivered";
  courierId?: string;
  scheduledFrom?: string;
  scheduledThrough?: string;
  unscheduled?: true;
  shippedFromDay?: string;
  shippedThroughDay?: string;
}>;

export type { RatedDeliveryAssignment } from "@mobile/features/orders/domain/order-draft";

type Api = Readonly<{
  setDelivery: (orderId: string, input: RatedDeliveryAssignment) => Promise<Result<OrderAggregateResponse, OrderRequestError>>;
  enableCheckout: (orderId: string) => Promise<Result<Readonly<{ url: string }>, OrderRequestError>>;
  listAggregates: (input: ListOrderAggregatesRequest) => Promise<Result<z.infer<typeof listOrderAggregatesResponseSchema>, OrderRequestError>>;
  getAggregate: (id: string) => Promise<Result<OrderAggregateResponse, OrderRequestError>>;
  list: (input: ListOrdersRequest) => Promise<Result<z.infer<typeof listOrdersResponseSchema>, OrderRequestError>>;
  get: (id: string) => Promise<Result<OrderAggregateResponse, OrderRequestError>>;
  rejectPayment: (orderId: string, paymentId: string, reason: string | null) => Promise<Result<OrderAggregateResponse, OrderRequestError>>;
  updateShipping: (orderId: string, input: UpdateOrderShippingRequest) => Promise<Result<OrderAggregateResponse, OrderRequestError>>;
  create: (input: OrderSubmission) => Promise<Result<OrderAggregateResponse, OrderRequestError>>;
  findCatalog: (variantIds: readonly string[]) => Promise<Result<z.infer<typeof orderCatalogSchema>, OrderRequestError>>;
  searchCatalog: (search: string) => Promise<Result<z.infer<typeof orderCatalogSchema>, OrderRequestError>>;
}>;
type PendingStore = Readonly<{
  list: (companyId: string) => Promise<Result<PendingOrderConfirmation[], PendingOrderStoreError>>;
  read: (companyId: string, id: string) => Promise<Result<PendingOrderConfirmation | null, PendingOrderStoreError>>;
  save: (pending: PendingOrderConfirmation) => Promise<Result<PendingOrderConfirmation, PendingOrderStoreError>>;
  clear: (companyId: string, id: string) => Promise<Result<void, PendingOrderStoreError>>;
  discard: (companyId: string) => Promise<Result<void, PendingOrderStoreError>>;
  replace: (previous: PendingOrderConfirmation, next: PendingOrderConfirmation) => Promise<Result<PendingOrderConfirmation, PendingOrderStoreError>>;
}>;

function listRequest(criteria: OrderListCriteria): Result<ListOrdersRequest, OrderRequestError> {
  if ((criteria.fromDay && !z.iso.date().safeParse(criteria.fromDay).success) ||
      (criteria.throughDay && !z.iso.date().safeParse(criteria.throughDay).success) ||
      (criteria.fromDay && criteria.throughDay && criteria.fromDay > criteria.throughDay))
    return err({ code: "INVALID_INPUT", message: "Invalid order days" });
  const parsed = listOrdersSchema.safeParse({ page: criteria.page, customer: criteria.customer.kind,
    ...(criteria.fromDay ? { completedFrom: limaMidnightUtc(criteria.fromDay) } : {}),
    ...(criteria.throughDay ? { completedBefore: limaMidnightUtc(nextCalendarDay(criteria.throughDay)) } : {}),
  });
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_INPUT", message: "Invalid order filters" });
}

const validRange = (from?: string, through?: string) => [from, through].every(day => !day || z.iso.date().safeParse(day).success) && !(from && through && from > through);

function mixedListRequest(criteria: OrderListCriteria): Result<ListOrderAggregatesRequest, OrderRequestError> {
  if (!validRange(criteria.fromDay, criteria.throughDay) || !validRange(criteria.scheduledFrom, criteria.scheduledThrough) ||
      !validRange(criteria.shippedFromDay, criteria.shippedThroughDay) ||
      (criteria.unscheduled && (criteria.scheduledFrom || criteria.scheduledThrough)))
    return err({ code: "INVALID_INPUT", message: "Invalid order days" });
  const parsed = listOrderAggregatesSchema.safeParse({ page: criteria.page, customer: criteria.customer.kind,
    ...(criteria.search ? { search: criteria.search.trim() } : {}), ...(criteria.view ? { view: criteria.view } : {}),
    ...(criteria.fromDay ? { createdFrom: limaMidnightUtc(criteria.fromDay) } : {}),
    ...(criteria.throughDay ? { createdBefore: limaMidnightUtc(nextCalendarDay(criteria.throughDay)) } : {}),
    ...(criteria.deliveryStatus ? { deliveryStatus: criteria.deliveryStatus } : {}), ...(criteria.courierId ? { courierId: criteria.courierId } : {}),
    ...(criteria.scheduledFrom ? { scheduledFrom: criteria.scheduledFrom } : {}), ...(criteria.scheduledThrough ? { scheduledThrough: criteria.scheduledThrough } : {}),
    ...(criteria.unscheduled ? { unscheduled: "true" } : {}),
    ...(criteria.shippedFromDay ? { shippedFrom: limaMidnightUtc(criteria.shippedFromDay) } : {}),
    ...(criteria.shippedThroughDay ? { shippedBefore: limaMidnightUtc(nextCalendarDay(criteria.shippedThroughDay)) } : {}),
  });
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_INPUT", message: "Invalid order filters" });
}

const definitive = new Set<string>(["INVALID_INPUT", "UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE",
  "INVALID_ORDER", "CURRENCY_MISMATCH", "VARIANT_NOT_FOUND", "INSUFFICIENT_STOCK",
  "INVALID_PAYMENT", "PAYMENT_CONFLICT", "PAYMENT_REQUIRED", "INVALID_TRANSITION", "STOCK_NOT_DEDUCTED",
  "DELIVERY_UNAVAILABLE", "DELIVERY_METHOD_DISABLED", "RATE_UNAVAILABLE", "TOTAL_CHANGED", "INVALID_DISTRICT", "INVALID_DELIVERY_RATE"] satisfies OrderRequestError["code"][]);
type Outcome = Promise<Result<ConfirmOrderOutcome, ConfirmOrderError>>;

export function createOrderOperations(api: Api, pendingStore: PendingStore) {
  // One request per sale at a time: a double tap and the background sync share the same attempt.
  const inFlight = new Map<string, Outcome>();
  const once = (companyId: string, id: string, work: () => Outcome): Outcome => {
    const key = `${companyId}/${id}`;
    const current = inFlight.get(key);
    if (current) return current;
    const promise = work().finally(() => { inFlight.delete(key); });
    inFlight.set(key, promise);
    return promise;
  };
  const confirmed = async (order: OrderAggregateResponse, pending: PendingOrderConfirmation): Outcome => {
    if (order.companyId !== pending.companyId || order.id !== pending.id ||
      (order.status === "completed" && (order.paymentStatus !== "paid" || order.balanceDue.amount !== 0 || order.deliveryStatus !== "delivered" || !order.stockDeducted)))
      return err({ code: "INVALID_RESPONSE", message: "Order identity or state mismatch" });
    // A failed clear leaves the sale queued; the next sync finds it in core and clears it then.
    await pendingStore.clear(pending.companyId, pending.id);
    return ok({ kind: "completed", order, shownTotal: pending.shownTotal });
  };
  const queued = (pending: PendingOrderConfirmation): Outcome => Promise.resolve(ok({ kind: "queued", pending }));
  /** Core refused the sale: it stops retrying and waits for the seller to review it. */
  const reject = async (pending: PendingOrderConfirmation, error: OrderRequestError): Outcome => {
    const variantId = error.issues?.find((issue) => issue.variantId)?.variantId;
    await pendingStore.replace(pending, { ...pending, rejection: { code: error.code, message: error.message.slice(0, 500), ...(variantId ? { variantId } : {}) } });
    return err(error);
  };
  const post = async (pending: PendingOrderConfirmation, onRejected: "clear" | "keep"): Outcome => {
    const result = await api.create(pending.request);
    if (result.success) return confirmed(result.data, pending);
    if (definitive.has(result.error.code)) {
      if (onRejected === "keep") return reject(pending, result.error);
      const cleared = await pendingStore.clear(pending.companyId, pending.id);
      return cleared.success ? result : cleared;
    }
    // A lost response or ORDER_ALREADY_EXISTS may mean core already has it.
    const found = await api.get(pending.id);
    return found.success ? confirmed(found.data, pending) : queued(pending);
  };
  /** Checks core first and only resends the stored request when the sale is not there. */
  const attempt = async (pending: PendingOrderConfirmation): Outcome => {
    const found = await api.get(pending.id);
    if (found.success) return confirmed(found.data, pending);
    return found.error.code === "ORDER_NOT_FOUND" ? post(pending, "keep") : queued(pending);
  };
  const send = async (draft: OrderDraft, companyId: string): Outcome => {
    const prepared = prepareOrder(draft);
    if (!prepared.success) return prepared;
    const itemLabels = itemLabelsOf(draft);
    const saved = await pendingStore.save({ version: 2, companyId, id: prepared.data.request.id,
      shownTotal: prepared.data.shownTotal, request: prepared.data.request, ...(Object.keys(itemLabels).length ? { itemLabels } : {}) });
    if (!saved.success) return saved;
    return saved.data.rejection ? err({ code: "PENDING_CONFIRMATION", message: "Saved sale needs review" }) : post(saved.data, "clear");
  };
  const syncPendingOrders = async (companyId: string): Promise<PendingOrderSyncSummary> => {
    const pending = await pendingStore.list(companyId);
    if (!pending.success) return { waiting: pending.error.code === "PENDING_STORAGE_UNAVAILABLE" ? 1 : 0 };
    let waiting = 0;
    for (const entry of pending.data.filter(entry => !entry.rejection)) {
      const result = await once(companyId, entry.id, () => attempt(entry));
      if (result.success && result.data.kind === "queued") waiting += 1;
      else if (!result.success && !definitive.has(result.error.code)) waiting += 1;
    }
    return { waiting };
  };
  /** A lost answer is "unknown": the caller reloads the order before repeating, and a repeat returns the same rejection. */
  const rejectPayment = async (orderId: string, paymentId: string, reason: string | null): Promise<RejectPaymentOutcome> => {
    const result = await api.rejectPayment(orderId, paymentId, reason);
    if (result.success) return { kind: "rejected", order: result.data };
    const { code } = result.error;
    if (code === "PAYMENT_CONFLICT" || code === "INVALID_TRANSITION") return { kind: "already_reviewed" };
    if (code === "ORDER_CANCELLED") return { kind: "order_cancelled" };
    return unknownResult.has(code) ? { kind: "unknown" } : { kind: "failed", error: result.error };
  };
  return {
    rejectPayment,
    setDelivery: api.setDelivery,
    loadMixedOrders: async (criteria: OrderListCriteria) => {
      const input = mixedListRequest(criteria);
      return input.success ? api.listAggregates(input.data) : input;
    },
    loadOrderAggregate: api.getAggregate,
    updateOrderShipping: api.updateShipping,
    enableOrderCheckout: api.enableCheckout,
    loadOrders: async (criteria: OrderListCriteria) => {
      const input = listRequest(criteria);
      return input.success ? api.list(input.data) : input;
    },
    loadOrder: api.get,
    searchOrderCatalog: api.searchCatalog,
    loadOrderCatalog: api.findCatalog,
    listPendingOrders: pendingStore.list,
    discardPendingOrderConfirmation: pendingStore.discard,
    syncPendingOrders,
    completeOrder: (draft: OrderDraft, companyId: string) => draft.kind === "items" ? once(companyId, draft.id, () => send(draft, companyId)) : send(draft, companyId),
    loadPendingOrderReview: async (companyId: string, id: string): Promise<Result<PendingOrderReview | ConfirmOrderOutcome, ConfirmOrderError>> => {
      const pending = await pendingStore.read(companyId, id);
      if (!pending.success) return pending;
      if (!pending.data) return err({ code: "PENDING_CONFIRMATION", message: "No saved request to review" });
      const saved = pending.data;
      const request = pending.data.request;
      const found = await api.get(saved.id);
      if (found.success) return confirmed(found.data, saved);
      if (found.error.code !== "ORDER_NOT_FOUND") return found;
      const catalog = await api.findCatalog(request.items.map(item => item.variantId));
      if (!catalog.success) return catalog;
      if (request.payments?.some(payment => payment.amount.currency !== saved.shownTotal.currency))
        return err({ code: "CURRENCY_MISMATCH", message: "Saved payment currency differs" });
      let draft: OrderDraft = { ...emptyOrderDraft(), id: saved.id,
        payments: request.payments?.map(payment => ({ ...payment, amount: String(payment.amount.amount) })),
        deliverImmediately: request.deliverImmediately, scheduledDispatchDate: request.scheduledDispatchDate };
      const unavailableVariantIds: string[] = [];
      for (const item of request.items) {
        const product = catalog.data.find(product => product.variants.some(variant => variant.id === item.variantId));
        const variant = product?.variants.find(variant => variant.id === item.variantId);
        if (!product || !variant) { unavailableVariantIds.push(item.variantId); continue; }
        if (product.currency !== saved.shownTotal.currency) return err({ code: "CURRENCY_MISMATCH", message: "Saved product currency differs" });
        const added = addDraftItem(draft, { variantId: variant.id, quantity: item.quantity, productName: product.name,
          variantAttributes: variant.attributes, sku: variant.sku, shownUnitPrice: { amount: variant.price, currency: product.currency }, shownStock: variant.stock }, () => saved.id);
        if (!added.success) return added;
        draft = added.data;
      }
      if (request.delivery && "expectedPrice" in request.delivery) {
        const delivery = ratedDeliveryAssignmentSchema.safeParse(request.delivery);
        if (!delivery.success) return err({ code: "INVALID_CART", message: "Invalid saved delivery" });
        draft = { ...draft, ratedDelivery: delivery.data };
      }
      const unavailableLabels = Object.fromEntries(unavailableVariantIds.flatMap((id) => saved.itemLabels?.[id] ? [[id, saved.itemLabels[id]] as const] : []));
      return ok({ kind: "review", pending: saved, draft, unavailableVariantIds, unavailableLabels });
    },
    /** Saves the seller's corrections to a refused sale under the same identities and sends it again. */
    reviewPendingOrder: (companyId: string, draft: OrderDraft) => draft.kind !== "items"
      ? Promise.resolve(err({ code: "PENDING_CONFIRMATION" as const, message: "No matching saved attempt to review" }))
      : once(companyId, draft.id, async () => {
        const pending = await pendingStore.read(companyId, draft.id);
        if (!pending.success) return pending;
        if (!pending.data) return err({ code: "PENDING_CONFIRMATION", message: "No matching saved attempt to review" });
        const found = await api.get(pending.data.id);
        if (found.success) return confirmed(found.data, pending.data);
        if (found.error.code !== "ORDER_NOT_FOUND") return found;
        const prepared = prepareOrder(draft);
        if (!prepared.success) return prepared;
        const { rejection: _rejection, ...current } = pending.data;
        const itemLabels = { ...current.itemLabels, ...itemLabelsOf(draft) };
        const saved = await pendingStore.replace(pending.data, { ...current, shownTotal: prepared.data.shownTotal, request: prepared.data.request, ...(Object.keys(itemLabels).length ? { itemLabels } : {}) });
        return saved.success ? post(saved.data, "keep") : saved;
      }),
  };
}
